"""The fixed vocabulary that rules and assumptions may refer to.

Decision rules may read only **state variables**: things an executing agent can observe about the supply chain.
Assumptions may also refer to **exogenous variables**: properties of the world the policy depends on (demand, lead
times, capacities). Anything outside this vocabulary is rejected by the schema itself, because a variable name is
an enum value.

Each variable has a unit, hard bounds for any threshold compared with it, and the qualifiers it takes (a supplier
for lead times, a node and optionally a SKU for stock levels).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import Field, model_validator

from core.domain.common import Id, Model


class Variable(StrEnum):
    # state: observable by an agent
    inventory_position = "inventory_position"
    on_hand = "on_hand"
    backorders = "backorders"
    pipeline = "pipeline"
    forecast = "forecast"
    observed_lead_time = "observed_lead_time"
    supplier_fill_rate = "supplier_fill_rate"
    capacity_utilisation = "capacity_utilisation"
    # exogenous: properties of the world
    demand = "demand"
    lead_time = "lead_time"
    supplier_capacity = "supplier_capacity"
    plant_capacity = "plant_capacity"


@dataclass(frozen=True)
class VarSpec:
    kind: str  # "state" or "exogenous"
    unit: str
    lo: float
    hi: float
    needs: str  # the qualifier it requires: "supplier", "node", "node_or_none"
    description: str


BIG = 1e7

VARIABLES: dict[Variable, VarSpec] = {
    Variable.inventory_position: VarSpec("state", "units", -BIG, BIG, "node_or_none", "on-hand + pipeline - backorder"),
    Variable.on_hand: VarSpec("state", "units", 0, BIG, "node_or_none", "physical stock at the node"),
    Variable.backorders: VarSpec("state", "units", 0, BIG, "node_or_none", "unfilled demand owed to customers"),
    Variable.pipeline: VarSpec("state", "units", 0, BIG, "node_or_none", "ordered, not yet received"),
    Variable.forecast: VarSpec("state", "units/period", 0, BIG, "node_or_none", "expected demand per period"),
    Variable.observed_lead_time: VarSpec("state", "days", 0, 730, "supplier", "lead time of recent receipts"),
    Variable.supplier_fill_rate: VarSpec("state", "fraction", 0, 1, "supplier", "share of ordered quantity shipped"),
    Variable.capacity_utilisation: VarSpec("state", "fraction", 0, 1, "node", "plant output / plant capacity"),
    Variable.demand: VarSpec("exogenous", "units/period", 0, BIG, "node_or_none", "customer demand per period"),
    Variable.lead_time: VarSpec("exogenous", "days", 0, 730, "supplier", "supplier lead time"),
    Variable.supplier_capacity: VarSpec("exogenous", "units/period", 0, BIG, "supplier", "supplier output per period"),
    Variable.plant_capacity: VarSpec("exogenous", "units/period", 0, BIG, "node", "plant output per period"),
}

STATE_VARIABLES = frozenset(v for v, s in VARIABLES.items() if s.kind == "state")


class VarRef(Model):
    """A variable with its qualifiers, written like `lead_time[supplier_B]` or `on_hand[DC_N, S01]`."""

    var: Variable = Field(description="A name from the fixed vocabulary")
    supplier: Id | None = Field(default=None, description="Supplier id, for supplier variables")
    node: Id | None = Field(default=None, description="Plant, DC or market id, for node variables")
    sku: Id | None = Field(default=None, description="SKU id; empty means summed over the SKUs in scope")

    @model_validator(mode="after")
    def _qualifiers(self) -> VarRef:
        needs = VARIABLES[self.var].needs
        if needs == "supplier":
            if self.supplier is None:
                raise ValueError(f"{self.var} needs a supplier")
            if self.node is not None or self.sku is not None:
                raise ValueError(f"{self.var} takes a supplier only")
        else:
            if self.supplier is not None:
                raise ValueError(f"{self.var} does not take a supplier")
            if needs == "node" and self.node is None:
                raise ValueError(f"{self.var} needs a node")
        return self

    @property
    def spec(self) -> VarSpec:
        return VARIABLES[self.var]

    def __str__(self) -> str:
        quals = [q for q in (self.supplier, self.node, self.sku) if q is not None]
        return f"{self.var}[{', '.join(quals)}]" if quals else str(self.var)


def check_threshold(ref: VarRef, threshold: float) -> None:
    """Raise if a threshold lies outside the variable's bounds."""
    s = ref.spec
    if not s.lo <= threshold <= s.hi:
        raise ValueError(f"threshold {threshold} for {ref} is outside {s.lo}..{s.hi} {s.unit}")
