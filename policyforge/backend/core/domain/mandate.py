"""The mandate: what the agent executing a policy may decide on its own, and when it must escalate.

A mandate always expires. If no expiry is given it is set to 90 days after `valid_from`; no mandate may run longer
than 366 days without review.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, Field, model_validator

from core.domain.common import Id, Model
from core.domain.condition import Condition

DEFAULT_TERM = timedelta(days=90)
MAX_TERM = timedelta(days=366)


class LimitKind(StrEnum):
    order_qty_change_pct = "order_qty_change_pct"
    expedite_spend_per_period = "expedite_spend_per_period"
    consecutive_sourcing_switches = "consecutive_sourcing_switches"
    volume_shift_pct = "volume_shift_pct"
    parameter_drift_pct = "parameter_drift_pct"


# unit and upper bound of each kind of limit (all have a lower bound of 0)
LIMIT_SPECS: dict[LimitKind, tuple[str, float]] = {
    LimitKind.order_qty_change_pct: ("% vs previous order", 100),
    LimitKind.expedite_spend_per_period: ("EUR per period", 1e7),
    LimitKind.consecutive_sourcing_switches: ("switches", 52),
    LimitKind.volume_shift_pct: ("% of volume", 100),
    LimitKind.parameter_drift_pct: ("% vs approved value", 100),
}


class AuthorityLimit(Model):
    """A bound on what the agent may do without asking."""

    kind: LimitKind
    value: float = Field(ge=0, le=1e7, description="In the unit of the kind (see LIMIT_SPECS)")

    @model_validator(mode="after")
    def _bounds(self) -> AuthorityLimit:
        unit, hi = LIMIT_SPECS[self.kind]
        if self.value > hi:
            raise ValueError(f"{self.kind} must be at most {hi:g} {unit}")
        if self.kind == LimitKind.consecutive_sourcing_switches and self.value != int(self.value):
            raise ValueError("a number of switches must be whole")
        return self

    @property
    def unit(self) -> str:
        return LIMIT_SPECS[self.kind][0]


class Severity(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class LimitBreach(Model):
    kind: Literal["limit_breach"] = "limit_breach"
    limit: LimitKind


class ConditionTrigger(Model):
    kind: Literal["condition"] = "condition"
    condition: Condition


class EscalationRule(Model):
    """When to hand a decision back to a person."""

    trigger: Annotated[LimitBreach | ConditionTrigger, Field(discriminator="kind")]
    severity: Severity
    escalate_to: Literal["owner", "approver"] = "owner"
    note: str = Field(default="", max_length=500)


class ActionKind(StrEnum):
    """Actions that can be prohibited outright."""

    add_new_supplier = "add_new_supplier"
    change_supplier_master_data = "change_supplier_master_data"
    cancel_customer_orders = "cancel_customer_orders"
    change_customer_priorities = "change_customer_priorities"
    exceed_storage_capacity = "exceed_storage_capacity"
    expedite_by_air = "expedite_by_air"
    change_policy_parameters = "change_policy_parameters"
    ship_expired_stock = "ship_expired_stock"


class Mandate(Model):
    owner: str = Field(min_length=1, max_length=80, description="The person accountable for the policy")
    approver: str = Field(min_length=1, max_length=80, description="The person who signs it off")
    agent_id: Id = Field(description="The agent that executes the policy")
    autonomy: list[AuthorityLimit] = Field(default_factory=list, max_length=20)
    escalation: list[EscalationRule] = Field(default_factory=list, max_length=50)
    prohibited_actions: list[ActionKind] = Field(default_factory=list, max_length=20)
    valid_from: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))
    expires_at: AwareDatetime = Field(description="Mandatory; defaults to valid_from + 90 days")
    review_triggers: list[Id] = Field(default_factory=list, max_length=50, description="Monitor ids forcing re-review")

    @model_validator(mode="before")
    @classmethod
    def _default_expiry(cls, data: Any) -> Any:
        if isinstance(data, dict) and data.get("expires_at") is None:
            data = dict(data)
            start = data.get("valid_from") or datetime.now(UTC)
            if isinstance(start, str):
                start = datetime.fromisoformat(start)
            data["valid_from"] = start
            data["expires_at"] = start + DEFAULT_TERM
        return data

    @model_validator(mode="after")
    def _term(self) -> Mandate:
        if self.expires_at <= self.valid_from:
            raise ValueError("expires_at must be after valid_from")
        if self.expires_at - self.valid_from > MAX_TERM:
            raise ValueError("a mandate may run at most 366 days before review")
        kinds = [a.kind for a in self.autonomy]
        if len(set(kinds)) != len(kinds):
            raise ValueError("each kind of authority limit may appear once")
        return self

    def limit(self, kind: LimitKind) -> float | None:
        return next((a.value for a in self.autonomy if a.kind == kind), None)

    def expired(self, at: datetime) -> bool:
        return at >= self.expires_at
