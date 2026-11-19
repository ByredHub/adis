"""LLM engine against a fake OpenAI-compatible provider (no network, no key)."""
import json

import httpx
import pytest

from adis.ai import llm
from adis.config import settings
from test_api import sse


def _chunks(*deltas):
    body = "".join(f"data: {json.dumps({'choices': [{'delta': d}]}, ensure_ascii=False)}\n\n" for d in deltas) + "data: [DONE]\n\n"
    return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})


@pytest.fixture
def fake_llm(monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert request.headers["authorization"] == "Bearer sk-test"
        if len(calls) == 1:
            return _chunks({"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "memory_save", "arguments": '{"type":"fact","ti'}}]},
                           {"tool_calls": [{"index": 0, "function": {"arguments": 'tle":"Кофе","content":"Пью флэт уайт"}'}}]})
        tool_msg = payload["messages"][-1]
        assert tool_msg["role"] == "tool" and "pending_user_confirmation" in tool_msg["content"]
        return _chunks({"content": "Предлагаю "}, {"content": "сохранить."})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    return calls


def test_llm_stream_with_tool(client, auth, fake_llm):
    ev = sse(client, auth, {"content": "Я пью флэт уайт"})
    assert [e["text"] for e in ev if e["type"] == "delta"] == ["Предлагаю ", "сохранить."]
    msg = ev[-1]["message"]
    assert msg["engine"] == "llm:test-model" and msg["content"] == "Предлагаю сохранить."
    assert msg["cards"][0]["type"] == "memory_save" and msg["cards"][0]["data"]["memory"]["title"] == "Кофе"
    assert fake_llm[0]["messages"][0]["role"] == "system" and fake_llm[0]["tools"]
    # history is passed on the next turn
    fake_llm.clear()
    client.post("/v1/chat/messages", json={"conversationId": ev[0]["conversation"]["id"], "content": "ещё"}, headers=auth)
    assert [m["role"] for m in fake_llm[0]["messages"][:3]] == ["system", "user", "assistant"]


def test_llm_error_falls_back_to_rules(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(500, text="boom")))
    ev = sse(client, auth, {"content": "Напомни завтра в 10 позвонить маме"})
    msg = ev[-1]["message"]
    assert ev[-1]["type"] == "done" and msg["engine"] == "rules" and msg["content"].startswith("_Языковая модель сейчас недоступна")
    assert msg["cards"][0]["type"] == "task_create"
    r = client.post("/v1/chat/messages", json={"content": "привет"}, headers=auth)
    assert r.status_code == 200 and r.json()["assistantMessage"]["engine"] == "rules"


def test_llm_error_after_text_is_reported(client, auth, monkeypatch):
    def handler(request):
        body = 'data: {"choices":[{"delta":{"content":"Начал"}}]}\n\n'
        return httpx.Response(200, stream=_Broken(body.encode()), headers={"content-type": "text/event-stream"})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    ev = sse(client, auth, {"content": "привет"})
    assert ev[-1]["type"] == "error"


class _Broken(httpx.AsyncByteStream):
    def __init__(self, first: bytes) -> None:
        self.first = first

    async def __aiter__(self):
        yield self.first
        raise httpx.ReadError("connection reset")

def test_custom_agent_runs_through_llm_with_read_only_tools(client, auth, monkeypatch):
    calls = []

    def handler(request: httpx.Request):
        payload = json.loads(request.content)
        calls.append(payload)
        if len(calls) == 1:
            # the model tries a write tool it was not given, plus a permitted read
            return _chunks({"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "task_create", "arguments": '{"title":"x"}'}},
                                           {"index": 1, "id": "c2", "function": {"name": "memory_search", "arguments": '{"query":"учёба"}'}}]})
        results = [m for m in payload["messages"] if m["role"] == "tool"]
        assert "not permitted" in results[0]["content"] and "results" in results[1]["content"]
        return _chunks({"content": "## План учёбы\n\n- Повторить конспекты"})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    a = client.post("/v1/agents", json={"name": "Учёба", "instructions": "Составь план учёбы", "tools": ["memory_search"]}, headers=auth).json()
    run = client.post(f"/v1/agents/{a['id']}/runs", headers=auth).json()
    assert run["status"] == "completed" and run["result"].startswith("## План учёбы")
    assert "Ищу в памяти" in run["steps"]
    assert {t["function"]["name"] for t in calls[0]["tools"]} == {"memory_search"}
    assert "Учёба" in calls[0]["messages"][0]["content"] and calls[0]["messages"][-1]["content"] == "Составь план учёбы"


def test_custom_agent_without_llm_explains(client, auth):
    a = client.post("/v1/agents", json={"name": "Без модели", "instructions": "Что-то сделать"}, headers=auth).json()
    run = client.post(f"/v1/agents/{a['id']}/runs", headers=auth).json()
    assert run["status"] == "completed" and "не подключена" in run["result"]


