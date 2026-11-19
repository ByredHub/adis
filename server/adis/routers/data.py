"""Memory, people, tasks, events, documents and proactive suggestions. All scoped to the current user."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from ..core.textutil import uid
from ..core.timeutil import local, utcnow
from ..deps import fail, not_found, store
from ..models import Document, Person, Task
from ..schemas import DocumentIn, EventIn, EventPatch, MemoryIn, MemoryPatch, PersonIn, PersonPatch, SnoozeIn, TaskIn, TaskPatch
from ..serialize import document_out, event_out, memory_out, person_out, task_out
from ..services.store import Store

router = APIRouter()
OK = {"ok": True}


def _done(s: Store, value):
    s.commit()
    return value


# ---------- memory ----------
@router.get("/memory")
def memory_list(type: str | None = None, personId: str | None = None, s: Store = Depends(store)):
    items = s.memory_search(types=[type] if type else None, person_id=personId, limit=10_000)
    return [memory_out(m) for m in items]


@router.get("/memory/search")
def memory_search(q: str = "", type: str | None = None, s: Store = Depends(store)):
    return [memory_out(m) for m in s.memory_search(q, types=[type] if type else None, limit=50)]


@router.post("/memory")
def memory_create(body: MemoryIn, s: Store = Depends(store)):
    if not (body.title.strip() or body.content.strip()):
        fail(422, "Заполните запись")
    return _done(s, memory_out(s.memory_save(body.model_dump())))


@router.patch("/memory/{mid}")
def memory_update(mid: str, body: MemoryPatch, s: Store = Depends(store)):
    m = s.memory_update(mid, body.patch()) or not_found()
    return _done(s, memory_out(m))


@router.delete("/memory/{mid}")
def memory_delete(mid: str, s: Store = Depends(store)):
    return _done(s, OK) if s.memory_delete(mid) else not_found()


# ---------- people ----------
@router.get("/people")
def people_list(s: Store = Depends(store)):
    return [person_out(p) for p in s.entity_lookup()]


@router.get("/people/{pid}")
def person_get(pid: str, s: Store = Depends(store)):
    return person_out(s._get(Person, pid) or not_found())


@router.post("/people")
def person_create(body: PersonIn, s: Store = Depends(store)):
    data = body.patch()
    if not body.id and not (body.name or "").strip():
        fail(422, "Введите имя")
    if body.id and not s._get(Person, body.id):
        not_found()
    return _done(s, person_out(s.person_save(data)))


@router.patch("/people/{pid}")
def person_update(pid: str, body: PersonPatch, s: Store = Depends(store)):
    return _done(s, person_out(s.person_update(pid, body.patch()) or not_found()))


@router.delete("/people/{pid}")
def person_delete(pid: str, s: Store = Depends(store)):
    return _done(s, OK) if s.person_delete(pid) else not_found()


# ---------- tasks ----------
@router.get("/tasks")
def tasks_list(s: Store = Depends(store)):
    return [task_out(t) for t in s.tasks()]


@router.post("/tasks")
def task_create(body: TaskIn, s: Store = Depends(store)):
    if not body.title.strip():
        fail(422, "Введите название")
    data = body.model_dump()
    data["title"] = data["title"].strip()
    return _done(s, task_out(s.task_create(data)))


@router.patch("/tasks/{tid}")
def task_update(tid: str, body: TaskPatch, s: Store = Depends(store)):
    p = body.patch()
    t = s.task_complete(tid, bool(p["done"])) if set(p) == {"done"} else s.task_update(tid, p)
    return _done(s, task_out(t or not_found()))


@router.delete("/tasks/{tid}")
def task_delete(tid: str, s: Store = Depends(store)):
    return _done(s, OK) if s.task_delete(tid) else not_found()


# ---------- events ----------
@router.get("/events")
def events_list(s: Store = Depends(store)):
    return [event_out(e) for e in s.events()]


@router.post("/events")
def event_create(body: EventIn, s: Store = Depends(store)):
    if not body.title.strip() or not body.start_at:
        fail(422, "Укажите название и время")
    return _done(s, event_out(s.event_create(body.model_dump())))


@router.patch("/events/{eid}")
def event_update(eid: str, body: EventPatch, s: Store = Depends(store)):
    return _done(s, event_out(s.event_update(eid, body.patch()) or not_found()))


@router.delete("/events/{eid}")
def event_delete(eid: str, s: Store = Depends(store)):
    s.event_delete(eid)
    return _done(s, OK)

# ---------- documents ----------
@router.get("/documents")
def documents_list(s: Store = Depends(store)):
    return [document_out(d) for d in s._all(Document, Document.updated_at.desc())]


@router.post("/documents")
def document_create(body: DocumentIn, s: Store = Depends(store)):
    d = Document(id=uid("doc"), user_id=s.uid, title=body.title or "Без названия", content=body.content or "")
    s.db.add(d)
    return _done(s, document_out(d))


@router.patch("/documents/{did}")
def document_update(did: str, body: DocumentIn, s: Store = Depends(store)):
    d = s._get(Document, did) or not_found()
    for k, v in body.patch().items():
        if v is not None:
            setattr(d, k, v)
    d.updated_at = utcnow()
    return _done(s, document_out(d))


@router.delete("/documents/{did}")
def document_delete(did: str, s: Store = Depends(store)):
    d = s._get(Document, did)
    if d:
        s.db.delete(d)
    return _done(s, OK)


# ---------- proactive ----------
@router.get("/proactive/suggestions")
def suggestions(frequency: str = "normal", s: Store = Depends(store)):
    if frequency == "off":
        return []
    items = s.proactive_suggestion()
    return items[:2] if frequency == "rare" else items


@router.post("/proactive/{sid}/accept")
def accept(sid: str, s: Store = Depends(store)):
    sug = next((x for x in s.proactive_suggestion() if x["id"] == sid), None)
    s.set_suggestion_state(sid, "accepted")
    result = None
    if sug and sug["action"]["type"] == "reschedule_task":
        t = s._get(Task, sug["action"]["taskId"])
        if t and t.due_at:
            old = local(t.due_at, s.tz)
            nxt = (datetime.now(s.tz) + timedelta(days=1)).replace(hour=old.hour, minute=old.minute, second=0, microsecond=0)
            result = task_out(s.task_update(t.id, {"due_at": nxt}))
    elif sug and sug["action"]["type"] == "create_task":
        due = (datetime.now(s.tz) + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
        result = task_out(s.task_create({"title": sug["action"]["title"], "person_id": sug["action"].get("personId"), "due_at": due}))
    return _done(s, {"ok": True, "action": sug["action"] if sug else None, "result": result})


@router.post("/proactive/{sid}/dismiss")
def dismiss(sid: str, s: Store = Depends(store)):
    s.set_suggestion_state(sid, "dismissed")
    return _done(s, OK)


@router.post("/proactive/{sid}/snooze")
def snooze(sid: str, body: SnoozeIn, s: Store = Depends(store)):
    s.set_suggestion_state(sid, "snoozed", utcnow() + timedelta(hours=max(0.5, min(body.hours, 24 * 30))))
    return _done(s, OK)
