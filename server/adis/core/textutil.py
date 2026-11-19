"""Text helpers shared by search and the rule-based NLU (port of app/js/core/utils.js)."""
from __future__ import annotations

import html
import re
import secrets
import time

_ENDINGS = re.compile(r"(ами|ями|ого|его|ому|ему|ыми|ими|ом|ем|ой|ей|ою|ею|ам|ям|ах|ях|ов|ев)$")
_VOWELS = re.compile(r"[аеиоуыэюяйь]+$")
_LATIN = re.compile(r"^[a-z0-9+#.]+$")
_SPLIT = re.compile(r"[^a-zа-я0-9+#]+")


def uid(prefix: str = "id") -> str:
    return f"{prefix}_{_b36(int(time.time() * 1000))}{secrets.token_hex(4)}"


def _b36(n: int) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = chars[r] + out
    return out or "0"


def cap(s: str | None) -> str:
    s = str(s or "").strip()
    return s[0].upper() + s[1:] if s else s


def esc(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=True)


def plural(n: int, one: str, few: str, many: str) -> str:
    m10, m100 = n % 10, n % 100
    if m10 == 1 and m100 != 11:
        return one
    if 2 <= m10 <= 4 and (m100 < 10 or m100 >= 20):
        return few
    return many


def stem(word: str) -> str:
    w = re.sub(r"[^a-zа-я0-9+#.]", "", str(word or "").lower().replace("ё", "е"))
    if _LATIN.match(w):
        return w
    before = w
    w = _VOWELS.sub("", _ENDINGS.sub("", w))
    return w if len(w) >= 2 else before


def same_stem(a: str, b: str) -> bool:
    sa, sb = stem(a), stem(b)
    if not sa or not sb:
        return False
    if sa == sb:
        return True
    if min(len(sa), len(sb)) >= 4 and (sa.startswith(sb) or sb.startswith(sa)):
        return True
    # stems ending in a case-like suffix ("Артём" -> "арт") still match their inflected forms ("Артёмом")
    ra, rb = (re.sub(r"[^a-zа-я0-9+#]", "", str(x or "").lower().replace("ё", "е")) for x in (a, b))
    return min(len(ra), len(rb)) >= 4 and (ra.startswith(rb) or rb.startswith(ra))


def words(text: str | None) -> list[str]:
    return [w for w in _SPLIT.split(str(text or "").lower().replace("ё", "е")) if w]
