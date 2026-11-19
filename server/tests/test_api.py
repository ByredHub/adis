import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from conftest import TZ


def sse(client, headers, body):
    events = []
    with client.stream("POST", "/v1/chat/stream", json=body, headers=headers) as r:
        assert r.status_code == 200, r.read()
        for line in r.iter_lines():
            if line.startswith("data:"):
                events.append(json.loads(line[5:]))
    return events


def test_health(client):
    r = client.get("/v1/health")
    assert r.json()["status"] == "ok" and r.json()["engine"] == "rules"


def test_auth_flow(client):
    body = {"name": "Анна", "email": "Anna@Example.com", "password": "secret-pass"}
    r = client.post("/v1/auth/register", json=body)
    assert r.status_code == 200
    tokens = r.json()
    assert tokens["user"]["email"] == "anna@example.com"
    assert client.post("/v1/auth/register", json=body).status_code == 409
    assert client.post("/v1/auth/register", json={**body, "email": "x@y.z", "password": "short"}).status_code == 422

    bad = client.post("/v1/auth/login", json={"email": "anna@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Неверный email или пароль"
    r = client.post("/v1/auth/login", json={"email": "anna@example.com", "password": "secret-pass"})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['accessToken']}"}
    assert client.get("/v1/users/me", headers=h).json()["name"] == "Анна"
    assert client.get("/v1/users/me").status_code == 401

    # refresh is one-time
    rt = r.json()["refreshToken"]
    r2 = client.post("/v1/auth/refresh", json={"refreshToken": rt})
    assert r2.status_code == 200
    assert client.post("/v1/auth/refresh", json={"refreshToken": rt}).status_code == 401
    assert client.get("/v1/users/me", headers=h).status_code == 401  # old access token rotated out
    h2 = {"Authorization": f"Bearer {r2.json()['accessToken']}"}
    devices = client.get("/v1/users/me/devices", headers=h2).json()
    assert any(d["current"] and d["name"] == "iPhone · Safari" for d in devices)

    assert client.post("/v1/auth/logout", json={"refreshToken": r2.json()["refreshToken"]}, headers=h2).status_code == 200
    assert client.get("/v1/users/me", headers=h2).status_code == 401


def test_login_rate_limit(client):
    client.post("/v1/auth/register", json={"name": "Бот", "email": "rl@example.com", "password": "password123"})
    codes = [client.post("/v1/auth/login", json={"email": "rl@example.com", "password": "nope-nope"}).status_code for _ in range(11)]
    assert codes[-1] == 429


def test_tz_scenario(client, auth):
    """TZ §2: introduce Artem -> find him a month later -> reminder linked to him."""
    ev = sse(client, auth, {"content": "Сегодня познакомился с Артёмом. Он программист, работает с Python и занимается разработкой сайтов",
                            "clientMessageId": "m1"})
    types = [e["type"] for e in ev]
    assert types[0] == "start" and "delta" in types and types[-1] == "done"
    msg = ev[-1]["message"]
    assert msg["engine"] == "rules"
    card = msg["cards"][0]
    assert card["type"] == "memory_save" and card["status"] == "pending"
    person = card["data"]["person"]
    assert person["name"] == "Артём" and person["profession"] == "Программист" and "Python" in person["skills"]

    # client confirms the card through the regular API
    p = client.post("/v1/people", json=person, headers=auth).json()
    m = client.post("/v1/memory", json={**card["data"]["memory"], "personId": p["id"], "source": {"kind": "chat"}}, headers=auth).json()
    conv_id = ev[0]["conversation"]["id"]
    r = client.patch(f"/v1/chat/conversations/{conv_id}/messages/{msg['id']}/cards/{card['id']}",
                     json={"status": "confirmed", "result": {"personId": p["id"], "memoryId": m["id"]}}, headers=auth)
    assert r.json()["status"] == "confirmed"

    # duplicate submit is rejected
    dup = client.post("/v1/chat/messages", json={"conversationId": conv_id, "content": "повтор", "clientMessageId": "m1"}, headers=auth)
    assert dup.status_code == 409

    r = client.post("/v1/chat/messages", json={"content": "С кем я недавно познакомился из программистов?"}, headers=auth).json()
    a = r["assistantMessage"]
    assert "Артём" in a["content"] and a["cards"][0] == {**a["cards"][0], "type": "people", "data": {"ids": [p["id"]]}}

    r = client.post("/v1/chat/messages", json={"content": "Напомни завтра в 10 позвонить Артёму"}, headers=auth).json()
    data = r["assistantMessage"]["cards"][0]["data"]
    assert data["personId"] == p["id"] and data["title"] == "Позвонить Артёму"
    due = datetime.fromisoformat(data["dueAt"].replace("Z", "+00:00")).astimezone(ZoneInfo(TZ))
    assert (due.hour, due.minute) == (10, 0) and due.date() == (datetime.now(ZoneInfo(TZ)) + timedelta(days=1)).date()

    t = client.post("/v1/tasks", json={"title": data["title"], "dueAt": data["dueAt"], "personId": p["id"]}, headers=auth).json()
    assert t["status"] == "active" and t["notifyAt"] == data["dueAt"]

    convs = client.get("/v1/chat/conversations", headers=auth).json()
    assert len(convs) == 3
    full = client.get(f"/v1/chat/conversations/{conv_id}", headers=auth).json()
    assert [x["role"] for x in full["messages"]] == ["user", "assistant"]


def test_user_isolation(client, auth):
    m = client.post("/v1/memory", json={"content": "Секретная заметка"}, headers=auth).json()
    r = client.post("/v1/auth/register", json={"name": "Чужой", "email": "other@example.com", "password": "password123"})
    other = {"Authorization": f"Bearer {r.json()['accessToken']}"}
    assert client.patch(f"/v1/memory/{m['id']}", json={"title": "x"}, headers=other).status_code == 404
    assert client.delete(f"/v1/memory/{m['id']}", headers=other).status_code == 404
    assert client.get("/v1/memory", headers=other).json() == []
    # cannot attach someone else's person to own task
    p = client.post("/v1/people", json={"name": "Пётр"}, headers=auth).json()
    t = client.post("/v1/tasks", json={"title": "x", "personId": p["id"]}, headers=other).json()
    assert t["personId"] is None


def test_memory_crud_and_search(client, auth):
    m = client.post("/v1/memory", json={"type": "preference", "content": "Люблю зелёный чай без сахара", "tags": ["чай"]}, headers=auth).json()
    assert m["title"] == "Люблю зелёный чай без сахара"
    assert client.get("/v1/memory/search", params={"q": "зелёный чай"}, headers=auth).json()[0]["id"] == m["id"]
    u = client.patch(f"/v1/memory/{m['id']}", json={"confirmed": False, "title": "Чай"}, headers=auth).json()
    assert u["title"] == "Чай" and not u["confirmed"]
    assert client.get("/v1/memory", params={"type": "preference"}, headers=auth).json()[0]["id"] == m["id"]
    assert client.delete(f"/v1/memory/{m['id']}", headers=auth).json() == {"ok": True}
    assert client.get("/v1/memory/search", params={"q": "чай"}, headers=auth).json() == []


def test_people_merge_and_delete(client, auth):
    p = client.post("/v1/people", json={"name": "Ольга", "skills": ["SQL"]}, headers=auth).json()
    p2 = client.post("/v1/people", json={"id": p["id"], "skills": ["Excel"], "interaction": "Созвонились"}, headers=auth).json()
    assert p2["id"] == p["id"] and p2["skills"] == ["SQL", "Excel"] and p2["interactions"][0]["text"] == "Созвонились"
    t = client.post("/v1/tasks", json={"title": "Написать Ольге", "personId": p["id"]}, headers=auth).json()
    assert client.delete(f"/v1/people/{p['id']}", headers=auth).status_code == 200
    assert next(x for x in client.get("/v1/tasks", headers=auth).json() if x["id"] == t["id"])["personId"] is None


def test_repeating_task(client, auth):
    due = (datetime.now(ZoneInfo(TZ)) + timedelta(hours=2)).isoformat()
    t = client.post("/v1/tasks", json={"title": "Зарядка", "dueAt": due, "repeat": "daily"}, headers=auth).json()
    done = client.patch(f"/v1/tasks/{t['id']}", json={"done": True}, headers=auth).json()
    assert done["status"] == "done" and done["repeat"] == "none"
    nxt = [x for x in client.get("/v1/tasks", headers=auth).json() if x["title"] == "Зарядка" and not x["done"]]
    assert len(nxt) == 1 and nxt[0]["repeat"] == "daily"
    moved = client.patch(f"/v1/tasks/{nxt[0]['id']}", json={"dueAt": "2020-01-01T10:00:00Z"}, headers=auth).json()
    assert moved["status"] == "overdue"


def test_sensitive_not_saved(client, auth):
    r = client.post("/v1/chat/messages", json={"content": "Запомни мой пароль от почты qwerty123", "autoSave": True}, headers=auth).json()
    card = r["assistantMessage"]["cards"][0]
    assert card["status"] == "pending" and card["data"]["sensitive"] is True
    assert client.get("/v1/memory", headers=auth).json() == []


def test_demo_login_is_isolated(client):
    a = client.post("/v1/auth/login", json={"email": "demo@adis.app", "password": "x", "demo": True}).json()
    b = client.post("/v1/auth/login", json={"email": "demo@adis.app", "password": "x", "demo": True}).json()
    assert a["user"]["id"] != b["user"]["id"] and a["user"]["demo"]
    h = {"Authorization": f"Bearer {a['accessToken']}"}
    assert len(client.get("/v1/people", headers=h).json()) == 3
    assert {s["kind"] for s in client.get("/v1/proactive/suggestions", headers=h).json()} >= {"overdue", "plan", "memory"}
    sug = next(s for s in client.get("/v1/proactive/suggestions", headers=h).json() if s["kind"] == "overdue")
    res = client.post(f"/v1/proactive/{sug['id']}/accept", headers=h).json()
    assert res["result"]["status"] == "active"
    assert sug["id"] not in [s["id"] for s in client.get("/v1/proactive/suggestions", headers=h).json()]
    agents = client.get("/v1/agents", headers=h).json()
    run = client.post(f"/v1/agents/{agents[0]['id']}/runs", headers=h).json()
    assert run["status"] == "completed" and run["result"].startswith("## План на")
    assert len(client.get(f"/v1/agents/{agents[0]['id']}/runs", headers=h).json()) == 1
    assert len(client.get("/v1/events", headers=h).json()) == 3
    exp = client.get("/v1/users/me/export", headers=h).json()
    assert len(exp["data"]["memories"]) == 8 and len(exp["data"]["agents"]) == 4


def test_delete_account(client):
    r = client.post("/v1/auth/register", json={"name": "Удаляемый", "email": "del@example.com", "password": "password123"}).json()
    h = {"Authorization": f"Bearer {r['accessToken']}"}
    client.post("/v1/memory", json={"content": "x"}, headers=h)
    client.post("/v1/chat/messages", json={"content": "привет"}, headers=h)
    assert client.delete("/v1/users/me", headers=h).status_code == 200
    assert client.get("/v1/users/me", headers=h).status_code == 401
    assert client.post("/v1/auth/login", json={"email": "del@example.com", "password": "password123"}).status_code == 401


def test_validation_message(client, auth):
    r = client.post("/v1/tasks", json={"title": "x", "dueAt": "не дата"}, headers=auth)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)


def test_phone_numbers_are_contacts_not_secrets(client, auth):
    client.post("/v1/people", json={"name": "Артём"}, headers=auth)
    for text in ("Запомни номер Артёма +7 999 123-45-67", "Запомни телефон мамы 9161234567"):
        card = client.post("/v1/chat/messages", json={"content": text}, headers=auth).json()["assistantMessage"]["cards"][0]
        assert card["type"] == "memory_save" and card["data"]["sensitive"] is False
        client.post("/v1/memory", json=card["data"]["memory"], headers=auth)
    a = client.post("/v1/chat/messages", json={"content": "Какой номер у Артёма?"}, headers=auth).json()["assistantMessage"]
    assert "+7 999 123-45-67" in a["content"]
    p = client.post("/v1/chat/messages", json={"content": "Запомни номер паспорта 4510 123456"}, headers=auth).json()["assistantMessage"]
    assert p["cards"][0]["data"]["sensitive"] is True


def test_about(client, auth):
    a = client.post("/v1/chat/messages", json={"content": "кто ты"}, headers=auth).json()["assistantMessage"]
    assert "помощник с памятью" in a["content"]
