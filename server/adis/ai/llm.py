"""LLM engine over any OpenAI-compatible Chat Completions API (OpenAI, DeepSeek, OpenRouter, Groq, Together, Ollama, ...).

The model gets permission-checked tools. Read tools (search) run immediately; write tools (memory_save, task_create)
only create "pending" cards that the user confirms in the app. The API key never leaves the server.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import timedelta

import httpx

from ..config import settings
from ..core.timeutil import fmt_date, fmt_date_time, iso, parse_iso
from ..services.store import MEMORY_TYPES, score
from . import nlu
from .base import TOOL_LABELS, EngineError, TurnContext, card
from .rules import _mem_fields, person_line, save_introduction

log = logging.getLogger("adis.llm")

# Tests replace this with httpx.MockTransport
TRANSPORT: httpx.AsyncBaseTransport | None = None
MAX_STEPS = 5

_TYPES = [k for k in MEMORY_TYPES if k != "person"]

TOOLS = [
    {"type": "function", "function": {
        "name": "memory_search", "description": "Поиск по личной памяти пользователя (факты, события, планы, идеи, предпочтения, знания).",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Ключевые слова"},
            "types": {"type": "array", "items": {"type": "string", "enum": _TYPES}}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "entity_lookup", "description": "Найти людей из знакомств пользователя по имени, профессии, навыку или давности знакомства.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "profession": {"type": "string", "description": "Основа слова в нижнем регистре, например 'программист'"},
            "skill": {"type": "string"}, "sinceDays": {"type": "number"}}}}},
    {"type": "function", "function": {
        "name": "task_list", "description": "Список задач и напоминаний пользователя.",
        "parameters": {"type": "object", "properties": {"scope": {"type": "string", "enum": ["active", "today", "tomorrow", "overdue", "done"]}}}}},
    {"type": "function", "function": {
        "name": "memory_save",
        "description": "Предложить сохранить информацию в память. Пользователь подтвердит карточку. Для нового знакомства передай person. "
                       "Телефоны, email и адреса людей сохранять можно. Не используй для паролей, PIN, номеров паспорта и банковских карт, диагнозов.",
        "parameters": {"type": "object", "properties": {
            "type": {"type": "string", "enum": _TYPES, "description": "assumption — если информация неточная"},
            "title": {"type": "string"}, "content": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}},
            "person": {"type": "object", "properties": {
                "name": {"type": "string", "description": "Имя в именительном падеже"}, "profession": {"type": "string"},
                "skills": {"type": "array", "items": {"type": "string"}}, "organization": {"type": "string"}, "metWhere": {"type": "string"}},
                "required": ["name"]}},
            "required": ["type", "title", "content"]}}},
    {"type": "function", "function": {
        "name": "task_create", "description": "Предложить создать задачу или напоминание. Пользователь подтвердит карточку.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "dueAt": {"type": "string", "description": "ISO 8601 со смещением часового пояса пользователя"},
            "repeat": {"type": "string", "enum": ["none", "daily", "weekly", "monthly"]},
            "personName": {"type": "string", "description": "С кем связана задача, если есть"}}, "required": ["title"]}}},
    {"type": "function", "function": {
        "name": "event_list", "description": "События календаря пользователя в интервале.",
        "parameters": {"type": "object", "properties": {
            "from": {"type": "string", "description": "ISO 8601"}, "to": {"type": "string", "description": "ISO 8601"},
            "query": {"type": "string", "description": "Слова из названия или имя человека"}}, "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "event_create", "description": "Предложить добавить событие в календарь (встреча, созвон, день рождения). Пользователь подтвердит.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"}, "startAt": {"type": "string", "description": "ISO 8601 со смещением"}, "endAt": {"type": "string"},
            "location": {"type": "string"}, "remindMinutes": {"type": "integer"}, "personName": {"type": "string"}},
            "required": ["title", "startAt"]}}},
    {"type": "function", "function": {
        "name": "event_update", "description": "Предложить перенести или отменить событие (eventId из event_list). Пользователь подтвердит.",
        "parameters": {"type": "object", "properties": {
            "eventId": {"type": "string"}, "startAt": {"type": "string"}, "endAt": {"type": "string"}, "cancel": {"type": "boolean"}},
            "required": ["eventId"]}}},
    {"type": "function", "function": {
        "name": "alarm_set", "description": "Предложить поставить будильник. Пользователь подтвердит.",
        "parameters": {"type": "object", "properties": {
            "time": {"type": "string", "description": "HH:MM"},
            "days": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6}, "description": "0 = воскресенье; пусто = один раз"},
            "label": {"type": "string"}}, "required": ["time"]}}},
]


WEEKDAYS_RU = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]


def system_prompt(ctx: TurnContext) -> str:
    u, now = ctx.user, ctx.now
    offset = now.strftime("%z")
    offset = f"{offset[:3]}:{offset[3:]}"
    week = ", ".join(f"{WEEKDAYS_RU[d.weekday()]} {d.strftime('%Y-%m-%d')}" for d in (now + timedelta(days=i) for i in range(8)))
    return (
        f"Ты — {u.assistant_name or 'Adis'}, персональный ИИ-помощник с долговременной памятью. Пользователь: {u.name}.\n"
        f"Сейчас {now.strftime('%Y-%m-%d %H:%M')}, {WEEKDAYS_RU[now.weekday()]}. Часовой пояс {ctx.tz.key} (UTC{offset}).\n"
        f"Ближайшие дни: {week}. Все даты в инструментах — ISO 8601 со смещением {offset}.\n\n"
        "Стиль: коротко, тепло и по делу, на языке пользователя, Markdown. Жирным выделяй только главное. "
        "Не заканчивай каждый ответ предложением «если хочешь, могу…».\n\n"
        "Память:\n"
        "- Перед ответом о прошлом, людях, планах и задачах ищи: memory_search, entity_lookup, task_list, event_list. Не выдумывай факты.\n"
        "- Если пользователь сообщает что-то стоящее (знакомство, факт о себе, предпочтение, план, идею, знание), сразу вызывай memory_save. "
        "Знакомство с человеком — type=event и объект person (имя в именительном падеже, профессия, навыки, организация, где познакомились).\n"
        "- Различай: fact, assumption (неуверенно: «кажется», «вроде»), intention, plan, event, preference, idea, knowledge.\n"
        "- Контакты можно и нужно сохранять: телефон, email, адрес, день рождения человека — memory_save type=fact с person (имя) или "
        "с именем в title/content, например «Телефон Артёма: +7 999 123-45-67». Когда спрашивают номер или просят продиктовать — найди его "
        "(memory_search) и напиши цифрами полностью.\n"
        "- Не сохраняй только секреты: пароли, PIN, CVV, номера паспорта и банковских карт, медицинские диагнозы. Коротко предупреди и предложи менеджер паролей.\n\n"
        "Действия (memory_save, task_create, event_create, event_update, alarm_set) не выполняются сразу: пользователь увидит карточку и подтвердит. "
        "Поэтому вызывай инструмент сразу, без вопроса «оформить?», а в ответе пиши «предлагаю…», а не «готово».\n"
        "- Напоминание («напомни…») — task_create.\n"
        "- Встреча, созвон, событие с датой/временем — event_create (сначала можно event_list на этот день, чтобы увидеть пересечения). "
        "Без указанного конца — 1 час.\n"
        "- Перенос или отмена — event_list, найди событие, затем event_update (при переносе сохраняй длительность).\n"
        "- Будильник — alarm_set; не придумывай подпись, если пользователь её не назвал.\n"
        "- Если не хватает даты или времени — уточни одним коротким вопросом."
    )


def _user_content(ctx: TurnContext):
    text = ctx.text or ""
    files = [f for f in ctx.attachments if not f.get("image")]
    for f in files:
        body = (f.get("text") or "")[:20000]
        text += f"\n\n[Файл: {f.get('name')}]\n{body if body else '(содержимое недоступно)'}"
    images = [f for f in ctx.attachments if f.get("image")]
    if images and settings.llm_vision:
        return [{"type": "text", "text": text or "Что на фото?"}, *({"type": "image_url", "image_url": {"url": f["image"]}} for f in images)]
    if images:
        text += f"\n\n[Пользователь приложил фото: {len(images)} шт. Модель не видит изображения.]"
    return text


class LLMEngine:
    def __init__(self) -> None:
        self.name = f"llm:{settings.llm_model}"

    # ---------- tools ----------
    def run_tool(self, ctx: TurnContext, name: str, args: dict, cards: list) -> dict:
        s, tz = ctx.store, ctx.tz
        if name == "memory_search":
            items = s.memory_search(str(args.get("query") or ""), types=args.get("types") or None, limit=8)
            if items:
                cards.append(card("memories", {"ids": [m.id for m in items]}))
            return {"results": [{"id": m.id, "type": m.type, "title": m.title, "content": m.content[:500], "confirmed": m.confirmed,
                                 "date": fmt_date(m.created_at, tz, True)} for m in items]}
        if name == "entity_lookup":
            items = s.entity_lookup(name=args.get("name"), profession=args.get("profession"), skill=args.get("skill"),
                                    since_days=args.get("sinceDays"))[:10]
            if items:
                cards.append(card("people", {"ids": [p.id for p in items]}))
            return {"results": [{"id": p.id, "name": p.name, "about": person_line(p), "metAt": fmt_date(p.met_at or p.created_at, tz, True),
                                 "metWhere": p.met_where, "notes": p.notes[:300]} for p in items]}
        if name == "task_list":
            from ..serialize import task_status

            scope = args.get("scope") or "active"
            items = [t for t in s.tasks() if (task_status(t) == "done") == (scope == "done")]
            if scope == "overdue":
                items = [t for t in items if task_status(t) == "overdue"]
            elif scope in ("today", "tomorrow"):

                from ..core.timeutil import is_same_day, utcnow
                day = utcnow() + timedelta(days=1 if scope == "tomorrow" else 0)
                items = [t for t in items if t.due_at and (is_same_day(t.due_at, day, tz) or (scope == "today" and task_status(t) == "overdue"))]
            items = items[:15]
            if items:
                cards.append(card("tasks", {"ids": [t.id for t in items]}))
            return {"results": [{"id": t.id, "title": t.title, "due": fmt_date_time(t.due_at, tz) if t.due_at else None,
                                 "status": task_status(t), "repeat": t.repeat} for t in items]}
        if name == "memory_save":
            type_ = args.get("type") if args.get("type") in MEMORY_TYPES else "fact"
            memory = {"type": type_, "title": str(args.get("title") or "")[:255] or nlu.memory_title(str(args.get("content") or "")),
                      "content": str(args.get("content") or "")[:20000], "tags": [str(t) for t in (args.get("tags") or [])][:5],
                      "confirmed": type_ != "assumption"}
            sensitive = nlu.is_sensitive(memory["title"] + " " + memory["content"])
            data: dict = {"memory": memory, "sensitive": sensitive}
            people = s.people()
            if isinstance(args.get("person"), dict) and args["person"].get("name"):
                ap = args["person"]
                person = {"name": str(ap["name"])[:160], "profession": ap.get("profession") or "", "skills": ap.get("skills") or [],
                          "organization": ap.get("organization") or "", "metWhere": ap.get("metWhere") or "", "metAt": iso(ctx.now)}
                existing = next((p for p in people if p.name.lower() == person["name"].lower()), None)
                data.update(person=person, existingPersonId=existing.id if existing else None)
            else:
                mention = nlu.find_person_mention(memory["content"], people)
                if mention:
                    memory["personId"] = mention.id
            if sensitive and ctx.sensitive_guard:
                cards.append(card("memory_save", data, "pending"))
                return {"status": "blocked_sensitive", "message": "Чувствительные данные не сохраняются автоматически. Предупреди пользователя."}
            if ctx.auto_save and not sensitive and memory["confirmed"]:
                res = save_introduction(ctx, data) if data.get("person") else {"memoryId": s.memory_save(
                    {**_mem_fields(memory), "source": {"kind": ctx.source or "chat", "excerpt": ctx.text, "conversationId": ctx.conversation_id}}).id}
                cards.append({**card("memory_save", data, "confirmed"), "result": res})
                return {"status": "saved"}
            cards.append(card("memory_save", data, "pending"))
            return {"status": "pending_user_confirmation"}
        if name == "task_create":
            due = parse_iso(args.get("dueAt"))
            people = s.people()
            person = nlu.find_person_mention(str(args.get("personName") or args.get("title") or ""), people)
            data = {"title": str(args.get("title") or "Напоминание")[:255], "dueAt": iso(due) if due else None,
                    "repeat": args.get("repeat") if args.get("repeat") in ("none", "daily", "weekly", "monthly") else "none",
                    "personId": person.id if person else None, "personName": person.name if person else None, "remind": True}
            cards.append(card("task_create", data, "pending"))
            return {"status": "pending_user_confirmation", "when": fmt_date_time(due, tz) if due else "время не указано"}
        if name == "event_list":
            start, end = parse_iso(args.get("from")), parse_iso(args.get("to"))
            if not start or not end:
                return {"error": "from/to must be ISO 8601"}
            items = sorted(s.events_between(start, end), key=lambda e: e.start_at)
            q = str(args.get("query") or "")
            if q:
                items = [e for e in items if score(q, [e.title, e.location, e.notes]) > 0] or items
            return {"results": [{"id": e.id, "title": e.title, "start": fmt_date_time(e.start_at, tz), "startAt": iso(e.start_at),
                                 "endAt": iso(e.end_at), "location": e.location} for e in items[:30]]}
        if name == "event_create":
            start = parse_iso(args.get("startAt"))
            end = parse_iso(args.get("endAt")) or (start + timedelta(hours=1) if start else None)
            person = nlu.find_person_mention(str(args.get("personName") or args.get("title") or ""), s.people())
            data = {"title": str(args.get("title") or "Событие")[:255], "startAt": iso(start), "endAt": iso(end),
                    "location": str(args.get("location") or "")[:255], "remindMinutes": int(args.get("remindMinutes") or 15),
                    "personId": person.id if person else None, "personName": person.name if person else None, "hasTime": bool(start)}
            if start:
                data["conflicts"] = [e.title for e in s.events_between(start, end)][:3]
            cards.append(card("event_create", data, "pending"))
            return {"status": "pending_user_confirmation", "conflicts": data.get("conflicts", [])}
        if name == "event_update":
            from ..models import Event

            e = s._get(Event, str(args.get("eventId") or ""))
            if not e:
                return {"error": "event not found"}
            data = {"eventId": e.id, "title": e.title, "oldStartAt": iso(e.start_at), "oldEndAt": iso(e.end_at), "location": e.location}
            if args.get("cancel"):
                data["cancel"] = True
            else:
                start = parse_iso(args.get("startAt"))
                if not start:
                    return {"error": "startAt required unless cancel"}
                end = parse_iso(args.get("endAt")) or start + ((e.end_at - e.start_at) if e.end_at else timedelta(hours=1))
                data.update(startAt=iso(start), endAt=iso(end))
            cards.append(card("event_update", data, "pending"))
            return {"status": "pending_user_confirmation"}
        if name == "alarm_set":
            from ..services.alarms import describe_days

            m = re.match(r"^(\d{1,2}):(\d{2})$", str(args.get("time") or "").strip())
            if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
                return {"error": "time must be HH:MM"}
            days = sorted({int(d) for d in (args.get("days") or []) if str(d).isdigit() and 0 <= int(d) <= 6})
            cards.append(card("alarm_set", {"hour": int(m.group(1)), "minute": int(m.group(2)), "days": days, "daysLabel": describe_days(days),
                                            "label": str(args.get("label") or "")[:120]}, "pending"))
            return {"status": "pending_user_confirmation"}
        return {"error": f"unknown tool {name}"}

    # ---------- provider ----------
    async def _stream(self, client: httpx.AsyncClient, messages: list, use_tools: bool):
        payload = {"model": settings.llm_model, "messages": messages, "stream": True}
        if settings.llm_temperature is not None:
            payload["temperature"] = settings.llm_temperature
        if settings.llm_reasoning:
            payload["reasoning_effort"] = settings.llm_reasoning
        if use_tools:
            payload["tools"] = TOOLS
        headers = {"Authorization": f"Bearer {settings.llm_api_key}"} if settings.llm_api_key else {}
        try:
            async with client.stream("POST", f"{settings.llm_base_url}/chat/completions", json=payload, headers=headers) as res:
                if res.status_code >= 400:
                    body = (await res.aread()).decode("utf-8", "replace")[:300]
                    log.warning("LLM HTTP %s: %s", res.status_code, body)
                    raise EngineError(f"Языковая модель вернула ошибку {res.status_code}")
                async for line in res.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        yield json.loads(data)
                    except json.JSONDecodeError:
                        continue
        except httpx.HTTPError as e:
            log.warning("LLM transport error: %s", type(e).__name__)
            raise EngineError("Языковая модель недоступна. Попробуйте позже.") from e

    async def respond(self, ctx: TurnContext):
        messages = [{"role": "system", "content": system_prompt(ctx)}, *ctx.history[-settings.llm_history:],
                    {"role": "user", "content": _user_content(ctx)}]
        cards: list = []
        tool_log: list = []
        content = ""
        if ctx.streaming:
            yield {"type": "status", "text": "Adis думает…"}
        async with httpx.AsyncClient(timeout=settings.llm_timeout, transport=TRANSPORT) as client:
            for step in range(MAX_STEPS + 1):
                text, calls = "", {}
                async for chunk in self._stream(client, messages, use_tools=step < MAX_STEPS):
                    choice = (chunk.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        text += delta["content"]
                        if ctx.streaming:
                            yield {"type": "delta", "text": delta["content"]}
                    for tc in delta.get("tool_calls") or []:
                        c = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                        c["id"] = tc.get("id") or c["id"]
                        fn = tc.get("function") or {}
                        c["name"] += fn.get("name") or ""
                        c["args"] += fn.get("arguments") or ""
                content += text
                if not calls:
                    break
                ordered = [calls[i] for i in sorted(calls)]
                messages.append({"role": "assistant", "content": text or None, "tool_calls": [
                    {"id": c["id"] or f"call_{i}", "type": "function", "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                    for i, c in enumerate(ordered)]})
                for i, c in enumerate(ordered):
                    try:
                        args = json.loads(c["args"] or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    if ctx.streaming and c["name"] in TOOL_LABELS:
                        yield {"type": "status", "text": TOOL_LABELS[c["name"]], "tool": c["name"]}
                    result = self.run_tool(ctx, c["name"], args if isinstance(args, dict) else {}, cards)
                    tool_log.append({"name": c["name"], "args": args})
                    messages.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}", "content": json.dumps(result, ensure_ascii=False)})
                if content and not content.endswith("\n"):
                    content += "\n\n"
                    if ctx.streaming:
                        yield {"type": "delta", "text": "\n\n"}
        yield {"type": "final", "content": content.strip() or "Готово.", "cards": cards, "toolCalls": tool_log}
