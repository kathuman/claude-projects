"""Scenarios: composable, parameterised descriptions of the futures a policy is tested against.

A scenario is a stack of components applied in order. The base layer (stochastic seasonal demand, lead times,
supplier fill rates) is always drawn; each component then changes those draws. Periods are counted from 0.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, model_validator

from core.domain.common import Category, Id, Model

MAX_T = 156


class Window(Model):
    start: int = Field(ge=0, le=MAX_T, description="First period affected")
    duration: int | None = Field(default=None, ge=1, le=MAX_T, description="Periods affected; none = to the end")

    def periods(self, horizon: int) -> range:
        end = horizon if self.duration is None else min(horizon, self.start + self.duration)
        return range(min(self.start, horizon), end)


class BaselineDemand(Model):
    """The base layer's settings; including it changes nothing else (it is always applied)."""

    kind: Literal["baseline_demand"] = "baseline_demand"
    seasonality: bool = Field(default=True, description="Apply each SKU's seasonal profile")


class DemandShift(Model):
    """A level shift (long window) or promotion spike (short window) in demand."""

    kind: Literal["demand_shift"] = "demand_shift"
    window: Window
    factor: float = Field(ge=0, le=10, description="Multiplier on demand in the window")
    markets: list[Id] = Field(default_factory=list, description="Empty = all markets")
    skus: list[Id] = Field(default_factory=list, description="Empty = all SKUs")
    categories: list[Category] = Field(default_factory=list, description="Empty = all categories")


class SupplierOutage(Model):
    kind: Literal["supplier_outage"] = "supplier_outage"
    supplier: Id
    window: Window
    severity: float = Field(ge=0, le=1, description="Share of capacity lost (1 = nothing ships)")


class LeadTimeInflation(Model):
    kind: Literal["lead_time_inflation"] = "lead_time_inflation"
    supplier: Id
    start: int = Field(ge=0, le=MAX_T)
    factor: float = Field(ge=0.1, le=10, description="Multiplier on lead time once fully in effect")
    ramp_periods: int = Field(default=0, ge=0, le=MAX_T, description="0 = a step change; else a linear ramp")


class PlantCapacityLoss(Model):
    kind: Literal["plant_capacity_loss"] = "plant_capacity_loss"
    plant: Id
    window: Window
    severity: float = Field(ge=0, le=1, description="Share of capacity lost")


class CorrelatedShock(Model):
    """Several suppliers and markets hit at once, at a random start, in a random share of replications."""

    kind: Literal["correlated_shock"] = "correlated_shock"
    probability: float = Field(ge=0, le=1, description="Share of replications in which the shock happens")
    earliest_start: int = Field(ge=0, le=MAX_T)
    latest_start: int = Field(ge=0, le=MAX_T)
    duration: int = Field(ge=1, le=MAX_T)
    suppliers: list[Id] = Field(default_factory=list)
    supply_severity: float = Field(default=0, ge=0, le=1, description="Share of capacity lost at each supplier")
    lead_time_factor: float = Field(default=1, ge=1, le=10, description="Lead-time multiplier at each supplier")
    markets: list[Id] = Field(default_factory=list)
    demand_factor: float = Field(default=1, ge=0, le=10, description="Demand multiplier in each market")

    @model_validator(mode="after")
    def _window(self) -> CorrelatedShock:
        if self.latest_start < self.earliest_start:
            raise ValueError("latest_start must not be before earliest_start")
        if not self.suppliers and not self.markets:
            raise ValueError("a correlated shock must hit at least one supplier or market")
        return self


class SignalNoise(Model):
    """The bullwhip stressor: noisier demand signals and a longer information delay."""

    kind: Literal["signal_noise"] = "signal_noise"
    noise_cv: float = Field(default=0, ge=0, le=2, description="CV of multiplicative noise on observed demand")
    extra_delay: int = Field(default=0, ge=0, le=12, description="Extra periods of information delay")


Component = Annotated[
    BaselineDemand | DemandShift | SupplierOutage | LeadTimeInflation | PlantCapacityLoss | CorrelatedShock
    | SignalNoise,
    Field(discriminator="kind"),
]


class Scenario(Model):
    id: Id
    name: str = Field(max_length=120)
    description: str = Field(default="", max_length=1000)
    components: list[Component] = Field(default_factory=list, max_length=20)


class ScenarioSet(Model):
    id: Id
    name: str = Field(max_length=120)
    scenarios: list[Scenario] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def _unique(self) -> ScenarioSet:
        ids = [s.id for s in self.scenarios]
        if len(set(ids)) != len(ids):
            raise ValueError("scenario ids must be unique within a set")
        return self
