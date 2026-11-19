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
from ..core.textutil import cap
from ..core.timeutil import fmt_date, fmt_date_time, iso, parse_iso
from ..core.timeutil import utcnow as _utcnow
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
            "title": {"type": "string", "description": "Конкретное действие с названием. Если пользователь ссылается на пункт прошлого ответа "
                      "(«2 фильм», «второй», «эту книгу»), подставь название этого пункта из истории диалога, а не номер"},
            "dueAt": {"type": "string", "description": "ISO 8601 со смещением часового пояса пользователя"},
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
            "title": {"type": "string", "description": "Конкретное название; ссылки на прошлый ответ («туда», «второй вариант») раскрой по истории"},
            "startAt": {"type": "string", "description": "ISO 8601 со смещением"}, "endAt": {"type": "string"},
            "location": {"type": "string"}, "remindMinutes": {"type": "integer"}, "personName": {"type": "string"}},
            "required": ["title", "startAt"]}}},
    {"type": "function", "function": {
        "name": "event_update", "description": "Предложить перенести или отменить событие (eventId из event_list). Пользователь подтвердит.",
        "parameters": {"type": "object", "properties": {
            "eventId": {"type": "string"}, "startAt": {"type": "string"}, "endAt": {"type": "string"}, "cancel": {"type": "boolean"}},
            "required": ["eventId"]}}},
    {"type": "function", "function": {
        "name": "finance_add", "description": "Предложить записать расход или доход. Пользователь подтвердит карточку.",
        "parameters": {"type": "object", "properties": {
            "kind": {"type": "string", "enum": ["expense", "income"]}, "amount": {"type": "number"},
            "currency": {"type": "string", "description": "ISO 4217, по умолчанию RUB"},
            "category": {"type": "string", "description": "Продукты, Кафе и рестораны, Такси, Транспорт, Жильё, Связь и интернет, Подписки, Здоровье, "
                                                          "Одежда, Красота, Спорт, Развлечения, Подарки, Образование, Дом, Путешествия, Дети, Животные, "
                                                          "Зарплата, Подработка, Бизнес, Подарок, Проценты и кэшбэк, Возврат, Другое"},
            "note": {"type": "string"}, "date": {"type": "string", "description": "ISO 8601, если не сегодня"}}, "required": ["kind", "amount"]}}},
    {"type": "function", "function": {
        "name": "debt_add", "description": "Предложить записать долг: lent — человек должен пользователю, borrowed — пользователь должен человеку.",
        "parameters": {"type": "object", "properties": {
            "direction": {"type": "string", "enum": ["lent", "borrowed"]}, "amount": {"type": "number"}, "currency": {"type": "string"},
            "personName": {"type": "string", "description": "Имя в именительном падеже"}, "dueAt": {"type": "string", "description": "Срок возврата, ISO 8601"},
            "note": {"type": "string"}}, "required": ["direction", "amount", "personName"]}}},
    {"type": "function", "function": {
        "name": "debt_repay", "description": "Предложить отметить возврат долга (полностью или частично). Укажи debtId из debt_list или personName.",
        "parameters": {"type": "object", "properties": {
            "debtId": {"type": "string"}, "personName": {"type": "string"}, "direction": {"type": "string", "enum": ["lent", "borrowed"]},
            "amount": {"type": "number", "description": "Пусто — весь остаток"}}}}},
    {"type": "function", "function": {
        "name": "debt_list", "description": "Открытые долги: кто должен пользователю и кому должен он.",
        "parameters": {"type": "object", "properties": {"direction": {"type": "string", "enum": ["lent", "borrowed"]}}}}},
    {"type": "function", "function": {
        "name": "finance_report", "description": "Доходы, расходы, баланс и траты по категориям за период.",
        "parameters": {"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"},
                                                       "category": {"type": "string"}}, "required": ["from", "to"]}}},
    {"type": "function", "function": {
        "name": "alarm_set", "description": "Предложить поставить будильник. Пользователь подтвердит.",
        "parameters": {"type": "object", "properties": {
            "time": {"type": "string", "description": "HH:MM"},
            "days": {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 6}, "description": "0 = воскресенье; пусто = один раз"},
            "label": {"type": "string"}}, "required": ["time"]}}},
]


