"""AI agents: CRUD, runs, stop. Built-in agents are deterministic analytics over the user's data (port of agent-runner.js)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from ..ai.rules import build_report
from ..core.textutil import uid
from ..core.timeutil import fmt_date, fmt_time, is_same_day, utcnow
from ..deps import Ctx, current, fail, not_found
from ..models import Agent, AgentRun
from ..schemas import AgentIn
from ..serialize import agent_out, run_out
from ..services.store import MEMORY_TYPES, Store

router = APIRouter()


def planner(s: Store) -> dict:
    tz, now = s.tz, utcnow()
    tasks = [t for t in s.tasks() if not t.done and t.due_at and (is_same_day(t.due_at, now, tz) or t.due_at < now)]
    events = [e for e in s.events() if is_same_day(e.start_at, now, tz)]
    pref = next((m for m in s.memories() if m.type == "preference" and "встреч" in (m.title + m.content).lower()), None)
    items = [(e.start_at, f"{fmt_time(e.start_at, tz)} — {e.title}{' (' + e.location + ')' if e.location else ''}") for e in events]
    for t in tasks:
        late = t.due_at < now
        items.append((now if late else t.due_at, f"{'Сначала' if late else fmt_time(t.due_at, tz)} — {t.title}{' (просрочено)' if late else ''}"))
    items.sort(key=lambda x: x[0])
    body = "\n".join("- " + x[1] for x in items) if items else "- Задач и событий на сегодня нет — хороший день для стратегических дел."
    return {"steps": ["Читаю задачи на сегодня", "Проверяю календарь", "Учитываю предпочтения из памяти", "Составляю план"],
            "result": f"## План на {fmt_date(now, tz)}\n\n{body}{chr(10) * 2 + '**Учтено предпочтение:** ' + pref.content if pref else ''}"
                      "\n\n**Совет:** оставь 1–2 часа без встреч для сосредоточенной работы."}


def network(s: Store) -> dict:
    people = sorted(s.people(), key=lambda p: p.updated_at)[:3]
    if not people:
        return {"steps": ["Загружаю контакты"], "result": "В памяти пока нет контактов. Расскажи Adis о своих знакомствах."}
    blocks = [f"**{p.name}** — {p.profession or 'знакомый'}; последний контакт {fmt_date(p.updated_at, s.tz)}.\n"
              f"> Привет, {p.name.split(' ')[0]}! Давно не общались — как {'дела в ' + p.organization if p.organization else 'твои дела'}? "
              "Есть пара идей, хотел бы обсудить." for p in people]
    return {"steps": ["Загружаю контакты", "Анализирую историю взаимодействий", "Готовлю сообщения"],
            "result": "## С кем стоит связаться\n\n" + "\n\n".join(blocks)}


def memory(s: Store) -> dict:
    mems, people = s.memories(), s.people()
    by: dict[str, int] = {}
    tags: dict[str, int] = {}
    for m in mems:
        by[m.type] = by.get(m.type, 0) + 1
        for t in m.tags or []:
            tags[t] = tags.get(t, 0) + 1
    unconfirmed = [m for m in mems if not m.confirmed]
    top = [t for t, _ in sorted(tags.items(), key=lambda x: -x[1])[:5]]
    lines = "\n".join(f"- {MEMORY_TYPES.get(k, (k,))[0]}: {v}" for k, v in by.items())
    return {"steps": ["Считаю записи по категориям", "Ищу неподтверждённые данные", "Выделяю ключевые темы"],
            "result": f"## Анализ памяти\n\nВсего записей: **{len(mems)}**, людей: **{len(people)}**.\n\n{lines}\n\n"
                      f"**Требуют подтверждения:** {', '.join('«' + m.title + '»' for m in unconfirmed) if unconfirmed else 'нет'}\n\n"
                      f"**Главные темы:** {', '.join(top) if top else '—'}"}


def generic(agent: Agent, s: Store, note: str = "") -> dict:
    """Answer for a custom agent when no language model is available."""
    active = sum(1 for t in s.tasks() if not t.done)
    return {"steps": ["Загружаю инструкции агента", "Формирую результат"],
            "result": f"## {agent.name}\n\n**Инструкция:** {agent.instructions or '—'}\n\nДоступно данных: {len(s.memories())} записей памяти, "
                      f"{active} активных задач, {len(s.people())} людей.\n\n_{note or 'Языковая модель не подключена: пользовательский агент не может выполнить инструкцию.'}_"}


# Agent permissions (as chosen in the app) -> read-only LLM tools. Agents never write: their result is a report, not a confirmable card.
AGENT_TOOL_MAP = {
    "memory_search": {"memory_search"},
    "memory_save": {"memory_search"},
    "entity_lookup": {"entity_lookup"},
    "task_create": {"task_list", "event_list"},
    "task_update": {"task_list", "event_list"},
    "notification_schedule": {"task_list", "event_list"},
    "proactive_suggestion": {"task_list", "event_list", "memory_search"},
    "finance": {"finance_report", "debt_list"},
}


def agent_tools(agent: Agent) -> set[str]:
    out: set[str] = set()
    for t in agent.tools or []:
        out |= AGENT_TOOL_MAP.get(t, set())
    return out


def agent_prompt(agent: Agent, s: Store) -> str:
    from datetime import datetime

    now = datetime.now(s.tz)
    offset = now.strftime("%z")
    return (
        f"Ты — AI-агент «{agent.name}» внутри персонального помощника Adis. Пользователь: {s.user.name}.\n"
        f"Сейчас {now.strftime('%Y-%m-%d %H:%M')}, часовой пояс {s.tz.key} (UTC{offset[:3]}:{offset[3:]}). Даты в инструментах — ISO 8601 с этим смещением.\n"
        + (f"Назначение агента: {agent.description}\n" if agent.description else "")
        + "\nВыполни инструкцию пользователя по его данным. Сначала собери факты доступными инструментами, не выдумывай данные. "
        "Ты работаешь только на чтение: ничего не создаёшь и не меняешь, а даёшь отчёт и конкретные рекомендации. "
        "Если данных не хватает — так и скажи и предложи, что пользователю стоит добавить.\n"
        "Формат: Markdown, начни с заголовка «## …», затем коротко и по делу, списками. На языке пользователя. "
        "Это разовый отчёт, диалога после него не будет: не задавай вопросов и не предлагай «если хочешь, могу…»."
    )


async def run_custom(agent: Agent, s: Store) -> dict:
    from ..ai.base import EngineError, TOOL_LABELS, TurnContext
    from ..ai.llm import LLMEngine
    from ..config import settings

    if not settings.llm_enabled:
        return generic(agent, s)
    ctx = TurnContext(store=s, text=agent.instructions or agent.description or f"Выполни задачу агента «{agent.name}».",
                      streaming=False, source="agent", system_override=agent_prompt(agent, s), allowed_tools=agent_tools(agent))
    final: dict = {}
    try:
        async for evt in LLMEngine().respond(ctx):
            if evt["type"] == "final":
                final = evt
    except EngineError as e:
        return generic(agent, s, f"{e} Агент выполнится, когда модель снова будет доступна.")
    steps = ["Читаю инструкцию агента"]
    for call in final.get("toolCalls") or []:
        label = TOOL_LABELS.get(call["name"], f"Вызываю {call['name']}…").rstrip("…")
        if label not in steps:
            steps.append(label)
    steps.append("Формирую результат")
    return {"steps": steps, "result": final.get("content") or "Готово."}


RUNNERS = {"planner": planner, "network": network, "memory": memory,
           "weekly": lambda s: {"steps": ["Собираю задачи за неделю", "Собираю знакомства", "Формирую отчёт"], "result": build_report(s)}}


def _own(ctx: Ctx, aid: str) -> Agent:
    a = ctx.db.get(Agent, aid)
    if not a or a.user_id != ctx.user.id:
        not_found()
    return a


def agents_export(ctx: Ctx) -> dict:
    agents = list(ctx.db.scalars(select(Agent).where(Agent.user_id == ctx.user.id)))
    runs = list(ctx.db.scalars(select(AgentRun).where(AgentRun.user_id == ctx.user.id)))
    return {"agents": [agent_out(a) for a in agents], "agentRuns": [run_out(r) for r in runs]}


@router.get("/agents")
def agents(ctx: Ctx = Depends(current)):
    return [agent_out(a) for a in ctx.db.scalars(select(Agent).where(Agent.user_id == ctx.user.id).order_by(Agent.created_at))]


@router.post("/agents")
def create(body: AgentIn, ctx: Ctx = Depends(current)):
    if not (body.name or "").strip():
        fail(422, "Введите название агента")
    a = Agent(id=uid("ag"), user_id=ctx.user.id, name=body.name.strip(), description=body.description or "",
              instructions=body.instructions or "", tools=body.tools or [])
    ctx.db.add(a)
    ctx.db.commit()
    return agent_out(a)


@router.patch("/agents/{aid}")
def update(aid: str, body: AgentIn, ctx: Ctx = Depends(current)):
    a = _own(ctx, aid)
    for k, v in body.patch().items():
        if v is not None and not (k == "name" and not v.strip()):
            setattr(a, k, v)
    ctx.db.commit()
    return agent_out(a)


@router.delete("/agents/{aid}")
def remove(aid: str, ctx: Ctx = Depends(current)):
    ctx.db.delete(_own(ctx, aid))
    ctx.db.commit()
    return {"ok": True}


@router.get("/agents/{aid}/runs")
def runs(aid: str, ctx: Ctx = Depends(current)):
    _own(ctx, aid)
    rows = ctx.db.scalars(select(AgentRun).where(AgentRun.agent_id == aid).order_by(AgentRun.started_at.desc()))
    return [run_out(r) for r in rows]


@router.post("/agents/{aid}/runs")
async def run(aid: str, ctx: Ctx = Depends(current)):
    a = _own(ctx, aid)
    s = Store(ctx.db, ctx.user, ctx.tz)
    started = utcnow()
    res = RUNNERS[a.builtin](s) if a.builtin in RUNNERS else await run_custom(a, s)
    r = AgentRun(id=uid("run"), agent_id=a.id, user_id=ctx.user.id, status="completed", steps=res["steps"], result=res["result"],
                 started_at=started, finished_at=utcnow())
    ctx.db.add(r)
    ctx.db.commit()
    return run_out(r)


@router.post("/agents/runs/{rid}/stop")
def stop(rid: str, ctx: Ctx = Depends(current)):
    r = ctx.db.get(AgentRun, rid)
    if not r or r.user_id != ctx.user.id:
        return {"ok": True}
    if r.status == "running":
        r.status, r.result, r.finished_at = "stopped", r.result or "Остановлено пользователем.", utcnow()
        ctx.db.commit()
    return run_out(r)
