"""User-scoped business logic. The same functions back the REST endpoints and the AI tool calls,
so the model never touches SQL and can only act on the current user's data."""
from __future__ import annotations

from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..ai import nlu
from ..core.textutil import plural, same_stem, uid, words
from ..core.timeutil import add_months, fmt_ago, fmt_date_time, get_tz, iso, local, to_utc, utcnow
from ..models import Alarm, Event, Memory, Person, SuggestionState, Task, User

MEMORY_TYPES = {
    "person": ("Люди", "Человек"), "event": ("События", "Событие"), "fact": ("Факты", "Факт"), "idea": ("Идеи", "Идея"),
    "preference": ("Предпочтения", "Предпочтение"), "plan": ("Планы", "План"), "knowledge": ("Знания", "Знание"),
    "intention": ("Намерения", "Намерение"), "assumption": ("Предположения", "Предположение"),
}

MEMORY_FIELDS = {"type", "title", "content", "tags", "confirmed", "person_id", "source", "photo"}
PERSON_FIELDS = {"name", "photo", "profession", "skills", "organization", "met_at", "met_where", "notes", "interactions"}
TASK_FIELDS = {"title", "notes", "due_at", "repeat", "remind", "person_id", "done"}


def score(query: str, fields: list) -> float:
    qs = nlu.keywords(query)
    if not qs:
        return 0
    hay = words(" ".join(f for f in fields if f))
    s = 0
    for q in qs:
        if q in hay:
            s += 3
        elif any(same_stem(h, q) for h in hay):
            s += 2
    return s / len(qs)


def next_occurrence(due, repeat: str, tz: ZoneInfo):
    d = local(due, tz)
    if repeat == "daily":
        d += timedelta(days=1)
    elif repeat == "weekly":
        d += timedelta(days=7)
    elif repeat == "monthly":
        d = add_months(d, 1)
    return to_utc(d)


