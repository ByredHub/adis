"""Cloud voice endpoints against a fake OpenAI audio API."""
import json

import httpx
import pytest

from adis.config import settings
from adis.routers import voice


@pytest.fixture
def fake_audio(monkeypatch):
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.url.path.endswith("/audio/transcriptions"):
            return httpx.Response(200, json={"text": " Запомни номер Артёма "})
        if request.url.path.endswith("/audio/speech"):
            return httpx.Response(200, content=b"ID3fake-mp3", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    monkeypatch.setattr(settings, "llm_base_url", "https://api.openai.com/v1")
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(voice, "TRANSPORT", httpx.MockTransport(handler))
    return seen


def test_voice_disabled_without_provider(client, auth):
    assert client.get("/v1/voice/status", headers=auth).json()["enabled"] is False
    assert client.post("/v1/voice/speak", json={"text": "привет"}, headers=auth).status_code == 503


def test_transcribe(client, auth, fake_audio):
    client.post("/v1/people", json={"name": "Артём Смирнов"}, headers=auth)
    r = client.post("/v1/voice/transcribe?lang=ru", content=b"\x1aE\xdf\xa3webm", headers={**auth, "Content-Type": "audio/webm;codecs=opus"})
    assert r.status_code == 200 and r.json() == {"text": "Запомни номер Артёма"}
    req = fake_audio[-1]
    body = req.content.decode("latin-1")
    assert req.headers["authorization"] == "Bearer sk-test" and 'filename="speech.webm"' in body and "gpt-4o-mini-transcribe" in body
    assert "Артём Смирнов".encode().decode("latin-1") in body  # known names are passed as a hint
    assert client.post("/v1/voice/transcribe", content=b"x", headers={**auth, "Content-Type": "text/plain"}).status_code == 415
    assert client.post("/v1/voice/transcribe", content=b"", headers={**auth, "Content-Type": "audio/mp4"}).status_code == 422


def test_speak(client, auth, fake_audio):
    st = client.get("/v1/voice/status", headers=auth).json()
    assert st["enabled"] and "coral" in st["voices"]
    r = client.post("/v1/voice/speak", json={"text": "**Телефон:** +7 999 123-45-67\n- пункт\n```py\nx=1\n```", "voice": "nova"}, headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"ID3fake-mp3"
    sent = json.loads(fake_audio[-1].content)
    assert sent["voice"] == "nova" and sent["model"] == "gpt-4o-mini-tts" and "*" not in sent["input"] and "Код показан на экране" in sent["input"]
    assert client.post("/v1/voice/speak", json={"text": "hi", "voice": "hacker"}, headers=auth).status_code == 200
    assert json.loads(fake_audio[-1].content)["voice"] == settings.tts_voice
