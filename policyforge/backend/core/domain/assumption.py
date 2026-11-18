"""An assumption a policy depends on. Each one becomes a drift monitor once the policy is deployed."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from core.domain.common import OPERATOR_SYMBOL, Id, Model, Operator
from core.domain.distributions import Distribution
from core.domain.vocabulary import VarRef, check_threshold

BIG = 1e7


class Assumption(Model):
    """`variable op threshold` (or `variable ~ distribution`), e.g. `lead_time[supplier_B] < 21 days`."""

    id: Id
    statement: str = Field(min_length=1, max_length=500, description="The assumption in plain language")
    variable: VarRef = Field(description="A state or exogenous variable")
    operator: Operator | None = Field(default=None, description="With a threshold")
    threshold: float | None = Field(default=None, ge=-BIG, le=BIG, description="In the variable's unit")
    distribution: Distribution | None = Field(default=None, description="The assumed distribution of the variable")
    source: Literal["user_stated", "compiler_inferred"]
    confidence: float = Field(ge=0, le=1, description="How sure the source is, 0..1")

    @model_validator(mode="after")
    def _one_form(self) -> Assumption:
        has_threshold = self.threshold is not None
        if has_threshold == (self.distribution is not None):
            raise ValueError("an assumption needs either a threshold or a distribution, not both")
        if has_threshold != (self.operator is not None):
            raise ValueError("a threshold needs an operator, and an operator a threshold")
        if self.threshold is not None:
            check_threshold(self.variable, self.threshold)
        return self

    def expression(self) -> str:
        if self.threshold is not None and self.operator is not None:
            return f"{self.variable} {OPERATOR_SYMBOL[self.operator]} {self.threshold:g} {self.variable.spec.unit}"
        return f"{self.variable} ~ {self.distribution}"
