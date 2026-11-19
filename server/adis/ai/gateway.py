"""AI Model Gateway: picks the engine. LLM when configured (ADIS_LLM_*), otherwise the rule-based engine.

If the LLM fails before it produced any text (network, quota, provider outage), the turn is answered by the rule-based
engine instead, with a visible note, so the user is never left without a reply.
"""
from __future__ import annotations

import logging

from ..config import settings
from .base import EngineError, TurnContext
from .llm import LLMEngine
from .rules import RulesEngine

log = logging.getLogger("adis.gateway")
FALLBACK_NOTE = "_Языковая модель сейчас недоступна — отвечаю в упрощённом режиме._\n\n"


class FallbackEngine:
    def __init__(self) -> None:
        self.primary, self.fallback = LLMEngine(), RulesEngine()
        self.name = self.primary.name

    async def respond(self, ctx: TurnContext):
        started = False
        try:
            async for evt in self.primary.respond(ctx):
                if evt["type"] == "delta":
                    started = True
                yield evt
            return
        except EngineError as e:
            if started:
                raise
            log.warning("LLM failed, falling back to rules: %s", e)
        self.name = self.fallback.name
        if ctx.streaming:
            yield {"type": "delta", "text": FALLBACK_NOTE}
        async for evt in self.fallback.respond(ctx):
            if evt["type"] == "final":
                evt = {**evt, "content": FALLBACK_NOTE + evt["content"]}
            elif evt["type"] == "status" and evt.get("text") == "Adis думает…":
                continue
            yield evt


def get_engine():
    return FallbackEngine() if settings.llm_enabled else RulesEngine()


def describe() -> dict:
    return {"engine": "llm" if settings.llm_enabled else "rules", "model": settings.llm_model if settings.llm_enabled else None}
