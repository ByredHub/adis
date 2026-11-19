"""Database engine and session. SQLite for local development, PostgreSQL in production (ADIS_DATABASE_URL)."""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

_sqlite = settings.database_url.startswith("sqlite")
if _sqlite and ":memory:" not in settings.database_url:
    Path(settings.database_url.split("///", 1)[1]).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _sqlite else {},
    pool_pre_ping=not _sqlite,
)

if _sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _record):  # noqa: ANN001
        cur = conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    with SessionLocal() as db:
        yield db


def init_db() -> None:
    """Bring the schema to the latest Alembic revision (server/migrations)."""
    from alembic import command
    from alembic.config import Config

    from . import models  # noqa: F401  (register tables)

    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
