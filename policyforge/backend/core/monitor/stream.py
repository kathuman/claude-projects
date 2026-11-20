"""The live stream: the network run with the deployed policies, one replication, from a hidden true scenario.

The hidden world is a list of switches: from week `w`, the true scenario gains a component. Draws are spliced, so weeks
before a switch come from the old world and later weeks from the new one. The base randomness is the same in every
world (common random numbers), so a switch can never change what has already been observed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Literal

import numpy as np
from pydantic import Field, model_validator

from core.baselines import incumbent_policies
from core.domain.common import Model
from core.domain.network import Network
from core.domain.policy import Policy
from core.domain.scenario import (
    BaselineDemand,
    Component,
    DemandShift,
    LeadTimeInflation,
    PlantCapacityLoss,
    Scenario,
    SupplierOutage,
)
from core.sim.engine import SimConfig, SimResult, simulate
from core.sim.layout import Layout, build_layout
from core.sim.program import compile_program
from core.sim.scenarios import generate
from core.sim.scenarios.generate import Draws

F = np.ndarray
MAX_HORIZON = 156
CAPACITY_NOISE = 0.02  # reported capacity: the true capacity with 2 % measurement noise

Injection = Annotated[DemandShift | SupplierOutage | LeadTimeInflation | PlantCapacityLoss, Field(discriminator="kind")]


class Switch(Model):
    """From `week`, the true world also has `component` (its own window says when it bites)."""

    week: int = Field(ge=0, le=MAX_HORIZON)
    component: Injection
    note: str = Field(default="", max_length=200)


class StreamConfig(Model):
    seed: int = Field(default=1, ge=0)
    horizon: int = Field(default=104, ge=26, le=MAX_HORIZON)
    switches: list[Switch] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _ordered(self) -> StreamConfig:
        weeks = [s.week for s in self.switches]
        if weeks != sorted(weeks):
            raise ValueError("switches must be in week order")
        return self


def world_at(cfg: StreamConfig, upto: int) -> Scenario:
    """The true scenario with the first `upto` switches."""
    comps: list[Component] = [BaselineDemand(), *(s.component for s in cfg.switches[:upto])]
    return Scenario(id=f"live-{upto}", name="the live world", components=comps)


def spliced_draws(lay: Layout, cfg: StreamConfig, R: int = 1) -> Draws:
    """Draws for the whole horizon, each week from the world in force that week."""
    base = generate(lay, world_at(cfg, 0), R, cfg.horizon, cfg.seed)
    for i, sw in enumerate(cfg.switches, start=1):
        if sw.week >= cfg.horizon:
            continue
        new = generate(lay, world_at(cfg, i), R, cfg.horizon, cfg.seed)
        w = sw.week
        for name in ("demand", "signal", "lt_days", "exp_lt_days", "fill", "supplier_cap", "plant_cap"):
            arr = getattr(base, name).copy()
            arr[:, w:] = getattr(new, name)[:, w:]
            setattr(base, name, arr)
        shocked = base.shocked.copy()
        shocked[:, w:] = new.shocked[:, w:]
        base.shocked = shocked
        base.onset = np.where((base.onset < 0) & (new.onset >= w), new.onset, base.onset)
    base.scenario_id = "live"
    return base


@dataclass
class Observations:
    """What the operations team sees each week ([R, T, …]; the stream has R = 1). NaN = nothing to observe."""

    T: int
    demand: F  # [R, T, M] units, summed over SKUs
    lead_time: F  # [R, T, S] days, of shipments that arrived that week
    fill_rate: F  # [R, T, S] shipped ÷ ordered
    supplier_capacity: F  # [R, T, S] reported, units/period
    plant_capacity: F  # [R, T, P] reported, units/period
    utilisation: F  # [R, T, P]
    on_hand: F  # [R, T, N, K]
    service: F  # [R, T] fill rate of market demand that week
    cost: F  # [R, T] EUR
    escalations: F  # [R, T]
    limit_hits: dict[str, F] = field(default_factory=dict)  # each [R, T]


def observe(lay: Layout, draws: Draws, res: SimResult, seed: int) -> Observations:
    R, T = res.R, res.T
    S = lay.S
    lead = np.full((R, T, S), np.nan)
    pd = lay.period_days
    for s in range(S):
        lanes = [i for i, ln in enumerate(lay.lanes) if ln.origin == lay.supplier_ids[s]]
        if not lanes:
            continue
        lt = draws.lt_days[:, :, lanes].mean(axis=2)  # [R, T] days, for an order placed in week t
        arrive = np.arange(T)[None, :] + np.ceil(lt / pd).astype(np.int64)
        total = np.zeros((R, T))
        count = np.zeros((R, T))
        placed = res.supplier_ordered[:, :, s] > 1e-9
        for r in range(R):
            ok = placed[r] & (arrive[r] < T)
            np.add.at(total[r], arrive[r][ok], lt[r][ok])
            np.add.at(count[r], arrive[r][ok], 1.0)
        lead[:, :, s] = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    ordered = res.supplier_ordered
    fill = np.where(ordered > 1e-9, res.supplier_shipped / np.maximum(ordered, 1e-9), np.nan)
    noise = np.random.default_rng(np.random.SeedSequence([seed, 7919]))
    sup_cap = lay.supplier_cap[None, None] * draws.supplier_cap * (1 + CAPACITY_NOISE * noise.standard_normal(
        (R, T, S)))
    plant_cap = lay.plant_cap[None, None] * draws.plant_cap * (1 + CAPACITY_NOISE * noise.standard_normal(
        (R, T, lay.P)))
    dem = res.demand.sum(axis=3)
    short = np.minimum(res.demand, res.backorders + res.lost).sum(axis=(2, 3))
    total_dem = res.demand.sum(axis=(2, 3))
    service = np.where(total_dem > 0, 1 - short / np.maximum(total_dem, 1e-9), np.nan)
    return Observations(T=T, demand=dem, lead_time=lead, fill_rate=fill, supplier_capacity=sup_cap,
                        plant_capacity=plant_cap, utilisation=res.utilisation, on_hand=res.on_hand, service=service,
                        cost=res.total_cost, escalations=res.escalations, limit_hits=dict(res.limit_hits))


def expected_demand(lay: Layout, T: int) -> F:
    """The model's mean demand per market and week, seasonality included ([T, M])."""
    t = np.arange(T)[:, None]
    season = 1.0 + lay.season_amp[None, :] * np.cos(2 * np.pi * (t - lay.season_peak[None, :]) / 52.0)  # [T, K]
    out: F = np.einsum("mk,tk->tm", lay.demand_mean, season)
    return out


