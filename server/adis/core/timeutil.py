"""Time helpers. Storage is naive UTC; formatting and natural-language dates use the user's time zone."""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def get_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except Exception:  # unknown or malformed zone name
        return ZoneInfo("UTC")


def to_utc(dt: datetime | None) -> datetime | None:
    """Any datetime -> naive UTC (naive input is treated as UTC)."""
    if dt is None:
        return None
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def parse_iso(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return to_utc(value)
    try:
        return to_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


def iso(dt: datetime | None) -> str | None:
    dt = to_utc(dt)
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def local(dt: datetime, tz: ZoneInfo) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(tz)


def start_of_day(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def add_months(d: datetime, n: int) -> datetime:
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def safe_replace(d: datetime, **kw) -> datetime:
    """datetime.replace that clamps an invalid day (31 Feb -> 28/29 Feb), like JS Date overflow would not silently do."""
    try:
        return d.replace(**kw)
    except ValueError:
        y, m = kw.get("year", d.year), kw.get("month", d.month)
        kw["day"] = min(kw.get("day", d.day), calendar.monthrange(y, m)[1])
        return d.replace(**kw)


def js_weekday(d: datetime) -> int:
    """Sunday = 0 ... Saturday = 6 (JS Date.getDay)."""
    return (d.weekday() + 1) % 7


def is_same_day(a: datetime, b: datetime, tz: ZoneInfo) -> bool:
    return local(a, tz).date() == local(b, tz).date()


def fmt_time(dt: datetime, tz: ZoneInfo) -> str:
    return local(dt, tz).strftime("%H:%M")


def fmt_date(dt: datetime, tz: ZoneInfo, with_year: bool = False) -> str:
    d = local(dt, tz)
    y = f" {d.year}" if with_year or d.year != datetime.now(tz).year else ""
    return f"{d.day} {MONTHS_GEN[d.month - 1]}{y}"


def fmt_rel_day(dt: datetime, tz: ZoneInfo) -> str:
    diff = (local(dt, tz).date() - datetime.now(tz).date()).days
    return {0: "Сегодня", 1: "Завтра", 2: "Послезавтра", -1: "Вчера"}.get(diff) or fmt_date(dt, tz)


def fmt_date_time(dt: datetime, tz: ZoneInfo) -> str:
    return f"{fmt_rel_day(dt, tz)}, {fmt_time(dt, tz)}"


def fmt_ago(dt: datetime, tz: ZoneInfo) -> str:
    from .textutil import plural

    s = round((utcnow() - to_utc(dt)).total_seconds())
    if s < 60:
        return "только что"
    if s < 3600:
        m = s // 60
        return f"{m} {plural(m, 'минуту', 'минуты', 'минут')} назад"
    if s < 86400:
        h = s // 3600
        return f"{h} {plural(h, 'час', 'часа', 'часов')} назад"
    return fmt_rel_day(dt, tz)


def days(n: float) -> timedelta:
    return timedelta(days=n)
