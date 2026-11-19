from datetime import datetime
from zoneinfo import ZoneInfo

from adis.ai import nlu

TZ = ZoneInfo("Europe/Moscow")
NOW = datetime(2026, 11, 19, 14, 30, tzinfo=TZ)  # Thursday


def when(text):
    r = nlu.parse_when(text, NOW)
    return r["date"].strftime("%Y-%m-%d %H:%M") if r["date"] else None, r["repeat"], r["rest"]


def test_parse_when():
    assert when("завтра в 10 позвонить")[:2] == ("2026-11-20 10:00", "none")
    assert when("через 2 часа выпить воды")[0] == "2026-11-19 16:30"
    assert when("в пятницу в 7 вечера ужин")[0] == "2026-11-20 19:00"
    assert when("в четверг созвон")[0] == "2026-11-26 09:00"
    assert when("каждый день в 8 зарядка")[:2] == ("2026-11-20 08:00", "daily")
    assert when("по понедельникам планёрка")[:2] == ("2026-11-23 09:00", "weekly")
    assert when("25 декабря в 18:30 корпоратив")[0] == "2026-12-25 18:30"
    assert when("1 марта день рождения")[0] == "2027-03-01 09:00"
    assert when("послезавтра вечером кино")[0] == "2026-11-21 19:00"
    assert when("31.02 что-то")[0] == "2026-02-28 09:00"
    assert when("просто текст")[0] is None


def test_reminder_title():
    r = nlu.extract_reminder("Напомни завтра в 10 позвонить Артёму", NOW)
    assert r["title"] == "Позвонить Артёму" and r["dueAt"] == "2026-11-20T07:00:00.000Z"


def test_extract_person():
    p = nlu.extract_person("Вчера познакомился с Дмитрием Невским на конференции, он инвестор, работает в Orbit Capital")
    assert p["name"] == "Дмитрий Невский" and p["profession"] == "Инвестор" and p["organization"] == "Orbit Capital"
    assert p["metWhere"] == "на конференции"


def test_intents():
    assert nlu.intent("С кем я недавно познакомился из программистов?") == "people_query"
    assert nlu.intent("Запомни, что я не пью кофе после 18") == "memory_save"
    assert nlu.intent("Что у меня на сегодня?") == "task_query"
    assert nlu.is_sensitive("мой пароль 123") and not nlu.is_sensitive("люблю чай")


def test_name_cases():
    from adis.core.textutil import same_stem

    assert same_stem("Артём", "Артёмом") and same_stem("Мария", "Марией") and same_stem("Артём", "Артёму")
    assert not same_stem("Игорь", "Ирина")
