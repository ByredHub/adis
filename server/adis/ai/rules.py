"""Rule-based engine (server port of app/js/mock/ai-engine.js). Works without any LLM key.

Replies are marked engine="rules" so the UI can show that no language model was used.
"""
from __future__ import annotations

import asyncio
import random
import re
from datetime import timedelta

from ..core.textutil import cap, esc, plural, same_stem, words
from ..core.timeutil import fmt_date, fmt_date_time, fmt_rel_day, fmt_time, is_same_day, iso, local, parse_iso, to_utc, utcnow
from ..services.store import MEMORY_TYPES
from . import nlu
from .base import TOOL_LABELS, TurnContext, card

ENGINE = "rules"


def _fmt_bytes(b: int) -> str:
    if b < 1024:
        return f"{b} Б"
    if b < 1048576:
        return f"{b / 1024:.1f} КБ"
    return f"{b / 1048576:.1f} МБ"


def person_line(p) -> str:
    return " · ".join(x for x in (p.profession, ", ".join(p.skills or []), p.organization) if x)


def first_name(p) -> str:
    return p.name.split(" ")[0]


def task_line(t, tz) -> str:
    when = fmt_date_time(t.due_at, tz) if t.due_at else "без срока"
    flag = " — **просрочено**" if not t.done and t.due_at and t.due_at < utcnow() else ""
    return f"- {t.title} — {when}{flag}"


def pl_prof(name: str) -> str:
    n = name.lower()
    if n.endswith("ь"):
        return "из " + n[:-1] + "ей"
    if re.search(r"(ик|ст|ер|ор|ог|ач|ар|ант|ент)$", n):
        return "из " + n + ("ей" if re.search(r"[чшщж]$", n) else "ов")
    return f"({n})"


def build_report(store) -> str:
    tz, now = store.tz, utcnow()
    week = now - timedelta(days=7)
    tasks, people, memories = store.tasks(), store.people(), store.memories()
    done = [t for t in tasks if t.done and (t.done_at or t.updated_at) > week]
    active = [t for t in tasks if not t.done]
    overdue = [t for t in active if t.due_at and t.due_at < now]
    new_people = [p for p in people if (p.met_at or p.created_at) > week]
    mems = [m for m in memories if m.created_at > week]
    plans = [m for m in memories if m.type in ("plan", "intention")]
    lines = [
        "## Отчёт за неделю", f"{fmt_date(week, tz)} — {fmt_date(now, tz)}", "",
        f"**Задачи:** выполнено {len(done)}, активно {len(active)}, просрочено {len(overdue)}.",
        "\n".join(f"- ✓ {t.title}" for t in done) if done else "- Выполненных задач пока нет", "",
        f"**Новые знакомства:** {len(new_people)}",
        "\n".join(f"- {p.name}{' — ' + p.profession.lower() if p.profession else ''}" for p in new_people) if new_people else "- Нет", "",
        f"**Новое в памяти:** {len(mems)} {plural(len(mems), 'запись', 'записи', 'записей')}", "",
        "**Планы в работе:**",
        "\n".join(f"- {m.title}" for m in plans) if plans else "- Нет сохранённых планов",
    ]
    if overdue:
        n = len(overdue)
        lines.append(f"\n**Рекомендация:** закрой или перенеси {n} {plural(n, 'просроченную задачу', 'просроченные задачи', 'просроченных задач')} — это разгрузит неделю.")
    return "\n".join(lines)


def code_answer(text: str) -> str:
    low = text.lower()
    if "фибоначч" in low:
        return 'Пример на Python:\n\n```python\ndef fibonacci(n: int) -> list[int]:\n    """Первые n чисел Фибоначчи."""\n    seq = [0, 1]\n    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq[:n]\n\nprint(fibonacci(10))\n```\n\nСложность — O(n) по времени и памяти.'
    if re.search(r"fastapi|api|эндпоинт|endpoint", low):
        return 'Минимальный эндпоинт на FastAPI:\n\n```python\nfrom fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Task(BaseModel):\n    title: str\n    due_at: str | None = None\n\n@app.post("/tasks")\nasync def create_task(task: Task):\n    return {"id": 1, **task.model_dump()}\n```\n\nЗапуск: `uvicorn main:app --reload`.'
    if re.search(r"javascript|js|джаваскрипт", low):
        return 'Пример на JavaScript:\n\n```javascript\nconst groupBy = (items, key) =>\n  items.reduce((acc, item) => {\n    (acc[item[key]] ||= []).push(item);\n    return acc;\n  }, {});\n\nconsole.log(groupBy([{ t: "a" }, { t: "b" }, { t: "a" }], "t"));\n```\n\nЭтот код можно запустить в рабочем пространстве «Программирование».'
    return 'Пример функции сортировки на Python:\n\n```python\ndef quick_sort(items: list[int]) -> list[int]:\n    if len(items) <= 1:\n        return items\n    pivot, *rest = items\n    left = [x for x in rest if x < pivot]\n    right = [x for x in rest if x >= pivot]\n    return quick_sort(left) + [pivot] + quick_sort(right)\n\nprint(quick_sort([5, 3, 8, 1, 9, 2]))\n```\n\nСейчас я показываю шаблонные примеры. Генерация кода под любую задачу появится после подключения языковой модели на сервере.'


