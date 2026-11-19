"""Rule-based Russian NLU (server port of app/js/mock/nlu.js).

Used by the rules engine when no LLM is configured, and by the LLM engine for sensitive-data checks and
person matching. Dates are resolved in the user's time zone.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

from ..core.textutil import cap, same_stem, words
from ..core.timeutil import add_months, iso, js_weekday, safe_replace, start_of_day, utcnow

L = "а-яёa-z0-9"


def W(src: str, flags=re.I) -> re.Pattern:
    """Word-boundary regex that works with Cyrillic."""
    return re.compile(f"(^|[^{L}])({src})(?=$|[^{L}])", flags)


PROFESSIONS = [
    ("Продакт-менеджер", "продакт"), ("Программист", "программист"), ("Разработчик", "разработчик"), ("Дизайнер", "дизайнер"),
    ("Врач", "врач"), ("Юрист", "юрист"), ("Адвокат", "адвокат"), ("Предприниматель", "предпринимател"), ("Бизнесмен", "бизнесмен"),
    ("Инвестор", "инвестор"), ("Маркетолог", "маркетолог"), ("Таргетолог", "таргетолог"), ("Менеджер", "менеджер"), ("Учитель", "учител"),
    ("Преподаватель", "преподавател"), ("Инженер", "инженер"), ("Бухгалтер", "бухгалтер"), ("Аналитик", "аналитик"), ("Архитектор", "архитектор"),
    ("Фотограф", "фотограф"), ("Журналист", "журналист"), ("Тренер", "тренер"), ("Студент", "студент"), ("Директор", "директор"),
    ("Основатель", "основател"), ("Рекрутер", "рекрутер"), ("Тестировщик", "тестировщик"), ("Психолог", "психолог"), ("Блогер", "блогер"),
    ("Музыкант", "музыкант"), ("Художник", "художник"), ("Повар", "повар"), ("Продюсер", "продюсер"), ("Консультант", "консультант"),
    ("Экономист", "экономист"), ("Финансист", "финансист"), ("Риелтор", "риелтор"), ("Стоматолог", "стоматолог"), ("Data Scientist", "data scien"),
]
TECH = ["Python", "JavaScript", "TypeScript", "Java", "Kotlin", "Swift", "Flutter", "Dart", "Golang", "Go", "Rust", r"C\+\+", "C#", "PHP", "Ruby",
        "React", "Vue", "Angular", r"Node\.js", "SQL", "PostgreSQL", "Django", "FastAPI", "Docker", "Kubernetes", "Figma", "Photoshop", "Excel",
        "1С", "Unity", "iOS", "Android", "TensorFlow", "PyTorch"]
_TECH_RX = [(t, re.compile(f"(^|[^a-zа-я0-9+#])({t})(?=$|[^a-zа-я0-9+#])", re.I)) for t in TECH]

WEEKDAY_FORMS = [
    ("воскресенье", "воскресенье|воскресеньям"), ("понедельник", "понедельник|понедельникам"), ("вторник", "вторник|вторникам"),
    ("среда", "среду|среда|средам"), ("четверг", "четверг|четвергам"), ("пятница", "пятницу|пятница|пятницам"), ("суббота", "субботу|суббота|субботам"),
]
MONTH_RX = "январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь]"
MONTH_PREFIX = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
KNOWN_NAMES = {"артёмом": "Артём", "артемом": "Артём", "ильёй": "Илья", "ильей": "Илья", "игорем": "Игорь", "никитой": "Никита",
               "львом": "Лев", "павлом": "Павел", "петром": "Пётр", "любовью": "Любовь"}


def weekday_index(word: str) -> int:
    word = word.lower()
    for i, (_, forms) in enumerate(WEEKDAY_FORMS):
        if re.fullmatch(f"({forms})", word):
            return i
    return -1


def _ends(w: str, rx: str) -> bool:
    return re.search(rx + "$", w, re.I) is not None


def name_to_nominative(w: str) -> str:
    if w.lower() in KNOWN_NAMES:
        return KNOWN_NAMES[w.lower()]
    r = w
    if _ends(w, "ием"):
        r = w[:-3] + "ий"
    elif _ends(w, "[еиа]ем"):
        r = w[:-2] + "й"
    elif _ends(w, "ом"):
        r = w[:-2]
    elif _ends(w, "ем"):
        r = w[:-2] + "ь"
    elif _ends(w, "ьей"):
        r = w[:-2] + "я"
    elif _ends(w, "[шжчщ]ей"):
        r = w[:-2] + "а"
    elif _ends(w, "ей"):
        r = w[:-2] + "я"
    elif _ends(w, "ой") or _ends(w, "ою"):
        r = w[:-2] + "а"
    return cap(r)


def surname_to_nominative(w: str) -> str:
    if _ends(w, "ским|цким"):
        return w[:-2] + "ий"
    if _ends(w, "[ео]вым|[ие]ным") or _ends(w, "ым|им"):
        return w[:-2]
    if _ends(w, "[ео]вой|[ие]ной|ской|цкой"):
        return w[:-2] + "а"
    return name_to_nominative(w)


def org_to_nominative(w: str) -> str:
    return w[:-1] if re.fullmatch(r"[А-ЯЁ][а-яё]{3,}е", w) else w


def activity_to_nominative(phrase: str) -> str:
    parts = phrase.strip().split()
    if not parts:
        return ""
    f = parts[0]
    if _ends(f, "ой"):
        f = f[:-2] + "а"
    elif _ends(f, "ом"):
        f = f[:-2]
    elif _ends(f, "ами"):
        f = f[:-3] + "ы"
    elif _ends(f, "ей"):
        f = f[:-2] + "я"
    parts[0] = f
    return " ".join(parts)


# ---------- dates ----------
_R = {
    "daily": W("каждый день|ежедневно"), "morning": W("каждое утро"), "evening": W("каждый вечер"),
    "weekly": W("каждую неделю|еженедельно"), "monthly": W("каждый месяц|ежемесячно"),
    "by_wd": W(r"(?:по|каждый|каждую|каждое)\s+(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям|понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)"),
    "in": W(r"через\s+(\d+|пару|полчаса|час|минуту|день|неделю|месяц)(?:\s+(минут[уы]?|час[аов]*|д[ен][яейь]*|недел[юиь]|месяц[аев]*))?"),
    "after2": W("послезавтра"), "tomorrow": W("завтра"), "today": W("сегодня"),
    "on_wd": W(r"(?:в|во)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)"),
    "day_month": W(rf"(\d{{1,2}})\s+({MONTH_RX})"),
    "time": W(r"(?:в|к|на)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:часов|часа|час|ч))?(?:\s+(утра|дня|вечера|ночи))?"),
    "numeric": W(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?"),
    "noon": W("в полдень"), "am": W("утром"), "pm": W("дн[её]м|в обед"), "eve": W("вечером"), "night": W("ночью"),
}


def parse_when(text: str, now: datetime) -> dict:
    """now: aware datetime in the user's time zone. Returns aware `date` (or None), repeat, rest text, has_time."""
    s = {"low": text.lower().replace("ё", "е"), "out": text, "day": None, "hour": None, "minute": 0, "repeat": "none",
         "period": None, "rel": None, "weekday": None}

    def take(rx: re.Pattern, fn) -> bool:
        m = rx.search(s["low"])
        if not m:
            return False
        start = m.start() + len(m.group(1) or "")
        ln = len(m.group(2))
        fn([m.group(i) for i in range(2, rx.groups + 1)])
        blank = " " * ln
        s["low"] = s["low"][:start] + blank + s["low"][start + ln:]
        s["out"] = s["out"][:start] + blank + s["out"][start + ln:]
        return True

    def setp(**kw):
        return lambda g: s.update(kw)

    take(_R["daily"], setp(repeat="daily"))
    take(_R["morning"], setp(repeat="daily", period=9))
    take(_R["evening"], setp(repeat="daily", period=20))
    take(_R["weekly"], setp(repeat="weekly"))
    take(_R["monthly"], setp(repeat="monthly"))
    take(_R["by_wd"], lambda g: s.update(repeat="weekly", weekday=weekday_index(g[1])))

    def rel_in(g):
        n = int(g[1]) if g[1].isdigit() else (2 if g[1] == "пару" else 1)
        unit = g[2] or g[1]
        d = now
        if g[1] == "полчаса":
            d = d + timedelta(minutes=30)
        elif unit.startswith("мин"):
            d = d + timedelta(minutes=n)
        elif unit.startswith("час"):
            d = d + timedelta(hours=n)
        elif re.match(r"^(день|дн|дня|дней)", unit):
            d, s["rel"] = d + timedelta(days=n), "day"
        elif unit.startswith("недел"):
            d, s["rel"] = d + timedelta(days=7 * n), "day"
        elif unit.startswith("месяц"):
            d, s["rel"] = add_months(d, n), "day"
        else:
            d = d + timedelta(minutes=n)
        s["day"] = d
        if not s["rel"]:
            s.update(hour=d.hour, minute=d.minute, rel="exact")

    take(_R["in"], rel_in)
    take(_R["after2"], lambda g: s.update(day=now + timedelta(days=2)))
    take(_R["tomorrow"], lambda g: s.update(day=now + timedelta(days=1)))
    take(_R["today"], lambda g: s.update(day=now))

    def on_wd(g):
        diff = ((weekday_index(g[1]) - js_weekday(now)) + 7) % 7 or 7
        s["day"] = now + timedelta(days=diff)

    take(_R["on_wd"], on_wd)

    def day_month(g):
        m_idx = next(i for i, p in enumerate(MONTH_PREFIX) if g[2].startswith(p))
        d = safe_replace(now, month=m_idx + 1, day=int(g[1]))
        if d < start_of_day(now):
            d = safe_replace(d, year=d.year + 1)
        s["day"] = d

    take(_R["day_month"], day_month)

    def at_time(g):
        hour, minute = int(g[1]), int(g[2]) if g[2] else 0
        if g[3] == "вечера" and hour < 12:
            hour += 12
        if g[3] == "дня" and hour < 8:
            hour += 12
        if g[3] == "ночи" and hour == 12:
            hour = 0
        s.update(hour=hour if hour <= 23 else None, minute=minute if minute <= 59 else 0)

    take(_R["time"], at_time)

    if not s["day"]:
        def numeric(g):
            y = int(g[3]) if g[3] else now.year
            if y < 100:
                y += 2000
            month, day = int(g[2]), int(g[1])
            if 1 <= month <= 12 and day >= 1:
                s["day"] = safe_replace(now, year=y, month=month, day=day)

        take(_R["numeric"], numeric)

    take(_R["noon"], lambda g: s.update(period=12))
    take(_R["am"], lambda g: s.update(period=s["period"] or 9))
    take(_R["pm"], lambda g: s.update(period=s["period"] or 13))
    take(_R["eve"], lambda g: s.update(period=s["period"] or 19))
    take(_R["night"], lambda g: s.update(period=s["period"] or 23))

    hour, period, day = s["hour"], s["period"], s["day"]
    if hour is None and period is not None:
        hour = period
    if hour is not None and hour < 12 and period is not None and 13 <= period <= 23:
        hour += 12

    date = None
    if s["rel"] == "exact":
        date = day
    elif day or hour is not None or s["weekday"] is not None or s["repeat"] != "none":
        if not day and s["weekday"] is not None and s["weekday"] >= 0:
            day = now + timedelta(days=((s["weekday"] - js_weekday(now)) + 7) % 7)
        date = (day or now).replace(hour=hour if hour is not None else 9, minute=s["minute"], second=0, microsecond=0)
        if date <= now:
            if not day or s["repeat"] == "daily":
                date = date + timedelta(days=1)
            elif s["repeat"] == "weekly":
                date = date + timedelta(days=7)

    return {"date": date, "repeat": s["repeat"], "rest": re.sub(r"\s+", " ", s["out"]).strip(), "has_time": hour is not None,
            "has_day": bool(s["day"]) or s["weekday"] is not None, "weekday": s["weekday"]}


