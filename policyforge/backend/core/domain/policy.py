"""The policy DSL: a typed, bounded language for decision rules.

The LLM compiler may produce instances of these models only. Execution is done by deterministic executors that
read validated objects; nothing in a policy is ever executed as code.

Durations a person states in days (cover, lead times) are in days. Persistence ("three weeks running") and review
periods are counted in simulation periods (weeks by default). Every numeric field declares bounds.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from core.domain.assumption import Assumption
from core.domain.common import Category, Id, Model, SkuClass
from core.domain.condition import Condition
from core.domain.mandate import Mandate

BIG = 1e7


# ---------------------------------------------------------------- quantities
class Units(Model):
    unit: Literal["units"] = "units"
    value: float = Field(ge=0, le=BIG, description="Units of the SKU")


class DaysOfCover(Model):
    unit: Literal["days_of_cover"] = "days_of_cover"
    value: float = Field(ge=0, le=365, description="Days of expected demand")


Quantity = Annotated[Units | DaysOfCover, Field(discriminator="unit")]


# ---------------------------------------------------------------- decision rules
class BaseStock(Model):
    """Order up to a target inventory position every review period."""

    type: Literal["base_stock"] = "base_stock"
    target: Quantity
    review_period: int = Field(default=1, ge=1, le=13, description="Periods between reviews")


class MinMax(Model):
    """(s, S): when the inventory position is at or below s, order up to S."""

    type: Literal["min_max"] = "min_max"
    reorder_point: Quantity = Field(description="s")
    order_up_to: Quantity = Field(description="S")

    @model_validator(mode="after")
    def _s_not_above_big_s(self) -> MinMax:
        if self.reorder_point.unit != self.order_up_to.unit:
            raise ValueError("s and S must use the same unit")
        if self.reorder_point.value > self.order_up_to.value:
            raise ValueError("s must not exceed S")
        return self


class AllocationRule(Model):
    """How a node shares scarce stock among the nodes it serves."""

    type: Literal["allocation"] = "allocation"
    method: Literal["fair_share", "priority", "proportional_to_demand"]
    priority: list[Id] = Field(default_factory=list, max_length=50, description="Served nodes, first = most protected")
    reservation_pct: float = Field(default=0, ge=0, le=100, description="Share of stock held back for priority nodes")

    @model_validator(mode="after")
    def _priority(self) -> AllocationRule:
        if self.method == "priority" and not self.priority:
            raise ValueError("the priority method needs a priority list")
        if self.reservation_pct > 0 and not self.priority:
            raise ValueError("a reservation needs a priority list to reserve for")
        return self


class ProjectedStockout(Model):
    kind: Literal["projected_stockout"] = "projected_stockout"
    within_periods: int = Field(ge=1, le=26, description="Expedite if a stockout is projected within this many periods")


class CoverageBelow(Model):
    kind: Literal["coverage_below"] = "coverage_below"
    days: float = Field(ge=0, le=365, description="Expedite when stock covers fewer days than this")


class ExpediteTrigger(Model):
    """When to pay for faster transport."""

    type: Literal["expedite"] = "expedite"
    condition: Annotated[ProjectedStockout | CoverageBelow, Field(discriminator="kind")]
    mode: Literal["air", "express_road"]
    cost_cap_per_period: float = Field(ge=0, le=BIG, description="EUR of expedite cost allowed per period")


class SourcingSwitch(Model):
    """Move volume from a primary to a secondary supplier when a trigger holds; switch back when allowed."""

    type: Literal["sourcing_switch"] = "sourcing_switch"
    primary: Id
    secondary: Id
    trigger: Condition
    shift_fraction: float = Field(default=1, ge=0, le=1, description="Share of the primary's volume moved")
    switch_back: Condition | None = Field(default=None, description="When to return; none = stay switched")
    min_dwell_periods: int = Field(default=0, ge=0, le=104, description="Periods to stay switched at least")

    @model_validator(mode="after")
    def _suppliers(self) -> SourcingSwitch:
        if self.primary == self.secondary:
            raise ValueError("primary and secondary must differ")
        for c in (self.trigger, self.switch_back):
            if c is not None and c.var.supplier is not None and c.var.supplier != self.primary:
                raise ValueError("the trigger and switch-back must watch the primary supplier")
        return self


SimpleRule = Annotated[
    BaseStock | MinMax | AllocationRule | ExpediteTrigger | SourcingSwitch, Field(discriminator="type")
]


class Composite(Model):
    """Several rules, applied in order: a later rule refines the actions of earlier ones in its scope."""

    type: Literal["composite"] = "composite"
    rules: list[SimpleRule] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _one_replenishment(self) -> Composite:
        n = sum(1 for r in self.rules if isinstance(r, BaseStock | MinMax))
        if n > 1:
            raise ValueError("a composite may contain at most one replenishment rule (base_stock or min_max)")
        return self


DecisionRule = Annotated[
    BaseStock | MinMax | AllocationRule | ExpediteTrigger | SourcingSwitch | Composite, Field(discriminator="type")
]


# ---------------------------------------------------------------- the policy
class Scope(Model):
    """Where a policy applies. An empty list puts no restriction on that dimension."""

    nodes: list[Id] = Field(default_factory=list, max_length=100)
    skus: list[Id] = Field(default_factory=list, max_length=200)
    sku_classes: list[SkuClass] = Field(default_factory=list, max_length=3)
    categories: list[Category] = Field(default_factory=list, max_length=2)
    suppliers: list[Id] = Field(default_factory=list, max_length=50)
    lanes: list[Id] = Field(default_factory=list, max_length=500)


class PolicyStatus(StrEnum):
    draft = "draft"
    tested = "tested"
    approved = "approved"
    deployed = "deployed"
    retired = "retired"


class Provenance(Model):
    compiler_model: str | None = Field(default=None, max_length=100, description="Model id that compiled the intent")
    prompt_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$", description="SHA-256 of the prompt")
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))
    editor: str = Field(default="local-user", max_length=80)


class Policy(Model):
    id: Id
    name: str = Field(max_length=120)
    version: int = Field(default=1, ge=1, le=10000)
    status: PolicyStatus = PolicyStatus.draft
    intent_text: str = Field(max_length=4000, description="The original natural-language intent")
    scope: Scope
    rule: DecisionRule
    mandate: Mandate
    assumptions: list[Assumption] = Field(default_factory=list, max_length=50)
    constitution_ref: str = Field(max_length=80, description="Constitution id@version the policy was tested against")
    provenance: Provenance = Field(default_factory=Provenance)

    def simple_rules(self) -> list[BaseStock | MinMax | AllocationRule | ExpediteTrigger | SourcingSwitch]:
        r = self.rule
        return list(r.rules) if isinstance(r, Composite) else [r]
