"""Chat: conversations, messages, SSE streaming through the AI gateway, card status updates."""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import random

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from ..ai.base import EngineError, TurnContext
from ..ai.gateway import get_engine
from ..core.textutil import uid
from ..core.timeutil import utcnow
from ..db import SessionLocal
from ..deps import Ctx, current, fail, not_found
from ..models import Conversation, Message, User
from ..schemas import CardPatch, ChatIn
from ..serialize import conv_summary, message_out
from ..services.store import Store

router = APIRouter()
log = logging.getLogger("adis.chat")


def _messages(db, conv_id: str) -> list[Message]:
    return list(db.scalars(select(Message).where(Message.conversation_id == conv_id).order_by(Message.pos)))


def _summary(db, c: Conversation) -> dict:
    last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(Message.pos.desc()).limit(1))
    count = db.scalar(select(func.count()).select_from(Message).where(Message.conversation_id == c.id))
    return conv_summary(c, last, count or 0)


def _own_conv(db, user_id: str, conv_id: str) -> Conversation:
    c = db.get(Conversation, conv_id)
    if not c or c.user_id != user_id:
        not_found()
    return c


def prepare_turn(store: Store, body: ChatIn) -> tuple[Conversation, Message, TurnContext]:
    """Validates and stores the user message (or picks it for regeneration). Commits so retries hit the 409 guard."""
    db, user = store.db, store.user
    content = (body.content or "").strip()
    attachments = []
    for f in body.attachments[:5]:
        image = f.image if f.image and f.image.startswith("data:image/") else None
        attachments.append({"name": f.name, "size": f.size, "type": f.type, "text": f.text, "width": f.width, "height": f.height, "image": image})
    if not content and not attachments and not body.regenerate:
        fail(422, "Пустое сообщение")
    if len(content) > 8000:
        fail(422, "Сообщение слишком длинное")
    conv = _own_conv(db, user.id, body.conversation_id) if body.conversation_id else None
    if not conv:
        first = attachments[0] if attachments else None
        title = content or (first and ("Фото" if first["image"] else first["name"])) or "Новый чат"
        conv = Conversation(id=uid("cv"), user_id=user.id, title=title[:48])
        db.add(conv)
        db.flush()
    msgs = _messages(db, conv.id)
    if body.regenerate:
        if msgs and msgs[-1].role == "assistant":
            db.delete(msgs.pop())
        user_msg = next((m for m in reversed(msgs) if m.role == "user"), None)
        if not user_msg:
            fail(422, "Нечего генерировать заново")
        turn_attachments = []
    else:
        if body.client_message_id and any(m.client_message_id == body.client_message_id for m in msgs):
            fail(409, "Сообщение уже отправлено")
        user_msg = Message(id=uid("msg"), conversation_id=conv.id, user_id=user.id, pos=(msgs[-1].pos + 1) if msgs else 0, role="user",
                           content=content, client_message_id=body.client_message_id, source=body.source,
                           attachments=[{k: a[k] for k in ("name", "size", "type", "image", "width", "height")} for a in attachments])
        db.add(user_msg)
        turn_attachments = attachments
    history = [{"role": m.role, "content": m.content} for m in msgs if m.id != user_msg.id and m.content]
    conv.updated_at = utcnow()
    db.commit()
    ctx = TurnContext(store=store, text=user_msg.content, attachments=turn_attachments, history=history, auto_save=body.auto_save,
                      sensitive_guard=body.sensitive_guard, variant=random.randint(1, 3) if body.regenerate else 0,
                      conversation_id=conv.id, source=body.source)
    return conv, user_msg, ctx


def _save_reply(db, conv: Conversation, user_msg: Message, msg_id: str, engine: str, content: str, cards: list, tool_calls: list,
                stopped: bool = False) -> Message:
    last_pos = db.scalar(select(func.max(Message.pos)).where(Message.conversation_id == conv.id)) or 0
    m = Message(id=msg_id, conversation_id=conv.id, user_id=conv.user_id, pos=max(last_pos, user_msg.pos) + 1, role="assistant",
                content=content, cards=cards, tool_calls=tool_calls, engine=engine, stopped=stopped)
    db.add(m)
    conv.updated_at = utcnow()
    db.commit()
    return m


