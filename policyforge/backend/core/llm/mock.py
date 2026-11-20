"""A deterministic provider that replays recorded answers, so tests and demos run offline.

Answers are keyed by purpose and trace key (the intent, plus any answers to clarifying questions). A key may hold a
sequence of answers, returned in turn: that is how tests script an invalid first answer to exercise the retry.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from core.llm.provider import LLMError, LLMResponse, Message, Purpose

MOCK_MODEL = "mock-replay"


def key_for(purpose: str, trace_key: str) -> str:
    norm = " ".join(trace_key.split()).lower()
    return hashlib.sha256(f"{purpose}\n{norm}".encode()).hexdigest()


class MockMissingError(LLMError):
    """No recorded answer for this call."""


class MockProvider:
    def __init__(self) -> None:
        self._answers: dict[str, list[str]] = defaultdict(list)
        self._used: dict[str, int] = defaultdict(int)
        self.calls: list[dict[str, Any]] = []

    @property
    def model_id(self) -> str:
        return MOCK_MODEL

    def add(self, purpose: Purpose, trace_key: str, *answers: str | dict[str, Any]) -> None:
        for a in answers:
            self._answers[key_for(purpose, trace_key)].append(a if isinstance(a, str) else json.dumps(a))

    def generate(self, *, system: str, messages: list[Message], schema: dict[str, Any] | None, purpose: Purpose,
                 trace_key: str) -> LLMResponse:
        self.calls.append({"purpose": purpose, "trace_key": trace_key, "messages": messages, "schema": schema})
        k = key_for(purpose, trace_key)
        seq = self._answers.get(k)
        if not seq:
            raise MockMissingError(f"no recorded {purpose} answer for: {trace_key[:80]!r}")
        i = min(self._used[k], len(seq) - 1)  # the last answer repeats
        self._used[k] += 1
        return LLMResponse(text=seq[i], model=MOCK_MODEL, stop_reason="end_turn")


def trace_key(intent: str, answers: dict[str, str] | None = None) -> str:
    if not answers:
        return intent
    return intent + "\n" + "\n".join(f"Q: {q}\nA: {a}" for q, a in sorted(answers.items()))


def load_fixtures(directory: Path) -> MockProvider:
    """A provider loaded with every recorded intent in a folder (see tests/fixtures/intents)."""
    mock = MockProvider()
    for path in sorted(directory.glob("*.json")):
        fx = json.loads(path.read_text(encoding="utf-8"))
        key = trace_key(fx["intent"], fx.get("answers"))
        mock.add("compile", key, *fx["responses"])
        mock.add("back_translate", key, fx["back_translation"])
    return mock
