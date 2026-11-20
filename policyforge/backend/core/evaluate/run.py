"""Run an evaluation: a candidate policy against its baselines, on a scenario set, into an EvaluationReport.

For each scenario, every random draw is made once (common random numbers). The candidate (layered over the
incumbent), the incumbent and the naive rule run on all replications. Rolling optimisation runs on the first
`rolling_reps` of the same futures, because it solves an LP per replication every few periods.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
from dataclasses import asdict

import numpy as np

from core.baselines import incumbent_policies, naive_policies, rolling_program
from core.domain.constitution import Constitution
from core.domain.network import Network, load_foodnet
from core.domain.policy import Policy
from core.domain.results import ConstraintRow, EvaluationReport, Fan, MetricMeta, PolicyRun, ScenarioRun, Stat
from core.domain.scenario import BaselineDemand, ScenarioSet
from core.evaluate import constitution as const
from core.evaluate.metrics import WARMUP, compute, fan, info, regret, summarise
from core.evaluate.verdict import decide
from core.sim.engine import SimConfig, SimResult, simulate
from core.sim.layout import F, build_layout
from core.sim.program import Program, compile_program
from core.sim.scenarios import generate

SAMPLE_METRICS = ("fill_rate", "cost_per_week", "peak_service_loss", "expedite_month_max")
REGRET_METRICS = {"cost_total": False, "fill_rate": True}  # name → higher is better
BASELINES = ("incumbent", "naive", "rolling_opt")


def _r(x: float | None, nd: int = 6) -> float | None:
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def _stat(x: F, level: float, higher: bool) -> Stat:
    s = summarise(x, level, higher)
    return Stat(mean=_r(s.mean), p5=_r(s.p5), p50=_r(s.p50), p95=_r(s.p95), cvar=_r(s.cvar), n=s.n)


def _fanify(series: F, w: int) -> Fan:
    return Fan(**fan(series, w))


def _run_entry(name: str, res: SimResult, metrics: dict[str, F], constitution: Constitution, w: int,
               subsample: bool, solver: dict[str, object] | None = None) -> PolicyRun:
    level = constitution.risk.level
    lay = res.layout
    weekly_short = np.minimum(res.demand, res.backorders + res.lost).sum(axis=(2, 3))
    weekly_dem = res.demand.sum(axis=(2, 3))
    weekly_fill = 1.0 - weekly_short / np.maximum(weekly_dem, 1e-9)
    return PolicyRun(
        policy=name, replications=res.R, subsample=subsample,
        metrics={k: _stat(v, level, info(k).higher_is_better) for k, v in metrics.items()},
        constitution=[ConstraintRow(**asdict(c)) for c in const.check(res, constitution, w)],
        samples={k: [_r(float(v), 5) for v in metrics[k]] for k in SAMPLE_METRICS if k in metrics},
        fans={"weekly_fill": _fanify(weekly_fill, w), "weekly_cost": _fanify(res.total_cost, w),
              "dc_stock": _fanify(res.on_hand[:, :, lay.P:].sum(axis=(2, 3)), w)},
        solver=solver,
    )


def report_id(*parts: object) -> str:
    blob = json.dumps(parts, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def evaluate(candidate: list[Policy] | Policy | None, constitution: Constitution, scenarios: ScenarioSet, *,
             net: Network | None = None, replications: int = 1000, periods: int = 104, seed: int = 1,
             warmup: int = WARMUP, baselines: tuple[str, ...] = BASELINES, rolling_reps: int = 50,
             rolling_every: int = 4, rolling_horizon: int = 8, cfg: SimConfig | None = None,
             progress: Callable[[str], None] | None = None) -> EvaluationReport:
    t0 = time.perf_counter()
    net = net or load_foodnet()
    lay = build_layout(net)
    cfg = cfg or SimConfig()
    cand = [candidate] if isinstance(candidate, Policy) else list(candidate or [])
    incumbent = incumbent_policies(lay)
    full: dict[str, Program] = {}
    if cand:
        full["candidate"] = compile_program(lay, [*incumbent, *cand])
    if "incumbent" in baselines or cand:
        full["incumbent"] = compile_program(lay, incumbent)
    if "naive" in baselines:
        full["naive"] = compile_program(lay, naive_policies(lay))
    notes: list[str] = []
    for prog in full.values():
        for pid, msgs in prog.supported.items():
            notes += [f"{pid}: {m}" for m in msgs]
    if "rolling_opt" in baselines:
        notes.append(f"Rolling optimisation ran on the first {min(rolling_reps, replications)} of {replications} "
                     f"replications (the same futures), re-planning every {rolling_every} periods over "
                     f"{rolling_horizon}; its regret is not computed.")

    runs: list[ScenarioRun] = []
    for sc in scenarios.scenarios:
        if progress:
            progress(f"scenario {sc.id}")
        draws = generate(lay, sc, R=replications, T=periods, seed=seed)
        results = {name: simulate(lay, draws, prog, cfg) for name, prog in full.items()}
        metrics = {name: compute(res, warmup) for name, res in results.items()}
        entries = {name: _run_entry(name, res, metrics[name], constitution, warmup, subsample=False)
                   for name, res in results.items()}
        if len(metrics) > 1:  # regret among the policies run on every replication
            for mname, higher in REGRET_METRICS.items():
                for name, rg in regret({n: m[mname] for n, m in metrics.items()}, higher).items():
                    entries[name].regret[mname] = _stat(rg, constitution.risk.level, False)
        if "rolling_opt" in baselines:
            sub = draws.subset(rolling_reps)
            prog, opt = rolling_program(lay, sub.R, horizon=rolling_horizon, every=rolling_every)
            res = simulate(lay, sub, prog, cfg)
            entries["rolling_opt"] = _run_entry(
                "rolling_opt", res, compute(res, warmup), constitution, warmup, subsample=True,
                solver={"solver": "HiGHS", "solves": opt.solves, "failures": opt.failures, "statuses": opt.statuses})
        normal = all(isinstance(c, BaselineDemand) for c in sc.components)
        runs.append(ScenarioRun(scenario_id=sc.id, name=sc.name, description=sc.description, normal=normal,
                                runs=list(entries.values())))

    names = sorted({k for sc in runs for r in sc.runs for k in r.metrics})
    meta = {k: MetricMeta(**asdict(info(k))) for k in names}
    # what determines the numbers: policies without their provenance (timestamps), constitution without its date
    rid = report_id([p.model_dump(mode="json", exclude={"provenance"}) for p in cand],
                    constitution.model_dump(mode="json", exclude={"created_at"}),
                    scenarios.model_dump(mode="json"), net.model_dump(mode="json"), replications, periods, seed,
                    warmup, baselines, rolling_reps, rolling_every, rolling_horizon, asdict(cfg))
    return EvaluationReport(
        id=rid, network=net.name, constitution_ref=constitution.ref, breach_alpha=constitution.breach_alpha,
        risk_measure=constitution.risk.measure, risk_level=constitution.risk.level,
        candidate_id=cand[-1].id if cand else None,
        candidate=cand[-1].model_dump(mode="json") if cand else None,
        policies=[*full, *(["rolling_opt"] if "rolling_opt" in baselines else [])], scenario_set=scenarios.id,
        replications=replications, periods=periods, seed=seed, warmup=warmup,
        rolling={"replications": min(rolling_reps, replications), "every": rolling_every,
                 "horizon": rolling_horizon} if "rolling_opt" in baselines else {},
        metric_info=meta, scenarios=runs, verdict=decide(runs, constitution), notes=notes,
        seconds=round(time.perf_counter() - t0, 2),
    )
