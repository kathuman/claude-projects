"""The escalation inbox: each alarm ranked by severity × (1 / reversibility) × financial exposure (brief §8.4).

- Severity: an assumption breach is high (critical when the mandate's `review_triggers` names the monitor or the
  assumption), input drift medium, performance high for service and medium for cost, a mandate escalation as its
  escalation rule says (high when no rule names the limit).
- Reversibility, 0–1: how easily what the policy does can be undone, taking its least reversible rule. Money spent on
  expediting is gone (0.4); a sourcing switch has a minimum dwell and a supplier relationship behind it (0.5);
  allocation 0.7; base stock and (s, S) only move stock targets (0.8). Network-level items (input drift) are 1.
- Exposure, EUR per week: the value flowing through the alarm's subject at unit cost plus the lost-sale penalty.
"""

from __future__ import annotations

import numpy as np

from core.domain.common import Model
from core.domain.policy import Composite, Policy
from core.monitor.monitors import Alarm
from core.monitor.stream import Run

SEVERITY_WEIGHT = {"low": 1, "medium": 2, "high": 3, "critical": 4}
REVERSIBILITY = {"expedite": 0.4, "sourcing_switch": 0.5, "allocation": 0.7, "base_stock": 0.8, "min_max": 0.8}


class Ranking(Model):
    severity: str
    reversibility: float
    exposure_eur_per_week: float
    score: float
    basis: str  # how the exposure was worked out


def rule_types(p: Policy) -> list[str]:
    r = p.rule
    return [x.type for x in r.rules] if isinstance(r, Composite) else [r.type]


def reversibility(p: Policy | None) -> float:
    if p is None:
        return 1.0
    return min((REVERSIBILITY.get(t, 0.8) for t in rule_types(p)), default=0.8)


def unit_value(ref: Run) -> np.ndarray:
    """EUR per unit of each SKU at risk: its value plus the penalty for not serving it ([K])."""
    lay = ref.lay
    out: np.ndarray = lay.unit_cost + np.maximum(lay.lost_penalty, lay.backorder_penalty)
    return out


def _mean_value(ref: Run, sku_mask: np.ndarray | None = None) -> float:
    lay = ref.lay
    dem = lay.demand_mean.sum(axis=0)  # [K]
    w = dem if sku_mask is None else dem * sku_mask
    return float(np.sum(w * unit_value(ref)) / max(float(np.sum(w)), 1e-9))


def _scope_mask(ref: Run, p: Policy) -> np.ndarray:
    lay = ref.lay
    sc = p.scope
    out = np.ones(lay.K, dtype=bool)
    for k, sid in enumerate(lay.sku_ids):
        sku = lay.net.sku(sid)
        if sc.skus and sid not in sc.skus:
            out[k] = False
        if sc.sku_classes and sku.abc_class not in sc.sku_classes:
            out[k] = False
        if sc.categories and sku.category not in sc.categories:
            out[k] = False
    return out.astype(np.float64)


def policy_exposure(ref: Run, p: Policy) -> float:
    """Weekly value of the demand for the SKUs in the policy's scope."""
    mask = _scope_mask(ref, p)
    dem = ref.lay.demand_mean.sum(axis=0) * mask
    return float(np.sum(dem * unit_value(ref)))


def supplier_units(ref: Run, sid: str, p: Policy | None) -> tuple[float, str]:
    """Units per week at stake at a supplier: its normal volume, or what the policy may shift to it, if larger."""
    lay = ref.lay
    s = lay.supplier_ids.index(sid)
    normal = float(ref.result.supplier_shipped[:, 8:, s].mean())
    units, basis = normal, f"{sid}'s normal volume, {normal:,.0f} units/week"
    if p is not None:
        rules = p.rule.rules if isinstance(p.rule, Composite) else [p.rule]
        for r in rules:
            if r.type == "sourcing_switch" and r.secondary == sid and r.primary in lay.supplier_ids:
                share = float(_scope_mask(ref, p) @ lay.demand_mean.sum(axis=0)) / float(lay.demand_mean.sum())
                primary = float(ref.result.supplier_shipped[:, 8:, lay.supplier_ids.index(r.primary)].mean())
                shifted = r.shift_fraction * primary * share
                if shifted > units:
                    units, basis = shifted, (f"the volume the policy may shift to {sid}: {r.shift_fraction:.0%} of "
                                             f"{r.primary}'s in-scope volume, {shifted:,.0f} units/week")
    return units, basis


def rank(alarm: Alarm, policy: Policy | None, ref: Run) -> Ranking:
    lay = ref.lay
    sev = "medium"
    if alarm.kind == "assumption":
        sev = "high"
        triggers = set(policy.mandate.review_triggers) if policy else set()
        if alarm.monitor_id in triggers or alarm.evidence.get("assumption_id") in triggers:
            sev = "critical"
    elif alarm.kind == "performance":
        sev = "high" if alarm.subject == "service" else "medium"
    elif alarm.kind == "mandate":
        sev = "high"
        if policy:
            for e in policy.mandate.escalation:
                if e.trigger.kind == "limit_breach" and e.trigger.limit.value == alarm.subject:
                    sev = e.severity.value
    rev = reversibility(policy) if alarm.kind != "input" else 1.0

    exposure, basis = 0.0, ""
    upd = alarm.update or {}
    if upd.get("supplier") in lay.supplier_ids:
        units, basis = supplier_units(ref, upd["supplier"], policy)
        exposure = units * _mean_value(ref, _scope_mask(ref, policy) if policy else None)
    elif upd.get("node") in lay.market_ids:
        m = lay.market_ids.index(upd["node"])
        exposure = float(lay.demand_mean[m] @ unit_value(ref))
        basis = f"{upd['node']}'s demand at unit value plus penalty"
    elif upd.get("node") in lay.plant_ids:
        p_i = lay.plant_ids.index(upd["node"])
        units = float(ref.result.utilisation[:, 8:, p_i].mean() * lay.plant_cap[p_i])
        exposure = units * _mean_value(ref)
        basis = f"{upd['node']}'s output, {units:,.0f} units/week"
    elif alarm.kind == "performance" and alarm.subject == "service":
        gap = max(0.0, float(alarm.evidence.get("p50", 0)) - float(alarm.evidence.get("value", 0)))
        total = float(lay.demand_mean.sum())
        exposure = gap * total * _mean_value(ref)
        basis = f"the service gap to the median, {gap:.1%} of {total:,.0f} units/week"
    elif alarm.kind == "performance":
        exposure = max(0.0, float(alarm.evidence.get("value", 0)) - float(alarm.evidence.get("p50", 0)))
        basis = "cost above the stress test's median"
    elif policy is not None:
        exposure = policy_exposure(ref, policy)
        basis = "the weekly value of the demand in the policy's scope"
    score = SEVERITY_WEIGHT[sev] * (1.0 / rev) * exposure
    return Ranking(severity=sev, reversibility=rev, exposure_eur_per_week=round(exposure, 2), score=round(score, 2),
                   basis=basis)