@router.post("/chat/messages")
async def send(body: ChatIn, ctx: Ctx = Depends(current)):
    store = Store(ctx.db, ctx.user, ctx.tz)
    conv, user_msg, turn = prepare_turn(store, body)
    turn.streaming = False
    engine = get_engine()
    final = None
    try:
        async for evt in engine.respond(turn):
            if evt["type"] == "final":
                final = evt
    except EngineError as e:
        fail(502, str(e))
    reply = _save_reply(ctx.db, conv, user_msg, uid("msg"), engine.name, final["content"], final["cards"], final["toolCalls"])
    return {"conversation": _summary(ctx.db, conv), "userMessage": message_out(user_msg), "assistantMessage": message_out(reply)}


def _sse(evt: dict) -> str:
    return f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
async def stream(body: ChatIn, ctx: Ctx = Depends(current)):
    # Validation happens before the response starts, so errors come back as normal HTTP statuses (409, 422, 404).
    user_id, tz = ctx.user.id, ctx.tz
    conv0, user_msg0, turn0 = prepare_turn(Store(ctx.db, ctx.user, tz), body)
    conv_id, user_msg_id = conv0.id, user_msg0.id

    async def gen():
        # Own DB session: request-scoped dependencies may already be closed while the body streams
        with SessionLocal() as db:
            user = db.get(User, user_id)
            store = Store(db, user, tz)
            conv, user_msg = db.get(Conversation, conv_id), db.get(Message, user_msg_id)
            turn = dataclasses.replace(turn0, store=store)
            engine, msg_id, acc = get_engine(), uid("msg"), ""
            yield _sse({"type": "start", "conversation": _summary(db, conv), "userMessage": message_out(user_msg), "messageId": msg_id})
            try:
                async for evt in engine.respond(turn):
                    if evt["type"] == "delta":
                        acc += evt["text"]
                        yield _sse(evt)
                    elif evt["type"] == "status":
                        yield _sse(evt)
                    elif evt["type"] == "final":
                        reply = _save_reply(db, conv, user_msg, msg_id, engine.name, evt["content"], evt["cards"], evt["toolCalls"])
                        yield _sse({"type": "done", "message": message_out(reply), "conversation": _summary(db, conv)})
            except EngineError as e:
                db.rollback()
                yield _sse({"type": "error", "message": str(e)})
            except (asyncio.CancelledError, GeneratorExit):
                # Client pressed "stop" or lost connection: keep what was generated so far
                db.rollback()
                if acc and not db.get(Message, msg_id):
                    _save_reply(db, conv, user_msg, msg_id, engine.name, acc + " …", [], [], stopped=True)
                raise
            except Exception:  # noqa: BLE001
                log.exception("stream failed")
                db.rollback()
                yield _sse({"type": "error", "message": "Ошибка на сервере. Попробуйте ещё раз."})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/chat/conversations")
def conversations(ctx: Ctx = Depends(current)):
    rows = ctx.db.scalars(select(Conversation).where(Conversation.user_id == ctx.user.id).order_by(Conversation.updated_at.desc()))
    return [_summary(ctx.db, c) for c in rows]


@router.get("/chat/conversations/{conv_id}")
def conversation(conv_id: str, ctx: Ctx = Depends(current)):
    c = _own_conv(ctx.db, ctx.user.id, conv_id)
    return {**_summary(ctx.db, c), "messages": [message_out(m) for m in _messages(ctx.db, c.id)]}


@router.delete("/chat/conversations/{conv_id}")
def delete_conversation(conv_id: str, ctx: Ctx = Depends(current)):
    ctx.db.delete(_own_conv(ctx.db, ctx.user.id, conv_id))
    ctx.db.commit()
    return {"ok": True}


@router.patch("/chat/conversations/{conv_id}/messages/{mid}/cards/{cid}")
def card_status(conv_id: str, mid: str, cid: str, body: CardPatch, ctx: Ctx = Depends(current)):
    _own_conv(ctx.db, ctx.user.id, conv_id)
    m = ctx.db.get(Message, mid)
    if not m or m.conversation_id != conv_id:
        not_found()
    cards = [dict(c) for c in (m.cards or [])]
    target = next((c for c in cards if c.get("id") == cid), None)
    if not target:
        not_found()
    for k in ("status", "result", "data"):
        v = getattr(body, k)
        if v:
            target[k] = v
    m.cards = cards
    ctx.db.commit()
    return target
