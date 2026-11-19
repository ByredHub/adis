"""Push subscriptions, alarms and calendar sync (iCal feed + .ics import)."""
from __future__ import annotations

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..core.timeutil import utcnow
from ..db import get_db
from ..deps import Ctx, current, fail, not_found, store
from ..models import Alarm, Event, User
from ..schemas import AlarmIn, AlarmPatch, IcsImportIn, PushSubscriptionIn, PushUnsubscribeIn, SnoozeMinutesIn
from ..serialize import alarm_out
from ..services import alarms as alarm_svc
from ..services import ics, push
from ..services.store import Store
from .auth import device_name

router = APIRouter()


# ---------- push ----------
@router.get("/push/vapid-key")
def vapid_key():
    return {"publicKey": push.keys()["public"]}


@router.post("/push/subscriptions")
def subscribe(body: PushSubscriptionIn, request: Request, ctx: Ctx = Depends(current)):
    if not body.endpoint.startswith("https://"):
        fail(422, "Некорректная подписка")
    push.subscribe(ctx.db, ctx.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, device_name(request.headers.get("user-agent", "")))
    ctx.db.commit()
    return {"ok": True}


@router.post("/push/unsubscribe")
def unsubscribe(body: PushUnsubscribeIn, ctx: Ctx = Depends(current)):
    push.unsubscribe(ctx.db, ctx.user.id, body.endpoint)
    ctx.db.commit()
    return {"ok": True}


@router.post("/push/test")
def push_test(ctx: Ctx = Depends(current)):
    n = push.send_to_user(ctx.db, ctx.user.id, {"title": "Adis", "body": "Уведомления работают", "route": "#/home", "tag": "test"})
    ctx.db.commit()
    if not n:
        fail(404, "Нет подписанных устройств или сервис уведомлений недоступен")
    return {"ok": True, "delivered": n}


# ---------- alarms ----------
@router.get("/alarms")
def alarms_list(s: Store = Depends(store)):
    return [alarm_out(a) for a in s.alarms()]


@router.post("/alarms")
def alarm_create(body: AlarmIn, s: Store = Depends(store)):
    a = s.alarm_create(body.model_dump())
    s.commit()
    return alarm_out(a)


@router.patch("/alarms/{aid}")
def alarm_update(aid: str, body: AlarmPatch, s: Store = Depends(store)):
    a = s.alarm_update(aid, body.patch()) or not_found()
    s.commit()
    return alarm_out(a)


@router.delete("/alarms/{aid}")
def alarm_delete(aid: str, s: Store = Depends(store)):
    s.alarm_delete(aid)
    s.commit()
    return {"ok": True}


def _own_alarm(s: Store, aid: str) -> Alarm:
    a = s._get(Alarm, aid) or not_found()
    due = alarm_svc.due_at(a)
    if due and due <= utcnow():
        alarm_svc.fire(a)  # the app rang it before the worker did
    return a


@router.post("/alarms/{aid}/dismiss")
def alarm_dismiss(aid: str, s: Store = Depends(store)):
    a = _own_alarm(s, aid)
    a.acked_at = utcnow()
    s.commit()
    return alarm_out(a)


@router.post("/alarms/{aid}/snooze")
def alarm_snooze(aid: str, body: SnoozeMinutesIn, s: Store = Depends(store)):
    a = _own_alarm(s, aid)
    now = utcnow()
    a.acked_at, a.snooze_until, a.enabled = now, now + timedelta(minutes=body.minutes), True
    s.commit()
    return alarm_out(a)


# ---------- calendar sync ----------
def _feed_url(request: Request, token: str) -> str:
    base = settings.public_url or str(request.base_url).rstrip("/")
    return f"{base}/v1/calendar/feed/{token}.ics"


def _feed_info(request: Request, user: User) -> dict:
    if not user.calendar_token:
        return {"enabled": False}
    url = _feed_url(request, user.calendar_token)
    return {"enabled": True, "url": url, "webcal": "webcal://" + url.split("://", 1)[1],
            "public": url.startswith("https://") and "localhost" not in url and "127.0.0.1" not in url}


@router.get("/calendar/feed")
def feed_status(request: Request, ctx: Ctx = Depends(current)):
    return _feed_info(request, ctx.user)


@router.post("/calendar/feed")
def feed_enable(request: Request, ctx: Ctx = Depends(current)):
    """Creates (or rotates) the secret subscription URL. Rotating invalidates the previous link."""
    ctx.user.calendar_token = secrets.token_urlsafe(24)
    ctx.db.commit()
    return _feed_info(request, ctx.user)


@router.delete("/calendar/feed")
def feed_disable(request: Request, ctx: Ctx = Depends(current)):
    ctx.user.calendar_token = None
    ctx.db.commit()
    return _feed_info(request, ctx.user)


@router.get("/calendar/feed/{token}.ics", include_in_schema=False)
def feed(token: str, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.calendar_token == token)) if len(token) >= 20 else None
    if not user:
        fail(404, "Календарь не найден")
    from ..core.timeutil import get_tz

    s = Store(db, user, get_tz(user.timezone))
    return Response(ics.build_feed(user, s.events(), s.tasks()), media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="adis.ics"'})


@router.post("/calendar/import")
def import_ics(body: IcsImportIn, s: Store = Depends(store)):
    if "BEGIN:VCALENDAR" not in body.ics.upper():
        fail(422, "Это не файл календаря (.ics)")
    items, stats = ics.parse(body.ics, s.tz)
    existing = {e.external_uid: e for e in s.events() if e.external_uid}
    created = updated = 0
    for it in items:
        uid_ = it.pop("uid")
        if uid_ and uid_ in existing:
            s.event_update(existing[uid_].id, it)
            updated += 1
        else:
            existing_ev: Event = s.event_create({**it, "external_uid": uid_})
            if uid_:
                existing[uid_] = existing_ev
            created += 1
    s.commit()
    return {"ok": True, "created": created, "updated": updated, "skipped": stats["skipped"], "recurring": stats["recurring"]}
