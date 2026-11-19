"""Cloud voice through the AI provider: speech-to-text and text-to-speech. Keys stay on the server.

The app sends the recorded audio as the raw request body (Content-Type: audio/webm, audio/mp4, ...),
so no multipart parsing is needed on our side.
"""
from __future__ import annotations

import logging
import re

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import Field

from ..config import settings
from ..core.security import RateLimiter
from ..deps import Ctx, current, fail
from ..schemas import In
from ..services.store import Store

router = APIRouter()
log = logging.getLogger("adis.voice")

TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests replace it with httpx.MockTransport
VOICES = ["coral", "nova", "shimmer", "sage", "alloy", "ash", "ballad", "echo", "fable", "onyx", "verse"]
MAX_AUDIO = 15 * 1024 * 1024
EXT = {"audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
       "audio/aac": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav"}
limiter = RateLimiter(limit=120, window=600)  # per user: ~1 request / 5 s on average


def _check(ctx: Ctx) -> None:
    if not settings.voice_enabled:
        fail(503, "Облачный голос не подключён на сервере")
    if limiter.blocked(ctx.user.id):
        fail(429, "Слишком много голосовых запросов. Подождите немного.")
    limiter.hit(ctx.user.id)


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.voice_api_key}"} if settings.voice_api_key else {}


@router.get("/voice/status")
def status(_ctx: Ctx = Depends(current)):
    return {"enabled": settings.voice_enabled, "stt": settings.voice_enabled, "tts": settings.voice_enabled,
            "voices": VOICES if settings.voice_enabled else [], "defaultVoice": settings.tts_voice}


@router.post("/voice/transcribe")
async def transcribe(request: Request, lang: str = "ru", ctx: Ctx = Depends(current)):
    _check(ctx)
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype not in EXT:
        fail(415, "Неподдерживаемый формат записи")
    audio = await request.body()
    if not audio:
        fail(422, "Пустая запись")
    if len(audio) > MAX_AUDIO:
        fail(413, "Запись слишком длинная")
    # Names from the user's memory help the model spell them right ("Артём", "Ковалёва")
    names = ", ".join(p.name for p in Store(ctx.db, ctx.user, ctx.tz).people()[:40])
    prompt = ("Числа, время и телефоны пиши цифрами: +7 916 555-12-34, 8 (999) 123-45-67, 15:30, 7:45, 25 декабря. "
              "Adis, напоминание, будильник, календарь, встреча." + (f" Имена: {names}." if names else ""))
    data = {"model": settings.stt_model, "language": (lang or "ru")[:2], "prompt": prompt[:800], "response_format": "json"}
    files = {"file": (f"speech.{EXT[ctype]}", audio, ctype)}
    try:
        async with httpx.AsyncClient(timeout=60, transport=TRANSPORT) as client:
            res = await client.post(f"{settings.voice_base_url}/audio/transcriptions", data=data, files=files, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("STT transport error: %s", type(e).__name__)
        fail(502, "Сервис распознавания речи недоступен")
    if res.status_code >= 400:
        log.warning("STT HTTP %s: %s", res.status_code, res.text[:300])
        fail(502, "Не удалось распознать речь")
    return {"text": (res.json().get("text") or "").strip()}


_MD = [(re.compile(r"```[\s\S]*?```"), " Код показан на экране. "), (re.compile(r"\[(.*?)\]\(.*?\)"), r"\1"),
       (re.compile(r"[*_#>`|]"), ""), (re.compile(r"^\s*[-•]\s+", re.M), ""), (re.compile(r"\s+"), " ")]


def speakable(text: str) -> str:
    for rx, repl in _MD:
        text = rx.sub(repl, text)
    return text.strip()[:1500]


class SpeakIn(In):
    text: str = Field(..., max_length=20_000)
    voice: str | None = None
    speed: float = Field(1.0, ge=0.5, le=2.0)


@router.post("/voice/speak")
async def speak(body: SpeakIn, ctx: Ctx = Depends(current)):
    _check(ctx)
    text = speakable(body.text)
    if not text:
        fail(422, "Нечего озвучивать")
    voice = body.voice if body.voice in VOICES else settings.tts_voice
    payload = {"model": settings.tts_model, "voice": voice, "input": text, "response_format": "mp3", "speed": body.speed,
               "instructions": "Говори естественно, тепло и спокойно, как внимательный личный помощник. Номера телефонов и числа читай чётко."}
    try:
        async with httpx.AsyncClient(timeout=60, transport=TRANSPORT) as client:
            res = await client.post(f"{settings.voice_base_url}/audio/speech", json=payload, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("TTS transport error: %s", type(e).__name__)
        fail(502, "Сервис озвучивания недоступен")
    if res.status_code >= 400:
        log.warning("TTS HTTP %s: %s", res.status_code, res.text[:300])
        fail(502, "Не удалось озвучить ответ")
    return Response(content=res.content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