# ---------- people ----------
def _low(text: str) -> str:
    return text.lower().replace("ё", "е")


def find_profession(text: str) -> str | None:
    low = _low(text)
    return next((name for name, st in PROFESSIONS if st in low), None)


def profession_stems(text: str) -> list[dict]:
    low = _low(text)
    return [{"name": name, "stem": st} for name, st in PROFESSIONS if st in low]


def find_tech(text: str) -> list[str]:
    res: list[str] = []
    for t, rx in _TECH_RX:
        m = rx.search(text)
        if m and not any(r.lower() == m.group(2).lower() for r in res):
            res.append(t.replace("\\", ""))
    if "Golang" in res and "Go" in res:
        res.remove("Go")
    return res


_INTRO = re.compile(r"познакомил(?:ся|ась|ись)?\s+(?:с|со)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?")


def extract_person(text: str) -> dict | None:
    m = _INTRO.search(text)
    if not m:
        return None
    first = name_to_nominative(m.group(1))
    last = surname_to_nominative(m.group(2)) if m.group(2) and not re.fullmatch(r"Он|Она|Сегодня|Вчера", m.group(2)) else ""
    name = " ".join(x for x in (first, last) if x)
    after = text[m.end():]
    where = re.match(r"^\s*,?\s*((?:на|в|во)\s+[^.,;!?]+)", after, re.I)
    low = text.lower()

    skills = find_tech(text)
    act = re.search(r"(?:занима(?:ется|лся|лась|ются)|специализируется на|разбирается в|эксперт в)\s+([^.,;!?]+)", text, re.I)
    if act:
        for p in re.split(r"\s+и\s+(?=[а-яё]+(?:ой|ом|ами|ей)\s)", act.group(1), flags=re.I):
            sk = activity_to_nominative(p.strip())
            if sk and not any(k.lower() == sk.lower() for k in skills):
                skills.append(sk)

    organization = ""
    org = re.search(r"работа(?:ет|л|ла)\s+(?:в|во)\s+(?:компании\s+)?«?([A-ZА-ЯЁ][\w\-]*(?:\s+[A-ZА-ЯЁ][\w\-]*)?)»?", text) \
        or re.search(r"из\s+(?:компании\s+)?«([^»]+)»", text)
    if org:
        organization = org_to_nominative(org.group(1))

    met = utcnow()
    if "позавчера" in low:
        met -= timedelta(days=2)
    elif "вчера" in low:
        met -= timedelta(days=1)
    elif "на прошлой неделе" in low:
        met -= timedelta(days=7)

    return {"name": name, "profession": find_profession(text.replace(m.group(0), "", 1)) or "", "skills": skills,
            "organization": organization, "metWhere": where.group(1).strip() if where else "", "metAt": iso(met)}


