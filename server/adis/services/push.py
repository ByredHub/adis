"""Web Push delivery (VAPID, RFC 8030/8291). Works for installed PWAs on Android and iOS 16.4+, and desktop browsers.

Keys come from ADIS_VAPID_* or are generated once into server/data/vapid.json (keep that file secret and stable:
rotating the key invalidates every existing subscription).
"""
from __future__ import annotations

import base64
import json
import logging
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import ROOT, settings
from ..core.security import token_hash
from ..core.textutil import uid
from ..core.timeutil import utcnow
from ..models import PushSubscription

log = logging.getLogger("adis.push")
KEY_FILE = ROOT / "data" / "vapid.json"


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


@lru_cache(maxsize=1)
def keys() -> dict:
    """{'private_pem': str, 'public': base64url uncompressed P-256 point (applicationServerKey)}"""
    if settings.vapid_private_key and settings.vapid_public_key:
        pem = settings.vapid_private_key.replace("\\n", "\n")
        return {"private_pem": pem, "public": settings.vapid_public_key}
    if KEY_FILE.exists():
        return json.loads(KEY_FILE.read_text(encoding="utf-8"))
    priv = ec.generate_private_key(ec.SECP256R1())
    data = {
        "private_pem": priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode(),
        "public": _b64url(priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
    }
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(json.dumps(data), encoding="utf-8")
    log.info("Generated VAPID keys in %s", KEY_FILE)
    return data


def _vapid():
    from py_vapid import Vapid

    return Vapid.from_pem(keys()["private_pem"].encode())


def _send_webpush(sub: PushSubscription, payload: dict, ttl: int, urgency: str) -> int:
    """Returns HTTP status from the push service. Replaced in tests."""
    from pywebpush import WebPushException, webpush

    try:
        res = webpush({"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}, data=json.dumps(payload, ensure_ascii=False),
                      vapid_private_key=_vapid(), vapid_claims={"sub": settings.vapid_subject}, ttl=ttl, timeout=10,
                      headers={"Urgency": urgency})
        return res.status_code
    except WebPushException as e:
        return e.response.status_code if e.response is not None else 0
    except Exception as e:  # network errors
        log.warning("push transport error: %s", type(e).__name__)
        return 0


SENDER = _send_webpush


def subscribe(db: Session, user_id: str, endpoint: str, p256dh: str, auth: str, device: str) -> PushSubscription:
    h = token_hash(endpoint)
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint_hash == h))
    if sub is None:
        sub = PushSubscription(id=uid("ps"), endpoint_hash=h, endpoint=endpoint)
        db.add(sub)
    # the same browser may switch accounts: the subscription follows the latest signed-in user
    sub.user_id, sub.p256dh, sub.auth, sub.device, sub.failures = user_id, p256dh, auth, device[:120], 0
    db.flush()
    return sub


def unsubscribe(db: Session, user_id: str, endpoint: str) -> bool:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint_hash == token_hash(endpoint)))
    if sub and sub.user_id == user_id:
        db.delete(sub)
        db.flush()
        return True
    return False


def send_to_user(db: Session, user_id: str, payload: dict, ttl: int = 3600, urgency: str = "normal") -> int:
    """Sends to every device of the user. Dead subscriptions (404/410) are removed. Returns number delivered."""
    delivered = 0
    for sub in list(db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id))):
        status = SENDER(sub, payload, ttl, urgency)
        if 200 <= status < 300:
            sub.failures, sub.last_ok_at = 0, utcnow()
            delivered += 1
        elif status in (404, 410):
            db.delete(sub)
        else:
            sub.failures += 1
            if sub.failures >= 10:
                db.delete(sub)
    db.flush()
    return delivered