@pytest.mark.parametrize("text,shift", [("Напомни в 17 пойти на занятия", 1), ("Напомни сегодня в 17 пойти на занятия", 0)])
def test_past_time_today_rolls_to_tomorrow(client, auth, monkeypatch, text, shift):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    past = (datetime.now(ZoneInfo("Europe/Moscow")) - timedelta(minutes=1)).replace(second=0, microsecond=0)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            args = json.dumps({"title": "Пойти на занятия", "dueAt": past.isoformat()})
            return _chunks({"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "task_create", "arguments": args}}]})
        return _chunks({"content": "Предлагаю напоминание."})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    msg = client.post("/v1/chat/messages", json={"content": text}, headers=auth).json()["assistantMessage"]
    due = datetime.fromisoformat(msg["cards"][0]["data"]["dueAt"].replace("Z", "+00:00"))
    assert due == past + timedelta(days=shift)


def test_old_receipt_date_is_recorded_today(client, auth, monkeypatch):
    from datetime import datetime, timedelta, timezone

    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            args = json.dumps({"kind": "expense", "amount": 188, "category": "Кафе и рестораны", "note": "Блинчики", "date": "2016-08-26T15:52:00+03:00"})
            return _chunks({"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "finance_add", "arguments": args}}]})
        assert "сегодняшним числом" in calls[-1]["messages"][-1]["content"]
        return _chunks({"content": "Предлагаю записать расход 188 ₽."})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(settings, "llm_vision", True)
    img = "data:image/png;base64,iVBORw0KGgo="
    msg = client.post("/v1/chat/messages", json={"content": "", "attachments": [{"name": "r.png", "type": "image/png", "image": img}]},
                      headers=auth).json()["assistantMessage"]
    d = msg["cards"][0]["data"]
    when = datetime.fromisoformat(d["occurredAt"].replace("Z", "+00:00"))
    assert abs(when - datetime.now(timezone.utc)) < timedelta(minutes=5) and "чек от 26 августа 2016" in d["note"]
    # the photo without a caption is not answered as a plain «what is on the photo?» question
    assert "чек или квитанция" in json.dumps(calls[0]["messages"][-1]["content"], ensure_ascii=False)


@pytest.mark.parametrize("answer,kept", [("Посмотри «Интерстеллар» — отличная фантастика.", []),
                                         ("Ты предпочитаешь встречи до обеда, так что ставлю на 11:00.", ["Встречи — до обеда"])])
def test_memory_cards_only_for_memories_the_answer_uses(client, auth, monkeypatch, answer, kept):
    for title, type_, body in [("Встречи — до обеда", "preference", "Предпочитаю назначать встречи до обеда"),
                               ("Retention D30", "knowledge", "Доля пользователей, вернувшихся через 30 дней")]:
        client.post("/v1/memory", json={"type": type_, "title": title, "content": body}, headers=auth)
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:  # a broad query matches whole categories by their type label
            args = json.dumps({"query": "предпочтения знания"})
            return _chunks({"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "memory_search", "arguments": args}}]})
        return _chunks({"content": answer})

    monkeypatch.setattr(settings, "llm_base_url", "https://llm.test/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")
    monkeypatch.setattr(llm, "TRANSPORT", httpx.MockTransport(handler))
    msg = client.post("/v1/chat/messages", json={"content": "Какой фильм посмотреть?"}, headers=auth).json()["assistantMessage"]
    mem_cards = [c for c in msg["cards"] if c["type"] == "memories"]
    by_id = {m["id"]: m["title"] for m in client.get("/v1/memory", headers=auth).json()}
    titles = [by_id[i] for c in mem_cards for i in c["data"]["ids"]]
    assert titles == kept


_FILMS = [{"role": "user", "content": "какой фильм посмотреть?"},
          {"role": "assistant", "content": "Вот варианты:\n\n- **«Дюна: Часть вторая»** — эпик\n- **«Достать ножи»** — детектив\n"
                                           "- **«Прошлые жизни»** — драма\n\nМогу подобрать ещё."}]


@pytest.mark.parametrize("title,expected", [
    ("Посмотреть 2 фильм", "Посмотреть «Достать ножи»"),
    ("Посмотреть «2 фильм»", "Посмотреть «Достать ножи»"),
    ("посмотреть второй фильм", "посмотреть «Достать ножи»"),
    ("Посмотреть фильм 3", "Посмотреть «Прошлые жизни»"),
    ("Посмотреть 3-й фильм", "Посмотреть «Прошлые жизни»"),
    ("Посмотреть 7 фильм", "Посмотреть 7 фильм"),          # no such item
    ("Купить 2 книги", "Купить 2 книги"),                  # books were never discussed
    ("Позвонить маме", "Позвонить маме"),
])
def test_resolve_list_ref(title, expected):
    assert llm.resolve_list_ref(title, _FILMS) == expected


def test_resolve_list_ref_numbered_list_and_no_history():
    hist = [{"role": "user", "content": "что почитать?"}, {"role": "assistant", "content": "1. Мастер и Маргарита — классика\n2. Дюна — фантастика"}]
    assert llm.resolve_list_ref("Прочитать вторую книгу", hist) == "Прочитать вторую книгу"  # «книг» not in context
    assert llm.resolve_list_ref("Прочитать 2 вариант", hist) == "Прочитать «Дюна»"
    assert llm.resolve_list_ref("Посмотреть 2 фильм", []) == "Посмотреть 2 фильм"


def test_resolve_list_ref_ignores_ordinals_inside_words():
    assert llm.resolve_list_ref("Посмотреть фильм вечером", _FILMS) == "Посмотреть фильм вечером"
    assert llm.resolve_list_ref("Пятница: сходить в кафе", _FILMS) == "Пятница: сходить в кафе"


@pytest.mark.parametrize("line,name", [
    ("**«Дюна: Часть вторая»** — эпик", "Дюна: Часть вторая"),
    ("**Для лёгкого вечера:** *1+1*", "1+1"),
    ("**Интерстеллар** — фантастика", "Интерстеллар"),
    ("**Для вечера:** Интерстеллар — про космос", "Интерстеллар"),
    ("Мастер и Маргарита — классика", "Мастер и Маргарита"),
])
def test_item_name_formats(line, name):
    assert llm._item_name(line) == name
