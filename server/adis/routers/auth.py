"""Auth and account: register, login, one-time refresh rotation, logout, password, profile, devices, export, deletion."""
from __future__ import annotations

import re
import secrets
from datetime import timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import settings
from ..core.security import hash_password, login_limiter, new_token, token_hash, verify_password
from ..core.textutil import uid
from ..core.timeutil import iso, utcnow
from ..db import get_db
from ..deps import Ctx, current, fail, user_tz
from ..models import AuthSession, Conversation, Document, Message, User
from ..schemas import ChangePasswordIn, ForgotIn, LoginIn, LogoutIn, RefreshIn, RegisterIn, UserPatch
from ..serialize import (conv_summary, document_out, event_out, memory_out, message_out, person_out, task_out,
                         user_out)
from ..services.seed import add_builtin_agents, seed_demo
from ..services.store import Store

router = APIRouter()
EMAIL_RX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
DEMO_EMAIL = "demo@adis.app"


def device_name(ua: str) -> str:
    os_ = next((n for k, n in (("iPhone", "iPhone"), ("iPad", "iPad"), ("Android", "Android"), ("Windows", "Windows"), ("Mac", "macOS")) if k in ua), "Устройство")
    br = ("Edge" if "Edg/" in ua else "Chrome" if re.search("CriOS|Chrome", ua) else "Safari" if "Safari" in ua
          else "Firefox" if "Firefox" in ua else "Браузер")
    return f"{os_} · {br}"


def issue(db: Session, user: User, request: Request, sess: AuthSession | None = None) -> dict:
    access, refresh = new_token("at"), new_token("rt")
    now = utcnow()
    if sess is None:
        sess = AuthSession(id=uid("dev"), user_id=user.id, device=device_name(request.headers.get("user-agent", ""))[:120])
        db.add(sess)
    sess.access_hash, sess.access_expires = token_hash(access), now + timedelta(seconds=settings.access_ttl)
    sess.refresh_hash, sess.refresh_expires = token_hash(refresh), now + timedelta(seconds=settings.refresh_ttl)
    sess.last_active_at = now
    db.commit()
    return {"accessToken": access, "refreshToken": refresh, "expiresIn": settings.access_ttl, "user": user_out(user)}


def norm_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL_RX.match(email) or len(email) > 254:
        fail(422, "Введите корректный email")
    return email


def new_user(db: Session, name: str, email: str, password: str, tz: ZoneInfo, demo: bool = False) -> User:
    user = User(id=uid("u"), name=name, email=email, pass_hash=hash_password(password), timezone=tz.key, demo=demo)
    db.add(user)
    db.flush()
    add_builtin_agents(db, user.id)
    return user


@router.post("/auth/register")
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db), tz: ZoneInfo = Depends(user_tz)):
    email = norm_email(body.email)
    if len(body.name.strip()) < 2:
        fail(422, "Введите имя")
    if len(body.password) < 8:
        fail(422, "Пароль должен быть не короче 8 символов")
    if db.scalar(select(User).where(User.email == email)):
        fail(409, "Пользователь с таким email уже существует")
    user = new_user(db, body.name.strip()[:120], email, body.password, tz)
    return issue(db, user, request)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db), tz: ZoneInfo = Depends(user_tz)):
    email = norm_email(body.email)
    if body.demo and email == DEMO_EMAIL:
        if not settings.demo_login:
            fail(403, "Демо-вход на этом сервере отключён")
        # Each demo login gets its own isolated account so presentation data is never shared between people
        user = new_user(db, "Алексей", f"demo+{secrets.token_hex(6)}@adis.app", secrets.token_urlsafe(16), tz, demo=True)
        seed_demo(db, user.id, tz)
        return issue(db, user, request)
    key = f"{email}|{request.client.host if request.client else ''}"
    if login_limiter.blocked(key):
        fail(429, "Слишком много попыток входа. Попробуйте через 15 минут.")
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(body.password or "", user.pass_hash):
        login_limiter.hit(key)
        fail(401, "Неверный email или пароль")
    login_limiter.reset(key)
    return issue(db, user, request)