def find_person_mention(text: str, people: list) -> object | None:
    """Find a known person mentioned in any grammatical case. `people` items need a `.name`."""
    def parts(p):
        return p.name.split(" ")

    for w in re.findall(r"[А-ЯЁA-Z][а-яёa-z]+", text):
        for p in people:
            ps = parts(p)
            if same_stem(ps[0], w) or (len(ps) > 1 and same_stem(ps[1], w)):
                return p
    for w in words(text):
        if len(w) < 3:
            continue
        for p in people:
            if same_stem(parts(p)[0], w):
                return p
    return None


# ---------- reminders ----------
_REMIND_PREFIX = re.compile(
    r"^\s*(?:adis,?\s*)?(?:пожалуйста,?\s*)?(?:напомни(?:те)?|поставь напоминание|создай напоминание|добавь напоминание|добавь задачу|"
    r"создай задачу|запиши задачу|запланируй|нужно не забыть|не дай мне забыть)\s*,?\s*(?:мне\s+)?(?:пожалуйста,?\s*)?", re.I)


def extract_reminder(text: str, now: datetime) -> dict:
    body = _REMIND_PREFIX.sub("", text, count=1)
    when = parse_when(body, now)
    title = when["rest"]
    title = re.sub(r"^\s*(?:о том,?\s*что|что|чтобы|о|об|про)\s+", "", title, flags=re.I)
    title = re.sub(r"^(?:мне\s+)?(?:нужно|надо|необходимо)\s+", "", title, flags=re.I)
    title = re.sub(r"^\s*[,.:;-]+\s*", "", title)
    title = re.sub(r"\s+(?:в|во|на|к)\s*$", "", title, flags=re.I)
    title = re.sub(r"\s+,", ",", re.sub(r"[.!?]+$", "", title)).strip()
    return {"title": cap(title) or "Напоминание", "dueAt": iso(when["date"]) if when["date"] else None,
            "repeat": when["repeat"], "hasTime": when["has_time"]}


