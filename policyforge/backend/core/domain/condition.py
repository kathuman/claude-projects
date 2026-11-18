"""A condition on an observable state variable, used by rules (triggers) and by mandates (escalations)."""

from __future__ import annotations

from pydantic import Field, model_validator

from core.domain.common import OPERATOR_SYMBOL, Model, Operator
from core.domain.vocabulary import STATE_VARIABLES, VarRef, check_threshold

BIG = 1e7


class Condition(Model):
    """`var op threshold`, holding for `for_periods` consecutive periods. Only state variables are allowed."""

    var: VarRef
    op: Operator
    threshold: float = Field(ge=-BIG, le=BIG, description="In the variable's unit (see the vocabulary)")
    for_periods: int = Field(default=1, ge=1, le=52, description="Consecutive periods the condition must hold")

    @model_validator(mode="after")
    def _state_only(self) -> Condition:
        if self.var.var not in STATE_VARIABLES:
            raise ValueError(f"rules may only read state variables; {self.var.var} is not one")
        check_threshold(self.var, self.threshold)
        return self

    def __str__(self) -> str:
        held = f" for {self.for_periods} periods" if self.for_periods > 1 else ""
        return f"{self.var} {OPERATOR_SYMBOL[self.op]} {self.threshold:g} {self.var.spec.unit}{held}"
