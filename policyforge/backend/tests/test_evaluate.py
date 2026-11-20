"""Phase 3: baselines, metrics, the constitution check, the verdict and the report."""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pyomo.environ as pyo
import pytest
from pyomo.contrib.appsi.solvers import Highs

from core.baselines import incumbent_policies, naive_policies, rolling_program
from core.baselines.naive import mean_lead_periods
from core.domain.constitution import Constitution, ConstraintScope, HardConstraint, Metric, Objective
from core.domain.examples import default_constitution
from core.domain.network import load_foodnet
from core.domain.policy import BaseStock, DaysOfCover, ExpediteTrigger, ProjectedStockout, Units
from core.domain.results import ConstraintRow, EvaluationReport, Fan, PolicyRun, ScenarioRun, Stat
from core.domain.scenario import BaselineDemand, DemandShift, Scenario, ScenarioSet, SupplierOutage, Window
from core.evaluate import constitution as const
from core.evaluate.metrics import WARMUP, compute, cvar, fan, info, monthly, regret, summarise, weekly_fill
from core.evaluate.report import fmt, to_markdown
from core.evaluate.run import evaluate
from core.evaluate.verdict import decide
from core.sim.engine import SimConfig, simulate
from core.sim.layout import build_layout
from core.sim.program import compile_program
from core.sim.scenarios import default_suite, generate
from examples.first_stress_test import candidate_policy
from tests.simkit import ample_plant, policy, single_node

LAY = build_layout(load_foodnet())
SUITE = {s.id: s for s in default_suite().scenarios}
FIXTURES = Path(__file__).parent / "fixtures"


def run(policies: list, scenario: Scenario, R: int = 40, T: int = 104, seed: int = 7,  # type: ignore[type-arg]
        cfg: SimConfig | None = None):  # type: ignore[no-untyped-def]
    return simulate(LAY, generate(LAY, scenario, R, T, seed), compile_program(LAY, policies), cfg)


# ---------------------------------------------------------------- acceptance
def test_naive_bullwhip_ratio_exceeds_one_under_information_delay() -> None:
    noisy = compute(run(naive_policies(LAY), SUITE["bullwhip"]))
    calm = compute(run(naive_policies(LAY), SUITE["baseline"]))
    ratio = float(np.nanmean(noisy["bullwhip_dc"]))
    print(f"\nnaive DC bullwhip ratio: {ratio:.2f} with noisy, delayed signals; "
          f"{float(np.nanmean(calm['bullwhip_dc'])):.2f} without")
    assert ratio > 1
    assert ratio > float(np.nanmean(calm["bullwhip_dc"]))
    assert float(np.nanmean(noisy["bullwhip_plant"])) > 1


