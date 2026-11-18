"""The supply network: suppliers → plants → distribution centres → markets, with SKUs and lanes.

Units: quantities in units (cases) of a SKU, money in the network's currency (EUR), time in days for lead times and
shelf life, and in periods (weeks by default) for capacities and demand rates. Locations are on a flat km grid; a
lane's distance is given explicitly so it can differ from the straight line.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import Field, model_validator

from core.domain.common import Category, Id, Model, SkuClass
from core.domain.distributions import Distribution

BIG = 1e7
Mode = Literal["road", "rail", "sea", "air", "express_road"]


class Location(Model):
    x_km: float = Field(ge=-5000, le=5000)
    y_km: float = Field(ge=-5000, le=5000)


class SKU(Model):
    id: Id
    name: str = Field(max_length=80)
    abc_class: SkuClass
    category: Category
    shelf_life_days: int | None = Field(default=None, ge=1, le=365, description="Chilled SKUs only")
    unit_cost: float = Field(gt=0, le=1e4, description="Value of one unit, EUR")
    holding_cost_per_unit_period: float = Field(ge=0, le=1e3, description="EUR per unit held per period")
    backorder_penalty_per_unit_period: float = Field(ge=0, le=1e4, description="EUR per unit backordered per period")
    lost_sale_penalty_per_unit: float = Field(ge=0, le=1e4, description="EUR per unit of demand lost")
    unmet_demand: Literal["backorder", "lost_sale"] = Field(description="What happens to demand that cannot be met")
    base_demand: float = Field(ge=0, le=1e6, description="Network-wide mean demand, units per period")
    demand_cv: float = Field(ge=0, le=3, description="Coefficient of variation of demand per market and period")
    seasonality_amplitude: float = Field(default=0, ge=0, le=0.9, description="Peak deviation from mean, fraction")
    seasonality_peak_period: int = Field(default=0, ge=0, le=52, description="Period of the year with peak demand")
    weight_kg: float = Field(gt=0, le=1000, description="Shipping weight of one unit")

    @model_validator(mode="after")
    def _shelf_life(self) -> SKU:
        if self.category == "chilled" and self.shelf_life_days is None:
            raise ValueError(f"chilled SKU {self.id} needs shelf_life_days")
        if self.category == "ambient" and self.shelf_life_days is not None:
            raise ValueError(f"ambient SKU {self.id} must not have a shelf life")
        return self


class Supplier(Model):
    id: Id
    name: str = Field(max_length=80)
    location: Location
    capacity_per_period: float = Field(gt=0, le=BIG, description="Units per period across all SKUs")
    unit_cost_index: float = Field(gt=0, le=10, description="Multiplier on SKU unit cost for material bought here")
    fill_rate_mean: float = Field(ge=0, le=1, description="Mean share of each order that is shipped")
    fill_rate_sd: float = Field(ge=0, le=0.5, description="Period-to-period variability of the fill rate")
    ordering_cost: float = Field(default=0, ge=0, le=1e5, description="EUR per order placed")


class SourcingShare(Model):
    supplier: Id
    share: float = Field(ge=0, le=1, description="Share of the plant's material bought from this supplier")


class Plant(Model):
    id: Id
    name: str = Field(max_length=80)
    location: Location
    capacity_per_period: float = Field(gt=0, le=BIG, description="Units of finished goods per period, all SKUs")
    production_cost_per_unit: float = Field(ge=0, le=1e4, description="EUR per unit produced")
    skus: list[Id] = Field(min_length=1, description="SKUs this plant can make")
    sourcing: list[SourcingShare] = Field(min_length=1, description="The plant's normal split of material by supplier")

    @model_validator(mode="after")
    def _shares(self) -> Plant:
        if abs(sum(s.share for s in self.sourcing) - 1.0) > 1e-6:
            raise ValueError(f"plant {self.id}: sourcing shares must sum to 1")
        return self


class DC(Model):
    id: Id
    name: str = Field(max_length=80)
    location: Location
    storage_capacity: float = Field(gt=0, le=BIG, description="Units the DC can hold")


class Market(Model):
    id: Id
    name: str = Field(max_length=80)
    region: str = Field(max_length=40)
    location: Location
    size_factor: float = Field(ge=0, le=10, description="Share of each SKU's base demand that arises here")
    served_by: Id = Field(description="The DC that serves this market")


class DemandOverride(Model):
    market: Id
    sku: Id
    mean: float = Field(ge=0, le=1e6, description="Units per period")
    cv: float | None = Field(default=None, ge=0, le=3)


class ExpediteOption(Model):
    mode: Literal["air", "express_road"]
    lead_time_days: Distribution
    cost_multiplier: float = Field(ge=1, le=20, description="Multiplier on the lane's cost per unit")


class Lane(Model):
    id: Id
    origin: Id
    destination: Id
    mode: Mode
    lead_time_days: Distribution
    cost_per_unit: float = Field(ge=0, le=1e4, description="EUR per unit moved")
    distance_km: float = Field(ge=0, le=20000)
    expedite: ExpediteOption | None = None


class EmissionFactors(Model):
    """kg CO2e per tonne-km, by transport mode."""

    road: float = Field(ge=0, le=10)
    rail: float = Field(ge=0, le=10)
    sea: float = Field(ge=0, le=10)
    air: float = Field(ge=0, le=10)
    express_road: float = Field(ge=0, le=10)

    def factor(self, mode: Mode) -> float:
        return float(getattr(self, mode))


class Network(Model):
    name: str = Field(max_length=80)
    currency: Literal["EUR"] = "EUR"
    period_days: int = Field(default=7, ge=1, le=31, description="Length of one simulation period")
    skus: Annotated[list[SKU], Field(min_length=1, max_length=200)]
    suppliers: Annotated[list[Supplier], Field(min_length=1, max_length=50)]
    plants: Annotated[list[Plant], Field(min_length=1, max_length=50)]
    dcs: Annotated[list[DC], Field(min_length=1, max_length=100)]
    markets: Annotated[list[Market], Field(min_length=1, max_length=500)]
    lanes: Annotated[list[Lane], Field(min_length=1, max_length=5000)]
    demand_overrides: list[DemandOverride] = Field(default_factory=list)
    emission_factors: EmissionFactors

    @model_validator(mode="after")
    def _references(self) -> Network:
        ids: list[str] = [x.id for group in (self.suppliers, self.plants, self.dcs, self.markets) for x in group]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"node ids must be unique: {sorted(dupes)}")
        sku_ids = [s.id for s in self.skus]
        if len(set(sku_ids)) != len(sku_ids):
            raise ValueError("SKU ids must be unique")
        lane_ids = [ln.id for ln in self.lanes]
        if len(set(lane_ids)) != len(lane_ids):
            raise ValueError("lane ids must be unique")

        kind = {s.id: "supplier" for s in self.suppliers}
        kind |= {p.id: "plant" for p in self.plants}
        kind |= {d.id: "dc" for d in self.dcs}
        kind |= {m.id: "market" for m in self.markets}
        allowed = {("supplier", "plant"), ("plant", "dc"), ("dc", "market")}
        for ln in self.lanes:
            if ln.origin not in kind or ln.destination not in kind:
                raise ValueError(f"lane {ln.id} refers to an unknown node")
            if (kind[ln.origin], kind[ln.destination]) not in allowed:
                raise ValueError(f"lane {ln.id} goes {kind[ln.origin]} → {kind[ln.destination]}, which is not allowed")
        pairs = {(ln.origin, ln.destination) for ln in self.lanes}
        if len(pairs) != len(self.lanes):
            raise ValueError("at most one lane per origin and destination")

        made = {s for p in self.plants for s in p.skus}
        unknown = made - set(sku_ids)
        if unknown:
            raise ValueError(f"plants make unknown SKUs: {sorted(unknown)}")
        unmade = set(sku_ids) - made
        if unmade:
            raise ValueError(f"no plant makes {sorted(unmade)}")
        for p in self.plants:
            if not any(ln.destination == p.id for ln in self.lanes):
                raise ValueError(f"plant {p.id} has no supplier lane")
            for share in p.sourcing:
                if (share.supplier, p.id) not in pairs:
                    raise ValueError(f"plant {p.id} sources from {share.supplier} but there is no lane between them")
        for d in self.dcs:
            sources = {ln.origin for ln in self.lanes if ln.destination == d.id}
            for s in sku_ids:
                if not any(p.id in sources and s in p.skus for p in self.plants):
                    raise ValueError(f"DC {d.id} has no lane from a plant that makes {s}")
        for m in self.markets:
            if kind.get(m.served_by) != "dc":
                raise ValueError(f"market {m.id} is served by {m.served_by}, which is not a DC")
            if (m.served_by, m.id) not in pairs:
                raise ValueError(f"market {m.id} has no lane from its DC {m.served_by}")
        for o in self.demand_overrides:
            if kind.get(o.market) != "market" or o.sku not in sku_ids:
                raise ValueError(f"demand override {o.market}/{o.sku} refers to an unknown market or SKU")
        return self

    # ---- lookups
    def sku(self, sku_id: str) -> SKU:
        return next(s for s in self.skus if s.id == sku_id)

    def lane(self, origin: str, destination: str) -> Lane | None:
        return next((ln for ln in self.lanes if ln.origin == origin and ln.destination == destination), None)

    def demand_mean(self, market_id: str, sku_id: str) -> float:
        for o in self.demand_overrides:
            if o.market == market_id and o.sku == sku_id:
                return o.mean
        m = next(m for m in self.markets if m.id == market_id)
        return self.sku(sku_id).base_demand * m.size_factor

    def demand_cv(self, market_id: str, sku_id: str) -> float:
        for o in self.demand_overrides:
            if o.market == market_id and o.sku == sku_id and o.cv is not None:
                return o.cv
        return self.sku(sku_id).demand_cv

    def source_plant(self, dc_id: str, sku_id: str) -> str:
        """The plant that supplies a SKU to a DC: the nearest (shortest lane) plant that makes it."""
        options = [
            (ln.distance_km, ln.origin)
            for ln in self.lanes
            if ln.destination == dc_id and any(p.id == ln.origin and sku_id in p.skus for p in self.plants)
        ]
        return min(options)[1]

    def node_kind(self, node_id: str) -> str | None:
        groups: tuple[tuple[str, list[Supplier] | list[Plant] | list[DC] | list[Market]], ...] = (
            ("supplier", self.suppliers), ("plant", self.plants), ("dc", self.dcs), ("market", self.markets),
        )
        for kind, group in groups:
            if any(x.id == node_id for x in group):
                return kind
        return None


def load_network(path: str | Path) -> Network:
    """Read and validate a network YAML file."""
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return Network.model_validate(data)


FOODNET = Path(__file__).resolve().parents[2] / "data" / "foodnet" / "network.yaml"


def load_foodnet() -> Network:
    return load_network(FOODNET)
