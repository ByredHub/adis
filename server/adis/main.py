"""Adis AI Backend entry point. API under /v1; optionally serves the PWA from the same origin."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .ai.gateway import describe
from .config import settings
from .db import init_db
from .services import push, worker
from .routers import agents, auth, chat, data, finance, schedule, voice

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("adis")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    info = describe()
    log.info("Adis backend %s, db=%s, engine=%s%s", __version__, settings.database_url.split("://", 1)[0], info["engine"],
             f" ({info['model']})" if info["model"] else "")
    push.keys()
    task = asyncio.create_task(worker.run_forever()) if settings.worker_enabled else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="Adis AI Backend", version=__version__, docs_url="/v1/docs", openapi_url="/v1/openapi.json", redoc_url=None,
              lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

FIELD_NAMES = {"email": "email", "password": "пароль", "name": "имя", "title": "название", "content": "текст", "dueAt": "срок",
               "startAt": "начало", "attachments": "вложения"}


@app.exception_handler(RequestValidationError)
async def validation_error(_request: Request, exc: RequestValidationError):
    fields = sorted({FIELD_NAMES.get(str(e["loc"][-1]), str(e["loc"][-1])) for e in exc.errors() if e.get("loc")})
    return JSONResponse(status_code=422, content={"detail": f"Проверьте поля: {', '.join(fields)}" if fields else "Некорректный запрос"})


@app.exception_handler(StarletteHTTPException)
async def http_error(_request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=getattr(exc, "headers", None))


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    log.exception("Unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"detail": "Внутренняя ошибка сервера"})


@app.get("/v1/health")
def health():
    return {"status": "ok", "version": __version__, **describe(), "voice": settings.voice_enabled}


for r in (auth.router, chat.router, data.router, agents.router, schedule.router, voice.router, finance.router):
    app.include_router(r, prefix="/v1")

if settings.serve_app and settings.app_dir.exists():
    app.mount("/", StaticFiles(directory=settings.app_dir, html=True), name="app")
