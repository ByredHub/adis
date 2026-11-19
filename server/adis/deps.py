"""Request dependencies: authenticated user, user's time zone, data store, API errors."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from zoneinfo import ZoneInfo

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.security import token_hash
from .core.timeutil import get_tz, utcnow
from .db import get_db
from .models import AuthSession, User


def fail(status: int, detail: str):
    raise HTTPException(status_code=status, detail=detail)


def not_found():
    fail(404, "Не найдено")


def user_tz(x_timezone: str | None = Header(None)) -> ZoneInfo:
    return get_tz(x_timezone)


@dataclass
class Ctx:
    db: Session
    user: User
    session: AuthSession
    tz: ZoneInfo


def current(request: Request, db: Session = Depends(get_db), tz: ZoneInfo = Depends(user_tz),
            authorization: str | None = Header(None)) -> Ctx:
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
    sess = db.scalar(select(AuthSession).where(AuthSession.access_hash == token_hash(token))) if token else None
    now = utcnow()
    if not sess or sess.access_expires < now:
        fail(401, "Сессия истекла")
    user = db.get(User, sess.user_id)
    if not user:
        fail(401, "Сессия истекла")
    dirty = False
    if now - sess.last_active_at > timedelta(minutes=5):
        sess.last_active_at, dirty = now, True
    if request.headers.get("x-timezone") and user.timezone != tz.key:
        user.timezone, dirty = tz.key, True
    if dirty:
        db.commit()
    return Ctx(db=db, user=user, session=sess, tz=tz)


def store(ctx: Ctx = Depends(current)):
    from .services.store import Store

    return Store(ctx.db, ctx.user, ctx.tz)
