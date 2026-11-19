"""Demo account content (port of app/js/mock/db.js seedDemo) and built-in agents for every new account."""
from __future__ import annotations

from datetime import datetime, timedelta

from ..core.textutil import uid
from ..core.timeutil import iso, to_utc
from ..models import Agent, Document, Event, Memory, Person, Task

BUILTIN_AGENTS = [
    ("Планировщик дня", "calendar", "planner", "Собирает план на день из задач, событий и напоминаний с учётом твоих предпочтений.",
     "Составь реалистичный план дня. Учитывай предпочтения по времени встреч.", ["memory_search", "task_update"]),
    ("Нетворкинг-ассистент", "users", "network", "Подсказывает, с кем из знакомых стоит связаться, и готовит короткое сообщение.",
     "Найди людей, с которыми давно не было контакта.", ["entity_lookup", "task_create"]),
    ("Аналитик памяти", "memory", "memory", "Анализирует личную память: что запомнено, что требует подтверждения, какие темы важны.",
     "Проанализируй структуру памяти.", ["memory_search"]),
    ("Недельный отчёт", "report", "weekly", "Готовит отчёт за неделю: выполненные задачи, новые знакомства, планы.",
     "Сформируй отчёт за последние 7 дней.", ["memory_search", "entity_lookup"]),
]


def add_builtin_agents(db, user_id: str) -> None:
    for name, icon, builtin, desc, instr, tools in BUILTIN_AGENTS:
        db.add(Agent(id=uid("ag"), user_id=user_id, name=name, icon=icon, builtin=builtin, description=desc, instructions=instr, tools=tools))


