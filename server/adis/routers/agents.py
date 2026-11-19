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


def generic(agent: Agent, s: Store) -> dict:
    active = sum(1 for t in s.tasks() if not t.done)
    return {"steps": ["Загружаю инструкции агента", *(f"Вызываю инструмент {x}" for x in agent.tools or []), "Формирую результат"],
            "result": f"## {agent.name}\n\n**Инструкция:** {agent.instructions or '—'}\n\nДоступно данных: {len(s.memories())} записей памяти, "
                      f"{active} активных задач, {len(s.people())} людей.\n\n_Пользовательские агенты пока не выполняются языковой моделью: "
                      "это следующий этап развития AI Backend._"}


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
def run(aid: str, ctx: Ctx = Depends(current)):
    a = _own(ctx, aid)
    s = Store(ctx.db, ctx.user, ctx.tz)
    started = utcnow()
    res = RUNNERS[a.builtin](s) if a.builtin in RUNNERS else generic(a, s)
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