# ---------- calendar events ----------
EVENT_WORDS = r"встреч|созвон|событи|собеседовани|совещани|планерк|планёрк|ужин|обед|завтрак|день рождени|конференци|вебинар|звонок|приём|прием|тренировк|урок|лекци|презентаци|свидани"
_EVENT_PREFIX = re.compile(
    r"^\s*(?:adis,?\s*)?(?:пожалуйста,?\s*)?(?:(?:добавь|внеси|запиши|поставь|занеси)\s+(?:в\s+(?:мой\s+)?(?:календарь|расписание))\s*,?\s*|"
    r"(?:запланируй|назначь|создай|добавь)\s+(?=" + EVENT_WORDS + r")|у меня\s+(?=" + EVENT_WORDS + r"))", re.I)
_RANGE = re.compile(r"(^|\s)с\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:до|по)\s+(\d{1,2})(?:[:.](\d{2}))?(?=$|[^\d])", re.I)
_DURATION = re.compile(r"(^|\s)на\s+(полчаса|полтора часа|час|\d{1,3}\s*(?:минут[уы]?|мин)|[1-8](?:[.,]5)?\s*час(?:а|ов)?)(?=$|[^а-яё])", re.I)
_REMIND_BEFORE = re.compile(r",?\s*(?:и\s+)?напомни(?:ть)?\s+(?:мне\s+)?за\s+(\d+\s*)?(минут[уы]?|час(?:а|ов)?|день|сутки)", re.I)
_PLACE = re.compile(r"(^|\s)((?:в|во|на)\s+(?:офис|кафе|ресторан|бар|клуб|переговорн|кабинет|школ|университет|институт|центр|парк|зал|студи|коворкинг|"
                    r"zoom|зум|teams|skype|google meet|meet|телеграм)[^,.;!?]*)", re.I)
