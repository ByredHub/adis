"""Alarms, push delivery worker, calendar from chat, iCal feed and import."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from adis.core.timeutil import parse_iso, utcnow
from adis.db import SessionLocal
from adis.models import Alarm, Event, Task
from adis.services import push, worker
from conftest import TZ

Z = ZoneInfo(TZ)


def local(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(Z)


@pytest.fixture
def sent(monkeypatch):
    log = []

    def fake(sub, payload, ttl, urgency):
        log.append({"endpoint": sub.endpoint, "payload": payload, "urgency": urgency})
        return 410 if "dead" in sub.endpoint else 201

    monkeypatch.setattr(push, "SENDER", fake)
    return log


def subscribe(client, auth, endpoint="https://push.example.com/sub/1"):
    r = client.post("/v1/push/subscriptions", json={"endpoint": endpoint, "keys": {"p256dh": "BPk", "auth": "a1"}}, headers=auth)
    assert r.status_code == 200, r.text


def test_vapid_key(client):
    key = client.get("/v1/push/vapid-key").json()["publicKey"]
    assert len(key) == 87  # 65-byte uncompressed P-256 point, base64url


def test_push_subscribe_and_test(client, auth, sent):
    assert client.post("/v1/push/test", headers=auth).status_code == 404
    subscribe(client, auth)
    subscribe(client, auth, "https://push.example.com/dead")
    r = client.post("/v1/push/test", headers=auth)
    assert r.json()["delivered"] == 1 and len(sent) == 2
    sent.clear()
    client.post("/v1/push/test", headers=auth)
    assert len(sent) == 1  # dead (410) subscription was removed
    assert client.post("/v1/push/subscriptions", json={"endpoint": "http://x", "keys": {"p256dh": "a", "auth": "b"}}, headers=auth).status_code == 422


def test_alarm_schedule(client, auth):
    now = datetime.now(Z)
    a = client.post("/v1/alarms", json={"hour": 7, "minute": 30, "days": [1, 2, 3, 4, 5], "label": "Подъём"}, headers=auth).json()
    nxt = local(a["nextAt"])
    assert (nxt.hour, nxt.minute) == (7, 30) and nxt.isoweekday() <= 5 and nxt > now and a["daysLabel"] == "По будням"
    once = client.post("/v1/alarms", json={"hour": now.hour, "minute": now.minute}, headers=auth).json()
    assert local(once["nextAt"]).date() == (now + timedelta(days=1)).date()  # this minute already passed -> tomorrow
    off = client.patch(f"/v1/alarms/{a['id']}", json={"enabled": False}, headers=auth).json()
    assert off["nextAt"] is None
    assert [x["time"] for x in client.get("/v1/alarms", headers=auth).json()] == sorted([a["time"], once["time"]])
    assert client.delete(f"/v1/alarms/{a['id']}", headers=auth).json() == {"ok": True}


def test_worker_delivers_and_alarm_rings(client, auth, sent):
    subscribe(client, auth, "https://push.example.com/sub/worker")
    past = (utcnow() - timedelta(minutes=1)).isoformat() + "Z"
    t = client.post("/v1/tasks", json={"title": "Позвонить маме", "dueAt": past}, headers=auth).json()
    soon = (datetime.now(Z) + timedelta(minutes=10)).isoformat()
    e = client.post("/v1/events", json={"title": "Созвон", "startAt": soon, "remindMinutes": 15}, headers=auth).json()
    a = client.post("/v1/alarms", json={"hour": 7, "minute": 0, "days": [0, 1, 2, 3, 4, 5, 6]}, headers=auth).json()
    with SessionLocal() as db:  # make the alarm due now
        al = db.get(Alarm, a["id"])
        al.next_at = utcnow() - timedelta(seconds=5)
        db.commit()

    res = worker.tick()
    assert res["tasks"] >= 1 and res["events"] >= 1 and res["alarms"] >= 1
    titles = [s["payload"]["title"] for s in sent if s["endpoint"].endswith("worker")]
    assert "Напоминание" in titles and "Скоро: Созвон" in titles and "Будильник 07:00" in titles
    assert next(s for s in sent if s["payload"].get("alarm"))["urgency"] == "high"

    sent.clear()
    worker.tick()
    assert not [s for s in sent if s["endpoint"].endswith("worker")]  # nothing is sent twice

    ringing = next(x for x in client.get("/v1/alarms", headers=auth).json() if x["id"] == a["id"])
    assert ringing["ringing"] and local(ringing["nextAt"]) > datetime.now(Z)
    snoozed = client.post(f"/v1/alarms/{a['id']}/snooze", json={"minutes": 10}, headers=auth).json()
    assert not snoozed["ringing"] and abs((parse_iso(snoozed["nextAt"]) - utcnow()).total_seconds() - 600) < 5
    with SessionLocal() as db:
        assert db.get(Task, t["id"]).notified_at is not None
        assert db.get(Event, e["id"]).notified_start is not None


def test_one_time_alarm_turns_off(client, auth):
    a = client.post("/v1/alarms", json={"hour": 6, "minute": 0}, headers=auth).json()
    with SessionLocal() as db:
        db.get(Alarm, a["id"]).next_at = utcnow() - timedelta(seconds=1)
        db.commit()
    r = client.post(f"/v1/alarms/{a['id']}/dismiss", headers=auth).json()  # app rang it before the worker
    assert r["enabled"] is False and r["ringing"] is False and r["nextAt"] is None


def chat(client, auth, text):
    return client.post("/v1/chat/messages", json={"content": text}, headers=auth).json()["assistantMessage"]


def test_event_from_chat(client, auth):
    client.post("/v1/people", json={"name": "Мария Ковалёва", "profession": "Дизайнер"}, headers=auth)
    m = chat(client, auth, "Встреча с Марией завтра с 15 до 16:30 в офисе на Тверской")
    c = m["cards"][0]
    assert c["type"] == "event_create" and c["status"] == "pending"
    d = c["data"]
    start, end = local(d["startAt"]), local(d["endAt"])
    assert (start.hour, end.hour, end.minute) == (15, 16, 30) and d["location"] == "В офисе на Тверской" and d["personName"] == "Мария Ковалёва"
    ev = client.post("/v1/events", json={"title": d["title"], "startAt": d["startAt"], "endAt": d["endAt"], "location": d["location"],
                                         "personId": d["personId"]}, headers=auth).json()
    assert ev["personId"] == d["personId"]

    # conflict warning
    m = chat(client, auth, "Созвон с командой завтра в 15:30")
    assert m["cards"][0]["data"]["conflicts"] == ["Встреча с Марией"] and "уже есть" in m["content"]

    m = chat(client, auth, "Что у меня завтра?")
    assert "Встреча с Марией" in m["content"]
    m = chat(client, auth, "Когда встреча с Марией?")
    assert "Встреча с Марией" in m["content"]

    m = chat(client, auth, "Перенеси встречу с Марией на 17:00")
    d = m["cards"][0]["data"]
    assert m["cards"][0]["type"] == "event_update" and d["eventId"] == ev["id"]
    assert (local(d["startAt"]).hour, local(d["endAt"]).hour, local(d["endAt"]).minute) == (17, 18, 30)
    assert local(d["startAt"]).date() == local(ev["startAt"]).date()

    m = chat(client, auth, "Отмени встречу с Марией")
    assert m["cards"][0]["data"] == {**m["cards"][0]["data"], "eventId": ev["id"], "cancel": True}


def test_alarm_from_chat(client, auth):
    m = chat(client, auth, "Поставь будильник на 7:30 по будням — зарядка")
    d = m["cards"][0]["data"]
    assert m["cards"][0]["type"] == "alarm_set" and (d["hour"], d["minute"], d["days"], d["label"]) == (7, 30, [1, 2, 3, 4, 5], "Зарядка")
    a = client.post("/v1/alarms", json=d, headers=auth).json()
    m = chat(client, auth, "Какие у меня будильники?")
    assert "07:30" in m["content"]
    m = chat(client, auth, "Выключи будильник на 7:30")
    assert m["cards"][0]["data"]["alarmId"] == a["id"]


def test_ics_feed_and_import(client, auth):
    client.post("/v1/events", json={"title": "Ужин; с друзьями, в 8", "startAt": (datetime.now(Z) + timedelta(days=1)).isoformat(),
                                    "remindMinutes": 30, "notes": "Строка 1\nСтрока 2"}, headers=auth)
    assert client.get("/v1/calendar/feed", headers=auth).json() == {"enabled": False}
    info = client.post("/v1/calendar/feed", headers=auth).json()
    assert info["enabled"] and info["webcal"].startswith("webcal://") and info["public"] is False
    path = info["url"].split("testserver", 1)[1]
    r = client.get(path, headers={"Authorization": ""})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert "SUMMARY:Ужин\\; с друзьями\\, в 8" in body and "TRIGGER:-PT30M" in body and "DESCRIPTION:Строка 1\\nСтрока 2" in body
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))
    rotated = client.post("/v1/calendar/feed", headers=auth).json()
    assert client.get(path).status_code == 404 and rotated["url"] != info["url"]

    ics = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:abc-1@google.com\r\nDTSTART;TZID=Europe/Moscow:20261201T100000\r\n"
           "DTEND;TZID=Europe/Moscow:20261201T113000\r\nSUMMARY:Стоматолог\r\nLOCATION:Клиника\\, 2 этаж\r\nRRULE:FREQ=MONTHLY\r\n"
           "BEGIN:VALARM\r\nTRIGGER:-PT1H\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nUID:abc-2\r\nDTSTART;VALUE=DATE:20261225\r\nSUMMARY:Рождество — длинное название, которое\r\n  переносится\r\nEND:VEVENT\r\n"
           "BEGIN:VEVENT\r\nUID:abc-3\r\nDTSTART:20261202T090000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
    r = client.post("/v1/calendar/import", json={"ics": ics}, headers=auth).json()
    assert (r["created"], r["skipped"], r["recurring"]) == (2, 1, 1)
    evs = {e["title"]: e for e in client.get("/v1/events", headers=auth).json()}
    st = evs["Стоматолог"]
    assert local(st["startAt"]).hour == 10 and local(st["endAt"]).minute == 30 and st["location"] == "Клиника, 2 этаж" and st["remindMinutes"] == 60
    assert "Рождество — длинное название, которое переносится" in evs
    again = client.post("/v1/calendar/import", json={"ics": ics}, headers=auth).json()
    assert (again["created"], again["updated"]) == (0, 2)
    assert client.post("/v1/calendar/import", json={"ics": "hello"}, headers=auth).status_code == 422