def save_introduction(ctx: TurnContext, data: dict) -> dict:
    s = ctx.store
    person = {"name": data["person"]["name"], "profession": data["person"].get("profession"), "skills": data["person"].get("skills"),
              "organization": data["person"].get("organization"), "met_where": data["person"].get("metWhere"),
              "met_at": data["person"].get("metAt")}
    if data.get("existingPersonId"):
        person = {k: v for k, v in person.items() if k not in ("name", "met_at")}
        person.update(id=data["existingPersonId"], interaction=data["memory"]["content"])
    p = s.person_save(person)
    m = s.memory_save({**_mem_fields(data["memory"]), "person_id": p.id,
                       "source": {"kind": ctx.source or "chat", "excerpt": ctx.text, "conversationId": ctx.conversation_id}})
    return {"personId": p.id, "memoryId": m.id}


def _mem_fields(m: dict) -> dict:
    return {"type": m.get("type"), "title": m.get("title"), "content": m.get("content"), "tags": m.get("tags"),
            "confirmed": m.get("confirmed", True), "person_id": m.get("personId"), "photo": m.get("photo")}


def respond_sync(ctx: TurnContext) -> dict:
    s, tz, text = ctx.store, ctx.tz, ctx.text or ""
    people, tasks = s.people(), s.tasks()
    tool_calls: list[dict] = []
    user_name = (ctx.user.name or "").split(" ")[0]

    def out(content, cards=None):
        return {"content": content, "cards": cards or [], "toolCalls": tool_calls}

    images = [f for f in ctx.attachments if f.get("image")]
    if images and len(images) == len(ctx.attachments) and not (text and nlu.intent(text) == "reminder"):
        f = images[0]
        caption = text.strip()
        person = nlu.find_person_mention(caption, people) if caption else None
        memory = {"type": nlu.classify_memory(caption) if caption else "event",
                  "title": nlu.memory_title(caption) if caption else f"Фото · {fmt_date(utcnow(), tz)}",
                  "content": nlu.memory_content(caption) if caption else "Фото, сделанное в Adis",
                  "tags": ["фото", *(nlu.keywords(caption)[:2] if caption else [])], "photo": f["image"], "confirmed": True,
                  "personId": person.id if person else None}
        cards = []
        if person and re.search(r"(это|вот|фото|аватар|портрет)", caption, re.I):
            cards.append(card("person_photo", {"personId": person.id, "personName": person.name, "photo": f["image"]}, "pending"))
        cards.append(card("memory_save", {"memory": memory}, "pending"))
        dims = f" ({f['width']}×{f['height']})" if f.get("width") else ""
        tool_calls.append({"name": "memory_save", "args": {"photo": True}})
        more = f" и ещё {len(images) - 1}" if len(images) > 1 else ""
        who = f"Похоже, это связано с **{person.name}**. " if person else ""
        return out(f"Фото получил{dims}{more}. {who}Могу сохранить его в память{' вместе с подписью' if caption else ''} — потом найдёшь его в разделе «Память».\n\n"
                   "_Распознавание содержимого фото выполняет языковая модель с поддержкой изображений. Сейчас я сохраняю фото и подпись, но не анализирую, что на нём._", cards)

    if any(not f.get("image") for f in ctx.attachments):
        lines = []
        for f in ctx.attachments:
            line = f"- **{esc(f.get('name'))}** · {_fmt_bytes(f.get('size') or 0)}"
            if f.get("text"):
                t = f["text"]
                wc, rows = len(t.split()), len(re.split(r"\r?\n", t))
                line += f" · {rows} {plural(rows, 'строка', 'строки', 'строк')}, {wc} {plural(wc, 'слово', 'слова', 'слов')}"
                preview = re.sub(r"\s+", " ", t.strip()[:160])
                if preview:
                    line += f"\n  > {esc(preview)}{'…' if len(t) > 160 else ''}"
            lines.append(line)
        many = len(ctx.attachments) > 1
        tail = "\n\nОтвечать на вопросы по содержимому файла сможет языковая модель, когда её подключат на сервере." if text else ""
        return out(f"Получил {'файлы' if many else 'файл'}:\n\n" + "\n".join(lines) +
                   f"\n\nПодробный разбор (структура, частые слова, колонки таблиц) — в рабочем пространстве «Анализ файлов».{tail}",
                   [card("open", {"route": "#/workspace/files", "label": "Открыть «Анализ файлов»", "icon": "fileSearch"})])

    intent = nlu.intent(text)
    now = utcnow()

    if intent == "greeting":
        today = [t for t in tasks if not t.done and t.due_at and is_same_day(t.due_at, now, tz)]
        overdue = [t for t in tasks if not t.done and t.due_at and t.due_at < now]
        upcoming = sorted([e for e in s.events() if e.start_at > now], key=lambda e: e.start_at)
        parts = [f"Привет{', ' + user_name if user_name else ''}! Я рядом."]
        if today:
            parts.append(f"Сегодня {len(today)} {plural(len(today), 'задача', 'задачи', 'задач')}.")
        if overdue:
            parts.append(f"{len(overdue)} {plural(len(overdue), 'задача просрочена', 'задачи просрочены', 'задач просрочено')}.")
        if upcoming:
            parts.append(f"Ближайшее событие — «{upcoming[0].title}», {fmt_date_time(upcoming[0].start_at, tz).lower()}.")
        parts.append("\n\nРасскажи, что нового, или попроси что-нибудь напомнить.")
        return out(" ".join(parts))

    if intent == "about":
        name = ctx.user.assistant_name or "Adis"
        return out(f"Я — **{name}**, твой личный помощник с памятью. Запоминаю людей, факты, контакты и договорённости, "
                   "напоминаю о делах, веду календарь и будильники, нахожу то, что ты рассказывал раньше.\n\n"
                   "Попробуй: «Запомни номер Артёма +7 999 123-45-67» или «Что у меня завтра?»")

    if intent == "thanks":
        return out(["Всегда пожалуйста!", "Рад помочь. Обращайся.", "Готово. Если что-то ещё — я здесь."][ctx.variant % 3])

    if intent == "capabilities":
        return out("Вот что я умею:\n\n- **Запоминать людей** — «Сегодня познакомился с Артёмом, он программист»\n"
                   "- **Находить информацию** — «С кем я недавно познакомился из программистов?»\n"
                   "- **Напоминать** — «Напомни завтра в 10 позвонить Артёму»\n"
                   "- **Хранить факты, идеи и предпочтения** — «Запомни, что я не пью кофе после 18»\n"
                   "- **Планировать день** — «Что у меня на сегодня?»\n- **Готовить отчёты** — «Сделай отчёт за неделю»\n"
                   "- **Помогать с кодом** — «Напиши функцию сортировки на Python»\n\n"
                   "Всё, что я запоминаю, видно в разделе **Память** — там можно проверить, изменить или удалить любую запись.")

    if intent == "introduce":
        person = nlu.extract_person(text)
        if person:
            existing = next((p for p in people if p.name.lower() == person["name"].lower()
                             or (same_stem(first_name(p), person["name"]) and len(p.name.split(" ")) == 1)), None)
            memory = {"type": "event", "title": f"Знакомство: {person['name']}", "content": nlu.memory_content(text),
                      "tags": [x for x in ("знакомство", person["profession"].lower() if person["profession"] else None) if x]}
            data = {"person": person, "memory": memory, "existingPersonId": existing.id if existing else None}
            desc = " · ".join(x for x in (person["profession"], ", ".join(person["skills"]), person["organization"]) if x)
            if ctx.auto_save:
                tool_calls.append({"name": "memory_save", "args": data})
                res = save_introduction(ctx, data)
                return out(f"Запомнил: **{person['name']}**{' — ' + desc if desc else ''}. Найти его можно в разделе «Люди».",
                           [{**card("memory_save", data, "confirmed"), "result": res}])
            tool_calls.append({"name": "entity_lookup", "args": {"name": person["name"]}})
            msg = (f"Похоже, **{existing.name}** уже есть в твоей памяти. Обновить карточку новыми данными?" if existing
                   else f"Я выделил нового человека — **{person['name']}**{': ' + desc if desc else ''}. Сохранить в память?")
            return out(msg, [card("memory_save", data, "pending")])

    if intent == "people_query":
        stems, tech = nlu.profession_stems(text), nlu.find_tech(text)
        low = text.lower()
        recent = bool(re.search(r"(недавно|на этой неделе|в этом месяце|последн)", low))
        period = 7 if "на этой неделе" in low else 31
        args = {"profession": stems[0]["stem"] if stems else None, "skill": tech[0] if tech else None}
        tool_calls.append({"name": "entity_lookup", "args": args})
        all_ = s.entity_lookup(**args) if (stems or tech) else s.entity_lookup()
        fresh = [p for p in all_ if now - (p.met_at or p.created_at) < timedelta(days=period)] if recent else all_
        what = bool(stems)
        if not all_:
            prof = f" с профессией «{stems[0]['name'].lower()}»" if stems else ""
            return out(f"Пока не нашёл в памяти знакомств{prof}. Расскажи мне о новом знакомстве — и я запомню.")
        if recent and not fresh:
            p = all_[0]
            return out(f"За последний месяц таких знакомств не было. Раньше — **{p.name}** ({person_line(p)}), познакомились "
                       f"{fmt_date(p.met_at or p.created_at, tz)}{' ' + p.met_where if p.met_where else ''}.", [card("people", {"ids": [p.id]})])
        lst = fresh
        prof = " " + pl_prof(stems[0]["name"]) if what else ""
        if len(lst) == 1:
            p = lst[0]
            head = (f"{'Недавнее знакомство' if recent else 'Нашёл'}{prof} — **{p.name}**: {person_line(p)}. Познакомились "
                    f"{fmt_rel_day(p.met_at or p.created_at, tz).lower()}{' ' + p.met_where if p.met_where else ''}.")
        else:
            head = (f"Нашёл {len(lst)} {plural(len(lst), 'человека', 'человек', 'человек')}{prof}:\n\n" +
                    "\n".join(f"- **{p.name}** — {person_line(p)} ({fmt_date(p.met_at or p.created_at, tz)})" for p in lst))
        older = [p for p in all_ if p not in lst] if recent else []
        tail = ("\n\nРаньше также: " + ", ".join(f"**{p.name}** ({fmt_date(p.met_at or p.created_at, tz)})" for p in older) + ".") if older else ""
        ids = {p.id for p in lst}
        related = [t for t in tasks if not t.done and t.person_id in ids]
        rel = ("\n\nСвязанные задачи:\n" + "\n".join(task_line(t, tz) for t in related)) if related else ""
        return out(head + tail + rel, [card("people", {"ids": [p.id for p in lst]})])

    if intent == "entity_lookup":
        p = nlu.find_person_mention(re.sub(r"^(кто так(ой|ая)|что (ты )?знаешь|расскажи)", "", text, flags=re.I), people)
        tool_calls.append({"name": "entity_lookup", "args": {"text": text}})
        if not p:
            return out("Не нашёл такого человека в памяти. Расскажи о нём — и я запомню.")
        mems = [m for m in s.memories() if m.person_id == p.id]
        open_tasks = [t for t in tasks if t.person_id == p.id and not t.done]
        c = f"**{p.name}**{' — ' + p.profession.lower() if p.profession else ''}{', ' + p.organization if p.organization else ''}."
        if p.skills:
            c += f"\n\n**Навыки:** {', '.join(p.skills)}"
        c += f"\n\n**Знакомство:** {fmt_date(p.met_at or p.created_at, tz)}{', ' + p.met_where if p.met_where else ''}"
        if p.notes:
            c += f"\n\n**Заметки:** {p.notes}"
        if open_tasks:
            c += "\n\n**Задачи:**\n" + "\n".join(task_line(t, tz) for t in open_tasks)
        if mems:
            c += f"\n\n**Связанные воспоминания:** {len(mems)}"
        return out(c, [card("people", {"ids": [p.id]})])

    if intent == "task_query":
        low = text.lower()
        lst = [t for t in tasks if not t.done]
        label = "Активные задачи"
        tomorrow = now + timedelta(days=1)
        if "завтра" in low:
            lst, label = [t for t in lst if t.due_at and is_same_day(t.due_at, tomorrow, tz)], "На завтра"
        elif "сегодня" in low:
            lst, label = [t for t in lst if t.due_at and (is_same_day(t.due_at, now, tz) or t.due_at < now)], "На сегодня"
        lst.sort(key=lambda t: iso(t.due_at) or "9")
        tool_calls.append({"name": "memory_search", "args": {"scope": "tasks"}})
        events = []
        if re.search(r"сегодня|завтра", low):
            day = tomorrow if "завтра" in low else now
            events = [e for e in s.events() if is_same_day(e.start_at, day, tz)]
        if not lst and not events:
            return out(f"{label}: ничего нет. Можно отдохнуть или запланировать что-то новое.")
        c = f"**{label}:**\n\n" + "\n".join(task_line(t, tz) for t in lst)
        if events:
            c += "\n\n**События:**\n" + "\n".join(f"- {e.title} — {fmt_time(e.start_at, tz)}{', ' + e.location if e.location else ''}" for e in events)
        return out(c, [card("tasks", {"ids": [t.id for t in lst[:6]]})] if lst else [])

    if intent == "reminder":
        r = nlu.extract_reminder(text, ctx.now)
        person = nlu.find_person_mention(r["title"], people)
        data = {"title": r["title"], "dueAt": r["dueAt"], "repeat": r["repeat"], "personId": person.id if person else None,
                "personName": person.name if person else None, "remind": True}
        tool_calls.extend([{"name": "task_create", "args": data}, {"name": "notification_schedule", "args": {"at": r["dueAt"]}}])
        msg = "Создать напоминание?" if r["dueAt"] else "Создать напоминание? Время не указано — выбери его на карточке."
        return out(msg + (f" Свяжу его с карточкой **{person.name}**." if person else ""), [card("task_create", data, "pending")])

    if intent in ("memory_save", "preference", "plan", "idea"):
        type_ = "idea" if intent == "idea" else "preference" if intent == "preference" else nlu.classify_memory(text)
        sensitive = nlu.is_sensitive(text)
        memory = {"type": type_, "title": nlu.memory_title(text), "content": nlu.memory_content(text), "tags": nlu.keywords(text)[:3],
                  "confirmed": type_ != "assumption"}
        person = nlu.find_person_mention(text, people)
        if person:
            memory["personId"] = person.id
        data = {"memory": memory, "sensitive": sensitive}
        type_name = MEMORY_TYPES[type_][1].lower()
        if sensitive and ctx.sensitive_guard:
            return out("⚠ Похоже, здесь **чувствительные данные** (пароль, документы, финансы или здоровье). Я не сохраняю такое автоматически. "
                       "Если это действительно нужно — подтверди вручную. Пароли лучше хранить в менеджере паролей.", [card("memory_save", data, "pending")])
        if ctx.auto_save and intent == "memory_save":
            tool_calls.append({"name": "memory_save", "args": memory})
            m = s.memory_save({**_mem_fields(memory), "source": {"kind": "chat", "excerpt": text, "conversationId": ctx.conversation_id}})
            return out(f"Запомнил как {type_name}: «{memory['title']}».", [{**card("memory_save", data, "confirmed"), "result": {"memoryId": m.id}}])
        q = f"Сохраню как **{type_name}**. Подтверди:" if intent == "memory_save" else f"Похоже на {type_name}. Запомнить?"
        return out(q, [card("memory_save", data, "pending")])

    if intent in ("event_create", "calendar_query", "event_move", "event_cancel", "alarm", "alarm_off", "alarm_list"):
        return calendar_turn(ctx, intent, tool_calls, out)

    if intent in ("expense", "income", "debt", "debt_repaid", "finance_query"):
        return finance_turn(ctx, intent, tool_calls, out)

    if intent == "report":
        tool_calls.append({"name": "memory_search", "args": {"period": "7d"}})
        return out(build_report(s), [card("open", {"route": "#/workspace/reports", "label": "Открыть в «Отчётах»", "icon": "report"})])

    if intent == "code":
        return out(code_answer(text), [card("open", {"route": "#/workspace/code", "label": "Открыть «Программирование»", "icon": "code"})])

    tool_calls.append({"name": "memory_search", "args": {"query": text}})
    mems = s.memory_search(text, limit=5)
    kws = nlu.keywords(text)
    found = [p for p in people if any(f and any(same_stem(w, k) for w in words(f)) for k in kws
                                      for f in [p.name, p.profession, p.organization, *(p.skills or [])])]
    if mems or found:
        c = "Вот что нашёл в памяти:\n\n" + "\n".join(
            f"- **{m.title}** — {MEMORY_TYPES.get(m.type, ('', 'Запись'))[1].lower()}, {fmt_date(m.created_at, tz)}" for m in mems)
        if found:
            c += ("\n" if mems else "") + "\n".join(f"- **{p.name}** — {person_line(p)}" for p in found)
        cards = []
        if mems:
            cards.append(card("memories", {"ids": [m.id for m in mems]}))
        if found:
            cards.append(card("people", {"ids": [p.id for p in found]}))
        return out(c, cards)
    if intent == "memory_query":
        return out("В памяти ничего не нашёл по этому запросу. Попробуй переформулировать или расскажи мне об этом — я запомню.")
    return out("На сервере пока **не подключена языковая модель**, поэтому свободный диалог ограничен. Я уже умею:\n\n"
               "- запоминать знакомства и факты\n- искать по памяти\n- создавать напоминания\n- показывать задачи и готовить отчёты\n\n"
               "Попробуй: «Напомни завтра в 10 позвонить Артёму» или «Что у меня на сегодня?»")


