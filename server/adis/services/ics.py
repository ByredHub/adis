"""iCalendar (RFC 5545): subscription feed for phone calendars and .ics import."""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..core.timeutil import get_tz, to_utc, utcnow

# ---------- export ----------


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def _fold(line: str) -> list[str]:
    """Lines longer than 75 octets are folded (continuation lines start with a space)."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode("utf-8")) > (75 if not out else 74):
            out.append(cur)
            cur = ch
        else:
            cur += ch
    out.append(cur)
    return [out[0], *(" " + x for x in out[1:])]


def _dt(dt: datetime) -> str:
    return to_utc(dt).strftime("%Y%m%dT%H%M%SZ")


def build_feed(user, events: list, tasks: list) -> str:
    now = utcnow()
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Adis//Adis Calendar//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{_esc(user.assistant_name or 'Adis')}", f"X-WR-TIMEZONE:{user.timezone}",
             "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"]

    def vevent(uid_, start, end, summary, location="", description="", remind=None):
        lines.extend(["BEGIN:VEVENT", f"UID:{uid_}@adis.app", f"DTSTAMP:{_dt(now)}", f"DTSTART:{_dt(start)}", f"DTEND:{_dt(end)}",
                      f"SUMMARY:{_esc(summary)}"])
        if location:
            lines.append(f"LOCATION:{_esc(location)}")
        if description:
            lines.append(f"DESCRIPTION:{_esc(description)}")
        if remind is not None:
            lines.extend(["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(summary)}", f"TRIGGER:-PT{int(remind)}M", "END:VALARM"])
        lines.append("END:VEVENT")

    for e in events:
        if e.start_at < now - timedelta(days=90):
            continue
        vevent(e.id, e.start_at, e.end_at or e.start_at + timedelta(hours=1), e.title, e.location, e.notes,
               e.remind_minutes if e.remind_minutes else None)
    for t in tasks:
        if t.done or not t.due_at:
            continue
        vevent(t.id, t.due_at, t.due_at + timedelta(minutes=15), f"Задача: {t.title}", "", t.notes, 0 if t.remind else None)
    lines.append("END:VCALENDAR")
    return "\r\n".join(x for line in lines for x in _fold(line)) + "\r\n"


# ---------- import ----------

_DUR = re.compile(r"^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def _unescape(s: str) -> str:
    return re.sub(r"\\([\\;,nN])", lambda m: "\n" if m.group(1) in "nN" else m.group(1), s)


def _duration(s: str) -> timedelta | None:
    m = _DUR.match(s.strip())
    if not m:
        return None
    sign, w, d, h, mi, se = m.groups()
    td = timedelta(weeks=int(w or 0), days=int(d or 0), hours=int(h or 0), minutes=int(mi or 0), seconds=int(se or 0))
    return -td if sign == "-" else td


def _parse_dt(value: str, params: dict, tz: ZoneInfo) -> tuple[datetime | None, bool]:
    """Returns (naive UTC, all_day)."""
    value = value.strip()
    try:
        if params.get("VALUE") == "DATE" or re.fullmatch(r"\d{8}", value):
            d = datetime.strptime(value[:8], "%Y%m%d").replace(tzinfo=tz)
            return to_utc(d), True
        if value.endswith("Z"):
            return datetime.strptime(value, "%Y%m%dT%H%M%SZ"), False
        zone = get_tz(params["TZID"]) if params.get("TZID") else tz
        if params.get("TZID") and zone.key == "UTC" and params["TZID"] not in ("UTC", "Etc/UTC"):
            zone = tz  # Windows / custom TZIDs (e.g. "Russian Standard Time"): fall back to the user's zone
        return to_utc(datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=zone)), False
    except ValueError:
        return None, False


def parse(text: str, tz: ZoneInfo, limit: int = 2000) -> tuple[list[dict], dict]:
    """Parses VEVENTs. Returns (events, stats). Recurring events are imported as their first occurrence."""
    raw = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines: list[str] = []
    for ln in raw:
        if ln[:1] in (" ", "\t") and lines:
            lines[-1] += ln[1:]
        elif ln.strip():
            lines.append(ln)
    events, stats = [], {"recurring": 0, "skipped": 0}
    cur: dict | None = None
    depth = 0
    for ln in lines:
        name_part, _, value = ln.partition(":")
        name, *param_list = name_part.split(";")
        name = name.upper()
        params = dict(p.split("=", 1) for p in param_list if "=" in p)
        params = {k.upper(): v.strip('"') for k, v in params.items()}
        if name == "BEGIN" and value.upper() == "VEVENT":
            cur, depth = {"_params": {}}, 0
            continue
        if cur is None:
            continue
        if name == "BEGIN":
            depth += 1
            continue
        if name == "END" and value.upper() == "VEVENT":
            ev = _finish(cur, tz, stats)
            if ev:
                events.append(ev)
            cur = None
            if len(events) >= limit:
                break
            continue
        if name == "END":
            depth -= 1
            continue
        if depth > 0:  # inside VALARM
            if name == "TRIGGER" and "trigger" not in cur:
                cur["trigger"] = value
            continue
        cur[name] = value
        cur["_params"][name] = params
    return events, stats


def _finish(c: dict, tz: ZoneInfo, stats: dict) -> dict | None:
    if (c.get("STATUS") or "").upper() == "CANCELLED" or "DTSTART" not in c:
        stats["skipped"] += 1
        return None
    start, all_day = _parse_dt(c["DTSTART"], c["_params"].get("DTSTART", {}), tz)
    if not start:
        stats["skipped"] += 1
        return None
    end = None
    if "DTEND" in c:
        end, _ = _parse_dt(c["DTEND"], c["_params"].get("DTEND", {}), tz)
    elif "DURATION" in c and _duration(c["DURATION"]):
        end = start + _duration(c["DURATION"])
    if not end or end < start:
        end = start + (timedelta(days=1) if all_day else timedelta(hours=1))
    if "RRULE" in c:
        stats["recurring"] += 1
    remind = 0
    if c.get("trigger"):
        td = _duration(c["trigger"])
        remind = max(0, int(-td.total_seconds() // 60)) if td is not None and td <= timedelta(0) else 0
    return {"uid": (c.get("UID") or "")[:255] or None, "title": _unescape(c.get("SUMMARY") or "Без названия")[:255], "start_at": start,
            "end_at": end, "location": _unescape(c.get("LOCATION") or "")[:255], "notes": _unescape(c.get("DESCRIPTION") or "")[:20000],
            "remind_minutes": remind}
