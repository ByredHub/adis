import os
import sys
import tempfile
from pathlib import Path

# ADIS_TEST_DATABASE_URL=postgresql://... runs the suite against PostgreSQL (schema is recreated from migrations)
_pg = os.environ.get("ADIS_TEST_DATABASE_URL")
_tmp = tempfile.mkdtemp(prefix="adis-test-")
os.environ["ADIS_DATABASE_URL"] = _pg or f"sqlite:///{Path(_tmp, 'test.db').as_posix()}"
os.environ["ADIS_SERVE_APP"] = "false"
os.environ["ADIS_WORKER"] = "false"
os.environ["ADIS_LLM_BASE_URL"] = ""
os.environ["ADIS_LLM_MODEL"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

if _pg:
    from sqlalchemy import text  # noqa: E402

    from adis.db import engine  # noqa: E402

    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))

from adis.main import app  # noqa: E402

TZ = "Europe/Moscow"


@pytest.fixture(scope="session")
def client():
    with TestClient(app, headers={"X-Timezone": TZ, "User-Agent": "Mozilla/5.0 (iPhone) Safari"}) as c:
        yield c


_n = [0]


@pytest.fixture
def auth(client):
    """Registers a fresh user, returns headers with a bearer token."""
    _n[0] += 1
    r = client.post("/v1/auth/register", json={"name": "Тест", "email": f"user{_n[0]}-{os.getpid()}@example.com", "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}