_ADDRESS = re.compile(r"(^|\s)по адресу\s+([^.;!?]+)", re.I)


def _minutes(num: str | None, unit: str) -> int:
    n = int(num.strip()) if num and num.strip() else 1
    unit = unit.lower()
    if unit.startswith("час"):
        return 60 * n
    if unit in ("день", "сутки"):
        return 1440 * n
    return n


def extract_event(text: str, now: datetime) -> dict:
    """«Встреча с Марией завтра с 15 до 16 в офисе» -> {title, startAt, endAt, location, remindMinutes, hasTime}"""
    body = _EVENT_PREFIX.sub("", text, count=1)
    remind = 15
    m = _REMIND_BEFORE.search(body)
    if m:
        remind = _minutes(m.group(1), m.group(2))
        body = body[:m.start()] + body[m.end():]
    end_hm = None
    m = _RANGE.search(body)
    if m:
        h1, m1, h2, m2 = int(m.group(2)), int(m.group(3) or 0), int(m.group(4)), int(m.group(5) or 0)
        if h1 <= 23 and h2 <= 23:
            body = body[:m.start()] + f"{m.group(1)}в {h1}:{m1:02d}" + body[m.end():]
            end_hm = (h2, m2)
    duration = None
    m = _DURATION.search(body)
    if m and (end_hm or re.search(r"(в|к)\s+\d", body)):
        d = m.group(2).lower()
        duration = 30 if d == "полчаса" else 90 if d == "полтора часа" else 60 if d == "час" else \
            int(re.match(r"\d+", d).group()) if "мин" in d else round(float(re.match(r"[\d.,]+", d).group().replace(",", ".")) * 60)
        body = body[:m.start()] + m.group(1) + body[m.end():]
    location = ""
    m = _ADDRESS.search(body) or _PLACE.search(body)
    if m:
        location = cap(m.group(2).strip())
        body = body[:m.start()] + m.group(1) + body[m.end():]
    when = parse_when(body, now)
    start = when["date"]
    end = None
    if start is not None:
        if end_hm:
            end = start.replace(hour=end_hm[0], minute=end_hm[1])
            if end <= start:
                end += timedelta(days=1)
        else:
            end = start + timedelta(minutes=duration or 60)
    title = re.sub(r"\s+,", ",", re.sub(r"[.!?]+$", "", when["rest"])).strip(" ,.-—:")
    title = re.sub(r"\s+(?:в|во|на|к|с)\s*$", "", title, flags=re.I)
    return {"title": cap(title) or "Событие", "startAt": iso(start) if start else None, "endAt": iso(end) if end else None,
            "location": location, "remindMinutes": remind,
            "hasTime": when["has_time"]}