_ACTION_WORDS = {"перенеси", "сдвинь", "передвинь", "перенести", "отмени", "удали", "убери", "встречу", "встреча", "мою", "мой", "моё",
                 "сегодняшнюю", "завтрашнюю", "событие", "пожалуйста", "adis"}


def event_line(e, tz) -> str:
    end = f"–{fmt_time(e.end_at, tz)}" if e.end_at and is_same_day(e.start_at, e.end_at, tz) else ""
    return f"- **{fmt_time(e.start_at, tz)}{end}** {e.title}{' · ' + e.location if e.location else ''}"


def find_event(ctx: TurnContext, text: str, use_day: bool = True):
    """Upcoming event the user refers to: by person, by title words, by day."""
    s, tz, now = ctx.store, ctx.tz, utcnow()
    events = sorted([e for e in s.events() if (e.end_at or e.start_at) >= now - timedelta(hours=2)], key=lambda e: e.start_at)
    if not events:
        return None
    if use_day:
        when = nlu.parse_when(text, ctx.now)
        if when["has_day"] and when["date"]:
            day_events = [e for e in events if is_same_day(e.start_at, when["date"], tz)]
            events = day_events or events
    person = nlu.find_person_mention(text, s.people())
    if person:
        first = person.name.split(" ")[0]
        hits = [e for e in events if e.person_id == person.id or any(same_stem(w, first) for w in words(e.title))]
        if hits:
            return hits[0]
    kws = [k for k in nlu.keywords(text) if k not in _ACTION_WORDS]
    best, best_score = None, 0
    for e in events:
        sc = sum(1 for k in kws if any(same_stem(w, k) for w in words(e.title + " " + e.location)))
        if sc > best_score:
            best, best_score = e, sc
    return best or (events[0] if len(events) == 1 else None)