def nominal_lead_time(lay: Layout) -> F:
    """Each supplier's mean lead time over its lanes, days ([S])."""
    out = np.full(lay.S, np.nan)
    for s, sid in enumerate(lay.supplier_ids):
        means = [ln.lead_time_days.mean() for ln in lay.lanes if ln.origin == sid]
        if means:
            out[s] = float(np.mean(means))
    return out


def programme(lay: Layout, policies: list[Policy]):  # type: ignore[no-untyped-def]
    return compile_program(lay, [*incumbent_policies(lay), *policies])


@dataclass
class Run:
    lay: Layout
    draws: Draws
    result: SimResult
    obs: Observations


def run_stream(net: Network, policies: list[Policy], cfg: StreamConfig, sim: SimConfig | None = None) -> Run:
    """The whole horizon of the live world; the stream shows it up to its current week."""
    lay = build_layout(net)
    draws = spliced_draws(lay, cfg)
    res = simulate(lay, draws, programme(lay, policies), sim)
    return Run(lay, draws, res, observe(lay, draws, res, cfg.seed))


def run_reference(net: Network, policies: list[Policy], scenario: Scenario, horizon: int, replications: int = 400,
                  seed: int = 104729, sim: SimConfig | None = None) -> Run:
    """What the stress test predicts: the same policies under the matching scenario, many replications."""
    lay = build_layout(net)
    draws = generate(lay, scenario, replications, horizon, seed)
    res = simulate(lay, draws, programme(lay, policies), sim)
    return Run(lay, draws, res, observe(lay, draws, res, seed))


Kind = Literal["assumption", "input", "performance", "mandate"]
