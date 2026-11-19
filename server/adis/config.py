"""Runtime configuration from environment variables (and an optional server/.env file).

Secrets (LLM API key, DB password) live only here, on the server. Never ship them in the app.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _bool(name: str, default: bool) -> bool:
    raw = _env(name)
    return default if not raw else raw.lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self) -> None:
        self.env = _env("ADIS_ENV", "development")
        url = _env("ADIS_DATABASE_URL") or f"sqlite:///{(ROOT / 'data' / 'adis.db').as_posix()}"
        # Hosting providers hand out postgres:// URLs; use the psycopg 3 driver for them
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url[len(prefix):]
        self.database_url = url
        # Cloud voice (speech-to-text / text-to-speech). auto = on when the LLM provider is OpenAI.
        self.voice_mode = _env("ADIS_VOICE", "auto").lower()
        self.voice_base_url_override = _env("ADIS_VOICE_BASE_URL").rstrip("/")
        self.voice_api_key_override = _env("ADIS_VOICE_API_KEY")
        self.stt_model = _env("ADIS_STT_MODEL", "gpt-4o-mini-transcribe")
        self.tts_model = _env("ADIS_TTS_MODEL", "gpt-4o-mini-tts")
        self.tts_voice = _env("ADIS_TTS_VOICE", "coral")
        # Web Push (VAPID). Generated on first start into server/data/vapid.json when not set.
        self.vapid_private_key = _env("ADIS_VAPID_PRIVATE_KEY")
        self.vapid_public_key = _env("ADIS_VAPID_PUBLIC_KEY")
        self.vapid_subject = _env("ADIS_VAPID_SUBJECT", "mailto:admin@adis.app")
        self.worker_enabled = _bool("ADIS_WORKER", True)
        self.worker_interval = float(_env("ADIS_WORKER_INTERVAL", "15"))
        # Public base URL of this server (used for iCal subscription links); empty = taken from the request
        self.public_url = _env("ADIS_PUBLIC_URL").rstrip("/")
        self.cors_origins = [o.strip() for o in _env("ADIS_CORS_ORIGINS", "*").split(",") if o.strip()]
        self.access_ttl = int(_env("ADIS_ACCESS_TTL", "3600"))
        self.refresh_ttl = int(_env("ADIS_REFRESH_TTL", str(30 * 86400)))
        # "Demo for presentation" button: creates an isolated, pre-filled account per login
        self.demo_login = _bool("ADIS_DEMO_LOGIN", True)
        # Serve the PWA from the same origin (one deploy, no CORS)
        self.serve_app = _bool("ADIS_SERVE_APP", True)
        self.app_dir = Path(_env("ADIS_APP_DIR") or (ROOT.parent / "app"))
        # LLM gateway (OpenAI-compatible Chat Completions API: OpenAI, DeepSeek, OpenRouter, Groq, Ollama, ...)
        self.llm_base_url = _env("ADIS_LLM_BASE_URL").rstrip("/")
        self.llm_api_key = _env("ADIS_LLM_API_KEY")
        self.llm_model = _env("ADIS_LLM_MODEL")
        self.llm_timeout = float(_env("ADIS_LLM_TIMEOUT", "60"))
        self.llm_vision = _bool("ADIS_LLM_VISION", False)
        self.llm_history = int(_env("ADIS_LLM_HISTORY", "20"))
        # Optional sampling/reasoning knobs (GPT-5 family accepts only the default temperature; use reasoning effort instead)
        self.llm_temperature = float(_env("ADIS_LLM_TEMPERATURE")) if _env("ADIS_LLM_TEMPERATURE") else None
        self.llm_reasoning = _env("ADIS_LLM_REASONING")  # none | minimal | low | medium | high

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_base_url and self.llm_model)

    @property
    def voice_base_url(self) -> str:
        return self.voice_base_url_override or self.llm_base_url

    @property
    def voice_api_key(self) -> str:
        return self.voice_api_key_override or self.llm_api_key

    @property
    def voice_enabled(self) -> bool:
        if not self.voice_base_url or self.voice_mode in ("0", "false", "off", "no"):
            return False
        return self.voice_mode in ("1", "true", "on", "yes") or "api.openai.com" in self.voice_base_url


settings = Settings()
