"""Finance: money parsing, transactions, debts, summary, chat, reminders."""
from datetime import timedelta
from decimal import Decimal

import pytest

from adis.core.timeutil import iso, utcnow
from adis.db import SessionLocal
from adis.models import Debt
from adis.services import finance as fin
from adis.services import push, worker


@pytest.mark.parametrize("text,amount,currency", [
    ("Потратил 1200 на продукты", "1200", "RUB"), ("кофе за 350р", "350", "RUB"), ("заплатил 5 000 за интернет", "5000", "RUB"),
    ("такси 2,5к", "2500", "RUB"), ("зарплата 150 тыс", "150000", "RUB"), ("$50 на подписку", "50", "USD"), ("100 евро", "100", "EUR"),
    ("Дал Артёму 5000 до 25 декабря", "5000", "RUB"), ("в 10 заплатил 300 за проезд", "300", "RUB"), ("дал брату тысячу", "1000", "RUB"),
])
def test_parse_money(text, amount, currency):
    m = fin.parse_money(text)
    assert m["amount"] == Decimal(amount) and m["currency"] == currency


def test_parse_money_ignores_dates_and_times():
    assert fin.parse_money("встреча в 15:30 до 25 декабря") is None
    assert fin.parse_money("отдал маме долг") is None


def test_counterparty_and_formatting():
    assert [fin.extract_counterparty(t) for t in ["Дал Артёму 5000", "Занял у Дмитрия 10000", "взял в долг у мамы 2к", "я должен Игорю 700",
                                                  "купил продукты у дома"]] == ["Артём", "Дмитрий", "Мама", "Игорь", None]
    assert fin.dative("Дмитрий") == "Дмитрию" and fin.dative("Мама") == "Маме" and fin.dative("Мария") == "Марии" and fin.dative("Артём") == "Артёму"
    assert fin.money(12500.5) == "12\u00a0500,50\u00a0₽" and fin.money(50, "USD") == "$50"


def chat(client, auth, text):
    return client.post("/v1/chat/messages", json={"content": text}, headers=auth).json()["assistantMessage"]


def test_transactions_and_summary(client, auth):
    for text in ("Потратил 1200 на продукты", "купил кофе за 350р", "Получил зарплату 150 тыс"):
        c = chat(client, auth, text)["cards"][0]
        assert c["type"] == "finance_tx" and c["status"] == "pending"
        assert client.post("/v1/finance/transactions", json=c["data"], headers=auth).status_code == 200
    s = client.get("/v1/finance/summary", headers=auth).json()
    assert s["totals"] == [{"currency": "RUB", "income": 150000.0, "expense": 1550.0, "balance": 148450.0}]
    assert s["byCategory"][0] == {"currency": "RUB", "category": "Продукты", "amount": 1200.0}
    a = chat(client, auth, "Сколько я потратил в этом месяце?")
    assert "1\u00a0550\u00a0₽" in a["content"] and "Продукты" in a["content"]
    assert "1\u00a0200" in chat(client, auth, "Сколько я потратил на продукты?")["content"]
    assert "148\u00a0450" in chat(client, auth, "Какой у меня баланс за месяц?")["content"]
    txs = client.get("/v1/finance/transactions", params={"kind": "expense"}, headers=auth).json()
    assert len(txs) == 2
    t = client.patch(f"/v1/finance/transactions/{txs[0]['id']}", json={"amount": 400, "category": "Кафе и рестораны"}, headers=auth).json()
    assert t["amount"] == 400.0
    assert client.delete(f"/v1/finance/transactions/{t['id']}", headers=auth).json() == {"ok": True}
    assert client.post("/v1/finance/transactions", json={"kind": "expense", "amount": -5}, headers=auth).status_code == 422
    assert client.get("/v1/finance/summary", params={"month": "2026-13"}, headers=auth).status_code == 422


def test_debts_flow(client, auth):
    client.post("/v1/people", json={"name": "Артём"}, headers=auth)
    lent = chat(client, auth, "Дал Артёму 5000 до 25 декабря")["cards"][0]
    assert lent["type"] == "debt_create" and lent["data"]["direction"] == "lent" and lent["data"]["personId"] and lent["data"]["dueAt"]
    d1 = client.post("/v1/finance/debts", json=lent["data"], headers=auth).json()
    borrowed = chat(client, auth, "Занял у Дмитрия 10000")
    assert "Дмитрию" in borrowed["content"] and borrowed["cards"][0]["data"]["direction"] == "borrowed"
    client.post("/v1/finance/debts", json=borrowed["cards"][0]["data"], headers=auth)

    rep = chat(client, auth, "Артём вернул 2000")["cards"][0]
    assert rep["type"] == "debt_repay" and rep["data"]["debtId"] == d1["id"] and rep["data"]["amount"] == 2000 and not rep["data"]["full"]
    d = client.post(f"/v1/finance/debts/{d1['id']}/repay", json={"amount": rep["data"]["amount"]}, headers=auth).json()
    assert d["left"] == 3000 and d["status"] == "open" and len(d["payments"]) == 1

    owed = chat(client, auth, "кто мне должен?")["content"]
    assert "Артём" in owed and "3\u00a0000" in owed and "Дмитрий" not in owed
    assert "Дмитрий" in chat(client, auth, "кому я должен")["content"]

    full = chat(client, auth, "я вернул Дмитрию долг")["cards"][0]
    assert full["data"]["full"] is True
    closed = client.post(f"/v1/finance/debts/{full['data']['debtId']}/repay", json={}, headers=auth).json()
    assert closed["status"] == "closed" and closed["left"] == 0
    assert [x["counterparty"] for x in client.get("/v1/finance/debts", params={"status": "open"}, headers=auth).json()] == ["Артём"]
    s = client.get("/v1/finance/summary", headers=auth).json()
    assert s["debts"] == [{"currency": "RUB", "owedToMe": 3000.0, "iOwe": 0.0}]
    assert client.post("/v1/finance/debts", json={"direction": "lent", "amount": 10}, headers=auth).status_code == 422


def test_debt_reminder_and_suggestion(client, auth, monkeypatch):
    sent = []
    monkeypatch.setattr(push, "SENDER", lambda sub, payload, ttl, urgency: sent.append(payload) or 201)
    client.post("/v1/push/subscriptions", json={"endpoint": "https://push.example.com/fin", "keys": {"p256dh": "a", "auth": "b"}}, headers=auth)
    d = client.post("/v1/finance/debts", json={"direction": "lent", "amount": 700, "counterparty": "Игорь",
                                               "dueAt": iso(utcnow() - timedelta(minutes=5))}, headers=auth).json()
    assert d["overdue"] is True
    worker.tick()
    assert any(p["body"] == "Игорь должен вернуть 700\u00a0₽" for p in sent)
    sent.clear()
    worker.tick()
    assert not [p for p in sent if "Игорь" in p["body"]]
    with SessionLocal() as db:
        assert db.get(Debt, d["id"]).notified_at is not None
    kinds = [s["kind"] for s in client.get("/v1/proactive/suggestions", headers=auth).json()]
    assert "debt" in kinds


def test_demo_has_finance(client):
    a = client.post("/v1/auth/login", json={"email": "demo@adis.app", "password": "x", "demo": True}).json()
    h = {"Authorization": f"Bearer {a['accessToken']}"}
    s = client.get("/v1/finance/summary", headers=h).json()
    assert s["totals"][0]["income"] == 205000.0 and s["debts"][0]["owedToMe"] == 3000.0
    exp = client.get("/v1/users/me/export", headers=h).json()["data"]
    assert len(exp["transactions"]) == 10 and len(exp["debts"]) == 2