def calendar_range(text: str, now: datetime) -> tuple[datetime, datetime, str]:
    """Day/week the user asks about. Returns (start, end, label) in the user's zone."""
    low = _low(text)
    day0 = start_of_day(now)
    if re.search(r"(на )?следующей неделе", low):
        start = day0 + timedelta(days=7 - (js_weekday(now) + 6) % 7)
        return start, start + timedelta(days=7), "На следующей неделе"
    if re.search(r"(на )?(этой )?неделе", low):
        return day0, day0 + timedelta(days=7 - (js_weekday(now) + 6) % 7), "На этой неделе"
    when = parse_when(text, now)
    if when["has_day"] and when["date"]:
        d = start_of_day(when["date"])
        return d, d + timedelta(days=1), ""
    return day0, day0 + timedelta(days=1), "Сегодня"


# ---------- alarms ----------
_DAY_FORMS = [("воскресень", 0), ("понедельник", 1), ("вторник", 2), ("сред", 3), ("четверг", 4), ("пятниц", 5), ("суббот", 6)]


def extract_alarm(text: str, now: datetime) -> dict:
    """«Поставь будильник на 7:30 по будням» -> {hour, minute, days, label, hasTime}"""
    low = _low(text)
    days: list[int] = []
    if re.search(r"по будням|в будни|в рабочие дни", low):
        days = [1, 2, 3, 4, 5]
    elif re.search(r"по выходным|в выходные", low):
        days = [0, 6]
    elif re.search(r"каждый день|ежедневно|каждое утро", low):
        days = list(range(7))
    else:
        m = re.search(r"(?:по|каждый|каждую|каждое)\s+((?:[а-я]+(?:,\s*|\s+и\s+|\s+))*[а-я]+)", low)
        if m:
            days = sorted({d for word in re.split(r"[,\s]+", m.group(1)) for stem_, d in _DAY_FORMS if word.startswith(stem_)})
    hour = minute = None
    m = re.search(r"через\s+(\d+|полчаса|час)\s*(минут[уы]?|час(?:а|ов)?)?", low)
    if m:
        n = 30 if m.group(1) == "полчаса" else 1 if m.group(1) == "час" else int(m.group(1))
        unit = m.group(2) or ("минут" if m.group(1) == "полчаса" else "час")
        t = now + (timedelta(hours=n) if unit.startswith("час") else timedelta(minutes=n))
        hour, minute = t.hour, t.minute
    else:
        m = re.search(r"(?:^|\s)(?:на|в|к)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(?:часов|часа|час|ч))?(?:\s+(утра|дня|вечера|ночи))?", low) \
            or re.search(r"(?:^|\s)(\d{1,2})[:.](\d{2})(?:\s+(утра|дня|вечера|ночи))?", low)
        if m:
            hour, minute = int(m.group(1)), int(m.group(2) or 0)
            if m.group(3) in ("вечера", "дня") and hour < 12:
                hour += 12
            if hour > 23 or minute > 59:
                hour = minute = None
    label = ""
    m = re.search(r"(?:чтобы|с подписью|с текстом|—|-)\s+(.+)$", text)
    if m:
        label = cap(re.sub(r"[.!]+$", "", m.group(1)).strip())[:120]
    return {"hour": hour, "minute": minute or 0, "days": days, "label": label, "hasTime": hour is not None}


