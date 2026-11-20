"""Metrics per replication, then their distributions.

Every metric is an array over replications [R], computed after a warm-up. Each has a unit and a direction (is
higher better?), so the distribution summaries can report the tail in the bad direction (CVaR) and the verdict can
compare policies.

Definitions (see also DECISIONS.md D023):
- **fill rate**: the share of demand met from stock in the period it arose. Backlog is served first, so the
  current period's shortfall is min(demand, backorders at the end + lost sales).
- **OTIF**: the share of (market, SKU, period) lines with demand that were met in full in the period.
- **backorder units**: the units of demand not met on time (summed over the horizon).
- **stockout periods**: periods with a shortfall, averaged over (market, SKU) lines.
- **peak service loss / recovery**: the pre-shock weekly fill rate minus the lowest 4-week rolling fill rate after
  the scenario's onset; and the periods from the onset until the rolling fill rate is back within 1 pp of the
  pre-shock level (the remaining horizon if it never is). Not defined for scenarios without a shock.
- **bullwhip ratio**: the variance over time of an echelon's total orders, divided by the variance of total
  consumer demand.
- **nervousness**: the mean period-to-period absolute change of a cell's orders, relative to its mean order.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from core.sim.engine import COST_KEYS, SimResult
from core.sim.layout import F

WARMUP = 8  # periods left out while the system settles from its initial state
RECOVERY_TOLERANCE = 0.01
ROLL = 4  # periods in the rolling window for resilience


@dataclass(frozen=True)
class MetricInfo:
    label: str
    unit: str
    higher_is_better: bool
    group: str  # service, cost, resilience, stability, governance, carbon, inventory


def _info() -> dict[str, MetricInfo]:
    m: dict[str, MetricInfo] = {
        "fill_rate": MetricInfo("Fill rate", "fraction", True, "service"),
        "otif": MetricInfo("OTIF (lines met in full)", "fraction", True, "service"),
        "backorder_units": MetricInfo("Units short on time", "units", False, "service"),
        "stockout_periods": MetricInfo("Stockout periods per line", "periods", False, "service"),
        "cost_total": MetricInfo("Total cost", "EUR", False, "cost"),
        "cost_per_week": MetricInfo("Total cost per week", "EUR/week", False, "cost"),
        "expedite_month_max": MetricInfo("Worst monthly expedite spend", "EUR/month", False, "cost"),
        "peak_service_loss": MetricInfo("Peak service loss after the shock", "fraction", False, "resilience"),
        "recovery_periods": MetricInfo("Time to recover service", "periods", False, "resilience"),
        "bullwhip_dc": MetricInfo("Bullwhip ratio, DC orders", "ratio", False, "stability"),
        "bullwhip_plant": MetricInfo("Bullwhip ratio, plant orders", "ratio", False, "stability"),
        "nervousness": MetricInfo("Order nervousness", "fraction", False, "stability"),
        "switches": MetricInfo("Sourcing switches", "switches", False, "stability"),
        "escalations": MetricInfo("Escalations", "count", False, "governance"),
        "limit_hits": MetricInfo("Mandate limit hits", "count", False, "governance"),
        "co2_t": MetricInfo("Emissions", "t CO2e", False, "carbon"),
        "inventory_days_max": MetricInfo("Inventory days, highest DC", "days", False, "inventory"),
    }
    for k in COST_KEYS:
        m[f"cost.{k}"] = MetricInfo(f"Cost: {k}", "EUR", False, "cost")
    return m


METRICS = _info()


def info(name: str) -> MetricInfo:
    """Metadata for a metric, including the breakdowns (fill_rate.class.A, inventory_days.node.DC_N, ...)."""
    if name in METRICS:
        return METRICS[name]
    base, _, what = name.partition(".")
    parent = METRICS["fill_rate" if base == "fill_rate" else "inventory_days_max" if base == "inventory_days"
                     else base]
    return MetricInfo(f"{parent.label} ({what.replace('.', ' ')})", parent.unit, parent.higher_is_better, parent.group)


def _shortfall(res: SimResult, w: int) -> tuple[F, F]:
    dem = res.demand[:, w:]
    short: F = np.minimum(dem, res.backorders[:, w:] + res.lost[:, w:])
    return dem, short


def _ratio(num: F, den: F) -> F:
    out: F = np.where(den > 0, num / np.where(den > 0, den, 1.0), np.nan)
    return out


def weekly_fill(res: SimResult, w: int = WARMUP) -> F:
    """[R, T − w] network fill rate in each period."""
    dem, short = _shortfall(res, w)
    return 1.0 - _ratio(short.sum(axis=(2, 3)), dem.sum(axis=(2, 3)))


def _rolling(x: F, n: int) -> F:
    c = np.cumsum(np.nan_to_num(x), axis=1)
    out = np.full_like(x, np.nan)
    out[:, n - 1:] = (c[:, n - 1:] - np.concatenate([np.zeros((x.shape[0], 1)), c[:, :-n]], axis=1)) / n
    return out


def resilience(res: SimResult, w: int = WARMUP) -> tuple[F, F]:
    """(peak service loss [R], periods to recover [R]); NaN where the scenario has no shock in the window."""
    R, T = res.R, res.T
    fill = np.full((R, T), np.nan)
    fill[:, w:] = weekly_fill(res, w)
    roll = _rolling(fill, ROLL)
    loss = np.full(R, np.nan)
    rec = np.full(R, np.nan)
    for r in range(R):
        o = int(res.onset[r])
        if o < w + ROLL or o >= T - 1:
            continue
        pre = float(np.nanmean(fill[r, max(w, o - 12):o]))
        after = roll[r, o:]
        trough = int(np.nanargmin(after))
        loss[r] = max(0.0, pre - float(after[trough]))
        if loss[r] <= RECOVERY_TOLERANCE:
            rec[r] = 0.0
            continue
        back = np.flatnonzero(after[trough:] >= pre - RECOVERY_TOLERANCE)
        rec[r] = float(trough + back[0]) if back.size else float(T - o)
    return loss, rec


def monthly(x: F, w: int) -> F:
    """[R, months] sums of a per-period series [R, T] over calendar months (52 weeks = 12 months)."""
    T = x.shape[1]
    month = (np.arange(T) * 12) // 52
    keep = np.arange(T) >= w
    months = np.unique(month[keep])
    out: F = np.stack([x[:, keep & (month == m)].sum(axis=1) for m in months], axis=1)
    return out


def inventory_days(res: SimResult, w: int = WARMUP) -> F:
    """[R, D] average days of demand held at each DC."""
    lay = res.layout
    stock = res.on_hand[:, w:, lay.P:].sum(axis=3).mean(axis=1)  # [R, D]
    daily = np.stack([res.demand[:, w:, lay.market_dc == d].sum(axis=(2, 3)).mean(axis=1) for d in range(lay.D)],
                     axis=1) / lay.period_days
    return _ratio(stock, daily)


def compute(res: SimResult, w: int = WARMUP) -> dict[str, F]:
    """Every metric for every replication of one run."""
    lay = res.layout
    dem, short = _shortfall(res, w)
    out: dict[str, F] = {}
    tot_d = dem.sum(axis=(1, 2, 3))
    out["fill_rate"] = 1.0 - _ratio(short.sum(axis=(1, 2, 3)), tot_d)
    for cls in sorted(set(lay.sku_class)):
        mk = np.array([c == cls for c in lay.sku_class])
        out[f"fill_rate.class.{cls}"] = 1.0 - _ratio(short[..., mk].sum(axis=(1, 2, 3)),
                                                     dem[..., mk].sum(axis=(1, 2, 3)))
    for cat, mk in (("chilled", lay.chilled), ("ambient", ~lay.chilled)):
        if mk.any():
            out[f"fill_rate.category.{cat}"] = 1.0 - _ratio(short[..., mk].sum(axis=(1, 2, 3)),
                                                            dem[..., mk].sum(axis=(1, 2, 3)))
    for m, mid in enumerate(lay.market_ids):
        out[f"fill_rate.market.{mid}"] = 1.0 - _ratio(short[:, :, m].sum(axis=(1, 2)), dem[:, :, m].sum(axis=(1, 2)))
    for k, sid in enumerate(lay.sku_ids):
        out[f"fill_rate.sku.{sid}"] = 1.0 - _ratio(short[..., k].sum(axis=(1, 2)), dem[..., k].sum(axis=(1, 2)))
    lines = dem > 1e-9
    out["otif"] = _ratio((lines & (short <= 1e-9)).sum(axis=(1, 2, 3)).astype(float),
                         lines.sum(axis=(1, 2, 3)).astype(float))
    out["backorder_units"] = short.sum(axis=(1, 2, 3))
    out["stockout_periods"] = (short > 1e-9).sum(axis=1).mean(axis=(1, 2)).astype(float)

    cost = {name: v[:, w:].sum(axis=1) for name, v in res.cost.items()}
    for name, v in cost.items():
        out[f"cost.{name}"] = v
    out["cost_total"] = sum(cost.values(), start=np.zeros(res.R))
    out["cost_per_week"] = out["cost_total"] / max(1, res.T - w)
    out["expedite_month_max"] = monthly(res.cost["expedite"], w).max(axis=1)

    out["peak_service_loss"], out["recovery_periods"] = resilience(res, w)

    dvar = res.demand[:, w:].sum(axis=(2, 3)).var(axis=1)
    out["bullwhip_dc"] = _ratio(res.orders[:, w:, lay.P:].sum(axis=(2, 3)).var(axis=1), dvar)
    out["bullwhip_plant"] = _ratio(res.orders[:, w:, :lay.P].sum(axis=(2, 3)).var(axis=1), dvar)
    q = res.orders[:, w:]  # [R, T', N, K]
    mean_q = q.mean(axis=1)
    change = np.abs(np.diff(q, axis=1)).mean(axis=1)
    rel = _ratio(change, mean_q)
    out["nervousness"] = np.nanmean(np.where(mean_q > 1e-9, rel, np.nan), axis=(1, 2))
    out["switches"] = res.switches.sum(axis=1)
    out["escalations"] = res.escalations[:, w:].sum(axis=1)
    out["limit_hits"] = sum((h[:, w:].sum(axis=1) for h in res.limit_hits.values()), start=np.zeros(res.R))
    out["co2_t"] = res.co2_t[:, w:].sum(axis=1)
    days = inventory_days(res, w)
    for d, did in enumerate(lay.dc_ids):
        out[f"inventory_days.node.{did}"] = days[:, d]
    out["inventory_days_max"] = np.nanmax(days, axis=1)
    return out


# ---------------------------------------------------------------- distributions
@dataclass(frozen=True)
class Summary:
    mean: float | None
    p5: float | None
    p50: float | None
    p95: float | None
    cvar: float | None  # mean of the worst (1 − level) share, in the metric's bad direction
    n: int  # replications with a value


def cvar(x: F, level: float, higher_is_better: bool) -> float | None:
    v = x[~np.isnan(x)]
    if v.size == 0:
        return None
    tail = max(1, int(np.ceil((1 - level) * v.size - 1e-9)))  # 1e-9: (1 - 0.95) * 100 is 5.000000000000004
    s = np.sort(v)
    worst = s[:tail] if higher_is_better else s[-tail:]
    return float(worst.mean())


def summarise(x: F, level: float, higher_is_better: bool) -> Summary:
    v = x[~np.isnan(x)]
    if v.size == 0:
        return Summary(None, None, None, None, None, 0)
    p5, p50, p95 = (float(q) for q in np.percentile(v, [5, 50, 95]))
    return Summary(float(v.mean()), p5, p50, p95, cvar(v, level, higher_is_better), int(v.size))


def regret(values: dict[str, F], higher_is_better: bool) -> dict[str, F]:
    """Per replication, how far each policy is from the best policy in that replication (≥ 0)."""
    stack = np.stack(list(values.values()))
    best = np.nanmax(stack, axis=0) if higher_is_better else np.nanmin(stack, axis=0)
    return {k: (best - v) if higher_is_better else (v - best) for k, v in values.items()}


def fan(series: F, w: int = WARMUP) -> dict[str, list[float]]:
    """Percentile bands over time of a per-period series [R, T]: for fan charts."""
    x = series[:, w:]
    qs = np.nanpercentile(x, [5, 25, 50, 75, 95], axis=0)
    return {f"p{p}": [round(float(v), 6) for v in row] for p, row in zip((5, 25, 50, 75, 95), qs, strict=True)}