def _event_data(e, tz) -> dict:
    return {"eventId": e.id, "title": e.title, "oldStartAt": iso(e.start_at), "oldEndAt": iso(e.end_at), "location": e.location}


def calendar_turn(ctx: TurnContext, intent: str, tool_calls: list, out):
    from ..services.alarms import describe_days

    s, tz, text = ctx.store, ctx.tz, ctx.text

    if intent == "event_create":
        ev = nlu.extract_event(text, ctx.now)
        person = nlu.find_person_mention(ev["title"], s.people())
        data = {**ev, "personId": person.id if person else None, "personName": person.name if person else None}
        if ev["startAt"]:
            start, end = parse_iso(ev["startAt"]), parse_iso(ev["endAt"])
            data["conflicts"] = [e.title for e in s.events_between(start, end) if e.start_at < end][:3]
        tool_calls.append({"name": "event_create", "args": data})
        if not ev["startAt"]:
            return out("Добавить в календарь? Дату я не понял — выбери её на карточке.", [card("event_create", data, "pending")])
        msg = "Добавить в календарь?"
        if data.get("conflicts"):
            msg += f" В это время уже есть: {', '.join('«' + c + '»' for c in data['conflicts'])}."
        return out(msg, [card("event_create", data, "pending")])

    if intent == "calendar_query":
        tool_calls.append({"name": "event_list", "args": {"text": text}})
        person = nlu.find_person_mention(text, s.people())
        if person and re.search(r"когда", text, re.I):
            e = find_event(ctx, text, use_day=False)
            if not e:
                return out(f"Ближайших событий с **{person.name}** в календаре нет.")
            return out(f"**{e.title}** — {fmt_date_time(e.start_at, tz).lower()}{', ' + e.location if e.location else ''}.",
                       [card("open", {"route": f"#/calendar?date={local_date(e.start_at, tz)}", "label": "Открыть в календаре", "icon": "calendar"})])
        start, end, label = nlu.calendar_range(text, ctx.now)
        su, eu = to_utc(start), to_utc(end)
        events = sorted(s.events_between(su, eu), key=lambda e: e.start_at)
        tasks = sorted([t for t in s.tasks() if not t.done and t.due_at and su <= t.due_at < eu], key=lambda t: t.due_at)
        single_day = end - start <= timedelta(days=1)
        label = label or fmt_rel_day(su, tz)
        if not events and not tasks:
            return out(f"{label}: в календаре пусто.", [card("open", {"route": f"#/calendar?date={local_date(su, tz)}", "label": "Открыть календарь", "icon": "calendar"})])
        parts = [f"**{label}:**"]
        if single_day:
            parts += [event_line(e, tz) for e in events]
        else:
            for e in events:
                parts.append(f"- {fmt_date(e.start_at, tz)}, **{fmt_time(e.start_at, tz)}** {e.title}{' · ' + e.location if e.location else ''}")
        if tasks:
            parts.append("\n**Задачи:**\n" + "\n".join(task_line(t, tz) for t in tasks))
        cards = [card("open", {"route": f"#/calendar?date={local_date(su, tz)}", "label": "Открыть календарь", "icon": "calendar"})]
        if tasks:
            cards.insert(0, card("tasks", {"ids": [t.id for t in tasks[:6]]}))
        return out("\n".join(parts), cards)

    if intent in ("event_move", "event_cancel"):
        e = find_event(ctx, text, use_day=intent == "event_cancel")
        tool_calls.append({"name": "event_update", "args": {"text": text}})
        if not e:
            return out("Не нашёл такое событие в календаре. Уточни название или открой календарь.",
                       [card("open", {"route": "#/calendar", "label": "Открыть календарь", "icon": "calendar"})])
        data = _event_data(e, tz)
        if intent == "event_cancel":
            return out(f"Отменить «{e.title}» ({fmt_date_time(e.start_at, tz).lower()})?", [card("event_update", {**data, "cancel": True}, "pending")])
        when = nlu.parse_when(re.sub(r"^\S+\s+", "", text), ctx.now)
        if not when["date"] or not (when["has_time"] or when["has_day"]):
            return out(f"На когда перенести «{e.title}»? Укажи день или время — или выбери на карточке.",
                       [card("event_update", {**data, "startAt": None}, "pending")])
        old = local(e.start_at, tz)
        new = when["date"]
        if not when["has_day"]:
            new = old.replace(hour=new.hour, minute=new.minute)
        elif not when["has_time"]:
            new = new.replace(hour=old.hour, minute=old.minute)
        duration = (e.end_at - e.start_at) if e.end_at else timedelta(hours=1)
        nu = to_utc(new)
        data.update(startAt=iso(nu), endAt=iso(nu + duration))
        return out(f"Перенести «{e.title}» с {fmt_date_time(e.start_at, tz).lower()} на {fmt_date_time(nu, tz).lower()}?",
                   [card("event_update", data, "pending")])

    alarms = s.alarms()
    if intent == "alarm_list":
        on = [a for a in alarms if a.enabled]
        if not alarms:
            return out("Будильников пока нет. Скажи, например: «Поставь будильник на 7:30 по будням».",
                       [card("open", {"route": "#/alarms", "label": "Будильники", "icon": "clock"})])
        lines = [f"- **{a.hour:02d}:{a.minute:02d}** {describe_days(a.days).lower()}{' · ' + a.label if a.label else ''}{'' if a.enabled else ' (выключен)'}" for a in alarms]
        return out(f"Будильники ({len(on)} включено):\n\n" + "\n".join(lines), [card("open", {"route": "#/alarms", "label": "Открыть будильники", "icon": "clock"})])

    al = nlu.extract_alarm(text, ctx.now)
    if intent == "alarm_off":
        on = [a for a in alarms if a.enabled]
        target = next((a for a in on if al["hasTime"] and (a.hour, a.minute) == (al["hour"], al["minute"])), None) or (on[0] if len(on) == 1 else None)
        if not target:
            return out("Какой будильник выключить? Открой список — там можно выключить любой.",
                       [card("open", {"route": "#/alarms", "label": "Будильники", "icon": "clock"})])
        tool_calls.append({"name": "alarm_update", "args": {"alarmId": target.id, "enabled": False}})
        return out(f"Выключить будильник на {target.hour:02d}:{target.minute:02d}?",
                   [card("alarm_update", {"alarmId": target.id, "time": f"{target.hour:02d}:{target.minute:02d}", "label": target.label,
                                          "enabled": False}, "pending")])

    data = {"hour": al["hour"], "minute": al["minute"], "days": al["days"], "daysLabel": describe_days(al["days"]), "label": al["label"]}
    tool_calls.append({"name": "alarm_set", "args": data})
    if not al["hasTime"]:
        return out("На какое время поставить будильник? Выбери на карточке.", [card("alarm_set", {**data, "hour": 7, "minute": 0}, "pending")])
    return out(f"Поставить будильник на **{al['hour']:02d}:{al['minute']:02d}** ({data['daysLabel'].lower()})?", [card("alarm_set", data, "pending")])