# ---------- memory ----------
SENSITIVE_RX = re.compile(
    r"(пароль|парол[яеи]|password|паспорт|снилс|(^|\s)инн(\s|$)|номер карты|cvv|cvc|пин-?код|pin-?код|диагноз|болезн|анализ[ыа]? крови|"
    r"медицинск|кредитн|банковск|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b|номер паспорта|серия паспорта)", re.I)


def is_sensitive(text: str) -> bool:
    return bool(SENSITIVE_RX.search(text or ""))


def classify_memory(text: str) -> str:
    low = text.lower()
    if re.search(r"(кажется|наверное|возможно|похоже|вроде бы|предполагаю)", low):
        return "assumption"
    if re.search(r"(люблю|обожаю|нравится|предпочитаю|не люблю|не переношу|терпеть не могу|удобнее|мой любимый|моя любимая|моё любимое)", low):
        return "preference"
    if re.search(r"(иде[яюи]|придумал|а что если)", low):
        return "idea"
    if re.search(r"(планирую|план |запланир|хочу|собираюсь|намерен|мечтаю|цель)", low):
        return "intention" if re.search(r"(хочу|собираюсь|намерен|мечтаю)", low) else "plan"
    if re.search(r"( — это | - это |означает|называется|определение|формула|правило)", low):
        return "knowledge"
    if re.search(r"(сегодня|вчера|был[аи]? на|ходил|ездил|встретил|произошло|случилось)", low):
        return "event"
    return "fact"


_SAVE_PREFIX = re.compile(r"^\s*(?:запомни|сохрани|запиши|заметка|отметь)\s*[,:]?\s*(?:пожалуйста,?\s*)?(?:что\s+)?", re.I)


def memory_title(text: str) -> str:
    t = cap(re.sub(r"[.!]+$", "", _SAVE_PREFIX.sub("", text, count=1)).strip())
    return re.sub(r"\s+\S*$", "", t[:67]) + "…" if len(t) > 70 else t


def memory_content(text: str) -> str:
    return cap(_SAVE_PREFIX.sub("", text, count=1).strip())


STOP = set(("и в во на с со по о об от до за из к ко у а но или что как это мне меня мой моя мои я ты он она они мы вы его её их кто где когда "
            "какой какая какие есть был была были будет все всё ещё уже про для при же ли бы не нет да так тут там очень недавно найди вспомни "
            "покажи скажи ты помнишь знаешь расскажи").split())


def keywords(text: str) -> list[str]:
    return [w for w in words(text) if len(w) > 2 and w not in STOP]


