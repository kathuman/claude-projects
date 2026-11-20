"""Compile a bundle of policies onto the network's cells, as arrays the executors read.

Precedence: policies are listed from background to foreground. For each (node, SKU) cell, the last policy whose
scope covers it supplies the replenishment rule. The same goes for each node's allocation rule and each cell's
expedite trigger. Sourcing switches all apply, in order, to the plants and SKUs in their scope.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from core.domain.condition import Condition
from core.domain.mandate import DEFAULT_TERM, LimitKind, Mandate
from core.domain.policy import (
    AllocationRule,
    BaseStock,
    DaysOfCover,
    ExpediteTrigger,
    MinMax,
    Policy,
    ProjectedStockout,
    Scope,
    SourcingSwitch,
)
from core.domain.vocabulary import Variable
from core.sim.layout import B, F, I, Layout


@dataclass
class Replenishment:
    kind: I  # [N, K] 0 none, 1 base stock, 2 min-max
    target: F  # [N, K] base-stock target, or S
    target_days: B  # [N, K] the target is in days of cover
    reorder: F  # [N, K] s (min-max)
    reorder_days: B
    review: I  # [N, K] periods between reviews
    owner: I  # [N, K] index of the policy that set the rule, −1 for none


@dataclass
class Expedite:
    policy: int
    cells: B  # [N, K]
    projected_stockout: bool  # else: coverage below
    param: float  # periods (stockout) or days (coverage)
    cap: float  # EUR per period


@dataclass
class Allocation:
    policy: int
    node: int
    method: str
    priority: list[int]  # indices of served markets (DC) or DCs (plant), most protected first
    reservation: float  # 0..1


@dataclass
class Sourcing:
    policy: int
    cells: B  # [P, K] plant cells whose material is switched
    primary: int
    secondary: int
    rule: SourcingSwitch


@dataclass
class MandatePlan:
    policy: int
    order_change: float | None  # fraction, e.g. 0.15
    expedite_spend: float | None  # EUR per period
    volume_shift: float | None  # fraction
    max_switches: int | None
    escalations: list[tuple[Condition, str]] = field(default_factory=list)  # (condition, severity)


@dataclass
class Program:
    policies: list[Policy]
    replenishment: Replenishment
    expedites: list[Expedite]
    allocations: dict[int, Allocation]
    sourcing: list[Sourcing]
    mandates: list[MandatePlan]
    supported: dict[str, list[str]] = field(default_factory=dict)  # notes on things the simulator skipped
    # A baseline may plan the orders itself: (observation, period) → orders [R, N, K]. None = the rule executors.
    decider: Callable[[Any, int], F] | None = None


def scope_cells(lay: Layout, scope: Scope) -> B:
    """[N, K] cells covered by a scope (empty lists mean no restriction)."""
    nodes = np.array([not scope.nodes or n in scope.nodes for n in lay.node_ids])
    skus = np.array([
        (not scope.skus or s in scope.skus)
        and (not scope.sku_classes or lay.sku_class[k] in scope.sku_classes)
        and (not scope.categories or lay.net.sku(s).category in scope.categories)
        for k, s in enumerate(lay.sku_ids)
    ])
    out: B = nodes[:, None] & skus[None, :] & lay.cell
    return out


def compile_program(lay: Layout, policies: list[Policy]) -> Program:
    N, K = lay.N, lay.K
    rep = Replenishment(
        kind=np.zeros((N, K), dtype=np.int64), target=np.zeros((N, K)), target_days=np.zeros((N, K), dtype=bool),
        reorder=np.zeros((N, K)), reorder_days=np.zeros((N, K), dtype=bool), review=np.ones((N, K), dtype=np.int64),
        owner=np.full((N, K), -1, dtype=np.int64),
    )
    expedites: list[Expedite] = []
    allocations: dict[int, Allocation] = {}
    sourcing: list[Sourcing] = []
    mandates: list[MandatePlan] = []
    notes: dict[str, list[str]] = {}

    for i, pol in enumerate(policies):
        cells = scope_cells(lay, pol.scope)
        m = pol.mandate
        mandates.append(MandatePlan(
            policy=i,
            order_change=_pct(m, LimitKind.order_qty_change_pct),
            expedite_spend=m.limit(LimitKind.expedite_spend_per_period),
            volume_shift=_pct(m, LimitKind.volume_shift_pct),
            max_switches=None if m.limit(LimitKind.consecutive_sourcing_switches) is None
            else int(m.limit(LimitKind.consecutive_sourcing_switches) or 0),
            escalations=[(e.trigger.condition, str(e.severity)) for e in m.escalation if e.trigger.kind == "condition"],
        ))
        for rule in pol.simple_rules():
            if isinstance(rule, BaseStock):
                rep.kind[cells] = 1
                rep.target[cells] = rule.target.value
                rep.target_days[cells] = isinstance(rule.target, DaysOfCover)
                rep.review[cells] = rule.review_period
                rep.owner[cells] = i
            elif isinstance(rule, MinMax):
                rep.kind[cells] = 2
                rep.target[cells] = rule.order_up_to.value
                rep.target_days[cells] = isinstance(rule.order_up_to, DaysOfCover)
                rep.reorder[cells] = rule.reorder_point.value
                rep.reorder_days[cells] = isinstance(rule.reorder_point, DaysOfCover)
                rep.review[cells] = 1
                rep.owner[cells] = i
            elif isinstance(rule, ExpediteTrigger):
                for e in expedites:  # a later trigger takes over the cells it covers
                    e.cells = e.cells & ~cells
                expedites.append(Expedite(
                    policy=i, cells=cells.copy(), projected_stockout=isinstance(rule.condition, ProjectedStockout),
                    param=float(rule.condition.within_periods if isinstance(rule.condition, ProjectedStockout)
                                else rule.condition.days),
                    cap=rule.cost_cap_per_period))
            elif isinstance(rule, AllocationRule):
                for n in np.flatnonzero(cells.any(axis=1)):
                    allocations[int(n)] = Allocation(policy=i, node=int(n), method=rule.method,
                                                     priority=_priority(lay, int(n), rule.priority),
                                                     reservation=rule.reservation_pct / 100.0)
            elif isinstance(rule, SourcingSwitch):
                if rule.primary not in lay.supplier_ids or rule.secondary not in lay.supplier_ids:
                    notes.setdefault(pol.id, []).append("sourcing switch names an unknown supplier: skipped")
                    continue
                for c in (rule.trigger, rule.switch_back):
                    if c is not None and c.var.var not in (Variable.supplier_fill_rate, Variable.observed_lead_time):
                        notes.setdefault(pol.id, []).append(f"sourcing trigger on {c.var.var} is read as a total")
                plant_cells = cells[: lay.P]
                if not plant_cells.any():  # scoped to DCs or markets only: switch at every plant, same SKU filter
                    plant_cells = scope_cells(lay, pol.scope.model_copy(update={"nodes": []}))[: lay.P]
                sec = lay.supplier_ids.index(rule.secondary)
                reachable = (lay.sp_lane[:, sec] >= 0)[:, None]  # only plants with a lane from the secondary
                sourcing.append(Sourcing(policy=i, cells=plant_cells & lay.makes & reachable,
                                         primary=lay.supplier_ids.index(rule.primary), secondary=sec, rule=rule))
    return Program(policies=policies, replenishment=rep, expedites=expedites, allocations=allocations,
                   sourcing=sourcing, mandates=mandates, supported=notes)


def _pct(m: Mandate, kind: LimitKind) -> float | None:
    v = m.limit(kind)
    return None if v is None else v / 100.0


def _priority(lay: Layout, node: int, ids: list[str]) -> list[int]:
    """Positions of the priority nodes among the node's children (a DC's markets in index order; a plant's DCs)."""
    if node >= lay.P:  # a DC: its markets
        d = node - lay.P
        served = [lay.market_ids[m] for m in range(lay.M) if lay.market_dc[m] == d]
        return [served.index(x) for x in ids if x in served]
    return [lay.dc_ids.index(x) for x in ids if x in lay.dc_ids]


def background_policies(lay: Layout, dc_days: float = 14, plant_days: float = 35) -> list[Policy]:
    """Plain base-stock rules for every cell: the default for cells that no other policy covers."""
    from core.domain.examples import EPOCH

    mandate = Mandate(owner="system", approver="system", agent_id="background", valid_from=EPOCH,
                      expires_at=EPOCH + DEFAULT_TERM)

    def pol(pid: str, nodes: list[str], days: float) -> Policy:
        return Policy(id=pid, name=pid, intent_text="Background base-stock rule.", scope=Scope(nodes=nodes),
                      rule=BaseStock(target=DaysOfCover(value=days)), mandate=mandate, constitution_ref="none")

    return [pol("background-plants", lay.plant_ids, plant_days), pol("background-dcs", lay.dc_ids, dc_days)]
