"""Password hashing (scrypt) and opaque session tokens (only hashes stored, refresh tokens are one-time)."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

_N, _R, _P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, dk = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(dk) // 2)
        return hmac.compare_digest(calc.hex(), dk)
    except (ValueError, TypeError):
        return False


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class RateLimiter:
    """In-process sliding window limiter for login attempts. Use Redis when running several workers."""

    def __init__(self, limit: int, window: float) -> None:
        self.limit, self.window = limit, window
        self.hits: dict[str, deque] = defaultdict(deque)

    def blocked(self, key: str) -> bool:
        q = self.hits[key]
        while q and q[0] < time.monotonic() - self.window:
            q.popleft()
        return len(q) >= self.limit

    def hit(self, key: str) -> None:
        self.hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        self.hits.pop(key, None)


login_limiter = RateLimiter(limit=10, window=15 * 60)
