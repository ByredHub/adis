"""AI gateway contract shared by all engines.

An engine is an async generator of events:
  {"type": "status", "text": str, "tool"?: str}
  {"type": "delta",  "text": str}
  {"type": "final",  "content": str, "cards": list, "toolCalls": list}
Cards with status "pending" are proposals: the client confirms them through the regular REST API.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from ..core.textutil import uid
from ..services.store import Store


class EngineError(Exception):
    pass


@dataclass
class TurnContext:
    store: Store
    text: str
    attachments: list[dict] = field(default_factory=list)
    history: list[dict] = field(default_factory=list)  # [{"role": "user"|"assistant", "content": str}]
    auto_save: bool = False
    sensitive_guard: bool = True
    variant: int = 0
    conversation_id: str | None = None
    source: str = "text"
    streaming: bool = True

    @property
    def tz(self) -> ZoneInfo:
        return self.store.tz

    @property
    def now(self) -> datetime:
        return datetime.now(self.store.tz)

    @property
    def user(self):
        return self.store.user


def card(type_: str, data: dict, status: str = "info") -> dict:
    return {"id": uid("c"), "type": type_, "status": status, "data": data}


TOOL_LABELS = {"memory_search": "Ищу в памяти…", "entity_lookup": "Ищу людей…", "task_create": "Готовлю напоминание…",
               "memory_save": "Сохраняю в память…", "task_list": "Смотрю задачи…"}
