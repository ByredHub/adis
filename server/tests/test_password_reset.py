"""Password recovery: reset link by email, one-time use, sessions revoked."""
import re

import pytest

from adis.config import settings
from adis.services import mail


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_from", "noreply@adis.test")
    monkeypatch.setattr(mail, "deliver", lambda to, subject, text, html=None: sent.append({"to": to, "subject": subject, "text": text}))
    return sent


def _register(client, email):
    r = client.post("/v1/auth/register", json={"name": "Мария", "email": email, "password": "oldpassword1"})
    assert r.status_code == 200
    return r.json()


def test_forgot_without_smtp_explains(client):
    r = client.post("/v1/auth/password/forgot", json={"email": "nobody@example.com"})
    assert r.status_code == 200 and "не настроена" in r.json()["demoNote"]


def test_reset_flow(client, outbox):
    email = "reset-flow@example.com"
    session = _register(client, email)
    assert client.post("/v1/auth/password/forgot", json={"email": email}).json() == {"ok": True}
    # unknown email: same answer, no mail
    assert client.post("/v1/auth/password/forgot", json={"email": "ghost@example.com"}).json() == {"ok": True}
    assert len(outbox) == 1 and outbox[0]["to"] == email
    token = re.search(r"#/reset\?token=(\S+)", outbox[0]["text"]).group(1)

    assert client.post("/v1/auth/password/reset", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/v1/auth/password/reset", json={"token": token, "password": "newpassword1"}).status_code == 200
    # one-time: the same link no longer works
    assert client.post("/v1/auth/password/reset", json={"token": token, "password": "another123"}).status_code == 400
    # old sessions are signed out, new password works, old one doesn't
    assert client.get("/v1/users/me", headers={"Authorization": f"Bearer {session['accessToken']}"}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": email, "password": "oldpassword1"}).status_code == 401
    assert client.post("/v1/auth/login", json={"email": email, "password": "newpassword1"}).status_code == 200


def test_reset_rejects_forged_and_expired(client, outbox):
    _register(client, "forged@example.com")
    assert client.post("/v1/auth/password/reset", json={"token": "abc.def", "password": "newpassword1"}).status_code == 400
    token = mail.reset_token("u_x", "hash", now=0)  # expired long ago
    assert mail.read_reset_token(token) is None
    body, _ = mail.reset_token("u_x", "hash").split(".")
    assert mail.read_reset_token(body + ".AAAA") is None


def test_forgot_is_rate_limited(client, outbox):
    email = "limit@example.com"
    _register(client, email)
    for _ in range(5):
        client.post("/v1/auth/password/forgot", json={"email": email})
    assert len(outbox) == 3
