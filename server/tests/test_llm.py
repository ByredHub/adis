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