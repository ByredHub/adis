"""Live check of the LLM engine against the real provider from server/.env (costs a few cents).

Usage (from server/):  .venv\\Scripts\\python.exe scripts\\llm_eval.py [model] [reasoning_effort]
Runs the TZ scenario + calendar/alarm requests on a throwaway SQLite DB and prints replies, cards and latency.
"""
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["ADIS_DATABASE_URL"] = f"sqlite:///{Path(tempfile.mkdtemp(), 'eval.db').as_posix()}"
os.environ["ADIS_SERVE_APP"] = "false"
os.environ["ADIS_WORKER"] = "false"
if len(sys.argv) > 1:
    os.environ["ADIS_LLM_MODEL"] = sys.argv[1]
if len(sys.argv) > 2:
    os.environ["ADIS_LLM_REASONING"] = sys.argv[2]

from fastapi.testclient import TestClient  # noqa: E402

from adis.config import settings  # noqa: E402
from adis.main import app  # noqa: E402

TURNS = [
    "Сегодня познакомился с Артёмом. Он программист, работает с Python и занимается разработкой сайтов",
    "@confirm",
    "С кем я недавно познакомился из программистов?",
    "Напомни завтра в 10 позвонить Артёму",
    "Встреча с Артёмом в пятницу с 15 до 16 в кафе",
    "@confirm",
    "Что у меня в пятницу?",
    "Перенеси встречу с Артёмом на 17:00",
    "Поставь будильник на 7:30 по будням",
    "Запомни мой пароль от почты qwerty123",
    "Объясни простыми словами, что такое retention D30",
]


def main() -> None:
    assert settings.llm_enabled, "Set ADIS_LLM_BASE_URL / ADIS_LLM_MODEL in server/.env"
    print(f"model={settings.llm_model} reasoning={settings.llm_reasoning or '-'}\n")
    with TestClient(app, headers={"X-Timezone": "Europe/Moscow"}) as c:
        tok = c.post("/v1/auth/register", json={"name": "Алексей", "email": "eval@example.com", "password": "password123"}).json()["accessToken"]
        h = {"Authorization": f"Bearer {tok}"}
        conv, last = None, None
        total = 0.0
        for text in TURNS:
            if text == "@confirm":
                cardd = last["cards"][0]
                d = cardd["data"]
                if cardd["type"] == "memory_save":
                    pid = None
                    if d.get("person"):
                        pid = c.post("/v1/people", json=d["person"], headers=h).json()["id"]
                    c.post("/v1/memory", json={**d["memory"], "personId": pid}, headers=h)
                elif cardd["type"] == "event_create":
                    c.post("/v1/events", json=d, headers=h)
                print(f"   [подтверждено: {cardd['type']}]\n")
                continue
            t0 = time.perf_counter()
            r = c.post("/v1/chat/messages", json={"content": text, "conversationId": conv}, headers=h)
            dt = time.perf_counter() - t0
            total += dt
            if r.status_code != 200:
                print(f"> {text}\n   ERROR {r.status_code}: {r.text[:300]}\n")
                continue
            body = r.json()
            conv, last = body["conversation"]["id"], body["assistantMessage"]
            print(f"> {text}   ({dt:.1f} с)")
            print("   " + last["content"].replace("\n", "\n   "))
            for cd in last["cards"]:
                keys = {k: v for k, v in cd["data"].items() if k in ("title", "startAt", "endAt", "dueAt", "hour", "minute", "days", "sensitive",
                                                                     "location", "personName", "eventId", "conflicts", "label", "cancel")}
                if cd["type"] == "memory_save":
                    keys = {"memory": cd["data"]["memory"].get("title"), "type": cd["data"]["memory"].get("type"),
                            "person": (cd["data"].get("person") or {}).get("name"), "sensitive": cd["data"].get("sensitive")}
                print(f"   [{cd['type']}/{cd['status']}] {keys}")
            print(f"   tools: {[tc['name'] for tc in last['toolCalls']]}\n")
        print(f"total {total:.1f} s")


if __name__ == "__main__":
    main()