def test_rolling_optimisation_solves_with_highs() -> None:
    R, T = 3, 26
    draws = generate(LAY, SUITE["baseline"], R, T, 3)
    prog, opt = rolling_program(LAY, R)
    res = simulate(LAY, draws, prog)
    assert opt.solves == R * -(-T // opt.every)
    assert opt.statuses == {"optimal": opt.solves} and opt.failures == 0
    assert res.orders.sum() > 0 and (res.orders >= 0).all()
    assert (res.utilisation <= 1 + 1e-9).all()
    m = compute(res)
    assert 0.5 < float(np.nanmean(m["fill_rate"])) <= 1


def test_the_fast_solve_path_solves_the_same_lp_as_pyomo() -> None:
    """The optimiser changes column bounds in HiGHS directly; a fresh Pyomo solve of the same state must agree."""
    draws = generate(LAY, SUITE["baseline"], 1, 9, 5)
    prog, opt = rolling_program(LAY, 1)
    seen = []
    solve = opt._solve

    def spy(r, obs):  # type: ignore[no-untyped-def]
        seen.append(obs)
        return solve(r, obs)

    opt._solve = spy  # type: ignore[method-assign]
    simulate(LAY, draws, prog)
    solve(0, seen[-1])
    fast = opt._h.getInfo().objective_function_value
    m = opt._m
    vm = opt._appsi._pyomo_var_to_solver_var_map
    x = np.asarray(opt._h.getSolution().col_value)
    for var in (m.net0, m.arr_dc, m.fc, m.inv0_pl, m.owed0, m.arr_pl, m.fc_pl):
        for v in var.values():
            v.setlb(float(x[vm[id(v)]]))
            v.setub(float(x[vm[id(v)]]))
    fresh = Highs()
    result = fresh.solve(m)
    assert str(result.termination_condition).endswith("optimal")
    assert pyo.value(m.obj) == pytest.approx(fast, rel=1e-7, abs=1e-6)


def test_reports_are_generated_for_the_default_suite() -> None:
    rep = evaluate(candidate_policy(), default_constitution(), default_suite(), replications=12, periods=60, seed=3,
                   rolling_reps=3)
    assert [s.scenario_id for s in rep.scenarios] == [s.id for s in default_suite().scenarios]
    assert all({r.policy for r in s.runs} == {"candidate", "incumbent", "naive", "rolling_opt"}
               for s in rep.scenarios)
    assert rep.verdict.decision in ("approve", "approve_with_conditions", "reject")
    assert rep.verdict.reasons and len(rep.verdict.comparisons) == 4
    ro = rep.scenarios[0].run("rolling_opt")
    assert ro is not None and ro.subsample and ro.replications == 3
    assert ro.solver is not None and ro.solver["failures"] == 0
    cand = rep.scenarios[0].run("candidate")
    assert cand is not None and set(cand.regret) == {"cost_total", "fill_rate"}
    assert len(cand.samples["fill_rate"]) == 12 and len(cand.fans["weekly_fill"].p50) == 60 - WARMUP
    assert any("Rolling optimisation ran on the first 3" in n for n in rep.notes)
    again = EvaluationReport.model_validate_json(rep.model_dump_json())
    assert again == rep
    md = to_markdown(rep)
    for part in ("# Evaluation report", "## Verdict", "## Constitution", "## Key results by scenario",
                 "Correlated shock", "Regret"):
        assert part in md
    # the same inputs give the same id and the same numbers
    rep2 = evaluate(candidate_policy(), default_constitution(), default_suite(), replications=12, periods=60, seed=3,
                    rolling_reps=3)
    assert rep2.id == rep.id
    assert rep2.scenarios[3].run("candidate") == rep.scenarios[3].run("candidate")


def test_baselines_only_report_has_no_verdict() -> None:
    one = ScenarioSet(id="one", name="one", scenarios=[SUITE["baseline"]])
    rep = evaluate(None, default_constitution(), one, replications=6, periods=30, baselines=("incumbent", "naive"))
    assert rep.verdict.decision == "none"
    assert rep.policies == ["incumbent", "naive"]
    assert "NO CANDIDATE" in to_markdown(rep)


# ---------------------------------------------------------------- regression lock
def incumbent_kpis() -> dict[str, dict[str, float]]:
    out = {}
    for sid, sc in SUITE.items():
        m = compute(run(incumbent_policies(LAY), sc, R=40, T=104, seed=2027))
        out[sid] = {k: round(float(np.nanmean(m[k])), 9) for k in
                    ("fill_rate", "fill_rate.category.chilled", "otif", "cost_per_week", "co2_t", "bullwhip_dc",
                     "inventory_days_max")}
    return out


def test_incumbent_default_suite_kpis_are_locked() -> None:
    """If this fails after an intended model change, regenerate with UPDATE_GOLDEN=1 and review the diff."""
    path = FIXTURES / "incumbent_kpis.json"
    got = incumbent_kpis()
    if os.environ.get("UPDATE_GOLDEN") or not path.exists():
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(got, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    want = json.loads(path.read_text(encoding="utf-8"))
    for sid, kpis in want.items():
        for k, v in kpis.items():
            assert got[sid][k] == pytest.approx(v, rel=1e-6), f"{sid} {k}"


# ---------------------------------------------------------------- metrics
def test_fill_rate_and_otif_on_a_single_node() -> None:
    lay = build_layout(single_node())
    flat = Scenario(id="f", name="f", components=[BaselineDemand(seasonality=False)])
    res = simulate(lay, generate(lay, flat, 50, 60, 1),
                   compile_program(lay, [ample_plant(), policy("dc", BaseStock(target=Units(value=220)),
                                                               nodes=["DC"])]))
    m = compute(res)
    dem = res.demand[:, WARMUP:, 0, 0]
    short = np.minimum(dem, res.backorders[:, WARMUP:, 0, 0])
    np.testing.assert_allclose(m["fill_rate"], 1 - short.sum(1) / dem.sum(1))
    np.testing.assert_allclose(m["otif"], (short <= 1e-9).mean(1))
    assert (m["otif"] <= m["fill_rate"] + 1e-12).all()
    np.testing.assert_allclose(m["backorder_units"], short.sum(1))
    np.testing.assert_allclose(weekly_fill(res).mean(1), 1 - (short / dem).mean(1), rtol=0, atol=1e-12)
    assert np.isnan(m["peak_service_loss"]).all(), "no shock, no resilience metric"
    assert m["fill_rate.class.A"] == pytest.approx(m["fill_rate"])
    assert (m["bullwhip_dc"] > 0.9).all() and (m["bullwhip_dc"] < 1.1).all()


def test_resilience_after_a_shock() -> None:
    outage = Scenario(id="o", name="o", components=[BaselineDemand(),
                                                    SupplierOutage(supplier="SUP_B", window=Window(start=20,
                                                                                                   duration=10),
                                                                   severity=1.0)])
    m = compute(run(incumbent_policies(LAY), outage, R=20))
    assert (m["peak_service_loss"] > 0).all()
    assert (m["recovery_periods"] >= 0).all() and np.nanmax(m["recovery_periods"]) <= 104 - 20
    calm = compute(run(incumbent_policies(LAY), SUITE["baseline"], R=5))
    assert np.isnan(calm["recovery_periods"]).all()


def test_distribution_helpers() -> None:
    x = np.arange(100, dtype=float)
    assert cvar(x, 0.95, higher_is_better=True) == pytest.approx(2.0)
    assert cvar(x, 0.95, higher_is_better=False) == pytest.approx(97.0)
    assert cvar(np.array([np.nan]), 0.95, True) is None
    s = summarise(np.array([1.0, 2.0, np.nan, 3.0]), 0.5, True)
    assert s.n == 3 and s.mean == pytest.approx(2.0) and s.p50 == pytest.approx(2.0)
    assert summarise(np.array([np.nan]), 0.9, True).mean is None
    rg = regret({"a": np.array([1.0, 5.0]), "b": np.array([3.0, 2.0])}, higher_is_better=False)
    np.testing.assert_allclose(rg["a"], [0, 3])
    np.testing.assert_allclose(rg["b"], [2, 0])
    rg = regret({"a": np.array([0.9]), "b": np.array([0.95])}, higher_is_better=True)
    assert rg["a"][0] == pytest.approx(0.05) and rg["b"][0] == 0
    months = monthly(np.ones((2, 52)), 0)
    assert months.shape == (2, 12) and months.sum() == 104
    f = fan(np.tile(np.arange(10.0), (5, 1)), 2)
    assert f["p50"] == [float(v) for v in range(2, 10)]
    assert info("fill_rate.market.MKT_N1").higher_is_better and info("inventory_days.node.DC_N").unit == "days"
    assert fmt(0.5, "fraction") == "50.0%" and fmt(None, "EUR") == "—" and fmt(1234, "EUR") == "€1,234"


def test_naive_targets_mean_demand_times_lead_time() -> None:
    lead = mean_lead_periods(LAY)
    assert (lead[LAY.P:] == 1).all(), "plant to DC lanes take under a week: one period"
    assert (lead[: LAY.P][LAY.makes] > 1).all()
    pols = {p.id: p for p in naive_policies(LAY)}
    assert len(pols) == int(LAY.cell.sum())
    n, k = LAY.P, LAY.sku_ids.index("S04")
    assert pols["naive-DC_N-S04"].rule.target.value == pytest.approx(LAY.mean_node_demand()[n, k] * lead[n, k])


# ---------------------------------------------------------------- the constitution
def test_constitution_check_scopes_and_windows() -> None:
    surge = Scenario(id="s", name="s", components=[DemandShift(window=Window(start=10, duration=8), factor=1.8)])
    rule = ExpediteTrigger(condition=ProjectedStockout(within_periods=2), mode="express_road",
                           cost_cap_per_period=3000)
    res = run([*incumbent_policies(LAY), policy("ex", rule, nodes=LAY.dc_ids)], surge, R=10, T=40)
    c = Constitution(
        id="t", name="t", priorities=list(Objective), soft_weights={Objective.service: 1},
        hard_constraints=[
            HardConstraint(id="fill-any", metric=Metric.fill_rate, op="ge", threshold=0.0),
            HardConstraint(id="fill-all", metric=Metric.fill_rate, op="ge", threshold=1.0),
            HardConstraint(id="fill-month", metric=Metric.fill_rate, op="ge", threshold=0.5, window="month"),
            HardConstraint(id="fill-n1", metric=Metric.fill_rate, scope=ConstraintScope(node="MKT_N1"), op="ge",
                           threshold=0.0),
            HardConstraint(id="fill-dcn", metric=Metric.fill_rate, scope=ConstraintScope(node="DC_N", sku="S04"),
                           op="ge", threshold=0.0),
            HardConstraint(id="otif", metric=Metric.otif, op="ge", threshold=0.0, window="period"),
            HardConstraint(id="exp-month", metric=Metric.expedite_spend, op="le", threshold=1.0, window="month"),
            HardConstraint(id="exp-period", metric=Metric.expedite_spend, op="le", threshold=1e6, window="period"),
            HardConstraint(id="cost", metric=Metric.total_cost, op="le", threshold=1e9),
            HardConstraint(id="co2", metric=Metric.co2_tonnes, op="le", threshold=1e6, window="month"),
            HardConstraint(id="bo", metric=Metric.backorder_units, op="le", threshold=1e9, window="period"),
            HardConstraint(id="so", metric=Metric.stockout_periods, op="le", threshold=1e4),
            HardConstraint(id="days", metric=Metric.inventory_days, op="le", threshold=1.0),
            HardConstraint(id="days-dcs", metric=Metric.inventory_days, scope=ConstraintScope(node="DC_S"),
                           op="le", threshold=3650),
        ])
    rows = {r.id: r for r in const.check(res, c)}
    assert rows["fill-any"].passed and rows["fill-any"].breach_share == 0
    assert not rows["fill-all"].passed and rows["fill-all"].breach_share == 1
    assert rows["fill-month"].worst is not None and rows["fill-month"].worst <= rows["fill-any"].median  # type: ignore[operator]
    assert rows["fill-n1"].passed and rows["fill-dcn"].passed and rows["otif"].passed
    assert rows["exp-month"].breach_share == 1, "the surge forces expediting"
    assert rows["exp-period"].passed and rows["cost"].passed and rows["co2"].passed
    assert rows["bo"].passed and rows["so"].passed and rows["days-dcs"].passed
    assert not rows["days"].passed


# ---------------------------------------------------------------- the verdict
def _stat(v: float) -> Stat:
    return Stat(mean=v, p5=v, p50=v, p95=v, cvar=v, n=10)


def _run(name: str, fill: float, cost: float, breaches: dict[str, float], esc: float = 0.0) -> PolicyRun:
    rows = [ConstraintRow(id=k, text=k, description=k, breach_share=v, passed=v <= 0.05, worst=None, median=None)
            for k, v in breaches.items()]
    f = Fan(p5=[], p25=[], p50=[], p75=[], p95=[])
    return PolicyRun(policy=name, replications=10, subsample=False,
                     metrics={"fill_rate": _stat(fill), "peak_service_loss": _stat(0.1), "cost_per_week": _stat(cost),
                              "co2_t": _stat(30.0), "escalations": _stat(esc)},
                     constitution=rows, samples={}, fans={"weekly_fill": f})


def _sc(sid: str, normal: bool, cand: PolicyRun, inc: PolicyRun) -> ScenarioRun:
    return ScenarioRun(scenario_id=sid, name=sid, description="", normal=normal, runs=[cand, inc])


CON = default_constitution()


def test_verdict_rules() -> None:
    ok = {"x": 0.0}
    # better service, no breaches → approve
    v = decide([_sc("base", True, _run("candidate", 0.97, 100, ok), _run("incumbent", 0.95, 100, ok))], CON)
    assert v.decision == "approve" and v.comparisons[0].outcome == "better"
    # a breach under normal conditions → reject, whatever else
    v = decide([_sc("base", True, _run("candidate", 0.99, 90, {"x": 0.2}), _run("incumbent", 0.95, 100, ok))], CON)
    assert v.decision == "reject" and "normal conditions" in v.reasons[0].text
    # a stress breach the incumbent shares → information only
    v = decide([_sc("base", True, _run("candidate", 0.96, 100, ok), _run("incumbent", 0.95, 100, ok)),
                _sc("shock", False, _run("candidate", 0.90, 100, {"x": 0.40}), _run("incumbent", 0.88, 100,
                                                                                     {"x": 0.50}))], CON)
    assert v.decision == "approve"
    assert any(r.level == "info" and "improved by this policy" in r.text for r in v.reasons)
    v = decide([_sc("base", True, _run("candidate", 0.96, 100, ok), _run("incumbent", 0.95, 100, ok)),
                _sc("shock", False, _run("candidate", 0.90, 100, {"x": 0.50}), _run("incumbent", 0.88, 100,
                                                                                     {"x": 0.50}))], CON)
    assert v.decision == "approve"
    assert any(r.level == "info" and "as the incumbent does" in r.text for r in v.reasons)
    # a stress breach the candidate makes worse → condition
    v = decide([_sc("base", True, _run("candidate", 0.96, 100, ok), _run("incumbent", 0.95, 100, ok)),
                _sc("shock", False, _run("candidate", 0.90, 100, {"x": 0.30}), _run("incumbent", 0.90, 100,
                                                                                     {"x": 0.10}))], CON)
    assert v.decision == "approve_with_conditions"
    assert any(r.level == "condition" and r.constraint == "x" for r in v.reasons)
    # worse on the first priority (service) → reject, even if cheaper
    v = decide([_sc("base", True, _run("candidate", 0.90, 50, ok), _run("incumbent", 0.95, 100, ok))], CON)
    assert v.decision == "reject" and v.reasons[0].objective == "service"
    # same service, cheaper → approve on cost
    v = decide([_sc("base", True, _run("candidate", 0.95, 90, ok), _run("incumbent", 0.95, 100, ok))], CON)
    assert v.decision == "approve" and [c.outcome for c in v.comparisons][:3] == ["same", "same", "better"]
    # all the same → noted
    v = decide([_sc("base", True, _run("candidate", 0.95, 100, ok), _run("incumbent", 0.95, 100, ok))], CON)
    assert any("No material difference" in r.text for r in v.reasons)
    # service far behind in one scenario only → condition; escalations reported
    v = decide([_sc("base", True, _run("candidate", 0.99, 100, ok), _run("incumbent", 0.95, 100, ok)),
                _sc("shock", False, _run("candidate", 0.89, 100, ok, esc=3), _run("incumbent", 0.90, 100, ok))], CON)
    assert v.decision == "approve_with_conditions" and any("escalates 3.0 times" in r.text for r in v.reasons)
    # no candidate
    assert decide([ScenarioRun(scenario_id="b", name="b", description="", normal=True,
                               runs=[_run("incumbent", 0.9, 1, ok)])], CON).decision == "none"


def test_seasonal_forecast_option_runs_and_is_off_by_default() -> None:
    assert SimConfig().seasonal_forecast is False
    a = run(incumbent_policies(LAY), SUITE["baseline"], R=6, T=30)
    b = run(incumbent_policies(LAY), SUITE["baseline"], R=6, T=30, cfg=SimConfig(seasonal_forecast=True))
    assert not np.array_equal(a.orders, b.orders)
    assert np.array_equal(a.demand, b.demand)


def test_supply_line_blind_delay_is_available_and_worse() -> None:
    sc = Scenario(id="d", name="d", components=[BaselineDemand(),
                                                DemandShift(window=Window(start=0), factor=1.0)])
    from core.domain.scenario import SignalNoise
    delayed = Scenario(id="d2", name="d2", components=[*sc.components, SignalNoise(extra_delay=2)])
    known = compute(run(incumbent_policies(LAY), delayed, R=10))
    blind = compute(run(incumbent_policies(LAY), delayed, R=10, cfg=SimConfig(own_orders_known=False)))
    assert np.nanmean(blind["bullwhip_dc"]) > 3 * np.nanmean(known["bullwhip_dc"])
    assert np.nanmean(blind["fill_rate"]) < np.nanmean(known["fill_rate"])
    lay = build_layout(single_node())
    assert lay.D == 1 and BaseStock(target=DaysOfCover(value=1)).review_period == 1