def seed_demo(db, user_id: str, tz) -> None:
    now_local = datetime.now(tz)

    def at(days: int, h: int, m: int = 0):
        return to_utc((now_local + timedelta(days=days)).replace(hour=h, minute=m, second=0, microsecond=0))

    def src(excerpt: str) -> dict:
        return {"kind": "chat", "excerpt": excerpt, "conversationId": None}

    def person(name, prof, skills, org, met, where, notes, inter, updated=None):
        return Person(id=uid("p"), user_id=user_id, name=name, profession=prof, skills=skills, organization=org, met_at=met, met_where=where,
                      notes=notes, interactions=[{"date": iso(d), "text": t} for d, t in inter], created_at=met, updated_at=updated or met)

    maria = person("Мария Ковалёва", "Дизайнер", ["Figma", "UX-исследования", "Мобильные интерфейсы"], "Studio North", at(-12, 19),
                   "на дизайн-митапе", "Готова помочь с дизайном онбординга.",
                   [(at(-12, 19), "Познакомились на дизайн-митапе"), (at(-3, 14), "Обсудили прототип онбординга")], at(-3, 14))
    dmitry = person("Дмитрий Орлов", "Инвестор", ["Венчурные инвестиции", "SaaS", "AI-стартапы"], "Orbit Capital", at(-20, 11),
                    "на конференции Startup Village", "Интересуется AI-ассистентами. Просил прислать метрики.",
                    [(at(-20, 11), "Познакомились на конференции")])
    igor = person("Игорь Смирнов", "Программист", ["Go", "Kubernetes", "Backend"], "Fintech Lab", at(-95, 18), "на хакатоне", "",
                  [(at(-95, 18), "Вместе участвовали в хакатоне")])
    db.add_all([maria, dmitry, igor])
    db.flush()

    def mem(type_, title, content, tags, created, excerpt, confirmed=True, pid=None):
        return Memory(id=uid("m"), user_id=user_id, type=type_, title=title, content=content, tags=tags, confirmed=confirmed, person_id=pid,
                      source=src(excerpt), created_at=created, updated_at=created)

    db.add_all([
        mem("event", "Знакомство с Марией Ковалёвой", "Познакомились на дизайн-митапе. Мария — дизайнер, работает с Figma.", ["знакомство", "дизайн"],
            maria.created_at, "Сегодня на митапе познакомился с Марией, она дизайнер", pid=maria.id),
        mem("event", "Знакомство с Дмитрием Орловым", "Инвестор из Orbit Capital, познакомились на Startup Village. Просил метрики продукта.",
            ["инвестор", "знакомство"], dmitry.created_at, "Познакомился с Дмитрием Орловым на Startup Village", pid=dmitry.id),
        mem("preference", "Встречи — до обеда", "Предпочитаю назначать встречи с 10:00 до 12:00.", ["встречи", "время"], at(-30, 9),
            "Мне удобнее встречи утром, с 10 до 12"),
        mem("plan", "Запустить MVP Adis", "Запустить MVP Adis и показать инвесторам до конца года.", ["adis", "запуск"], at(-25, 10),
            "Хочу запустить MVP до конца года"),
        mem("idea", "Голосовой дневник", "Голосовой дневник, который сам расставляет теги и находит связи между записями.", ["идея", "голос"],
            at(-8, 22), "Идея: голосовой дневник с автотегами"),
        mem("fact", "Любимый кофе — флэт уайт", "Пью флэт уайт на овсяном молоке.", ["кофе"], at(-15, 8), "Запомни, я пью флэт уайт на овсяном"),
        mem("knowledge", "Retention D30", "Retention D30 — доля пользователей, вернувшихся в продукт через 30 дней. Цель для MVP — 25%.", ["метрики"],
            at(-5, 16), "Запомни: цель по retention D30 — 25%"),
        mem("assumption", "Дмитрий может инвестировать в pre-seed", "Похоже, Дмитрий рассматривает pre-seed раунды в AI. Требует подтверждения.",
            ["инвестор"], at(-2, 18), "Кажется, Дмитрий смотрит pre-seed", confirmed=False, pid=dmitry.id),
    ])

    def task(title, notes, due, repeat="none", remind=True, done=False, pid=None, done_at=None):
        return Task(id=uid("t"), user_id=user_id, title=title, notes=notes, due_at=due, repeat=repeat, remind=remind, done=done, done_at=done_at,
                    person_id=pid, timezone=tz.key, notify_at=due if remind and not done else None)

    db.add_all([
        task("Подготовить питч-дек для инвесторов", "Слайды: проблема, решение, демо, рынок, команда.", at(0, 18)),
        task("Позвонить Марии насчёт дизайна онбординга", "", at(1, 11), pid=maria.id),
        task("Отправить метрики Дмитрию", "Retention, DAU, воронка онбординга.", at(-1, 17), pid=dmitry.id),
        task("Утренняя тренировка", "", at(1, 8), repeat="daily"),
        task("Зарегистрировать домен", "", at(-4, 12), remind=False, done=True, done_at=at(-4, 13)),
    ])
    db.add_all([
        Event(id=uid("e"), user_id=user_id, title="Встреча с инвесторами", start_at=at(2, 11), end_at=at(2, 12), location="Orbit Capital, офис",
              notes="Демо Adis + метрики", remind_minutes=60),
        Event(id=uid("e"), user_id=user_id, title="Созвон с командой", start_at=at(0, 12), end_at=at(0, 12, 30), location="Онлайн", remind_minutes=10),
        Event(id=uid("e"), user_id=user_id, title="Дизайн-ревью с Марией", start_at=at(4, 10), end_at=at(4, 11), remind_minutes=30),
    ])
    db.add(Document(id=uid("doc"), user_id=user_id, title="Заметки к питчу", created_at=at(-1, 20), updated_at=at(-1, 20), content=(
        "# Питч Adis\n\n**Проблема:** информация о людях, планах и договорённостях теряется в десятках приложений.\n\n"
        "**Решение:** Adis — персональный ИИ-помощник с долговременной памятью.\n\n- Голос и текст\n- Память о людях и событиях\n"
        "- Напоминания естественным языком")))
