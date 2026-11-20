"""The provider-agnostic LLM interface.

The compiler only ever asks a provider for text (JSON, when a schema is given). Nothing a model returns is executed:
it is parsed into typed, bounded DSL objects and validated deterministically (see core/llm/compiler.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

Purpose = Literal["compile", "back_translate", "narrative"]
Message = dict[str, Any]  # {"role": "user" | "assistant", "content": str}


@dataclass(frozen=True)
class LLMResponse:
    text: str
    model: str
    stop_reason: str
    input_tokens: int = 0
    output_tokens: int = 0


class LLMError(RuntimeError):
    """The provider could not produce an answer (network, API or configuration error)."""


class LLMRefusalError(LLMError):
    """The model declined the request."""


class LLMTruncatedError(LLMError):
    """The answer hit the output limit and is incomplete."""


class LLMProvider(Protocol):
    @property
    def model_id(self) -> str: ...

    def generate(self, *, system: str, messages: list[Message], schema: dict[str, Any] | None, purpose: Purpose,
                 trace_key: str) -> LLMResponse:
        """Answer the conversation. With a schema, the answer is JSON matching it.

        `purpose` and `trace_key` identify the call (the intent and any answers): real providers ignore them, the
        mock provider uses them to find the recorded answer.
        """
        ...
