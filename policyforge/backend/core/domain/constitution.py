"""The organisation's constitution: hard limits, the order of priorities, soft weights and risk attitude.

Every policy is evaluated against the active constitution. A policy that breaches a hard constraint in more than
`breach_alpha` of the replications cannot be approved.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator

from core.domain.common import OPERATOR_SYMBOL, Category, Id, Model, SkuClass


class Objective(StrEnum):
    service = "service"
    resilience = "resilience"
    cost = "cost"
    carbon = "carbon"


class Metric(StrEnum):
    fill_rate = "fill_rate"
    otif = "otif"
    backorder_units = "backorder_units"
    stockout_periods = "stockout_periods"
    expedite_spend = "expedite_spend"
    total_cost = "total_cost"
    inventory_days = "inventory_days"
    co2_tonnes = "co2_tonnes"


@dataclass(frozen=True)
class MetricSpec:
    unit: str
    lo: float
    hi: float


METRICS: dict[Metric, MetricSpec] = {
    Metric.fill_rate: MetricSpec("fraction", 0, 1),
    Metric.otif: MetricSpec("fraction", 0, 1),
    Metric.backorder_units: MetricSpec("units", 0, 1e9),
    Metric.stockout_periods: MetricSpec("periods", 0, 1e4),
    Metric.expedite_spend: MetricSpec("EUR", 0, 1e9),
    Metric.total_cost: MetricSpec("EUR", 0, 1e11),
    Metric.inventory_days: MetricSpec("days", 0, 3650),
    Metric.co2_tonnes: MetricSpec("t CO2e", 0, 1e7),
}


class ConstraintScope(Model):
    """What a constraint applies to; empty fields mean everything."""

    sku_class: SkuClass | None = None
    category: Category | None = None
    sku: Id | None = None
    node: Id | None = None


class HardConstraint(Model):
    id: Id
    metric: Metric
    scope: ConstraintScope = Field(default_factory=ConstraintScope)
    op: Literal["ge", "le"]
    threshold: float = Field(ge=0, le=1e11, description="In the metric's unit")
    window: Literal["period", "month", "horizon"] = Field(
        default="horizon", description="Measured per period, per calendar month (4.33 weeks), or over the horizon"
    )
    description: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def _bounds(self) -> HardConstraint:
        spec = METRICS[self.metric]
        if not spec.lo <= self.threshold <= spec.hi:
            raise ValueError(f"{self.metric} threshold must be within {spec.lo:g}..{spec.hi:g} {spec.unit}")
        return self

    def __str__(self) -> str:
        where = ", ".join(f"{k}={v}" for k, v in self.scope.model_dump(exclude_none=True).items()) or "all"
        unit = METRICS[self.metric].unit
        return f"{self.metric} [{where}] {OPERATOR_SYMBOL[self.op]} {self.threshold:g} {unit} per {self.window}"


class RiskAttitude(Model):
    """Which part of the distribution counts as the acceptable worst case."""

    measure: Literal["percentile", "cvar"] = "cvar"
    level: float = Field(default=0.95, ge=0.5, le=0.999, description="E.g. 0.95: the worst 5 % of outcomes")


Weight = Annotated[float, Field(ge=0, le=1)]


class Constitution(Model):
    id: Id
    version: int = Field(default=1, ge=1, le=10000)
    name: str = Field(max_length=120)
    hard_constraints: list[HardConstraint] = Field(default_factory=list, max_length=50)
    priorities: list[Objective] = Field(description="Lexicographic order, most important first; all four objectives")
    soft_weights: dict[Objective, Weight] = Field(description="Weights for a scalar tie-breaking score")
    risk: RiskAttitude = Field(default_factory=RiskAttitude)
    breach_alpha: float = Field(default=0.05, ge=0, le=0.5, description="Largest share of replications that may breach")
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def _priorities(self) -> Constitution:
        if sorted(self.priorities) != sorted(Objective):
            raise ValueError("priorities must list each objective exactly once")
        if sum(self.soft_weights.values()) <= 0:
            raise ValueError("at least one soft weight must be positive")
        ids = [c.id for c in self.hard_constraints]
        if len(set(ids)) != len(ids):
            raise ValueError("constraint ids must be unique")
        return self

    @property
    def ref(self) -> str:
        return f"{self.id}@{self.version}"
