"""Alarm scheduling in the alarm's own time zone (DST-safe wall-clock times)."""
from __future__ import annotations

from datetime import datetime, timedelta

from ..core.timeutil import get_tz, js_weekday, local, to_utc, utcnow
from ..models import Alarm

WEEKDAYS_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]


def compute_next(a: Alarm, after: datetime | None = None) -> datetime | None:
    """Next ring time (naive UTC) strictly after `after` (default now). None for disabled alarms."""
    if not a.enabled:
        return None
    tz = get_tz(a.timezone)
    base = local(after or utcnow(), tz)
    days = set(a.days or [])
    for i in range(0, 8):
        d = (base + timedelta(days=i)).replace(hour=a.hour, minute=a.minute, second=0, microsecond=0)
        if d <= base:
            continue
        if not days or js_weekday(d) in days:
            return to_utc(d)
    return None


def due_at(a: Alarm) -> datetime | None:
    times = [t for t in (a.next_at, a.snooze_until) if t]
    return min(times) if times and a.enabled else None


def fire(a: Alarm, now: datetime | None = None) -> datetime:
    """Marks the alarm as ringing and schedules the next occurrence. Returns ring time."""
    now = now or utcnow()
    ring = due_at(a) or now
    a.ring_at, a.acked_at, a.snooze_until = ring, None, None
    if a.days:
        a.next_at = compute_next(a, max(now, ring))
    else:
        a.enabled, a.next_at = False, None  # one-time alarms switch off after ringing, like a phone clock
    a.updated_at = now
    return ring


def ringing(a: Alarm, now: datetime | None = None) -> bool:
    now = now or utcnow()
    return bool(a.ring_at and now - a.ring_at < timedelta(minutes=10) and (not a.acked_at or a.acked_at < a.ring_at))


def describe_days(days: list[int]) -> str:
    s = sorted(set(days or []))
    if not s:
        return "Один раз"
    if s == list(range(7)):
        return "Каждый день"
    if s == [1, 2, 3, 4, 5]:
        return "По будням"
    if s == [0, 6]:
        return "По выходным"
    return ", ".join(WEEKDAYS_SHORT[d] for d in sorted(s, key=lambda x: (x + 6) % 7))
