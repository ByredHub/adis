"""Personal finance: incomes, expenses and debts (who owes me / whom I owe).

Shared by REST endpoints and AI tools. Amounts are Decimal; the API returns numbers rounded to 2 digits.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select

from ..core.textutil import cap, uid
from ..core.timeutil import add_months, iso, local, start_of_day, to_utc, utcnow
from ..models import Debt, Person, Transaction

CURRENCY_SIGNS = {"RUB": "₽", "USD": "$", "EUR": "€", "KZT": "₸", "UZS": "сум", "GBP": "£", "CNY": "¥", "TRY": "₺", "AED": "AED"}

EXPENSE_CATEGORIES = [
    ("Продукты", r"продукт|магазин|супермаркет|пятёрочк|пятерочк|магнит|перекрёст|перекрест|ашан|лент[аеу]|вкусвилл|овощ|фрукт|хлеб|молок|мяс"),
    ("Кафе и рестораны", r"кафе|ресторан|кофе|обед|ужин|завтрак|бар\b|пицц|суши|бургер|доставк[аеу] еды|шаурм|столов"),
    ("Такси", r"такси|uber|яндекс go|убер"),
    ("Транспорт", r"метро|автобус|проезд|бензин|топлив|заправк|парковк|электричк|трамва|каршеринг|самокат"),
    ("Жильё", r"аренд|квартплат|коммунал|жкх|ипотек|квартир"),
    ("Связь и интернет", r"интернет|связь|мобильн|телефон[ау]? (?:счёт|счет)|сотов"),
    ("Подписки", r"подписк|netflix|spotify|кинопоиск|яндекс плюс|icloud|youtube premium|chatgpt"),
    ("Здоровье", r"аптек|лекарств|врач|стоматолог|анализ|клиник|больниц|витамин"),
    ("Одежда", r"одежд|обув|кроссовк|куртк|джинс|футболк|платье"),
    ("Красота", r"парикмахер|стрижк|маникюр|салон|косметик|барбер"),
    ("Спорт", r"спортзал|фитнес|абонемент|тренировк|бассейн|йог"),
    ("Развлечения", r"кино|театр|концерт|игр[аыу]|развлеч|музей|билет"),
    ("Подарки", r"подар|цвет[ыо]|букет"),
    ("Образование", r"курс|учёб|учеб|книг|школ|универ|репетитор"),
    ("Дом", r"мебел|ремонт|посуд|бытов|икеа|ikea|хозтовар"),
    ("Путешествия", r"отел|гостиниц|авиабилет|самолёт|самолет|поезд|путешеств|отпуск|виз[аеу]"),
    ("Дети", r"детск|ребён|ребен|садик|игрушк"),
    ("Животные", r"корм|ветеринар|зоомагазин"),
]
INCOME_CATEGORIES = [
    ("Зарплата", r"зарплат|зп\b|оклад|аванс"),
    ("Подработка", r"подработк|фриланс|заказ|клиент|проект"),
    ("Бизнес", r"выручк|продаж|бизнес|магазин"),
    ("Подарок", r"подар"),
    ("Проценты и кэшбэк", r"процент|кэшбэк|кешбэк|дивиденд|вклад"),
    ("Возврат", r"возврат|вернули деньги|компенсац"),
]

_NUM = r"(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}))?"
_MULT = r"(к|k|тыс\.?|тысяч[аи]?|тыщ[иа]?|т\.р\.?|млн|миллион(?:а|ов)?)"
_CUR = r"(₽|руб(?:л(?:ей|я|ь))?\.?|р\.?(?![а-яё])|\$|долл(?:ар(?:ов|а)?)?\.?|usd|бакс(?:ов|а)?|€|евро|eur|₸|тенге|тг|сум(?:ов)?|£|фунт(?:ов|а)?|юан(?:ей|я|ь)?|лир(?:а|ы)?)"
_MONEY = re.compile(rf"(?:(\$|€|£)\s*)?{_NUM}(?:\s*{_MULT})?(?:\s*{_CUR})?", re.I)
_MONTHS = "январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр"
_WORD_AMOUNTS = [(r"полтор[аы] тысяч[иа]?", 1500), (r"тысяч[ауи]", 1000), (r"сотн[юи]|сотк[уи]", 100), (r"пятихатк[уи]", 500)]


def _currency(token: str | None) -> str | None:
    if not token:
        return None
    t = token.lower()
    if t in ("₽", "р.", "р") or t.startswith("руб"):
        return "RUB"
    if t == "$" or t.startswith("долл") or t == "usd" or t.startswith("бакс"):
        return "USD"
    if t in ("€", "евро", "eur"):
        return "EUR"
    if t in ("₸", "тенге", "тг"):
        return "KZT"
    if t.startswith("сум"):
        return "UZS"
    if t == "£" or t.startswith("фунт"):
        return "GBP"
    if t.startswith("юан"):
        return "CNY"
    if t.startswith("лир"):
        return "TRY"
    return None


def parse_money(text: str, default_currency: str = "RUB") -> dict | None:
    """«потратил 1 200 на продукты», «15к», «$50», «2,5 тыс руб» -> {amount: Decimal, currency, span}.
    Numbers that look like times or dates («в 10», «до 25 декабря», «15:30») are ignored."""
    best = None
    for m in _MONEY.finditer(text):
        whole, frac, mult, cur = m.group(2), m.group(3), m.group(4), m.group(5)
        before, after = text[:m.start()], text[m.end():]
        if (re.match(r"\s*[:.]\d", text[m.end(2) + (len(frac) + 1 if frac else 0):]) or re.search(r"\d[:.]$", before)) and not cur:
            continue  # 15:30
        if re.match(rf"\s*({_MONTHS})", after, re.I) or re.match(r"\s*(час|мин|числ|сек|ден|дн|недел|месяц|лет|год|раз|шт|%|процент)", after, re.I):
            continue
        if not (mult or cur or m.group(1)) and re.search(r"(?:^|\s)(в|к|до|с|на|через|по)\s*$", before, re.I) and int(whole.replace(" ", "").replace("\u00a0", "")) <= 31:
            continue
        try:
            value = Decimal(whole.replace(" ", "").replace("\u00a0", "") + ("." + frac if frac else ""))
        except InvalidOperation:
            continue
        if mult:
            ml = mult.lower()
            value *= Decimal(1_000_000) if ml.startswith(("млн", "миллион")) else Decimal(1000)
        if value <= 0:
            continue
        score = (2 if (mult or cur or m.group(1)) else 1, value)
        cand = {"amount": value.quantize(Decimal("0.01")), "currency": _currency(cur) or _currency(m.group(1)) or default_currency,
                "span": (m.start(), m.end()), "_score": score}
        if best is None or cand["_score"] > best["_score"]:
            best = cand
    if best is None:
        low = text.lower()
        for rx, value in _WORD_AMOUNTS:
            wm = re.search(rf"(?:^|\s)({rx})(?:\s*{_CUR})?", low)
            if wm:
                return {"amount": Decimal(value).quantize(Decimal("0.01")), "currency": _currency(wm.group(2)) or default_currency, "span": wm.span(1)}
        return None
    best.pop("_score")
    return best


def categorize(text: str, kind: str) -> str:
    low = text.lower().replace("ё", "е")
    for name, rx in (EXPENSE_CATEGORIES if kind == "expense" else INCOME_CATEGORIES):
        if re.search(rx.replace("ё", "е"), low):
            return name
    return "Другое"


RELATIVES = {"мам": "Мама", "пап": "Папа", "брат": "Брат", "сестр": "Сестра", "друг": "Друг", "подруг": "Подруга", "жен": "Жена", "муж": "Муж",
             "сын": "Сын", "доч": "Дочь", "бабушк": "Бабушка", "дедушк": "Дедушка", "дяд": "Дядя", "тёт": "Тётя", "тет": "Тётя", "сосед": "Сосед",
             "коллег": "Коллега", "начальник": "Начальник"}


def counterparty_name(word: str) -> str:
    """Dative/genitive/instrumental -> nominative for names and relatives («Артёму» -> Артём, «у Марии» -> Мария, «маме» -> Мама)."""
    from ..ai.nlu import name_to_nominative

    low = word.lower()
    for stem, nom in RELATIVES.items():
        if low.startswith(stem) and len(low) - len(stem) <= 3:
            return nom
    w = word
    if re.search(r"ии$", w):
        return cap(w[:-1] + "я")          # Марии -> Мария
    if re.search(r"ию$", w):
        return cap(w[:-1] + "я")          # Марию -> Мария
    if re.search(r"ия$", w) and low not in ("мария", "юлия", "наталия", "лия"):
        return cap(w[:-1] + "й")          # Дмитрия -> Дмитрий
    if re.search(r"ю$", w):
        return cap(w[:-1] + "ь")          # Игорю -> Игорь
    if re.search(r"[^аеиоуыэюя]у$", w):
        return cap(w[:-1])                # Артёму -> Артём
    if low.endswith("а") or low.endswith("я"):
        return cap(w)                     # Маша, Саша, Илья stay
    if re.search(r"е$", w):
        return cap(w[:-1] + "а")          # Маше -> Маша, Анне -> Анна
    if re.search(r"ы$", w):
        return cap(w[:-1] + "а")          # у Анны -> Анна
    return name_to_nominative(w)


_PARTY_PATTERNS = [
    r"(?:дал|дала|одолжил[аи]?|занял[аи]?|перевёл|перевел[аи]?|скинул[аи]?|отдал[аи]?|вернул[аи]?|должен|должна|задолжал[аи]?)\s+(?:в долг\s+)?(?:мне\s+)?([А-ЯЁ][а-яё]+|мам[еуы]|пап[еуы]|брат[уа]?|сестр[еуы]|друг[уа]?|подруг[еи]|жен[еы]|муж[уа]|сын[уа]|дочер[и]|бабушк[еи]|дедушк[еи]|сосед[уа]|коллег[еи])",
    r"(?:^|\s)(?:у|от)\s+([А-ЯЁ][а-яё]+|мамы|папы|брата|сестры|друга|подруги|жены|мужа|сына|дочери|бабушки|дедушки|соседа|коллеги)",
    r"^([А-ЯЁ][а-яё]+)\s+(?:мне\s+)?(?:должен|должна|вернул|вернула|отдал|отдала|задолжал)",
]


def extract_counterparty(text: str) -> str | None:
    lowered_first = text[:1].lower() + text[1:]  # «Дал Артёму…»: verbs lower-case, names keep their capital letter
    for i, rx in enumerate(_PARTY_PATTERNS):
        m = re.search(rx, text if i == 2 else lowered_first)
        if m and m.group(1).lower() not in ("мне", "в", "долг", "его", "ей", "ему", "им", "ее", "её"):
            return counterparty_name(m.group(1))
    return None


# ---------- data access ----------
class Finance:
    def __init__(self, store) -> None:
        self.s, self.db, self.uid, self.tz = store, store.db, store.uid, store.tz

    def _own_person(self, pid):
        return pid if pid and self.s._get(Person, pid) else None

    # transactions
    def transactions(self, start=None, end=None, kind=None, category=None) -> list[Transaction]:
        q = select(Transaction).where(Transaction.user_id == self.uid)
        if start:
            q = q.where(Transaction.occurred_at >= start)
        if end:
            q = q.where(Transaction.occurred_at < end)
        if kind:
            q = q.where(Transaction.kind == kind)
        if category:
            q = q.where(Transaction.category == category)
        return list(self.db.scalars(q.order_by(Transaction.occurred_at.desc())))

    def add_transaction(self, data: dict) -> Transaction:
        kind = data.get("kind") if data.get("kind") in ("expense", "income") else "expense"
        note = (data.get("note") or "").strip()[:500]
        t = Transaction(id=uid("tx"), user_id=self.uid, kind=kind, amount=Decimal(str(data["amount"])).quantize(Decimal("0.01")),
                        currency=(data.get("currency") or "RUB").upper()[:3], category=(data.get("category") or categorize(note, kind))[:60],
                        note=note, occurred_at=to_utc(data.get("occurred_at")) or utcnow(), person_id=self._own_person(data.get("person_id")),
                        source=data.get("source"))
        self.db.add(t)
        self.db.flush()
        return t

    def update_transaction(self, id_: str, patch: dict) -> Transaction | None:
        t = self.s._get(Transaction, id_)
        if not t:
            return None
        for k in ("kind", "category", "note", "currency"):
            if patch.get(k) is not None:
                setattr(t, k, patch[k].upper()[:3] if k == "currency" else patch[k])
        if patch.get("amount") is not None:
            t.amount = Decimal(str(patch["amount"])).quantize(Decimal("0.01"))
        if patch.get("occurred_at") is not None:
            t.occurred_at = to_utc(patch["occurred_at"])
        if "person_id" in patch:
            t.person_id = self._own_person(patch["person_id"])
        t.updated_at = utcnow()
        self.db.flush()
        return t

    def delete(self, model, id_: str) -> bool:
        obj = self.s._get(model, id_)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.flush()
        return True

    # debts
    def debts(self, status=None, direction=None) -> list[Debt]:
        q = select(Debt).where(Debt.user_id == self.uid)
        if status:
            q = q.where(Debt.status == status)
        if direction:
            q = q.where(Debt.direction == direction)
        return list(self.db.scalars(q.order_by(Debt.occurred_at.desc())))

    def add_debt(self, data: dict) -> Debt:
        d = Debt(id=uid("db"), user_id=self.uid, direction=data["direction"] if data.get("direction") in ("lent", "borrowed") else "lent",
                 person_id=self._own_person(data.get("person_id")), counterparty=(data.get("counterparty") or "").strip()[:160],
                 amount=Decimal(str(data["amount"])).quantize(Decimal("0.01")), paid=Decimal("0"), currency=(data.get("currency") or "RUB").upper()[:3],
                 note=(data.get("note") or "").strip()[:500], occurred_at=to_utc(data.get("occurred_at")) or utcnow(),
                 due_at=to_utc(data.get("due_at")), remind=data.get("remind", True) is not False, payments=[])
        if d.person_id and not d.counterparty:
            d.counterparty = self.s._get(Person, d.person_id).name
        self.db.add(d)
        self.db.flush()
        return d

    def update_debt(self, id_: str, patch: dict) -> Debt | None:
        d = self.s._get(Debt, id_)
        if not d:
            return None
        for k in ("counterparty", "note", "remind"):
            if patch.get(k) is not None:
                setattr(d, k, patch[k])
        if patch.get("amount") is not None:
            d.amount = Decimal(str(patch["amount"])).quantize(Decimal("0.01"))
        if "due_at" in patch:
            d.due_at, d.notified_at = to_utc(patch["due_at"]), None
        if "person_id" in patch:
            d.person_id = self._own_person(patch["person_id"])
        if patch.get("status") in ("open", "closed"):
            d.status, d.closed_at = patch["status"], utcnow() if patch["status"] == "closed" else None
        self._settle(d)
        d.updated_at = utcnow()
        self.db.flush()
        return d

    def repay(self, id_: str, amount=None) -> Debt | None:
        """Partial or full repayment (amount=None -> the whole remainder)."""
        d = self.s._get(Debt, id_)
        if not d:
            return None
        left = d.amount - (d.paid or 0)
        pay = left if amount is None else min(Decimal(str(amount)).quantize(Decimal("0.01")), left)
        if pay > 0:
            d.paid = (d.paid or 0) + pay
            d.payments = [*(d.payments or []), {"date": iso(utcnow()), "amount": float(pay)}]
        self._settle(d)
        d.updated_at = utcnow()
        self.db.flush()
        return d

    @staticmethod
    def _settle(d: Debt) -> None:
        if (d.paid or 0) >= d.amount and d.status == "open":
            d.status, d.closed_at = "closed", utcnow()

    def find_open_debt(self, text: str, direction: str | None = None) -> Debt | None:
        from ..ai import nlu
        from ..core.textutil import same_stem

        debts = self.debts(status="open", direction=direction)
        if not debts:
            return None
        person = nlu.find_person_mention(text, self.s.people())
        name = extract_counterparty(text)
        for d in debts:
            if person and d.person_id == person.id:
                return d
        for d in debts:
            if name and d.counterparty and any(same_stem(w, name) for w in d.counterparty.split()):
                return d
        return debts[0] if len(debts) == 1 else None

    # summary
    def period(self, text: str = "", month: str | None = None) -> tuple[datetime, datetime, str]:
        now = datetime.now(self.tz)
        if month:
            y, m = (int(x) for x in month.split("-"))
            start = now.replace(year=y, month=m, day=1, hour=0, minute=0, second=0, microsecond=0)
            return start, add_months(start, 1), ""
        low = text.lower()
        day0 = start_of_day(now)
        if "сегодня" in low:
            return day0, day0 + timedelta(days=1), "Сегодня"
        if "вчера" in low:
            return day0 - timedelta(days=1), day0, "Вчера"
        if re.search(r"(за|на) (эту |этой )?недел", low):
            start = day0 - timedelta(days=day0.weekday())
            return start, start + timedelta(days=7), "На этой неделе"
        if "прошл" in low and "месяц" in low:
            start = add_months(day0.replace(day=1), -1)
            return start, day0.replace(day=1), "В прошлом месяце"
        if re.search(r"(за|в этом) год", low):
            start = day0.replace(month=1, day=1)
            return start, start.replace(year=start.year + 1), "В этом году"
        start = day0.replace(day=1)
        return start, add_months(start, 1), "В этом месяце"

    def summary(self, start: datetime, end: datetime) -> dict:
        su, eu = to_utc(start), to_utc(end)
        txs = self.transactions(su, eu)
        totals: dict = defaultdict(lambda: {"income": Decimal(0), "expense": Decimal(0)})
        cats: dict = defaultdict(Decimal)
        for t in txs:
            totals[t.currency][t.kind] += t.amount
            if t.kind == "expense":
                cats[(t.currency, t.category)] += t.amount
        debts = self.debts(status="open")
        dsum: dict = defaultdict(lambda: {"owedToMe": Decimal(0), "iOwe": Decimal(0)})
        now = utcnow()
        overdue = 0
        for d in debts:
            dsum[d.currency]["owedToMe" if d.direction == "lent" else "iOwe"] += d.amount - (d.paid or 0)
            overdue += 1 if d.due_at and d.due_at < now else 0
        return {
            "from": iso(su), "to": iso(eu),
            "totals": [{"currency": c, "income": float(v["income"]), "expense": float(v["expense"]), "balance": float(v["income"] - v["expense"])}
                       for c, v in sorted(totals.items())],
            "byCategory": [{"currency": c, "category": k, "amount": float(v)} for (c, k), v in sorted(cats.items(), key=lambda x: -x[1])],
            "debts": [{"currency": c, "owedToMe": float(v["owedToMe"]), "iOwe": float(v["iOwe"])} for c, v in sorted(dsum.items())],
            "openDebts": len(debts), "overdueDebts": overdue, "count": len(txs),
        }


def dative(name: str) -> str:
    """Артём -> Артёму, Дмитрий -> Дмитрию, Игорь -> Игорю, Мама -> Маме, Мария -> Марии (first word only)."""
    first, _, rest = (name or "").partition(" ")
    low = first.lower()
    if not first:
        return name
    if low.endswith("ия"):
        d = first[:-1] + "и"
    elif low.endswith(("а", "я")):
        d = first[:-1] + "е"
    elif low.endswith(("й", "ь")):
        d = first[:-1] + "ю"
    elif re.search(r"[бвгджзклмнпрстфхцчшщ]$", low):
        d = first + "у"
    else:
        d = first
    return d + (" " + rest if rest else "")


def money(amount, currency: str = "RUB") -> str:
    """12500.5 -> «12 500,50 ₽», 300 -> «300 ₽»"""
    a = Decimal(str(amount)).quantize(Decimal("0.01"))
    whole, frac = divmod(abs(a), 1)
    s = f"{int(whole):,}".replace(",", "\u00a0")
    if frac:
        s += "," + f"{frac:.2f}"[2:]
    sign = CURRENCY_SIGNS.get(currency, currency)
    return ("−" if a < 0 else "") + (f"{sign}{s}" if currency in ("USD", "GBP") else f"{s}\u00a0{sign}")


def local_day(dt, tz) -> str:
    return local(dt, tz).strftime("%Y-%m-%d")
