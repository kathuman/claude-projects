"""Helpers for simulator tests: tiny networks and one-line policies."""

from __future__ import annotations

from typing import Any

from core.domain.examples import EPOCH
from core.domain.mandate import DEFAULT_TERM, AuthorityLimit, LimitKind, Mandate
from core.domain.network import Network
from core.domain.policy import BaseStock, DecisionRule, Policy, Scope, Units


def mandate(limits: dict[LimitKind, float] | None = None, agent: str = "agent") -> Mandate:
    return Mandate(owner="o", approver="a", agent_id=agent, valid_from=EPOCH, expires_at=EPOCH + DEFAULT_TERM,
                   autonomy=[AuthorityLimit(kind=k, value=v) for k, v in (limits or {}).items()])


def policy(pid: str, rule: DecisionRule, nodes: list[str] | None = None, limits: dict[LimitKind, float] | None = None,
           **scope: Any) -> Policy:
    return Policy(id=pid, name=pid, intent_text="test", scope=Scope(nodes=nodes or [], **scope), rule=rule,
                  mandate=mandate(limits), constitution_ref="test@1")


def single_node(mu: float = 100, cv: float = 0.2, dc_lead_days: float = 14, chilled: bool = False,
                lost_sale: bool = False) -> Network:
    """One SKU, one supplier, one plant, one DC, one market: ample upstream, deterministic lead times."""
    sku: dict[str, Any] = {
        "id": "X", "name": "x", "abc_class": "A", "category": "chilled" if chilled else "ambient", "unit_cost": 1,
        "holding_cost_per_unit_period": 0.01, "backorder_penalty_per_unit_period": 0.1,
        "lost_sale_penalty_per_unit": 1, "unmet_demand": "lost_sale" if lost_sale else "backorder",
        "base_demand": mu, "demand_cv": cv, "weight_kg": 1,
    }
    if chilled:
        sku["shelf_life_days"] = 14
    loc = {"x_km": 0, "y_km": 0}
    return Network.model_validate({
        "name": "single", "skus": [sku],
        "suppliers": [{"id": "SUP", "name": "s", "location": loc, "capacity_per_period": 1e7, "unit_cost_index": 1,
                       "fill_rate_mean": 1, "fill_rate_sd": 0}],
        "plants": [{"id": "PL", "name": "p", "location": loc, "capacity_per_period": 1e7,
                    "production_cost_per_unit": 0, "skus": ["X"], "sourcing": [{"supplier": "SUP", "share": 1}]}],
        "dcs": [{"id": "DC", "name": "d", "location": loc, "storage_capacity": 1e7}],
        "markets": [{"id": "MK", "name": "m", "region": "R", "location": loc, "size_factor": 1, "served_by": "DC"}],
        "lanes": [
            {"id": "L1", "origin": "SUP", "destination": "PL", "mode": "road", "distance_km": 10, "cost_per_unit": 0,
             "lead_time_days": {"kind": "deterministic", "value": 7}},
            {"id": "L2", "origin": "PL", "destination": "DC", "mode": "road", "distance_km": 10, "cost_per_unit": 0,
             "lead_time_days": {"kind": "deterministic", "value": dc_lead_days},
             "expedite": {"mode": "express_road", "lead_time_days": {"kind": "deterministic", "value": 1},
                          "cost_multiplier": 3}},
            {"id": "L3", "origin": "DC", "destination": "MK", "mode": "road", "distance_km": 10, "cost_per_unit": 0,
             "lead_time_days": {"kind": "deterministic", "value": 1}},
        ],
        "emission_factors": {"road": 0.1, "rail": 0.03, "sea": 0.02, "air": 0.6, "express_road": 0.15},
    })


def ample_plant(units: float = 1e6) -> Policy:
    return policy("plant", BaseStock(target=Units(value=units)), nodes=["PL"])
