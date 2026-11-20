"""Turn a scenario and a seed into all the random draws of a simulation.

Common random numbers: the base draws (demand noise, lead times, fill rates, signal noise) come from streams that
depend on the seed only, each spawned from one `SeedSequence` for one purpose. So every policy run on the same
`Draws` sees identical futures, and two scenarios with the same seed share the same base randomness, differing only
where the scenario says so.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from core.domain.scenario import (
    BaselineDemand,
    CorrelatedShock,
    DemandShift,
    LeadTimeInflation,
    PlantCapacityLoss,
    Scenario,
    SignalNoise,
    SupplierOutage,
)
from core.sim.layout import B, F, I, Layout

STREAMS = ("demand", "lead_time", "expedite_lead_time", "fill", "signal_noise", "shock")


@dataclass
class Draws:
    scenario_id: str
    seed: int
    R: int
    T: int
    demand: F  # [R, T, M, K] true demand, units
    signal: F  # [R, T, M, K] multiplicative noise on the demand that policies observe (1 = exact)
    lt_days: F  # [R, T, L] lead time of an order placed in period t on lane l, days
    exp_lt_days: F  # [R, T, L] the same for expedited orders
    fill: F  # [R, T, S] share of each order the supplier ships
    supplier_cap: F  # [R, T, S] capacity factor (1 = normal)
    plant_cap: F  # [R, T, P] capacity factor
    extra_delay: int = 0  # periods of information delay the scenario adds
    shocked: B = field(default_factory=lambda: np.zeros((0, 0), dtype=bool))  # [R, T] a correlated shock is on
    onset: I = field(default_factory=lambda: np.zeros(0, dtype=np.int64))  # [R] first disrupted period, −1 for none

    def subset(self, n: int) -> Draws:
        """The first n replications (the same futures, for baselines run on a subsample)."""
        return Draws(scenario_id=self.scenario_id, seed=self.seed, R=min(n, self.R), T=self.T,
                     demand=self.demand[:n], signal=self.signal[:n], lt_days=self.lt_days[:n],
                     exp_lt_days=self.exp_lt_days[:n], fill=self.fill[:n], supplier_cap=self.supplier_cap[:n],
                     plant_cap=self.plant_cap[:n], extra_delay=self.extra_delay,
                     shocked=self.shocked[:n] if self.shocked.size else self.shocked,
                     onset=self.onset[:n] if self.onset.size else self.onset)


def _season(lay: Layout, T: int, on: bool) -> F:
    t = np.arange(T)[:, None]
    if not on:
        return np.ones((T, lay.K))
    return 1.0 + lay.season_amp[None, :] * np.cos(2 * np.pi * (t - lay.season_peak[None, :]) / 52.0)


def _market_mask(lay: Layout, markets: list[str]) -> F:
    return np.array([not markets or m in markets for m in lay.market_ids], dtype=np.float64)


def generate(lay: Layout, scenario: Scenario, R: int, T: int, seed: int) -> Draws:
    """Draw everything a run of `R` replications over `T` periods needs."""
    rng = dict(zip(STREAMS, (np.random.default_rng(s) for s in np.random.SeedSequence(seed).spawn(len(STREAMS))),
                   strict=True))
    M, K, L, S, P = lay.M, lay.K, len(lay.lanes), lay.S, lay.P

    seasonal = all(c.seasonality for c in scenario.components if isinstance(c, BaselineDemand))
    z = rng["demand"].standard_normal((R, T, M, K))
    mean = lay.demand_mean[None, None] * _season(lay, T, seasonal)[None, :, None, :]
    demand = mean * (1.0 + lay.demand_cv[None, None] * z)

    lt = np.empty((R, T, L))
    exp_lt = np.empty((R, T, L))
    for i, ln in enumerate(lay.lanes):
        lt[:, :, i] = ln.lead_time_days.sample(rng["lead_time"], (R, T))
        exp_lt[:, :, i] = (ln.expedite.lead_time_days if ln.expedite else ln.lead_time_days).sample(
            rng["expedite_lead_time"], (R, T))
    fill = np.clip(rng["fill"].normal(lay.supplier_fill_mean, lay.supplier_fill_sd, (R, T, S)), 0.0, 1.0)
    noise_z = rng["signal_noise"].standard_normal((R, T, M, K))
    signal = np.ones((R, T, M, K))
    sup_cap = np.ones((R, T, S))
    plant_cap = np.ones((R, T, P))
    shocked = np.zeros((R, T), dtype=bool)
    onset = np.full(R, -1, dtype=np.int64)

    def mark(start: int) -> None:  # the earliest disruption so far, for every replication
        nonlocal onset
        if start < T:
            onset = np.where((onset < 0) | (onset > start), start, onset)
    extra_delay = 0
    t_idx = np.arange(T)

    def supplier_lanes(supplier: str) -> list[int]:
        return [i for i, ln in enumerate(lay.lanes) if ln.origin == supplier]

    for c in scenario.components:
        if isinstance(c, DemandShift):
            mark(c.window.start)
            w = list(c.window.periods(T))
            mk = _market_mask(lay, c.markets)
            sk = np.array([(not c.skus or s in c.skus) and (not c.categories or lay.net.sku(s).category in c.categories)
                           for s in lay.sku_ids], dtype=np.float64)
            factor = 1.0 + (c.factor - 1.0) * mk[:, None] * sk[None, :]
            demand[:, w] *= factor[None, None]
        elif isinstance(c, SupplierOutage):
            mark(c.window.start)
            sup_cap[:, list(c.window.periods(T)), lay.supplier_ids.index(c.supplier)] *= 1.0 - c.severity
        elif isinstance(c, PlantCapacityLoss):
            mark(c.window.start)
            plant_cap[:, list(c.window.periods(T)), lay.plant_ids.index(c.plant)] *= 1.0 - c.severity
        elif isinstance(c, LeadTimeInflation):
            mark(c.start)
            ramp = np.clip((t_idx - c.start + 1) / max(1, c.ramp_periods), 0.0, 1.0) if c.ramp_periods else (
                (t_idx >= c.start).astype(np.float64))
            ramp = np.where(t_idx >= c.start, ramp, 0.0)
            mult = 1.0 + (c.factor - 1.0) * ramp
            for i in supplier_lanes(c.supplier):
                lt[:, :, i] *= mult[None, :]
                exp_lt[:, :, i] *= mult[None, :]
        elif isinstance(c, CorrelatedShock):
            g = rng["shock"]
            occurs = g.random(R) < c.probability
            start = g.integers(c.earliest_start, c.latest_start + 1, R)
            on = occurs[:, None] & (t_idx[None, :] >= start[:, None]) & (t_idx[None, :] < start[:, None] + c.duration)
            shocked |= on
            hit = occurs & (start < T)
            onset = np.where(hit & ((onset < 0) | (onset > start)), start, onset)
            onf = on.astype(np.float64)
            for s in c.suppliers:
                j = lay.supplier_ids.index(s)
                sup_cap[:, :, j] *= 1.0 - c.supply_severity * onf
                for i in supplier_lanes(s):
                    lt[:, :, i] *= 1.0 + (c.lead_time_factor - 1.0) * onf
                    exp_lt[:, :, i] *= 1.0 + (c.lead_time_factor - 1.0) * onf
            mk = _market_mask(lay, c.markets) if c.markets else np.zeros(M)
            demand *= 1.0 + (c.demand_factor - 1.0) * onf[:, :, None, None] * mk[None, None, :, None]
        elif isinstance(c, SignalNoise):
            signal = np.maximum(0.0, 1.0 + c.noise_cv * noise_z)
            extra_delay += c.extra_delay

    return Draws(scenario_id=scenario.id, seed=seed, R=R, T=T, demand=np.maximum(demand, 0.0), signal=signal,
                 lt_days=lt, exp_lt_days=exp_lt, fill=fill, supplier_cap=sup_cap, plant_cap=plant_cap,
                 extra_delay=extra_delay, shocked=shocked, onset=onset)
