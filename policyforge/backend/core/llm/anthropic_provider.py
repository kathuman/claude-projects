"""Claude through the official Anthropic SDK.

- Model: the `LLM_MODEL` environment variable, `claude-opus-5-5` by default.
- JSON answers use **structured outputs** (`output_config.format`). Forced tool choice is not available on current
  models, and a schema-constrained answer is exactly what the compiler needs.
- Thinking is adaptive (always on for Claude Opus 5.5); depth is set with `effort`: `high` to compile a policy,
  `low` for prose (back-translation, narrative).
- **Server-side refusal fallbacks are on by default** (`fallbacks: "default"`): if the model declines, the API
  re-runs the request on a fallback model within the same call. A request that is still declined raises
  `LLMRefusalError`.
- Credentials are resolved by the SDK (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an `ant auth login`
  profile); nothing is hard-coded.
"""

from __future__ import annotations

import os
from typing import Any

import anthropic

from core.llm.provider import LLMError, LLMRefusalError, LLMResponse, LLMTruncatedError, Message, Purpose

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
EFFORT: dict[str, str] = {"compile": "high", "back_translate": "low", "narrative": "low"}


class AnthropicProvider:
    def __init__(self, model: str | None = None, client: Any = None, max_tokens: int = 16000,
                 fallbacks: bool = True) -> None:
        self._model = model or os.environ.get("LLM_MODEL") or DEFAULT_MODEL
        self._client = client if client is not None else anthropic.Anthropic()
        self._max_tokens = max_tokens
        self._fallbacks = fallbacks

    @property
    def model_id(self) -> str:
        return self._model

    def generate(self, *, system: str, messages: list[Message], schema: dict[str, Any] | None, purpose: Purpose,
                 trace_key: str) -> LLMResponse:
        output_config: dict[str, Any] = {"effort": EFFORT[purpose]}
        if schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": schema}
        params: dict[str, Any] = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "system": system,
            "messages": messages,
            "output_config": output_config,
        }
        if self._fallbacks:
            params["betas"] = [FALLBACK_BETA]
            params["fallbacks"] = "default"
        try:
            response = self._client.beta.messages.create(**params)
        except anthropic.AuthenticationError as e:
            raise LLMError("Anthropic credentials are missing or invalid (set ANTHROPIC_API_KEY)") from e
        except anthropic.NotFoundError as e:
            raise LLMError(f"model {self._model} is not available to this account") from e
        except anthropic.RateLimitError as e:
            raise LLMError("rate limited by the Anthropic API; try again shortly") from e
        except anthropic.BadRequestError as e:
            raise LLMError(f"the Anthropic API rejected the request: {e.message}") from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError("could not reach the Anthropic API") from e

        if response.stop_reason == "refusal":
            details = getattr(response, "stop_details", None)
            category = getattr(details, "category", None) if details else None
            raise LLMRefusalError(f"the model declined the request (category: {category})")
        if response.stop_reason == "max_tokens":
            raise LLMTruncatedError("the answer hit the output limit before it was complete")
        text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
        usage = getattr(response, "usage", None)
        return LLMResponse(text=text, model=getattr(response, "model", self._model) or self._model,
                           stop_reason=str(response.stop_reason),
                           input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
                           output_tokens=int(getattr(usage, "output_tokens", 0) or 0))