# ---------- intents ----------
def intent(text: str) -> str:
    t = text.strip()
    low = t.lower().replace("ё", "е")
    is_q = bool(re.search(r"\?\s*$", t)) or bool(re.match(r"^(с кем|кто|кого|какие|какой|что|когда|где|сколько|покажи|найди|вспомни|напомни,?\s+кто|есть ли)", low))

    def has(rx):
        return re.search(rx, low) is not None

    if re.match(r"^(кто ты|ты кто|что ты такое|кто ты такой|кто ты такая|как тебя зовут|расскажи о себе|представься)[\s?!.]*$", low):
        return "about"
    if re.match(r"^(привет|здравствуй|здравствуйте|добрый (день|вечер|утро)|доброе утро|хай|hello|hi|салам|ассалам)", low):
        return "greeting"
    if re.match(r"^(спасибо|благодарю|спс|супер|отлично|класс)[\s!.]*$", low):
        return "thanks"
    if has(r"(что ты умеешь|что умеешь|что ты можешь|чем ты можешь помочь|как тобой пользоваться|помощь$|^help)"):
        return "capabilities"
    if is_q and has(r"(с кем|кого|кто из|каких|кто у меня)") and has(r"(познаком|знаком|знаю|контакт|люд|встреча)"):
        return "people_query"
    if is_q and has(r"(с кем|кто из|кого из)") and profession_stems(low):
        return "people_query"
    if has(r"(кто так(ой|ая)|что (ты )?знаешь (о|об|про)|что я знаю (о|об|про)|расскажи (о|об|про)|напомни,?\s+кто)\s+\S+"):
        return "entity_lookup"
    if has(r"будильник|разбуди меня|подними меня"):
        if has(r"(выключи|отключи|удали|убери|отмени)\s+(мой\s+|все\s+)?будильник"):
            return "alarm_off"
        if is_q or has(r"(мои|какие|покажи|список)\s+(у меня\s+)?будильник"):
            return "alarm_list"
        return "alarm"
    if re.match(rf"^(adis,?\s*)?(пожалуйста,?\s*)?(отмени|удали|убери)\s+(мою\s+|мой\s+|моё\s+|сегодняшн\S*\s+|завтрашн\S*\s+)?({EVENT_WORDS})", low):
        return "event_cancel"
    if re.match(rf"^(adis,?\s*)?(пожалуйста,?\s*)?(перенеси|сдвинь|передвинь|перенести)\s+(мою\s+|мой\s+|моё\s+|сегодняшн\S*\s+|завтрашн\S*\s+)?({EVENT_WORDS})", low):
        return "event_move"
    if (is_q and has(rf"({EVENT_WORDS}|календар|расписани)")) or has(r"^(что|какие планы) у меня (в|во|на) (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье|\d|этой неделе|неделе|следующей неделе|выходные)") \
            or has(r"^(покажи|открой)\s+(мой\s+)?(календарь|расписание)"):
        return "calendar_query"
    if not has(r"^(напомни|не дай мне забыть|нужно не забыть)") and (
            _EVENT_PREFIX.match(t) or (re.match(rf"^({EVENT_WORDS})", low)
                                       and re.search(r"(сегодня|завтра|послезавтра|понедельник|вторник|сред|четверг|пятниц|суббот|воскресень|\d)", low))):
        return "event_create"
    if has(r"(мои|какие|покажи|что у меня|список).*(задач|дела|напоминани)|что у меня (на )?(сегодня|завтра)|какие планы на (сегодня|завтра)|что запланировано"):
        return "task_query"
    if has(r"(отч[её]т|сводк|итоги (недели|дня|месяца))"):
        return "report"
    if has(r"(напиши|сгенерируй|покажи|создай|помоги написать).*(код|функци|скрипт|программ|класс|запрос sql)|^```"):
        return "code"
    if has(r"познакомил(ся|ась|ись)") and not is_q:
        return "introduce"
    if has(r"(напомни|напоминани|поставь будильник|добавь задачу|создай задачу|запиши задачу|запланируй|не дай мне забыть|нужно не забыть)"):
        return "reminder"
    if re.match(r"^(запомни|сохрани|запиши|заметка|отметь)", low):
        return "memory_save"
    if re.match(r"^(я\s+)?(люблю|обожаю|не люблю|предпочитаю|терпеть не могу|мне (не )?нравится|мне удобнее|мой любимый|моя любимая)", low):
        return "preference"
    if re.match(r"^(я\s+)?(хочу|планирую|собираюсь|мечтаю|решил|решила)\s", low):
        return "plan"
    if re.match(r"^(у меня )?(есть )?иде[яю]", low):
        return "idea"
    if is_q or has(r"(что ты помнишь|вспомни|найди|поищи|что я говорил|что я рассказывал)"):
        return "memory_query"
    return "chat"