_FIN_VERBS = re.compile(r"^\s*(?:я\s+)?(?:потратил[аи]?|потрачено|заплатил[аи]?|оплатил[аи]?|купил[аи]?|расход|трата|получил[аи]?|заработал[аи]?|"
                        r"пришл[оа]|поступил[оа]|начислили|мне перевели|перевели мне)\s*", re.I)


def _fin_note(text: str, span) -> str:
    rest = (text[:span[0]] + " " + text[span[1]:]) if span else text
    rest = _FIN_VERBS.sub("", rest.strip())
    rest = re.sub(r"^\s*(?:на|за)\s+", "", re.sub(r"\s+(?:на|за)\s*$", "", rest.strip()))
    rest = re.sub(r"\s+(?:на|за)\s+(?=на|за)", " ", rest)
    rest = re.sub(r"\s*(?:₽|руб(?:л(?:ей|я|ь))?\.?|р\.)\s*", " ", rest)
    return cap(re.sub(r"\s+", " ", rest).strip(" ,.-—"))[:200]


def finance_turn(ctx: TurnContext, intent: str, tool_calls: list, out):
    from ..services import finance as fin

    s, tz, text = ctx.store, ctx.tz, ctx.text
    F = fin.Finance(s)
    open_fin = card("open", {"route": "#/finance", "label": "Открыть «Финансы»", "icon": "chart"})

    if intent in ("expense", "income"):
        m = fin.parse_money(text)
        if not m:
            return out("Сколько? Назови сумму, например: «Потратил 1200 на продукты».")
        note = _fin_note(text, m["span"])
        when = utcnow() - (timedelta(days=1) if re.search(r"\bвчера\b", text, re.I) else timedelta(0))
        person = nlu.find_person_mention(text, s.people())
        data = {"kind": intent, "amount": float(m["amount"]), "currency": m["currency"], "category": fin.categorize(text, intent),
                "note": note, "occurredAt": iso(when), "personId": person.id if person else None}
        tool_calls.append({"name": "finance_add", "args": data})
        what = "расход" if intent == "expense" else "доход"
        cat = data["category"]
        if note and len(note.split()) == 1 and same_stem(note, cat.split()[0]):
            note = data["note"] = cat
        label = (note + ("" if same_stem(note.split()[0], cat.split()[0]) else f" ({cat.lower()})")) if note else cat
        return out(f"Записать {what} **{fin.money(m['amount'], m['currency'])}** — {label}?",
                   [card("finance_tx", data, "pending")])

    if intent == "debt":
        m = fin.parse_money(text)
        direction = nlu.debt_direction(text)
        person = nlu.find_person_mention(text, s.people())
        name = person.name if person else fin.extract_counterparty(text)
        if not m:
            return out("Какая сумма? Например: «Дал Артёму 5000 до пятницы».")
        if not name:
            return out("Кто должен или кому ты должен? Например: «Занял у Дмитрия 10000».")
        rest = text[:m["span"][0]] + " " + text[m["span"][1]:]
        when = nlu.parse_when(rest, ctx.now) if re.search(r"(до|к|через|вернуть|отдать)\s", rest, re.I) else {"date": None, "has_day": False}
        due = when["date"] if when.get("has_day") or (when.get("date") and when.get("has_time")) else None
        data = {"direction": direction, "amount": float(m["amount"]), "currency": m["currency"], "personId": person.id if person else None,
                "counterparty": name, "dueAt": iso(due) if due else None, "note": ""}
        tool_calls.append({"name": "debt_add", "args": data})
        amount = fin.money(m["amount"], m["currency"])
        due_txt = f" до {fmt_date(due, tz)}" if due else ""
        msg = f"Записать: **{name}** должен тебе **{amount}**{due_txt}?" if direction == "lent" else f"Записать: ты должен **{fin.dative(name)}** **{amount}**{due_txt}?"
        return out(msg + (" Напомню в срок." if due else ""), [card("debt_create", data, "pending")])

    if intent == "debt_repaid":
        direction = nlu.repaid_direction(text)
        d = F.find_open_debt(text, direction) or (F.find_open_debt(text) if direction else None)
        tool_calls.append({"name": "debt_repay", "args": {"text": text}})
        if not d:
            return out("Не нашёл открытого долга. Открой «Финансы → Долги», чтобы выбрать вручную.", [open_fin])
        m = fin.parse_money(text, d.currency)
        left = d.amount - (d.paid or 0)
        amount = min(m["amount"], left) if m else left
        full = amount >= left
        data = {"debtId": d.id, "amount": float(amount), "full": full, "left": float(left), "currency": d.currency, "counterparty": d.counterparty,
                "direction": d.direction}
        who = f"**{d.counterparty}** вернул(а) тебе" if d.direction == "lent" else f"Ты вернул(а) **{fin.dative(d.counterparty)}**"
        rest = "" if full else f" Останется {fin.money(left - amount, d.currency)}."
        return out(f"{who} **{fin.money(amount, d.currency)}**{' — долг закрыт' if full else ''}?{rest}", [card("debt_repay", data, "pending")])

    # finance_query
    low = text.lower()
    if re.search(r"долг|должен|должна|должны|задолж", low):
        direction = "lent" if re.search(r"(кто|сколько)\s+(мне\s+)?(\S+\s+)?(мне\s+)?(должен|должна|должны)|мне\s+должн|мои должники", low) else \
            "borrowed" if re.search(r"кому\s+я|я\s+(\S+\s+)?должен|я\s+(\S+\s+)?должна|мои долги перед", low) else None
        tool_calls.append({"name": "debt_list", "args": {"direction": direction}})
        debts = F.debts(status="open", direction=direction)
        person = nlu.find_person_mention(text, s.people())
        if person:
            debts = [d for d in debts if d.person_id == person.id] or [d for d in debts if same_stem(d.counterparty.split(" ")[0], person.name.split(" ")[0])]
        if not debts:
            empty = {"lent": "Тебе никто не должен.", "borrowed": "Ты никому не должен."}.get(direction, "Открытых долгов нет.")
            return out(empty, [open_fin])
        lines = []
        for title, dr in (("**Тебе должны:**", "lent"), ("**Ты должен:**", "borrowed")):
            items = [d for d in debts if d.direction == dr]
            if items:
                lines.append(title)
                for d in items:
                    left = d.amount - (d.paid or 0)
                    due = f", до {fmt_date(d.due_at, tz)}" + (" — **просрочено**" if d.due_at < utcnow() else "") if d.due_at else ""
                    lines.append(f"- {d.counterparty} — {fin.money(left, d.currency)}{due}")
                totals = {}
                for d in items:
                    totals[d.currency] = totals.get(d.currency, 0) + (d.amount - (d.paid or 0))
                lines.append("  Итого: " + ", ".join(fin.money(v, c) for c, v in totals.items()) + "\n")
        return out("\n".join(lines).strip(), [open_fin])

    start, end, label = F.period(text)
    kind = "income" if re.search(r"доход|заработал|получил|поступлен", low) else "expense"
    both = bool(re.search(r"баланс|бюджет|итог|финанс", low))
    cat = fin.categorize(text, "expense") if kind == "expense" else "Другое"
    tool_calls.append({"name": "finance_report", "args": {"from": iso(to_utc(start)), "to": iso(to_utc(end)), "category": cat}})
    sm = F.summary(start, end)
    if cat != "Другое" and not both:
        txs = F.transactions(to_utc(start), to_utc(end), "expense", cat)
        if not txs:
            return out(f"{label}: на «{cat.lower()}» трат нет.", [open_fin])
        totals = {}
        for t in txs:
            totals[t.currency] = totals.get(t.currency, 0) + t.amount
        return out(f"{label} на «{cat.lower()}»: **{', '.join(fin.money(v, c) for c, v in totals.items())}** ({len(txs)} {plural(len(txs), 'операция', 'операции', 'операций')}).", [open_fin])
    if not sm["totals"]:
        return out(f"{label}: операций пока нет. Скажи, например: «Потратил 1200 на продукты».", [open_fin])
    lines = [f"**{label}:**"]
    for tt in sm["totals"]:
        c = tt["currency"]
        if both or kind == "income":
            lines.append(f"- Доходы: {fin.money(tt['income'], c)}")
        if both or kind == "expense":
            lines.append(f"- Расходы: {fin.money(tt['expense'], c)}")
        if both:
            lines.append(f"- Баланс: {fin.money(tt['balance'], c)}")
    if kind == "expense" or both:
        top = sm["byCategory"][:5]
        if top:
            lines.append("\n**Больше всего:**\n" + "\n".join(f"- {x['category']} — {fin.money(x['amount'], x['currency'])}" for x in top))
    return out("\n".join(lines), [open_fin])


def local_date(dt, tz) -> str:
    return local(dt, tz).strftime("%Y-%m-%d")


class RulesEngine:
    name = ENGINE

    async def respond(self, ctx: TurnContext):
        reply = respond_sync(ctx)
        if ctx.streaming:
            yield {"type": "status", "text": "Adis думает…"}
            for tc in reply["toolCalls"]:
                if tc["name"] in TOOL_LABELS:
                    yield {"type": "status", "text": TOOL_LABELS[tc["name"]], "tool": tc["name"]}
                    await asyncio.sleep(0.15)
            for tok in re.findall(r"\s*\S+", reply["content"]):
                yield {"type": "delta", "text": tok}
                await asyncio.sleep(0.012 + random.random() * 0.012)
        yield {"type": "final", **reply}