class Store:
    def __init__(self, db: Session, user: User, tz: ZoneInfo) -> None:
        self.db, self.user, self.tz = db, user, tz
        self.uid = user.id

    # ---------- generic ----------
    def _all(self, model, *order):
        return list(self.db.scalars(select(model).where(model.user_id == self.uid).order_by(*order)))

    def _get(self, model, id_: str | None):
        obj = self.db.get(model, id_) if id_ else None
        return obj if obj is not None and obj.user_id == self.uid else None

    def _own_person(self, pid):
        return pid if pid and self._get(Person, pid) else None

    def commit(self):
        self.db.commit()

    # ---------- lists ----------
    def people(self):
        return self._all(Person, Person.created_at.desc())

    def memories(self):
        return self._all(Memory, Memory.created_at.desc())

    def tasks(self):
        return self._all(Task, Task.created_at.desc())

    def events(self):
        return self._all(Event, Event.start_at)

    # ---------- memory ----------
    def memory_search(self, query: str = "", types: list[str] | None = None, limit: int = 20, person_id: str | None = None):
        items = self.memories()
        if types:
            items = [m for m in items if m.type in types]
        if person_id:
            items = [m for m in items if m.person_id == person_id]
        if not query.strip():
            return items[:limit]
        scored = [(m, score(query, [m.title, m.content, " ".join(m.tags or []), MEMORY_TYPES.get(m.type, ("",))[0]])) for m in items]
        return [m for m, s in sorted((x for x in scored if x[1] > 0.3), key=lambda x: -x[1])][:limit]

    def memory_save(self, data: dict) -> Memory:
        data = {k: v for k, v in data.items() if k in MEMORY_FIELDS and v is not None}
        m = Memory(id=uid("m"), user_id=self.uid, **{"source": {"kind": "manual"}, **data})
        if m.type not in MEMORY_TYPES:
            m.type = "fact"
        if not m.title:
            m.title = nlu.memory_title(m.content or "Без названия")
        m.person_id = self._own_person(m.person_id)
        m.tags = [str(t)[:60] for t in (m.tags or [])]
        self.db.add(m)
        self.db.flush()
        return m

    def memory_update(self, id_: str, patch: dict) -> Memory | None:
        m = self._get(Memory, id_)
        if not m:
            return None
        for k, v in patch.items():
            if k in MEMORY_FIELDS:
                setattr(m, k, v)
        if m.type not in MEMORY_TYPES:
            m.type = "fact"
        if "person_id" in patch:
            m.person_id = self._own_person(m.person_id)
        m.updated_at = utcnow()
        self.db.flush()
        return m

    def memory_delete(self, id_: str) -> bool:
        m = self._get(Memory, id_)
        if not m:
            return False
        self.db.delete(m)
        self.db.flush()
        return True

    # ---------- people (entity_lookup) ----------
    def entity_lookup(self, name: str | None = None, profession: str | None = None, skill: str | None = None, since_days: float | None = None):
        items = self.people()
        if name:
            items = [p for p in items if any(same_stem(part, name) for part in p.name.split(" "))]
        if profession:
            st = str(profession).lower().replace("ё", "е")
            items = [p for p in items if st in (p.profession or "").lower().replace("ё", "е") or any(st in s.lower() for s in (p.skills or []))]
        if skill:
            items = [p for p in items if any(s.lower() == str(skill).lower() for s in (p.skills or []))]
        if since_days:
            lim = utcnow() - timedelta(days=since_days)
            items = [p for p in items if (p.met_at or p.created_at) >= lim]
        return sorted(items, key=lambda p: p.met_at or p.created_at, reverse=True)

    def person_save(self, data: dict) -> Person:
        interaction = data.pop("interaction", None)
        name = (data.get("name") or "").strip()
        existing = self._get(Person, data.get("id")) if data.get("id") else None
        if not existing and name:
            existing = next((p for p in self.people() if p.name.lower() == name.lower()), None)
        now = utcnow()
        if existing:
            for k, v in data.items():
                if k in PERSON_FIELDS and k != "skills" and v:
                    setattr(existing, k, to_utc(v) if k == "met_at" else v)
            existing.skills = list(dict.fromkeys([*(existing.skills or []), *(data.get("skills") or [])]))
            if interaction:
                existing.interactions = [{"date": iso(now), "text": interaction}, *(existing.interactions or [])]
            existing.updated_at = now
            self.db.flush()
            return existing
        fields = {k: v for k, v in data.items() if k in PERSON_FIELDS and v is not None}
        fields["met_at"] = to_utc(fields.get("met_at")) or now
        p = Person(id=uid("p"), user_id=self.uid, **{"name": "Без имени", **fields})
        if not p.interactions:
            p.interactions = [{"date": iso(p.met_at), "text": f"Познакомились {p.met_where}" if p.met_where else "Знакомство"}]
        self.db.add(p)
        self.db.flush()
        return p

    def person_update(self, id_: str, patch: dict) -> Person | None:
        p = self._get(Person, id_)
        if not p:
            return None
        for k, v in patch.items():
            if k in PERSON_FIELDS and not (k == "name" and not v):
                setattr(p, k, to_utc(v) if k == "met_at" else v)
        p.updated_at = utcnow()
        self.db.flush()
        return p

    def person_delete(self, id_: str) -> bool:
        p = self._get(Person, id_)
        if not p:
            return False
        for m in self.memories():
            if m.person_id == id_:
                m.person_id = None
        for t in self.tasks():
            if t.person_id == id_:
                t.person_id = None
        self.db.delete(p)
        self.db.flush()
        return True

    # ---------- tasks ----------
    def task_create(self, data: dict) -> Task:
        fields = {k: v for k, v in data.items() if k in TASK_FIELDS | {"timezone", "source"} and v is not None}
        fields["due_at"] = to_utc(fields.get("due_at"))
        fields["timezone"] = get_tz(fields.get("timezone") or self.tz.key).key
        t = Task(id=uid("t"), user_id=self.uid, **{"title": "Задача", **fields})
        t.person_id = self._own_person(t.person_id)
        self.db.add(t)
        if t.remind and t.due_at:
            self.notification_schedule(t, t.due_at)
        self.db.flush()
        return t

    def task_update(self, id_: str, patch: dict) -> Task | None:
        t = self._get(Task, id_)
        if not t:
            return None
        for k, v in patch.items():
            if k in TASK_FIELDS - {"done"}:
                setattr(t, k, to_utc(v) if k == "due_at" else v)
        if "person_id" in patch:
            t.person_id = self._own_person(t.person_id)
        if "due_at" in patch or "remind" in patch:
            self.notification_schedule(t, t.due_at if t.remind else None)
        if "done" in patch:
            self.task_complete(id_, bool(patch["done"]))
        t.updated_at = utcnow()
        self.db.flush()
        return t

    def task_complete(self, id_: str, done: bool = True) -> Task | None:
        t = self._get(Task, id_)
        if not t:
            return None
        if done and not t.done and t.repeat and t.repeat != "none" and t.due_at:
            self.task_create({"title": t.title, "notes": t.notes, "due_at": next_occurrence(t.due_at, t.repeat, get_tz(t.timezone)),
                              "repeat": t.repeat, "remind": t.remind, "person_id": t.person_id, "timezone": t.timezone})
            t.repeat = "none"
        t.done, t.done_at, t.updated_at = done, utcnow() if done else None, utcnow()
        self.db.flush()
        return t

    def task_delete(self, id_: str) -> bool:
        t = self._get(Task, id_)
        if not t:
            return False
        self.db.delete(t)
        self.db.flush()
        return True

    def notification_schedule(self, task: Task, at) -> dict:
        """Queue a reminder on the server. A delivery worker (Web Push / APNs / FCM) sends rows with notify_at <= now."""
        task.notify_at, task.notified_at = to_utc(at), None
        return {"scheduled": bool(at), "at": iso(at)}

    # ---------- events ----------
    def event_create(self, data: dict) -> Event:
        start = to_utc(data["start_at"])
        e = Event(id=uid("e"), user_id=self.uid, title=(data.get("title") or "Событие").strip()[:255], start_at=start,
                  end_at=to_utc(data.get("end_at")) or start + timedelta(hours=1), location=data.get("location") or "",
                  notes=data.get("notes") or "", remind_minutes=data.get("remind_minutes", 15) if data.get("remind_minutes") is not None else 15,
                  person_id=self._own_person(data.get("person_id")), external_uid=data.get("external_uid"))
        if e.end_at < e.start_at:
            e.end_at = e.start_at + timedelta(hours=1)
        self.db.add(e)
        self.db.flush()
        return e

    def event_update(self, id_: str, patch: dict) -> Event | None:
        e = self._get(Event, id_)
        if not e:
            return None
        duration = (e.end_at - e.start_at) if e.end_at else timedelta(hours=1)
        for k, v in patch.items():
            if k in ("title", "location", "notes", "remind_minutes", "start_at", "end_at", "person_id") and not (k == "title" and not v):
                setattr(e, k, to_utc(v) if k in ("start_at", "end_at") else v)
        if "start_at" in patch and "end_at" not in patch:
            e.end_at = e.start_at + duration  # moving an event keeps its length
        if e.end_at and e.end_at < e.start_at:
            e.end_at = e.start_at + duration
        if "person_id" in patch:
            e.person_id = self._own_person(e.person_id)
        e.updated_at = utcnow()
        self.db.flush()
        return e

    def event_delete(self, id_: str) -> bool:
        e = self._get(Event, id_)
        if not e:
            return False
        self.db.delete(e)
        self.db.flush()
        return True

    def events_between(self, start, end) -> list[Event]:
        return [e for e in self.events() if e.start_at < end and (e.end_at or e.start_at) >= start]

    # ---------- alarms ----------
    def alarms(self) -> list[Alarm]:
        return sorted(self._all(Alarm, Alarm.created_at), key=lambda a: (a.hour, a.minute))

    def alarm_create(self, data: dict) -> Alarm:
        from . import alarms as svc

        a = Alarm(id=uid("al"), user_id=self.uid, hour=int(data["hour"]), minute=int(data.get("minute") or 0),
                  days=sorted({int(d) for d in data.get("days") or [] if 0 <= int(d) <= 6}), label=(data.get("label") or "")[:120],
                  enabled=data.get("enabled", True) is not False, timezone=get_tz(data.get("timezone") or self.tz.key).key)
        a.next_at = svc.compute_next(a)
        self.db.add(a)
        self.db.flush()
        return a

    def alarm_update(self, id_: str, patch: dict) -> Alarm | None:
        from . import alarms as svc

        a = self._get(Alarm, id_)
        if not a:
            return None
        for k in ("hour", "minute", "label", "enabled"):
            if patch.get(k) is not None:
                setattr(a, k, patch[k])
        if patch.get("days") is not None:
            a.days = sorted({int(d) for d in patch["days"] if 0 <= int(d) <= 6})
        if any(k in patch for k in ("hour", "minute", "days", "enabled")):
            a.snooze_until = None
            a.next_at = svc.compute_next(a)
        a.updated_at = utcnow()
        self.db.flush()
        return a

    def alarm_delete(self, id_: str) -> bool:
        a = self._get(Alarm, id_)
        if not a:
            return False
        self.db.delete(a)
        self.db.flush()
        return True

    # ---------- proactive ----------
    def _suggestion_states(self) -> dict:
        return {s.suggestion_id: s for s in self.db.scalars(select(SuggestionState).where(SuggestionState.user_id == self.uid))}

    def set_suggestion_state(self, sid: str, status: str, until=None) -> None:
        st = self.db.get(SuggestionState, (self.uid, sid)) or SuggestionState(user_id=self.uid, suggestion_id=sid, status=status)
        st.status, st.until, st.at = status, until, utcnow()
        self.db.merge(st)
        self.db.flush()

    def proactive_suggestion(self) -> list[dict]:
        tz, now = self.tz, utcnow()
        tasks, people, memories = self.tasks(), self.people(), self.memories()
        by_id = {p.id: p for p in people}
        res = []
        for t in [t for t in tasks if not t.done and t.due_at and t.due_at < now][:2]:
            res.append({"id": f"sg_overdue_{t.id}", "kind": "overdue", "title": "Есть незавершённая задача",
                        "text": f"«{t.title}» — срок прошёл {fmt_ago(t.due_at, tz).lower()}. Перенести на завтра или отметить выполненной?",
                        "action": {"type": "reschedule_task", "taskId": t.id}, "actionLabel": "Перенести на завтра", "icon": "clock"})
        for t in [t for t in tasks if not t.done and t.person_id and t.due_at and now < t.due_at < now + timedelta(days=3)][:1]:
            p = by_id.get(t.person_id)
            res.append({"id": f"sg_person_{t.id}", "kind": "person",
                        "title": f"Ты собирался связаться: {p.name.split(' ')[0]}" if p else "Запланированный контакт",
                        "text": f"{t.title} — {fmt_date_time(t.due_at, tz)}.",
                        "action": {"type": "open", "route": f"#/person/{p.id}" if p else "#/tasks"}, "actionLabel": "Открыть", "icon": "users"})
        plan = next((m for m in memories if m.type in ("plan", "intention") and m.confirmed), None)
        if plan:
            res.append({"id": f"sg_plan_{plan.id}", "kind": "plan", "title": "Продолжим твой план?",
                        "text": f"Ты хотел: «{plan.title}». Могу разбить его на шаги и создать задачи.",
                        "action": {"type": "chat", "prompt": f"Помоги разбить план «{plan.title}» на шаги"}, "actionLabel": "Продолжить", "icon": "flag"})
        stale = next((p for p in people if now - p.updated_at > timedelta(days=14)), None)
        if stale:
            res.append({"id": f"sg_stale_{stale.id}", "kind": "network", "title": f"Давно не было контакта: {stale.name}",
                        "text": f"{stale.profession or 'Знакомый'}{', ' + stale.organization if stale.organization else ''}. Напомнить написать на этой неделе?",
                        "action": {"type": "create_task", "title": f"Написать {stale.name.split(' ')[0]}", "personId": stale.id},
                        "actionLabel": "Напомнить", "icon": "bell"})
        unconfirmed = sum(1 for m in memories if not m.confirmed)
        if unconfirmed:
            res.append({"id": f"sg_confirm_{unconfirmed}", "kind": "memory", "title": "Проверь, что я запомнил",
                        "text": f"{unconfirmed} {plural(unconfirmed, 'запись требует', 'записи требуют', 'записей требуют')} подтверждения.",
                        "action": {"type": "open", "route": "#/memory?filter=unconfirmed"}, "actionLabel": "Проверить", "icon": "memory"})
        if any(t.done for t in tasks) or len(memories) > 3:
            res.append({"id": "sg_report_week", "kind": "report", "title": "Могу подготовить отчёт",
                        "text": "Сводка за неделю на основе сохранённых данных: задачи, знакомства, планы.",
                        "action": {"type": "open", "route": "#/workspace/reports"}, "actionLabel": "Подготовить", "icon": "report"})
        states = self._suggestion_states()

        def visible(s):
            st = states.get(s["id"])
            return not st or (st.status == "snoozed" and st.until and st.until < now)

        return [s for s in res if visible(s)]

    # ---------- account ----------
    def wipe(self) -> None:
        from ..models import Agent, AgentRun, AuthSession, Conversation, Document, Message

        from ..models import PushSubscription

        for model in (AgentRun, Agent, Message, Conversation, Memory, Task, Event, Alarm, Document, SuggestionState, PushSubscription, Person, AuthSession):
            self.db.execute(delete(model).where(model.user_id == self.uid))
