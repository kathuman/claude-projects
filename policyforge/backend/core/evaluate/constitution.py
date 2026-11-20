"""Evaluate a constitution's hard constraints on a run, replication by replication.

Each constraint is measured on its scope (SKU class, category, SKU, market or DC) and its window: over the horizon,
the worst calendar month (52 weeks = 12 months), or the worst period. Its breach share is the share of replications
that break it; the constraint passes when that share is at most the constitution's α.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.domain.constitution import Constitution, HardConstraint, Metric
from core.evaluate.metrics import WARMUP, inventory_days, monthly
from core.sim.engine import SimResult
from core.sim.layout import F


@dataclass(frozen=True)
class ConstraintResult:
    id: str
    text: str
    description: str
    breach_share: float  # share of replications that break it
    passed: bool  # breach_share ≤ α
    worst: float | None  # the worst value seen (in the bad direction), in the metric's unit
    median: float | None


def _masks(res: SimResult, c: HardConstraint) -> tuple[np.ndarray, np.ndarray]:
    lay, sc = res.layout, c.scope
    skus = np.array([
        (sc.sku is None or s == sc.sku) and (sc.sku_class is None or lay.sku_class[k] == sc.sku_class)
        and (sc.category is None or lay.net.sku(s).category == sc.category)
        for k, s in enumerate(lay.sku_ids)
    ])
    if sc.node is None:
        markets = np.ones(lay.M, dtype=bool)
    elif sc.node in lay.market_ids:
        markets = np.array([m == sc.node for m in lay.market_ids])
    elif sc.node in lay.dc_ids:
        markets = lay.market_dc == lay.dc_ids.index(sc.node)
    else:
        markets = np.zeros(lay.M, dtype=bool)
    return skus, markets


def _per_window(per_period: F, window: str, w: int, agg: str) -> F:
    """Reduce a [R, T] series to [R]: horizon total, worst month, or worst period (agg = 'max' or 'min')."""
    if window == "horizon":
        out: F = per_period[:, w:].sum(axis=1)
        return out
    blocks = monthly(per_period, w) if window == "month" else per_period[:, w:]
    red: F = blocks.max(axis=1) if agg == "max" else blocks.min(axis=1)
    return red


def values(res: SimResult, c: HardConstraint, w: int = WARMUP) -> F:
    """The constrained quantity for each replication, in the metric's unit."""
    m = c.metric
    if m in (Metric.fill_rate, Metric.otif, Metric.backorder_units, Metric.stockout_periods):
        skus, markets = _masks(res, c)
        dem = res.demand[:, :, markets][..., skus]
        short = np.minimum(dem, (res.backorders + res.lost)[:, :, markets][..., skus])
        if m == Metric.backorder_units:
            return _per_window(short.sum(axis=(2, 3)), c.window, w, "max")
        if m == Metric.stockout_periods:
            out: F = (short[:, w:] > 1e-9).sum(axis=1).mean(axis=(1, 2)).astype(float)
            return out
        if m == Metric.fill_rate:
            num, den = short.sum(axis=(2, 3)), dem.sum(axis=(2, 3))
        else:  # OTIF: lines met in full
            lines = dem > 1e-9
            num = (lines & (short > 1e-9)).sum(axis=(2, 3)).astype(float)
            den = lines.sum(axis=(2, 3)).astype(float)
        if c.window == "horizon":
            n, d = num[:, w:].sum(axis=1), den[:, w:].sum(axis=1)
        elif c.window == "month":
            n, d = monthly(num, w), monthly(den, w)
        else:
            n, d = num[:, w:], den[:, w:]
        frac = 1.0 - np.where(d > 0, n / np.where(d > 0, d, 1.0), 0.0)
        result: F = frac if frac.ndim == 1 else frac.min(axis=1)
        return result
    if m == Metric.expedite_spend:
        return _per_window(res.cost["expedite"], c.window, w, "max")
    if m == Metric.total_cost:
        return _per_window(res.total_cost, c.window, w, "max")
    if m == Metric.co2_tonnes:
        return _per_window(res.co2_t, c.window, w, "max")
    # inventory days: one DC, or the highest DC
    days = inventory_days(res, w)
    if c.scope.node in res.layout.dc_ids:
        col: F = days[:, res.layout.dc_ids.index(c.scope.node)]
        return col
    top: F = np.nanmax(days, axis=1)
    return top


def check(res: SimResult, constitution: Constitution, w: int = WARMUP) -> list[ConstraintResult]:
    out = []
    for c in constitution.hard_constraints:
        v = values(res, c, w)
        ok = v >= c.threshold - 1e-12 if c.op == "ge" else v <= c.threshold + 1e-12
        share = float(1.0 - ok.mean()) if v.size else 0.0
        finite = v[~np.isnan(v)]
        worst = (float(finite.min()) if c.op == "ge" else float(finite.max())) if finite.size else None
        out.append(ConstraintResult(id=c.id, text=str(c), description=c.description, breach_share=share,
                                    passed=share <= constitution.breach_alpha + 1e-12, worst=worst,
                                    median=float(np.median(finite)) if finite.size else None))
    return out
