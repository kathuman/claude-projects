"""What a scenario changes, period by period, for the scenario builder's preview.

Each series is the scenario's draws divided by the baseline's draws for the same seed (common random numbers), so
the noise cancels and only the scenario's effect is left: demand by market, supplier capacity, supplier lead time,
plant capacity, and the share of futures in which a correlated shock is on.
"""

from __future__ import annotations

import numpy as np

from core.domain.common import Model
from core.domain.scenario import BaselineDemand, Scenario
from core.sim.layout import Layout
from core.sim.scenarios.generate import generate


class Preview(Model):
    periods: int
    demand: dict[str, list[float]]  # market → multiplier per period
    supplier_capacity: dict[str, list[float]]
    supplier_lead_time: dict[str, list[float]]
    plant_capacity: dict[str, list[float]]
    shock_share: list[float]  # share of futures with a correlated shock on
    signal_noise: float  # CV of the noise on observed demand
    extra_delay: int  # periods


def _r(x: np.ndarray) -> list[float]:
    return [round(float(v), 4) for v in x]


def preview(lay: Layout, scenario: Scenario, periods: int = 104, replications: int = 200, seed: int = 7) -> Preview:
    sc = generate(lay, scenario, replications, periods, seed)
    base = generate(lay, Scenario(id="base", name="base", components=[BaselineDemand(seasonality=True)]),
                    replications, periods, seed)
    dem_s = sc.demand.sum(axis=(0, 3))  # [T, M]
    dem_b = np.maximum(base.demand.sum(axis=(0, 3)), 1e-9)
    lt = {}
    for j, sid in enumerate(lay.supplier_ids):
        lanes = [i for i, ln in enumerate(lay.lanes) if ln.origin == sid]
        if lanes:
            lt[sid] = _r(sc.lt_days[:, :, lanes].mean(axis=(0, 2)) / base.lt_days[:, :, lanes].mean(axis=(0, 2)))
        else:
            lt[sid] = [1.0] * periods
        del j
    noise = float(np.std(sc.signal)) if sc.signal.size else 0.0
    return Preview(
        periods=periods,
        demand={mid: _r(dem_s[:, m] / dem_b[:, m]) for m, mid in enumerate(lay.market_ids)},
        supplier_capacity={sid: _r(sc.supplier_cap[:, :, j].mean(axis=0)) for j, sid in enumerate(lay.supplier_ids)},
        supplier_lead_time=lt,
        plant_capacity={pid: _r(sc.plant_cap[:, :, p].mean(axis=0)) for p, pid in enumerate(lay.plant_ids)},
        shock_share=_r(sc.shocked.mean(axis=0)) if sc.shocked.size else [0.0] * periods,
        signal_noise=round(noise, 4), extra_delay=sc.extra_delay)
