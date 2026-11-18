"""Shared building blocks: identifiers, operators and the base model configuration."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# An identifier: a letter, then letters, digits, underscores or hyphens (at most 64 characters).
Id = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_\-]{0,63}$", description="Identifier")]

# Comparison operators used by conditions, assumptions and constraints.
Operator = Literal["lt", "le", "gt", "ge"]
OPERATOR_SYMBOL: dict[str, str] = {"lt": "<", "le": "≤", "gt": ">", "ge": "≥"}

SkuClass = Literal["A", "B", "C"]
Category = Literal["chilled", "ambient"]


def compare(value: float, op: Operator, threshold: float) -> bool:
    """Evaluate `value op threshold`."""
    if op == "lt":
        return value < threshold
    if op == "le":
        return value <= threshold
    if op == "gt":
        return value > threshold
    return value >= threshold


class Model(BaseModel):
    """Base for every domain model: unknown fields are rejected, instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True, validate_default=True)