@router.post("/auth/refresh")
def refresh(body: RefreshIn, request: Request, db: Session = Depends(get_db)):
    sess = db.scalar(select(AuthSession).where(AuthSession.refresh_hash == token_hash(body.refresh_token or "")))
    if not sess or sess.refresh_expires < utcnow():
        fail(401, "Сессия истекла")
    user = db.get(User, sess.user_id)
    if not user:
        fail(401, "Сессия истекла")
    return issue(db, user, request, sess)  # rotates: the old refresh token stops working


@router.post("/auth/logout")
def logout(body: LogoutIn, request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization", "")
    hashes = [token_hash(auth[7:].strip())] if auth.lower().startswith("bearer ") else []
    conds = [AuthSession.access_hash.in_(hashes)] if hashes else []
    if body.refresh_token:
        conds.append(AuthSession.refresh_hash == token_hash(body.refresh_token))
    for c in conds:
        db.execute(delete(AuthSession).where(c))
    db.commit()
    return {"ok": True}


@router.post("/auth/password/forgot")
def forgot(body: ForgotIn):
    norm_email(body.email)
    # Always the same answer so the endpoint can't be used to check which emails are registered
    return {"ok": True, "demoNote": "Отправка писем на сервере пока не настроена: восстановление пароля по email появится после подключения почтового сервиса."}


@router.post("/auth/password/change")
def change_password(body: ChangePasswordIn, ctx: Ctx = Depends(current)):
    if not verify_password(body.current, ctx.user.pass_hash):
        fail(422, "Текущий пароль неверен")
    if len(body.next) < 8:
        fail(422, "Новый пароль должен быть не короче 8 символов")
    ctx.user.pass_hash = hash_password(body.next)
    ctx.db.execute(delete(AuthSession).where(AuthSession.user_id == ctx.user.id, AuthSession.id != ctx.session.id))
    ctx.db.commit()
    return {"ok": True}


@router.get("/users/me")
def me(ctx: Ctx = Depends(current)):
    return user_out(ctx.user)


@router.patch("/users/me")
def update_me(body: UserPatch, ctx: Ctx = Depends(current)):
    p = body.patch()
    if "name" in p and p["name"] and p["name"].strip():
        ctx.user.name = p["name"].strip()
    if "assistant_name" in p and p["assistant_name"] and p["assistant_name"].strip():
        ctx.user.assistant_name = p["assistant_name"].strip()
    if "avatar" in p:
        ctx.user.avatar = p["avatar"] or None
    ctx.db.commit()
    return user_out(ctx.user)


@router.delete("/users/me")
def delete_me(ctx: Ctx = Depends(current)):
    Store(ctx.db, ctx.user, ctx.tz).wipe()
    ctx.db.delete(ctx.user)
    ctx.db.commit()
    return {"ok": True}


@router.get("/users/me/devices")
def devices(ctx: Ctx = Depends(current)):
    rows = ctx.db.scalars(select(AuthSession).where(AuthSession.user_id == ctx.user.id, AuthSession.refresh_expires > utcnow())
                          .order_by(AuthSession.last_active_at.desc()))
    return [{"id": s.id, "name": s.device, "lastActiveAt": iso(s.last_active_at), "current": s.id == ctx.session.id} for s in rows]


@router.get("/users/me/export")
def export(ctx: Ctx = Depends(current)):
    s = Store(ctx.db, ctx.user, ctx.tz)
    convs = []
    for c in ctx.db.scalars(select(Conversation).where(Conversation.user_id == ctx.user.id)):
        msgs = list(ctx.db.scalars(select(Message).where(Message.conversation_id == c.id).order_by(Message.pos)))
        convs.append({**conv_summary(c, msgs[-1] if msgs else None, len(msgs)), "messages": [message_out(m) for m in msgs]})
    from ..routers.agents import agents_export

    return {"exportedAt": iso(utcnow()), "user": user_out(ctx.user), "data": {
        "conversations": convs, "memories": [memory_out(m) for m in s.memories()], "people": [person_out(p) for p in s.people()],
        "tasks": [task_out(t) for t in s.tasks()], "events": [event_out(e) for e in s.events()],
        "documents": [document_out(d) for d in ctx.db.scalars(select(Document).where(Document.user_id == ctx.user.id))],
        **agents_export(ctx)}}
