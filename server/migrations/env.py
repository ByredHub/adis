"""Alembic environment: uses the app's engine and metadata."""
from alembic import context

from adis import models  # noqa: F401  (register tables)
from adis.db import Base, engine

target_metadata = Base.metadata


def run() -> None:
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _migrate(connection)
        return
    with engine.connect() as conn:
        _migrate(conn)
        conn.commit()


def _migrate(conn) -> None:
    context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=conn.dialect.name == "sqlite",
                      compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


run()
