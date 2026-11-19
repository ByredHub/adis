"""Background delivery worker: task reminders, event reminders and alarms -> Web Push.

Runs inside the API process (asyncio task). For several API replicas run it in one of them (ADIS_WORKER=false in the
others) — on PostgreSQL rows are additionally locked with SKIP LOCKED, so parallel workers never double-send.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import and_, or_, select

from ..config import settings
from ..core.timeutil import fmt_date_time, fmt_time, get_tz, utcnow
from ..db import SessionLocal
from ..models import Alarm, Event, Task, User
from . import alarms as alarm_svc
from . import push

log = logging.getLogger("adis.worker")
STALE = timedelta(hours=6)  # don't send reminders that are older than this (server was down)


def _locked(q):
    return q.with_for_update(skip_locked=True)


def tick(now=None) -> dict:
    now = now or utcnow()
    sent = {"tasks": 0, "events": 0, "alarms": 0}
    with SessionLocal() as db:
        tz_of = {}

        def tz(user_id):
            if user_id not in tz_of:
                u = db.get(User, user_id)
                tz_of[user_id] = get_tz(u.timezone if u else "UTC")
            return tz_of[user_id]

        for t in db.scalars(_locked(select(Task).where(Task.notify_at <= now, Task.notified_at.is_(None), Task.done.is_(False))).limit(200)):
            t.notified_at = now
            if now - t.notify_at > STALE:
                continue
            push.send_to_user(db, t.user_id, {"title": "Напоминание", "body": t.title, "route": "#/tasks", "tag": f"task-{t.id}"})
            sent["tasks"] += 1

        horizon = now + timedelta(days=1, minutes=1)
        q = select(Event).where(Event.remind_minutes > 0, Event.start_at > now, Event.start_at <= horizon,
                                or_(Event.notified_start.is_(None), Event.notified_start != Event.start_at))
        for e in db.scalars(_locked(q).limit(200)):
            if e.start_at - timedelta(minutes=e.remind_minutes) > now:
                continue
            e.notified_start = e.start_at
            when = fmt_time(e.start_at, tz(e.user_id)) if e.remind_minutes < 720 else fmt_date_time(e.start_at, tz(e.user_id))
            push.send_to_user(db, e.user_id, {"title": f"Скоро: {e.title}", "body": f"{when}{' · ' + e.location if e.location else ''}",
                                              "route": "#/calendar", "tag": f"event-{e.id}"})
            sent["events"] += 1

        q = select(Alarm).where(Alarm.enabled.is_(True), or_(Alarm.next_at <= now, and_(Alarm.snooze_until.is_not(None), Alarm.snooze_until <= now)))
        for a in db.scalars(_locked(q).limit(200)):
            ring = alarm_svc.fire(a, now)
            if now - ring > STALE:
                continue
            push.send_to_user(db, a.user_id, {"title": f"Будильник {a.hour:02d}:{a.minute:02d}", "body": a.label or "Пора вставать!",
                                              "route": f"#/alarm/{a.id}", "tag": f"alarm-{a.id}", "alarm": True},
                              ttl=600, urgency="high")
            sent["alarms"] += 1
        db.commit()
    return sent


async def run_forever() -> None:
    log.info("Delivery worker started (every %ss)", settings.worker_interval)
    while True:
        try:
            res = await asyncio.to_thread(tick)
            if any(res.values()):
                log.info("Delivered: %s", res)
        except Exception:  # keep the loop alive
            log.exception("worker tick failed")
        await asyncio.sleep(settings.worker_interval)
