"""The quick test: a few seconds of simulation with the incumbent policy, for the Network Studio.

It answers "does this network work at all?" while editing: fill rates by market and DC, plant and supplier
utilisation, cost per week. A full stress test is the evaluation (core/evaluate/run.py).
"""

from __future__ import annotations

import numpy as np

from core.baselines import incumbent_policies
from core.domain.common import Model
from core.domain.network import Network
from core.domain.scenario import BaselineDemand, Scenario
from core.evaluate.metrics import WARMUP, compute
from core.sim.engine import simulate
from core.sim.layout import build_layout
from core.sim.program import compile_program
from core.sim.scenarios import generate


class QuickTest(Model):
    replications: int
    periods: int
    fill_rate: float
    fill_by_market: dict[str, float]
    fill_by_dc: dict[str, float]
    plant_utilisation: dict[str, float]
    supplier_utilisation: dict[str, float]  # shipped ÷ capacity
    cost_per_week: float
    seconds: float


def quick_test(net: Network, replications: int = 100, periods: int = 52, seed: int = 1) -> QuickTest:
    import time

    t0 = time.perf_counter()
    lay = build_layout(net)
    draws = generate(lay, Scenario(id="quick", name="quick", components=[BaselineDemand()]), replications, periods,
                     seed)
    res = simulate(lay, draws, compile_program(lay, incumbent_policies(lay)))
    m = compute(res, min(WARMUP, periods // 4))
    w = min(WARMUP, periods // 4)
    dem = res.demand[:, w:]
    short = np.minimum(dem, res.backorders[:, w:] + res.lost[:, w:])
    by_dc = {}
    for d, did in enumerate(lay.dc_ids):
        ms = lay.market_dc == d
        tot = dem[:, :, ms].sum()
        by_dc[did] = round(float(1 - short[:, :, ms].sum() / tot), 4) if tot > 0 else 1.0
    caps = lay.supplier_cap[None, None] * draws.supplier_cap
    return QuickTest(
        replications=replications, periods=periods, fill_rate=round(float(np.nanmean(m["fill_rate"])), 4),
        fill_by_market={mid: round(float(np.nanmean(m[f"fill_rate.market.{mid}"])), 4) for mid in lay.market_ids},
        fill_by_dc=by_dc,
        plant_utilisation={pid: round(float(res.utilisation[:, w:, p].mean()), 4)
                           for p, pid in enumerate(lay.plant_ids)},
        supplier_utilisation={sid: round(float((res.supplier_shipped[:, w:, s] / caps[:, w:, s]).mean()), 4)
                              for s, sid in enumerate(lay.supplier_ids)},
        cost_per_week=round(float(np.nanmean(m["cost_per_week"])), 2), seconds=round(time.perf_counter() - t0, 2))