def roll_forward(ctx: TurnContext, when):
    """The model sometimes puts «в 17» on today although 17:00 already passed. Unless the user said «сегодня»
    (or gave a date), a time earlier today means the next such time: tomorrow."""
    from datetime import timezone

    if not when:
        return when
    # parse_iso gives naive UTC
    aware = when.replace(tzinfo=timezone.utc) if when.tzinfo is None else when
    now = ctx.now
    low = (ctx.text or "").lower()
    explicit_day = re.search(r"сегодня|\b\d{1,2}[./](0?[1-9]|1[0-2])\b|\d{1,2}\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)", low)
    if aware < now and aware.astimezone(ctx.tz).date() == now.date() and not explicit_day:
        return when + timedelta(days=1)
    return when


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
        "- Деньги: трата или доход — finance_add (категория по смыслу, сумма числом). «Дал/одолжил X …» — debt_add lent, «занял/взял у X …», «я должен X» — debt_add borrowed. "
        "«X вернул…», «я отдал X долг» — debt_list, затем debt_repay. Вопросы о тратах, доходах, балансе — finance_report за нужный период; о долгах — debt_list. "
        "Суммы пиши с пробелами и знаком валюты: 12 500 ₽.\n"
        "- Фото чека, квитанции или скриншот оплаты — сразу finance_add kind=expense: сумма ИТОГО (не отдельные позиции), "
        "категория по магазину и покупкам, note — название магазина, date — дата и время с чека (если видны). "
        "В ответе коротко: магазин, итог и 2–3 главные позиции. Если итог не читается — попроси переснять.\n"
        "- Время без дня («в 17», «в 9 утра»), которое сегодня уже прошло, — это завтра.\n"
        "- Ссылки на прошлые ответы («второй фильм», «2 фильм», «этот», «туда», «ему») раскрывай по истории диалога: "
        "в задаче, событии и памяти пиши конкретное название пункта, а не его номер.\n"
        "- Если не хватает даты или времени — уточни одним коротким вопросом."
    )


_ORDINALS = {"перв": 1, "втор": 2, "трет": 3, "четв": 4, "пят": 5, "шест": 6, "седьм": 7, "восьм": 8, "девят": 9, "десят": 10}
_NUM = r"(\d{1,2}|(?:перв|втор|трет|четв|пят|шест|седьм|восьм|девят|десят)[а-я]*)(?:-?[а-я]{1,3})?"
_NOUN = r"(фильм[а-я]*|книг[а-я]*|сериал[а-я]*|вариант[а-я]*|пункт[а-я]*|ресторан[а-я]*|кафе|мест[а-я]*|иде[а-я]*|курс[а-я]*|игр[а-я]*|рецепт[а-я]*)"
# (?<!...) keeps «Посмо-треть фильм» from reading as «третий фильм»
_LIST_REF = re.compile(rf"«?(?:(?<![а-яёa-z0-9]){_NUM}\s+{_NOUN}|(?<![а-яёa-z0-9]){_NOUN}\s+(?:№\s*)?(\d{{1,2}}))»?", re.I)
_ITEM = re.compile(r"^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$")


def _item_name(line: str) -> str:
    """List item -> its name: «Дюна», *1+1* or **Интерстеллар** win; a bold label like «**Для вечера:**» is skipped."""
    for rx in (r"«([^»]+)»", r"(?<!\*)\*([^*]+)\*(?!\*)"):
        m = re.search(rx, line)
        if m:
            return m.group(1).strip()
    b = re.search(r"\*\*(.+?)\*\*", line)
    if b and not b.group(1).rstrip().endswith(":"):
        return b.group(1).strip("«»\"' ").strip()
    text = re.sub(r"\*\*.+?\*\*", "", line) if b else line
    return re.split(r"\s+[—–-]\s+", text.strip(" :"))[0].strip("«»\"'* ").strip()


def resolve_list_ref(title: str, history: list) -> str:
    """«Посмотреть 2 фильм» right after a list of films -> «Посмотреть «Название»». The model often keeps the number literally."""
    m = _LIST_REF.search(title or "")
    if not m:
        return title
    raw = m.group(1) or m.group(4)
    noun = (m.group(2) or m.group(3) or "").lower()
    n = int(raw) if raw.isdigit() else next((v for k, v in _ORDINALS.items() if raw.lower().startswith(k)), None)
    hist = list(history or [])
    idx = next((i for i in range(len(hist) - 1, -1, -1) if hist[i].get("role") == "assistant"), None)
    if idx is None:
        return title
    last = hist[idx].get("content") or ""
    asked = next((h.get("content") or "" for h in reversed(hist[:idx]) if h.get("role") == "user"), "")
    # «Купить 2 книги» after a list of films is two books, not the second item
    if not noun.startswith(("вариант", "пункт")) and noun[:4] not in (last + " " + asked).lower().replace("ё", "е"):
        return title
    items = [x.group(1) for x in map(_ITEM.match, last.splitlines()) if x]
    if not n or not 1 <= n <= len(items):
        return title
    name = _item_name(items[n - 1])
    if not name:
        return title
    return re.sub(r"\s{2,}", " ", title[:m.start()] + f"«{name}»" + title[m.end():]).strip()


