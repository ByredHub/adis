"""Password-reset links and outgoing email over SMTP (any provider: Yandex, Mail.ru, Gmail, Unisender, SendGrid, ...).

Reset tokens are stateless and signed (HMAC-SHA256). They carry the user id, an expiry and a fingerprint of the current
password hash, so a link stops working once it was used (the password changed) or after RESET_TTL.
"""
from __future__ import annotations

import base64
import html as _html
import hashlib
import hmac
import json
import logging
import secrets
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage

from ..config import ROOT, settings

log = logging.getLogger("adis.mail")
RESET_TTL = 3600
KEY_FILE = ROOT / "data" / "secret.key"
_key: bytes | None = None


def secret_key() -> bytes:
    global _key
    if _key is None:
        if settings.secret_key_override:
            _key = settings.secret_key_override.encode()
        elif KEY_FILE.exists():
            _key = KEY_FILE.read_text(encoding="utf-8").strip().encode()
        else:
            KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
            KEY_FILE.write_text(secrets.token_urlsafe(48), encoding="utf-8")
            _key = KEY_FILE.read_text(encoding="utf-8").strip().encode()
    return _key


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _fingerprint(pass_hash: str) -> str:
    return hashlib.sha256(pass_hash.encode()).hexdigest()[:16]


def _sign(body: str) -> str:
    return _b64(hmac.new(secret_key(), body.encode(), hashlib.sha256).digest())


def reset_token(user_id: str, pass_hash: str, now: float | None = None) -> str:
    body = _b64(json.dumps({"u": user_id, "e": int((time.time() if now is None else now) + RESET_TTL), "h": _fingerprint(pass_hash)}).encode())
    return f"{body}.{_sign(body)}"


def read_reset_token(token: str) -> dict | None:
    """Returns {"u": user_id, "h": fingerprint} for a valid, unexpired token; the caller checks the fingerprint."""
    try:
        body, sig = (token or "").strip().split(".")
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        data = json.loads(_unb64(body))
        return data if data.get("e", 0) > time.time() else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def fingerprint_matches(data: dict, pass_hash: str) -> bool:
    return hmac.compare_digest(str(data.get("h", "")), _fingerprint(pass_hash))


def send(to: str, subject: str, text: str, html: str | None = None) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    if settings.smtp_security == "ssl":
        server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20, context=ctx)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
    with server:
        if settings.smtp_security == "starttls":
            server.starttls(context=ctx)
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


# Tests replace this to capture mail instead of sending it
def deliver(to: str, subject: str, text: str, html: str | None = None) -> None:
    def job():
        try:
            send(to, subject, text, html)
        except Exception as e:  # noqa: BLE001 — never fail the request because of the mail provider
            log.warning("Mail to %s failed: %s", to.split("@")[-1], type(e).__name__)

    threading.Thread(target=job, daemon=True).start()


def send_reset(to: str, name: str, link: str) -> None:
    text = (f"Здравствуйте, {name}!\n\nЧтобы задать новый пароль в Adis, откройте ссылку (она действует 1 час):\n{link}\n\n"
            "Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.")
    html = (f"<p>Здравствуйте, {_html.escape(name)}!</p><p>Чтобы задать новый пароль в Adis, нажмите на кнопку. Ссылка действует 1 час.</p>"
            f'<p><a href="{_html.escape(link)}" style="display:inline-block;padding:12px 20px;background:#5b5bd6;color:#fff;border-radius:10px;'
            f'text-decoration:none">Задать новый пароль</a></p><p style="color:#888">Если вы не запрашивали сброс пароля, '
            "просто проигнорируйте это письмо.</p>")
    deliver(to, "Восстановление пароля Adis", text, html)
