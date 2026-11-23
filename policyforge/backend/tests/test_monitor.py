"""P6: the live stream, the monitors, the escalation inbox and the re-test."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.app import API_VERSION, create_app
from core.domain.assumption import Assumption
from core.domain.distributions import Gamma
from core.domain.examples import default_constitution
from core.domain.network import load_foodnet
from core.domain.policy import Policy
from core.domain.scenario import BaselineDemand, DemandShift, LeadTimeInflation, Scenario, SupplierOutage, Window
from core.domain.vocabulary import Variable, VarRef
from core.llm.compiler import compile_intent
from core.llm.mock import load_fixtures
from core.monitor.detectors import (
    Cusum,
    calibrate_limit,
    change_point,
    cusum_two_sided,
    cusum_upper,
    ks_pvalue,
    psi,
    robust_scale,
)
from core.monitor.inbox import rank, reversibility
from core.monitor.monitors import Alarm, mandate_monitors, run_monitors
from core.monitor.retest import observed_network
from core.monitor.stream import StreamConfig, Switch, run_reference, run_stream
from core.registry.monitoring import Monitoring
from core.registry.registry import Registry, RegistryError, seeded
from core.registry.store import make_engine

FIXTURES = Path(__file__).parent / "fixtures"
INTENTS = FIXTURES / "intents"
NET = load_foodnet()
BASELINE = Scenario(id="baseline", name="Baseline", components=[BaselineDemand()])
C_ASSUMPTION = "assumption:shift-ambient-volume-from-b-to-c:c-spare-capacity"


def c_capacity_loss(start: int = 20, severity: float = 0.6) -> SupplierOutage:
    return SupplierOutage(supplier="SUP_C", window=Window(start=start), severity=severity)


@pytest.fixture(scope="module")
def demo() -> Policy:
    """The §10 demo policy: shift ambient volume from B to C, up to 30 % alone; three assumptions."""
    intent = json.loads((INTENTS / "05-demo-b-to-c-30.json").read_text(encoding="utf-8"))["intent"]
    return compile_intent(intent, provider=load_fixtures(INTENTS), net=NET,
                          constitution=default_constitution()).policy


@pytest.fixture(scope="module")
def ref(demo: Policy) -> Any:
    return run_reference(NET, [demo], BASELINE, 104)


def deployed_registry(demo: Policy) -> Registry:
    reg = seeded(make_engine())
    reg.create_policy(demo, "strategist")
    reg.evaluate(demo.id, 1, "tester", scenarios=None, replications=10, periods=104, rolling_reps=2)
    reg.approve(demo.id, 1, "Head of supply chain")
    reg.deploy(demo.id, 1, "operator")
    return reg


# ---------------------------------------------------------------- detectors
def test_detectors() -> None:
    z = np.array([0, 0, 0, 3, 3, 0, np.nan, 0])
    stat, alarms = cusum_upper(z, Cusum(k=0.5, h=4))
    assert alarms == [4] and stat[4] == 5 and stat[5] == 0 and stat[6] == stat[5]  # reset; NaN changes nothing
    assert change_point(np.array([0, 0, 1, 2, 5.0]), 4) == 2
    _, both = cusum_two_sided(np.array([0, -6, 0, 6.0]), Cusum(k=0.5, h=4))
    assert both == [(1, "down"), (3, "up")]
    rng = np.random.default_rng(1)
    a, b = rng.normal(size=4000), rng.normal(size=400)
    assert psi(a, b) < 0.05 and psi(a, b + 1.5) > 0.5 and np.isnan(psi(a[:3], b))
    assert ks_pvalue(a, b) > 0.05 and ks_pvalue(a, b + 1) < 1e-6 and np.isnan(ks_pvalue(a, np.array([np.nan])))
    assert robust_scale(a, 0.0) == pytest.approx(1, abs=0.1) and robust_scale(np.array([np.nan]), 0.3) == 0.3
    quiet = rng.normal(size=(300, 100))
    h = calibrate_limit(quiet, 0.5, 0.01, 4.0)
    assert 5 < h < 12


# ---------------------------------------------------------------- the stream
def test_injecting_never_changes_the_past(demo: Policy) -> None:
    quiet = run_stream(NET, [demo], StreamConfig(seed=3))
    changed = run_stream(NET, [demo], StreamConfig(seed=3, switches=[
        Switch(week=15, component=SupplierOutage(supplier="SUP_B", window=Window(start=5), severity=1))]))
    for name in ("demand", "supplier_capacity", "service", "cost"):
        a, b = getattr(quiet.obs, name)[0], getattr(changed.obs, name)[0]
        assert np.array_equal(a[:15], b[:15], equal_nan=True), name
        assert not np.array_equal(a[15:], b[15:], equal_nan=True) or name == "demand", name
    assert changed.obs.supplier_capacity[0, 15:, 1].max() < 200  # B ships nothing from week 15, not from 5


def test_observations_look_like_the_model() -> None:
    live = run_stream(NET, [], StreamConfig(seed=2))
    o = live.obs
    assert np.nanmean(o.lead_time[0, :, 0]) == pytest.approx(22.5, abs=1.5)  # A: 21 and 24 days
    assert np.isnan(o.lead_time[0, :, 2]).all() and np.isnan(o.fill_rate[0, :, 2]).all()  # C gets no orders
    assert np.nanmean(o.fill_rate[0, :, 1]) == pytest.approx(0.93, abs=0.02)
    assert o.supplier_capacity[0, :, 2].mean() == pytest.approx(2000, rel=0.01)  # C still reports its capacity
    assert np.nanmean(o.service[0, 8:]) > 0.95


# ---------------------------------------------------------------- the monitors
def test_acceptance_the_demo_fires_the_assumption_within_four_periods(demo: Policy, ref: Any) -> None:
    """§9 P6: capacity loss at Supplier C from week 20 fires the assumption-drift alert within 4 periods."""
    for seed in (1, 2, 3):
        live = run_stream(NET, [demo], StreamConfig(seed=seed, switches=[Switch(week=10,
                                                                                 component=c_capacity_loss())]))
        res = run_monitors(live, ref, [demo], 40)
        first = min(a.week for a in res.alarms if a.monitor_id == C_ASSUMPTION)
        assert 20 <= first <= 23, (seed, first)
        quiet = run_monitors(run_stream(NET, [demo], StreamConfig(seed=seed)), ref, [demo], 40)
        assert not any(a.monitor_id == C_ASSUMPTION for a in quiet.alarms)


def test_no_false_alarms_in_quiet_streams(demo: Policy, ref: Any) -> None:
    noisy = 0
    for seed in range(1, 11):
        res = run_monitors(run_stream(NET, [demo], StreamConfig(seed=seed)), ref, [demo], 103)
        assert not [a for a in res.alarms if a.kind == "assumption"], seed
        noisy += bool([a for a in res.alarms if a.kind in ("input", "performance")])
    assert noisy <= 1, "the family-wise target is 5 % of quiet futures"


def test_input_drift_catches_lead_time_and_demand(demo: Policy, ref: Any) -> None:
    lt = run_stream(NET, [demo], StreamConfig(seed=1, switches=[
        Switch(week=20, component=LeadTimeInflation(supplier="SUP_B", start=20, factor=1.6))]))
    res = run_monitors(lt, ref, [demo], 60)
    hit = [a for a in res.alarms if a.monitor_id == "input:lead_time:SUP_B"]
    assert hit and 22 <= hit[0].week <= 32  # seen only when the slower shipments arrive
    ev = hit[0].evidence
    assert ev["direction"] == "up" and ev["recent_ratio"] > 1.3 and ev["psi"] > 0.25 and ev["ks_p"] < 0.01
    dm = run_stream(NET, [demo], StreamConfig(seed=1, switches=[
        Switch(week=30, component=DemandShift(window=Window(start=30), factor=1.5, markets=["MKT_N1"]))]))
    res = run_monitors(dm, ref, [demo], 50)
    hit = [a for a in res.alarms if a.monitor_id == "input:demand:MKT_N1"]
    assert hit and 30 <= hit[0].week <= 34
    assert hit[0].update == {"variable": "demand", "node": "MKT_N1", "ratio": pytest.approx(1.5, abs=0.15),
                             "since_week": pytest.approx(30, abs=2)}
    states = {s.id: s for s in res.states}
    assert states["input:demand:MKT_N2"].status == "ok" and states["input:demand:MKT_N1"].status == "alarm"


def test_performance_drift_under_a_severe_outage(demo: Policy, ref: Any) -> None:
    live = run_stream(NET, [demo], StreamConfig(seed=1, switches=[
        Switch(week=20, component=SupplierOutage(supplier="SUP_A", window=Window(start=20), severity=1))]))
    res = run_monitors(live, ref, [demo], 70)
    service = [a for a in res.alarms if a.monitor_id == "performance:service"]
    assert service and service[0].week > 20
    assert service[0].evidence["value"] < service[0].evidence["p5"]


def test_assumption_forms_and_unobservable_variables(demo: Policy, ref: Any) -> None:
    extra = [
        Assumption(id="b-lead-dist", statement="B's lead times follow gamma(13.5, 0.35)",
                   variable=VarRef(var=Variable.lead_time, supplier="SUP_B"),
                   distribution=Gamma(mu=13.5, cv=0.35), source="user_stated", confidence=0.8),
        Assumption(id="ip", statement="Inventory position stays positive",
                   variable=VarRef(var=Variable.inventory_position, node="DC_N"), operator="gt", threshold=0,
                   source="compiler_inferred", confidence=0.5),
        Assumption(id="util", statement="PLANT_N runs below 95 %",
                   variable=VarRef(var=Variable.capacity_utilisation, node="PLANT_N"), operator="lt",
                   threshold=0.95, source="compiler_inferred", confidence=0.5)]
    p = demo.model_copy(update={"assumptions": [*demo.assumptions, *extra]})
    live = run_stream(NET, [p], StreamConfig(seed=1, switches=[
        Switch(week=20, component=LeadTimeInflation(supplier="SUP_B", start=20, factor=1.8))]))
    states = {s.id.split(":")[-1]: s for s in run_monitors(live, ref, [p], 60).states}
    assert states["ip"].status == "not_observable"
    assert states["b-lead-dist"].status == "alarm" and states["b-lead-dist"].alarm_weeks[0] > 20
    assert states["util"].status in ("ok", "alarm") and states["util"].series
    early = {s.id.split(":")[-1]: s for s in run_monitors(live, ref, [p], 5).states}
    assert early["c-spare-capacity"].status == "warming_up"


def test_mandate_escalations_become_inbox_items(demo: Policy) -> None:
    hits = np.zeros((1, 30))
    hits[0, [12, 13, 20]] = 1
    fake = SimpleNamespace(obs=SimpleNamespace(limit_hits={"volume_shift_pct": hits}))
    res = mandate_monitors(fake, [demo], 25)  # type: ignore[arg-type]
    assert [a.week for a in res.alarms] == [12, 20]  # one per episode
    assert "escalated to Planning manager" in res.alarms[0].message


# ---------------------------------------------------------------- the inbox ranking and the re-test
def test_ranking(demo: Policy, ref: Any) -> None:
    assert reversibility(demo) == 0.5 and reversibility(None) == 1.0
    a = Alarm(monitor_id=C_ASSUMPTION, kind="assumption", week=20, policy_id=demo.id,
              subject="supplier_capacity[SUP_C]", message="", evidence={"assumption_id": "c-spare-capacity"},
              update={"variable": "supplier_capacity", "supplier": "SUP_C", "observed": 800})
    r = rank(a, demo, ref)
    assert r.severity == "high" and "may shift to SUP_C" in r.basis and r.exposure_eur_per_week > 1000
    assert r.score == pytest.approx(3 * 2 * r.exposure_eur_per_week, rel=1e-6)
    reviewed = demo.mandate.model_copy(update={"review_triggers": ["c-spare-capacity"]})
    critical = demo.model_copy(update={"mandate": reviewed})
    assert rank(a, critical, ref).severity == "critical"
    inp = Alarm(monitor_id="input:demand:MKT_N1", kind="input", week=30, subject="demand[MKT_N1]", message="",
                update={"variable": "demand", "node": "MKT_N1", "ratio": 1.5})
    assert rank(inp, None, ref).score < r.score


def test_observed_network() -> None:
    net, changes = observed_network(NET, [
        {"variable": "supplier_capacity", "supplier": "SUP_C", "observed": 812.4},
        {"variable": "lead_time", "supplier": "SUP_B", "ratio": 1.5},
        {"variable": "supplier_fill_rate", "supplier": "SUP_B", "observed": 0.71},
        {"variable": "demand", "node": "MKT_S1", "ratio": 1.2},
        {"variable": "plant_capacity", "node": "PLANT_S", "observed": 3000},
        {"variable": "capacity_utilisation", "node": "PLANT_N", "observed": 0.99}], week=23)
    assert net.name == "FoodNet (as observed at week 23)"
    paths = [c.path for c in changes]
    assert paths[0] == "suppliers.2.capacity_per_period" and net.suppliers[2].capacity_per_period == 812.4
    assert net.lane("SUP_B", "PLANT_N").lead_time_days.mean() == pytest.approx(  # type: ignore[union-attr]
        1.5 * NET.lane("SUP_B", "PLANT_N").lead_time_days.mean())  # type: ignore[union-attr]
    assert net.suppliers[1].fill_rate_mean == 0.71 and net.plants[1].capacity_per_period == 3000
    assert net.markets[4].size_factor == pytest.approx(NET.markets[4].size_factor * 1.2)
    assert not any("PLANT_N" in p or "plants.0" in p for p in paths)  # a state variable changes nothing


# ---------------------------------------------------------------- the registry: streams, inbox, re-test
def test_the_demo_through_the_registry(demo: Policy) -> None:
    reg = deployed_registry(demo)
    mon = Monitoring(reg)
    st = mon.create_stream("operator", seed=1)
    assert st.week == 0 and st.policies == [f"{demo.id}@1"] and st.switches is None
    assert mon.step(st.id, 9, "operator") == [] and mon.stream(st.id).week == 9
    mon.inject(st.id, c_capacity_loss(), "trainer", note="quietly")
    assert mon.stream(st.id, reveal=True).switches[0].week == 10  # type: ignore[index]
    raised: list[Any] = []
    week = 9
    while not raised and week < 30:
        raised = mon.step(st.id, 1, "operator")
        week += 1
    assert raised and raised[0].monitor_id == C_ASSUMPTION and week <= 23
    top = mon.alerts("active")[0]
    assert top.monitor_id == C_ASSUMPTION and top.severity == "high" and top.reversibility == 0.5

    # one open alert per monitor; resolving it lets the monitor raise a new one for later alarms only
    mon.step(st.id, 5, "operator")
    assert len([a for a in mon.alerts() if a.monitor_id == C_ASSUMPTION]) == 1
    acked = mon.set_status(top.id, "acknowledged", "planner", "looking into it")
    assert acked.status == "acknowledged" and acked.note == "looking into it"
    with pytest.raises(RegistryError, match="cannot become open"):
        mon.set_status(top.id, "open", "planner")  # type: ignore[arg-type]

    rt = mon.run_retest(top.id, "planner", replications=10, periods=52, rolling_reps=2)
    assert rt.retest.changes[0].path == "suppliers.2.capacity_per_period"
    assert 700 < rt.retest.changes[0].after < 900
    assert rt.retest.report.network.startswith("FoodNet (as observed at week")
    assert mon.alert(top.id).retest_id == rt.id and mon.retest(rt.id).verdict == rt.verdict

    mon.set_status(top.id, "resolved", "planner", "C confirmed; volume capped")
    mon.step(st.id, 3, "operator")
    again = [a for a in mon.alerts() if a.monitor_id == C_ASSUMPTION]
    fresh = [a for a in again if a.status == "open"]
    assert len(again) == 2 and len(fresh) == 1 and fresh[0].week > mon.alert(top.id).week
    actions = [e.action for e in reg.audit(limit=1000)]
    for x in ("stream.created", "stream.injected", "alert.raised", "alert.acknowledged", "retest.run",
              "alert.resolved"):
        assert x in actions
    assert reg.verify().ok


def test_stepping_equals_jumping(demo: Policy) -> None:
    reg = deployed_registry(demo)
    mon = Monitoring(reg)
    a, b = mon.create_stream("op", seed=4), mon.create_stream("op", seed=4)
    for sid in (a.id, b.id):
        mon.inject(sid, LeadTimeInflation(supplier="SUP_B", start=15, factor=1.7), "op")
    for _ in range(50):
        mon.step(a.id, 1, "op")
    mon.step(b.id, 50, "op")
    seen = [sorted((x.monitor_id, x.week) for x in mon.alerts(stream_id=s)) for s in (a.id, b.id)]
    assert seen[0] == seen[1] and seen[0]
    assert mon.stream(a.id).monitors == mon.stream(b.id).monitors
    assert mon.step(a.id, 500, "op") == mon.step(a.id, 1, "op") == []  # clamped at the horizon


def test_registry_errors(demo: Policy) -> None:
    mon = Monitoring(deployed_registry(demo))
    with pytest.raises(RegistryError, match="no stream"):
        mon.stream(99)
    st = mon.create_stream("op")
    with pytest.raises(RegistryError, match="no supplier 'SUP_X'"):
        mon.inject(st.id, SupplierOutage(supplier="SUP_X", window=Window(start=5), severity=1), "op")
    with pytest.raises(RegistryError, match="no market"):
        mon.inject(st.id, DemandShift(window=Window(start=5), factor=2, markets=["MKT_X"]), "op")
    with pytest.raises(RegistryError, match="no scenario"):
        mon.create_stream("op", scenario_id="nope")
    with pytest.raises(RegistryError, match="no alert"):
        mon.alert(1)
    with pytest.raises(RegistryError, match="no re-test"):
        mon.retest(1)


def test_the_demo_over_http() -> None:
    """§10 step 6 through the API: deploy, start the stream, inject, the inbox ranks the alert first, re-test."""
    client = TestClient(create_app(make_engine(), provider=load_fixtures(INTENTS)))
    intent = json.loads((INTENTS / "05-demo-b-to-c-30.json").read_text(encoding="utf-8"))["intent"]
    policy = client.post("/compile", json={"intent": intent}).json()["policy"]
    pid = policy["id"]
    client.post("/policies", json=policy)
    client.post(f"/policies/{pid}/1/evaluate", json={"replications": 10, "periods": 104, "scenarios": ["baseline"],
                                                    "rolling_replications": 2})
    client.post(f"/policies/{pid}/1/approve", headers={"X-Actor": "Head of supply chain"})
    client.post(f"/policies/{pid}/1/deploy")
    st = client.post("/streams", json={"seed": 1}).json()
    assert st["policies"] == [f"{pid}@1"] and st["week"] == 0
    sid = st["id"]
    assert client.post(f"/streams/{sid}/step", json={"weeks": 10}).json()["raised"] == []
    r = client.post(f"/streams/{sid}/inject", json={"component": {
        "kind": "supplier_outage", "supplier": "SUP_C", "window": {"start": 20}, "severity": 0.6}, "note": "demo"})
    assert r.status_code == 200 and r.json()["switches"] is None
    assert client.get(f"/streams/{sid}", params={"reveal": True}).json()["switches"][0]["week"] == 11
    step = client.post(f"/streams/{sid}/step", json={"weeks": 13}).json()
    assert step["stream"]["week"] == 23 and step["raised"][0]["monitor_id"] == C_ASSUMPTION
    inbox = client.get("/alerts", params={"status": "active"}).json()
    assert inbox[0]["monitor_id"] == C_ASSUMPTION and inbox[0]["score"] == max(a["score"] for a in inbox)
    aid = inbox[0]["id"]
    assert client.post(f"/alerts/{aid}/acknowledge", json={"note": "on it"}).json()["status"] == "acknowledged"
    rt = client.post(f"/alerts/{aid}/retest", json={"replications": 10, "periods": 52,
                                                   "rolling_replications": 2}).json()
    assert rt["retest"]["changes"][0]["path"] == "suppliers.2.capacity_per_period"
    md = client.get(f"/retests/{rt['id']}/markdown").text
    assert md.startswith(f"# Re-test after alert {aid}") and "suppliers.2.capacity_per_period" in md
    assert client.get(f"/retests/{rt['id']}").json()["verdict"] == rt["verdict"]
    assert client.post(f"/alerts/{aid}/dismiss").json()["status"] == "dismissed"
    assert client.post(f"/alerts/{aid}/resolve").status_code == 409
    assert client.get("/streams/999").status_code == 404
    assert client.post(f"/streams/{sid}/inject", json={"component": {"kind": "signal_noise"}}).status_code == 422
    assert client.get(f"/alerts/{aid}").json()["status"] == "dismissed"
    assert client.get("/alerts", params={"status": "dismissed", "stream_id": sid}).json()[0]["id"] == aid
    assert client.get("/health").json()["version"] == API_VERSION


def test_ranking_for_every_kind_of_subject(demo: Policy, ref: Any) -> None:
    def alarm(kind: str, subject: str, **kw: Any) -> Alarm:
        return Alarm(monitor_id=f"{kind}:x", kind=kind, week=30, subject=subject, message="", **kw)  # type: ignore[arg-type]

    plant = rank(alarm("assumption", "plant_capacity[PLANT_N]", policy_id=demo.id,
                       update={"variable": "plant_capacity", "node": "PLANT_N", "observed": 3000}), demo, ref)
    assert "PLANT_N's output" in plant.basis and plant.exposure_eur_per_week > 0
    svc = rank(alarm("performance", "service", evidence={"p50": 0.98, "value": 0.90}), None, ref)
    assert svc.severity == "high" and "service gap" in svc.basis and svc.exposure_eur_per_week > 0
    cost = rank(alarm("performance", "cost", evidence={"p50": 30000, "value": 34000}), None, ref)
    assert cost.severity == "medium" and cost.exposure_eur_per_week == 4000
    mandate = rank(alarm("mandate", "volume_shift_pct", policy_id=demo.id), demo, ref)
    assert mandate.severity == "high" and "policy's scope" in mandate.basis  # the demo's escalation rule says high
    from core.domain.mandate import Severity

    low = demo.mandate.model_copy(update={"escalation": [e.model_copy(update={"severity": Severity.low})
                                                         for e in demo.mandate.escalation]})
    assert rank(alarm("mandate", "volume_shift_pct"), demo.model_copy(update={"mandate": low}), ref).severity == "low"
    plain = rank(alarm("assumption", "supplier_capacity[SUP_A]",
                       update={"variable": "supplier_capacity", "supplier": "SUP_A", "observed": 5000}), None, ref)
    assert "SUP_A's normal volume" in plain.basis


def test_lead_times_of_every_distribution_scale() -> None:
    from core.domain.distributions import Deterministic, Discrete, Normal, Triangular

    lanes = [ln for ln in NET.lanes if ln.origin == "SUP_A"]
    for d in (Deterministic(value=20), Normal(mu=20, sigma=2), Triangular(low=15, mode=20, high=30),
              Discrete(values=[18, 22], probs=[0.5, 0.5])):
        net = NET.model_copy(update={"lanes": [ln.model_copy(update={"lead_time_days": d}) if ln in lanes else ln
                                               for ln in NET.lanes]})
        out, changes = observed_network(net, [{"variable": "observed_lead_time", "supplier": "SUP_A", "observed": 30}])
        assert out.lane("SUP_A", "PLANT_N").lead_time_days.mean() == pytest.approx(30)  # type: ignore[union-attr]
        assert len(changes) == 2
    unchanged, none = observed_network(NET, [{"variable": "lead_time", "supplier": "SUP_X", "ratio": 2}])
    assert none == [] and unchanged.suppliers == NET.suppliers


def test_a_demand_alert_re_tests_with_the_level_since_the_change(demo: Policy) -> None:
    reg = deployed_registry(demo)
    mon = Monitoring(reg)
    st = mon.create_stream("op", seed=1)
    mon.step(st.id, 25, "op")
    mon.inject(st.id, DemandShift(window=Window(start=30), factor=1.4, markets=["MKT_S1"]), "op")
    mon.step(st.id, 20, "op")
    a = next(x for x in mon.alerts() if x.monitor_id == "input:demand:MKT_S1")
    assert a.update and 28 <= a.update["since_week"] <= 32
    rt = mon.run_retest(a.id, "planner", replications=10, periods=52, rolling_reps=2)
    ch = rt.retest.changes[0]
    assert ch.path == "markets.4.size_factor" and ch.after == pytest.approx(ch.before * 1.4, rel=0.08)