def relevant_cards(ctx: TurnContext, cards: list, content: str) -> list:
    """memory_search attaches every hit as a card, and a broad query («предпочтения», «знания») matches whole categories.
    Keep only the memories the answer actually talks about, so a reply about films doesn't carry «Retention D30»."""
    if not any(c["type"] == "memories" for c in cards):
        return cards
    from ..core.textutil import same_stem, words

    said = set(words(content))

    def hits(text: str) -> int:
        return sum(1 for q in set(nlu.keywords(text or "")) if q in said or any(same_stem(h, q) for h in said))

    by_id = {m.id: m for m in ctx.store.memories()}
    out = []
    for c in cards:
        if c["type"] == "memories":
            ids = [i for i in c["data"].get("ids", []) if i in by_id and (hits(by_id[i].title) or hits(by_id[i].content[:300]) >= 2)]
            if not ids:
                continue
            c = {**c, "data": {**c["data"], "ids": ids}}
        out.append(c)
    return out


def _user_content(ctx: TurnContext):
    text = ctx.text or ""
    files = [f for f in ctx.attachments if not f.get("image")]
    for f in files:
        body = (f.get("text") or "")[:20000]
        text += f"\n\n[Файл: {f.get('name')}]\n{body if body else '(содержимое недоступно)'}"
    images = [f for f in ctx.attachments if f.get("image")]
    if images and settings.llm_vision:
        caption = text or "[Фото без подписи. Если это чек или квитанция — предложи записать расход; иначе коротко опиши, что на фото.]"
        return [{"type": "text", "text": caption}, *({"type": "image_url", "image_url": {"url": f["image"]}} for f in images)]
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
            due = roll_forward(ctx, parse_iso(args.get("dueAt")))
            people = s.people()
            person = nlu.find_person_mention(str(args.get("personName") or args.get("title") or ""), people)
            data = {"title": resolve_list_ref(str(args.get("title") or "Напоминание"), ctx.history)[:255], "dueAt": iso(due) if due else None,
                    "repeat": args.get("repeat") if args.get("repeat") in ("none", "daily", "weekly", "monthly") else "none",
                    "personId": person.id if person else None, "personName": person.name if person else None, "remind": True}
            cards.append(card("task_create", data, "pending"))
            res = {"status": "pending_user_confirmation", "when": fmt_date_time(due, tz) if due else "время не указано"}
            if due and data["repeat"] == "none" and due < _utcnow():
                res["warning"] = "Это время уже прошло. Скажи пользователю об этом и предложи перенести на завтра (на карточке есть кнопка «На завтра»)."
            return res
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
            raw_start = parse_iso(args.get("startAt"))
            start = roll_forward(ctx, raw_start)
            end = parse_iso(args.get("endAt"))
            end = end + (start - raw_start) if end and start and raw_start else end or (start + timedelta(hours=1) if start else None)
            person = nlu.find_person_mention(str(args.get("personName") or args.get("title") or ""), s.people())
            data = {"title": resolve_list_ref(str(args.get("title") or "Событие"), ctx.history)[:255], "startAt": iso(start), "endAt": iso(end),
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
        if name in ("finance_add", "debt_add", "debt_repay", "debt_list", "finance_report"):
            return self.finance_tool(ctx, name, args, cards)
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

    def finance_tool(self, ctx: TurnContext, name: str, args: dict, cards: list) -> dict:
        from decimal import Decimal, InvalidOperation

        from ..models import Debt
        from ..services import finance as fin

        s, tz = ctx.store, ctx.tz
        F = fin.Finance(s)

        def amount_of(v):
            try:
                a = Decimal(str(v)).quantize(Decimal("0.01"))
                return a if a > 0 else None
            except (InvalidOperation, TypeError):
                return None

        cur = str(args.get("currency") or "RUB").upper()[:3]
        if name == "finance_add":
            a = amount_of(args.get("amount"))
            if not a:
                return {"error": "amount must be > 0"}
            kind = args.get("kind") if args.get("kind") in ("expense", "income") else "expense"
            note = str(args.get("note") or "")[:200]
            now_utc = _utcnow()
            when = parse_iso(args.get("date")) or now_utc
            res: dict = {"status": "pending_user_confirmation", "formatted": fin.money(a, cur)}
            # An old receipt (or a misread year) would land in a past month and look as if nothing was recorded
            if when < now_utc - timedelta(days=60) or when > now_utc + timedelta(days=1):
                note = f"{note} (чек от {fmt_date(when, tz, True)})".strip()[:200]
                when = now_utc
                res["note"] = "Дата на чеке далеко от сегодняшней: расход записан сегодняшним числом, дата чека — в заметке. Скажи об этом пользователю."
            data = {"kind": kind, "amount": float(a), "currency": cur, "category": str(args.get("category") or fin.categorize(note or ctx.text, kind))[:60],
                    "note": note, "occurredAt": iso(when), "personId": None}
            cards.append(card("finance_tx", data, "pending"))
            return res
        if name == "debt_add":
            a = amount_of(args.get("amount"))
            who = str(args.get("personName") or "").strip()[:160]
            if not a or not who:
                return {"error": "amount and personName required"}
            person = nlu.find_person_mention(who, s.people())
            due = parse_iso(args.get("dueAt"))
            data = {"direction": args.get("direction") if args.get("direction") in ("lent", "borrowed") else "lent", "amount": float(a), "currency": cur,
                    "personId": person.id if person else None, "counterparty": person.name if person else cap(who), "dueAt": iso(due) if due else None,
                    "note": str(args.get("note") or "")[:200]}
            cards.append(card("debt_create", data, "pending"))
            return {"status": "pending_user_confirmation", "formatted": fin.money(a, cur)}
        if name == "debt_repay":
            d = s._get(Debt, str(args.get("debtId") or ""))
            if (not d or d.status != "open") and args.get("personName"):
                dr = args.get("direction") if args.get("direction") in ("lent", "borrowed") else None
                d = F.find_open_debt(str(args["personName"]), dr) or F.find_open_debt(str(args["personName"]))
            if not d or d.status != "open":
                return {"error": "open debt not found"}
            left = d.amount - (d.paid or 0)
            a = amount_of(args.get("amount"))
            a = min(a, left) if a else left
            data = {"debtId": d.id, "amount": float(a), "full": a >= left, "left": float(left), "currency": d.currency, "counterparty": d.counterparty,
                    "direction": d.direction}
            cards.append(card("debt_repay", data, "pending"))
            return {"status": "pending_user_confirmation", "remaining_after": fin.money(left - a, d.currency)}
        if name == "debt_list":
            direction = args.get("direction") if args.get("direction") in ("lent", "borrowed") else None
            return {"results": [{"id": d.id, "direction": d.direction, "who": d.counterparty, "left": fin.money(d.amount - (d.paid or 0), d.currency),
                                 "due": fmt_date(d.due_at, tz, True) if d.due_at else None, "overdue": bool(d.due_at and d.due_at < parse_iso(iso(ctx.now))),
                                 "note": d.note} for d in F.debts(status="open", direction=direction)]}
        start, end = parse_iso(args.get("from")), parse_iso(args.get("to"))
        if not start or not end:
            return {"error": "from/to must be ISO 8601"}
        sm = F.summary(start, end)
        cat = str(args.get("category") or "")
        if cat:
            sm["byCategory"] = [x for x in sm["byCategory"] if x["category"].lower() == cat.lower()]
        cards.append(card("open", {"route": "#/finance", "label": "Открыть «Финансы»", "icon": "chart"}))
        return sm

    # ---------- provider ----------
    async def _stream(self, client: httpx.AsyncClient, messages: list, tools: list | None):
        payload = {"model": settings.llm_model, "messages": messages, "stream": True}
        if settings.llm_temperature is not None:
            payload["temperature"] = settings.llm_temperature
        if settings.llm_reasoning:
            payload["reasoning_effort"] = settings.llm_reasoning
        if tools:
            payload["tools"] = tools
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
        messages = [{"role": "system", "content": ctx.system_override or system_prompt(ctx)}, *ctx.history[-settings.llm_history:],
                    {"role": "user", "content": _user_content(ctx)}]
        allowed = ctx.allowed_tools
        tools = TOOLS if allowed is None else [t for t in TOOLS if t["function"]["name"] in allowed]
        cards: list = []
        tool_log: list = []
        content = ""
        if ctx.streaming:
            yield {"type": "status", "text": "Adis думает…"}
        async with httpx.AsyncClient(timeout=settings.llm_timeout, transport=TRANSPORT) as client:
            for step in range(MAX_STEPS + 1):
                text, calls = "", {}
                async for chunk in self._stream(client, messages, tools if step < MAX_STEPS else None):
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
                    if allowed is not None and c["name"] not in allowed:
                        result = {"error": f"tool {c['name']} is not permitted"}
                    else:
                        result = self.run_tool(ctx, c["name"], args if isinstance(args, dict) else {}, cards)
                    tool_log.append({"name": c["name"], "args": args})
                    messages.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}", "content": json.dumps(result, ensure_ascii=False)})
                if content and not content.endswith("\n"):
                    content += "\n\n"
                    if ctx.streaming:
                        yield {"type": "delta", "text": "\n\n"}
        yield {"type": "final", "content": content.strip() or "Готово.", "cards": relevant_cards(ctx, cards, content), "toolCalls": tool_log}
