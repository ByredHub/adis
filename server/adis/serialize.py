"""ORM -> API DTO (camelCase JSON, ISO-8601 UTC timestamps). Mirrors app/js/api/contract.js."""
from __future__ import annotations

import re

from .core.timeutil import iso, utcnow
from .models import Agent, AgentRun, Alarm, Conversation, Document, Event, Memory, Message, Person, Task, User


def user_out(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "createdAt": iso(u.created_at),
            "assistantName": u.assistant_name or "Adis", "avatar": u.avatar, "timezone": u.timezone, "demo": u.demo}


def person_out(p: Person) -> dict:
    return {"id": p.id, "name": p.name, "photo": p.photo, "profession": p.profession or "", "skills": p.skills or [],
            "organization": p.organization or "", "metAt": iso(p.met_at), "metWhere": p.met_where or "", "notes": p.notes or "",
            "interactions": p.interactions or [], "createdAt": iso(p.created_at), "updatedAt": iso(p.updated_at)}


def memory_out(m: Memory) -> dict:
    out = {"id": m.id, "type": m.type, "title": m.title, "content": m.content, "tags": m.tags or [], "confirmed": m.confirmed,
           "personId": m.person_id, "source": m.source or {"kind": "manual"}, "createdAt": iso(m.created_at), "updatedAt": iso(m.updated_at)}
    if m.photo:
        out["photo"] = m.photo
    return out


def task_status(t: Task) -> str:
    if t.done:
        return "done"
    return "overdue" if t.due_at and t.due_at < utcnow() else "active"


def task_out(t: Task) -> dict:
    return {"id": t.id, "title": t.title, "notes": t.notes or "", "dueAt": iso(t.due_at), "repeat": t.repeat or "none",
            "remind": t.remind, "done": t.done, "doneAt": iso(t.done_at), "personId": t.person_id, "notifyAt": iso(t.notify_at),
            "timezone": t.timezone, "source": t.source, "status": task_status(t),
            "createdAt": iso(t.created_at), "updatedAt": iso(t.updated_at)}


def event_out(e: Event) -> dict:
    return {"id": e.id, "title": e.title, "startAt": iso(e.start_at), "endAt": iso(e.end_at), "location": e.location or "",
            "notes": e.notes or "", "remindMinutes": e.remind_minutes, "personId": e.person_id, "imported": bool(e.external_uid), "createdAt": iso(e.created_at), "updatedAt": iso(e.updated_at)}


def document_out(d: Document) -> dict:
    return {"id": d.id, "title": d.title, "content": d.content, "createdAt": iso(d.created_at), "updatedAt": iso(d.updated_at)}


def message_out(m: Message) -> dict:
    out = {"id": m.id, "role": m.role, "content": m.content, "createdAt": iso(m.created_at)}
    if m.role == "user":
        out.update(attachments=m.attachments or [], clientMessageId=m.client_message_id, source=m.source)
    else:
        out.update(cards=m.cards or [], toolCalls=m.tool_calls or [], engine=m.engine)
        if m.stopped:
            out["stopped"] = True
    return out


_MD = re.compile(r"[*#`>_-]")


def conv_summary(c: Conversation, last: Message | None, count: int) -> dict:
    preview = ""
    if last:
        preview = _MD.sub("", last.content)[:90] or ("Фото" if any(a.get("image") for a in (last.attachments or [])) else "")
    return {"id": c.id, "title": c.title, "createdAt": iso(c.created_at), "updatedAt": iso(c.updated_at), "lastMessage": preview, "count": count}


def agent_out(a: Agent) -> dict:
    # Built-in agents are deterministic analytics over the user's data (no LLM), so the UI keeps the "Демо" label
    return {"id": a.id, "name": a.name, "description": a.description, "instructions": a.instructions, "tools": a.tools or [],
            "icon": a.icon, "demo": bool(a.builtin), "builtin": a.builtin, "createdAt": iso(a.created_at)}


def run_out(r: AgentRun) -> dict:
    return {"id": r.id, "agentId": r.agent_id, "status": r.status, "steps": r.steps or [], "result": r.result,
            "startedAt": iso(r.started_at), "finishedAt": iso(r.finished_at)}


def alarm_out(a: Alarm) -> dict:
    from .services.alarms import describe_days, due_at, ringing

    return {"id": a.id, "hour": a.hour, "minute": a.minute, "time": f"{a.hour:02d}:{a.minute:02d}", "days": a.days or [],
            "daysLabel": describe_days(a.days), "label": a.label, "enabled": a.enabled, "timezone": a.timezone,
            "nextAt": iso(due_at(a)), "snoozeUntil": iso(a.snooze_until), "ringAt": iso(a.ring_at), "ringing": ringing(a),
            "createdAt": iso(a.created_at), "updatedAt": iso(a.updated_at)}