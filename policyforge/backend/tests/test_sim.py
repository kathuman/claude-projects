"""Phase 2: the simulator conserves stock, is reproducible, uses common random numbers, is fast, and matches theory."""

from __future__ import annotations

import time

import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from scipy.stats import norm

from core.domain.condition import Condition
from core.domain.mandate import LimitKind
from core.domain.network import load_foodnet
from core.domain.policy import (
    AllocationRule,
    BaseStock,
    Composite,
    CoverageBelow,
    DaysOfCover,
    ExpediteTrigger,
    MinMax,
    Policy,
    ProjectedStockout,
    SourcingSwitch,
    Units,
)
from core.domain.scenario import (
    BaselineDemand,
    CorrelatedShock,
    DemandShift,
    LeadTimeInflation,
    PlantCapacityLoss,
    Scenario,
    SignalNoise,
    SupplierOutage,
    Window,
)
from core.domain.vocabulary import Variable, VarRef
from core.sim.engine import COST_KEYS, SimConfig, SimResult, simulate
from core.sim.layout import Layout, build_layout
from core.sim.program import background_policies, compile_program
from core.sim.scenarios import default_suite, generate
from tests.simkit import ample_plant, policy, single_node

FOODNET = build_layout(load_foodnet())
BASE = Scenario(id="base", name="base", components=[BaselineDemand()])


def run(lay: Layout, policies: list[Policy], scenario: Scenario = BASE, R: int = 30, T: int = 40, seed: int = 1,
        cfg: SimConfig | None = None) -> SimResult:
    return simulate(lay, generate(lay, scenario, R, T, seed), compile_program(lay, policies), cfg)


def background(*extra: Policy) -> list[Policy]:
    return [*background_policies(FOODNET), *extra]


# ---------------------------------------------------------------- conservation
def assert_conserved(res: SimResult) -> None:
    lay = res.layout
    P = lay.P
    prev = res.init_on_hand
    for t in range(res.T):
        np.testing.assert_allclose(prev + res.receipts[:, t] - res.outflow[:, t] - res.spoiled[:, t],
                                   res.on_hand[:, t], atol=1e-6)
        prev = res.on_hand[:, t]
    assert (res.on_hand >= -1e-9).all() and (res.backorders >= -1e-9).all() and (res.lost >= -1e-9).all()
    # markets: what was asked = what was delivered + what was lost + the change in backorders
    bo_prev = np.concatenate([np.zeros_like(res.backorders[:, :1]), res.backorders[:, :-1]], axis=1)
    np.testing.assert_allclose(res.demand + bo_prev, res.shipped + res.lost + res.backorders, atol=1e-6)
    # DC deliveries to markets equal DC outflow
    for d in range(lay.D):
        ms = np.flatnonzero(lay.market_dc == d)
        np.testing.assert_allclose(res.shipped[:, :, ms].sum(axis=2), res.outflow[:, :, P + d], atol=1e-6)
    # material: start pipeline + shipped by suppliers = received + end pipeline
    np.testing.assert_allclose(res.init_material_pipeline.sum((1, 2)) + res.supplier_shipped.sum((1, 2)),
                               res.material_in.sum((1, 2, 3)) + res.end_material_pipeline.sum((1, 2)), rtol=1e-9,
                               atol=1e-6)
    # production queue: start + received − produced = end
    np.testing.assert_allclose(res.init_wip + res.material_in.sum(1) - res.receipts[:, :, :P].sum(1),
                               res.wip[:, -1], atol=1e-6)
    # DC side: start pipeline (incl. unshipped orders) + orders placed = received + end pipeline
    np.testing.assert_allclose(res.init_dc_pipeline + res.orders[:, :, P:].sum(1),
                               res.receipts[:, :, P:].sum(1) + res.end_dc_pipeline, atol=1e-6)
    # what plants ship equals what DCs order or are still owed
    assert (res.supplier_shipped <= res.supplier_ordered + 1e-6).all()


def test_conservation_on_foodnet_default_suite() -> None:
    for sc in default_suite().scenarios:
        assert_conserved(run(FOODNET, background(), sc, R=8, T=60))


rules = st.one_of(
    st.builds(lambda d, r: BaseStock(target=DaysOfCover(value=d), review_period=r),
              st.floats(0, 60), st.integers(1, 4)),
    st.builds(lambda s, gap: MinMax(reorder_point=DaysOfCover(value=s), order_up_to=DaysOfCover(value=s + gap)),
              st.floats(0, 30), st.floats(0, 30)),
    st.builds(lambda u: BaseStock(target=Units(value=u)), st.floats(0, 20000)),
)
components = st.sampled_from([
    BaselineDemand(seasonality=False),
    DemandShift(window=Window(start=5, duration=10), factor=2.5),
    SupplierOutage(supplier="SUP_B", window=Window(start=3, duration=12), severity=1.0),
    LeadTimeInflation(supplier="SUP_A", start=2, factor=3, ramp_periods=4),
    PlantCapacityLoss(plant="PLANT_S", window=Window(start=4), severity=0.9),
    CorrelatedShock(probability=0.7, earliest_start=0, latest_start=10, duration=6, suppliers=["SUP_A", "SUP_B"],
                    supply_severity=0.8, lead_time_factor=2, markets=["MKT_S1"], demand_factor=3),
    SignalNoise(noise_cv=0.8, extra_delay=3),
])


@settings(max_examples=25, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(rules, rules, components, st.integers(0, 2**31), st.booleans(), st.sampled_from(["block", "flag"]))
def test_conservation_holds_for_any_policy_and_scenario(dc_rule: BaseStock | MinMax, plant_rule: BaseStock | MinMax,
                                                        comp: object, seed: int, with_extras: bool,
                                                        on_limit: str) -> None:
    extras: list[Policy] = []
    if with_extras:
        fill_b = VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B")
        extras = [
            policy("alloc", AllocationRule(method="priority", priority=["MKT_N2", "MKT_C1"], reservation_pct=20),
                   nodes=["DC_N", "DC_C", "PLANT_N"]),
            policy("switch", Composite(rules=[
                SourcingSwitch(primary="SUP_B", secondary="SUP_C",
                               trigger=Condition(var=fill_b, op="lt", threshold=0.95, for_periods=1),
                               switch_back=Condition(var=fill_b, op="ge", threshold=0.95), shift_fraction=0.7),
                ExpediteTrigger(condition=CoverageBelow(days=10), mode="express_road", cost_cap_per_period=500),
            ]), limits={LimitKind.volume_shift_pct: 30, LimitKind.expedite_spend_per_period: 300}),
        ]
    pols = [policy("plants", plant_rule, nodes=FOODNET.plant_ids, limits={LimitKind.order_qty_change_pct: 20}),
            policy("dcs", dc_rule, nodes=FOODNET.dc_ids), *extras]
    sc = Scenario(id="h", name="h", components=[comp])  # type: ignore[list-item]
    assert_conserved(run(FOODNET, pols, sc, R=5, T=36, seed=seed, cfg=SimConfig(on_limit=on_limit, info_delay=1)))


# ---------------------------------------------------------------- determinism and common random numbers
def _fingerprint(res: SimResult) -> list[np.ndarray]:
    return [res.shipped, res.orders, res.on_hand, res.total_cost, res.co2_t, res.spoiled, res.supplier_shipped]


def test_same_seed_same_results_different_seed_different_results() -> None:
    sc = default_suite().scenarios[6]  # the correlated shock uses its own random stream as well
    a, b = run(FOODNET, background(), sc, seed=11), run(FOODNET, background(), sc, seed=11)
    for x, y in zip(_fingerprint(a), _fingerprint(b), strict=True):
        assert np.array_equal(x, y)
    c = run(FOODNET, background(), sc, seed=12)
    assert not np.array_equal(a.shipped, c.shipped)


def test_common_random_numbers() -> None:
    draws = generate(FOODNET, BASE, 20, 30, 5)
    p1 = simulate(FOODNET, draws, compile_program(FOODNET, background()))
    p2 = simulate(FOODNET, draws, compile_program(FOODNET, background_policies(FOODNET, dc_days=28)))
    assert np.array_equal(p1.demand, p2.demand)
    assert not np.array_equal(p1.orders, p2.orders)
    # scenarios that do not touch demand share the same demand and lead-time draws for the same seed
    outage = Scenario(id="o", name="o", components=[SupplierOutage(supplier="SUP_B", window=Window(start=5),
                                                                   severity=1)])
    d2 = generate(FOODNET, outage, 20, 30, 5)
    assert np.array_equal(draws.demand, d2.demand) and np.array_equal(draws.lt_days, d2.lt_days)
    assert not np.array_equal(draws.supplier_cap, d2.supplier_cap)


# ---------------------------------------------------------------- performance
def test_one_thousand_replications_of_104_periods_in_under_30_seconds() -> None:
    lay = FOODNET
    prog = compile_program(lay, background())
    t0 = time.perf_counter()
    res = simulate(lay, generate(lay, default_suite().scenarios[0], 1000, 104, 3), prog)
    elapsed = time.perf_counter() - t0
    print(f"\n1,000 × 104 on FoodNet: {elapsed:.1f} s")
    assert res.shipped.shape == (1000, 104, 6, 10)
    assert elapsed < 30


# ---------------------------------------------------------------- the analytical case
@pytest.mark.parametrize(("lead", "z"), [(2, 1.0), (3, 0.5), (1, 1.5)])
def test_single_node_base_stock_matches_theoretical_fill_rate(lead: int, z: float) -> None:
    """Base-stock S at the DC, normal demand, lead time L periods, orders placed after demand: protection is L
    periods, and the fill rate is 1 − (E[(D_L − S)⁺] − E[(D_{L−1} − S)⁺]) / μ."""
    mu, sigma = 100.0, 20.0
    lay = build_layout(single_node(mu=mu, cv=sigma / mu, dc_lead_days=7 * lead))
    big_s = lead * mu + z * sigma * np.sqrt(lead)

    def loss(n: int) -> float:  # E[(D_n − S)^+]
        if n == 0:
            return max(0.0, -big_s)
        s = sigma * np.sqrt(n)
        zz = (big_s - n * mu) / s
        return float(s * (norm.pdf(zz) - zz * (1 - norm.cdf(zz))))

    theory = 1 - (loss(lead) - loss(lead - 1)) / mu
    sc = Scenario(id="flat", name="flat", components=[BaselineDemand(seasonality=False)])
    res = run(lay, [ample_plant(), policy("dc", BaseStock(target=Units(value=big_s)), nodes=["DC"])], sc,
              R=1000, T=150, seed=2)
    warm = 20
    dem = res.demand[:, warm:, 0, 0]
    short_now = np.minimum(dem, res.backorders[:, warm:, 0, 0])  # this period's demand not met from stock
    fill = 1 - short_now.sum() / dem.sum()
    print(f"\nL={lead}: simulated {fill:.4f}, theory {theory:.4f}")
    assert abs(fill - theory) < 0.01


# ---------------------------------------------------------------- behaviour of executors in the engine
def test_mandate_blocks_or_flags_large_order_changes() -> None:
    noisy = Scenario(id="n", name="n", components=[SignalNoise(noise_cv=0.6)])
    dc = BaseStock(target=DaysOfCover(value=14))
    limited = [*background_policies(FOODNET), policy("dcs", dc, nodes=FOODNET.dc_ids,
                                                     limits={LimitKind.order_qty_change_pct: 5})]
    blocked = run(FOODNET, limited, noisy, cfg=SimConfig(on_limit="block"))
    flagged = run(FOODNET, limited, noisy, cfg=SimConfig(on_limit="flag"))
    assert blocked.limit_hits["order_qty_change_pct"].sum() > 0
    assert flagged.limit_hits["order_qty_change_pct"].sum() > 0
    assert blocked.escalations.sum() >= blocked.limit_hits["order_qty_change_pct"].sum()
    # blocking keeps DC orders within ±5 % of the previous order
    q = blocked.orders[:, :, FOODNET.P:]
    prev, now = q[:, :-1], q[:, 1:]
    ok = (prev <= 0) | (now <= 0) | (np.abs(now - prev) <= 0.05 * prev + 1e-6)
    assert ok.all()
    assert not np.array_equal(blocked.orders, flagged.orders)


def test_sourcing_switch_moves_volume_and_respects_the_mandate() -> None:
    fill_b = VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B")
    outage = Scenario(id="o", name="o", components=[SupplierOutage(supplier="SUP_B", window=Window(start=10,
                                                                                                  duration=10),
                                                                   severity=0.9)])
    rule = SourcingSwitch(primary="SUP_B", secondary="SUP_C",
                          trigger=Condition(var=fill_b, op="lt", threshold=0.5, for_periods=2),
                          switch_back=Condition(var=fill_b, op="ge", threshold=0.85, for_periods=2),
                          shift_fraction=0.6, min_dwell_periods=4)
    free = run(FOODNET, background(policy("sw", rule)), outage)
    capped = run(FOODNET, background(policy("sw", rule, limits={LimitKind.volume_shift_pct: 30})), outage)
    none = run(FOODNET, background(), outage)
    c = FOODNET.supplier_ids.index("SUP_C")
    assert free.switches.sum() > 0
    assert free.supplier_ordered[:, :, c].sum() > capped.supplier_ordered[:, :, c].sum() > 0
    assert none.supplier_ordered[:, :, c].sum() == 0
    assert capped.limit_hits["volume_shift_pct"].sum() > 0
    first = free.switches.argmax(axis=1)
    assert (first >= 11).all(), "the switch waits for two periods of low fill"
    one_switch = run(FOODNET, background(policy("sw", rule, limits={LimitKind.consecutive_sourcing_switches: 1})),
                     outage)
    assert one_switch.switches.sum(axis=1).max() <= 1


def test_expedite_trigger_spends_within_its_cap() -> None:
    surge = Scenario(id="s", name="s", components=[DemandShift(window=Window(start=8, duration=6), factor=1.8)])
    rule = ExpediteTrigger(condition=ProjectedStockout(within_periods=2), mode="express_road",
                           cost_cap_per_period=1500)
    res = run(FOODNET, background(policy("ex", rule, nodes=FOODNET.dc_ids)), surge)
    assert res.expedited_units.sum() > 0
    assert (res.cost["expedite"] <= 1500 + 1e-6).all()
    capped = run(FOODNET, background(policy("ex", rule, nodes=FOODNET.dc_ids,
                                            limits={LimitKind.expedite_spend_per_period: 400})), surge)
    assert (capped.cost["expedite"] <= 400 + 1e-6).all()
    flagged = run(FOODNET, background(policy("ex", rule, nodes=FOODNET.dc_ids,
                                             limits={LimitKind.expedite_spend_per_period: 400})), surge,
                  cfg=SimConfig(on_limit="flag"))
    assert flagged.limit_hits["expedite_spend_per_period"].sum() > 0
    cover = ExpediteTrigger(condition=CoverageBelow(days=30), mode="express_road", cost_cap_per_period=1e6)
    assert run(FOODNET, background(policy("cv", cover, nodes=["PLANT_N"]))).expedited_units.sum() > 0


def test_priority_allocation_protects_the_listed_market() -> None:
    surge = Scenario(id="s", name="s", components=[DemandShift(window=Window(start=5), factor=1.6,
                                                               markets=["MKT_N1", "MKT_N2"])])
    lean = BaseStock(target=DaysOfCover(value=7))
    plain = run(FOODNET, background(policy("lean", lean, nodes=["DC_N"])), surge)
    protect = run(FOODNET, background(policy("lean", lean, nodes=["DC_N"]),
                                      policy("p", AllocationRule(method="priority", priority=["MKT_N2"]),
                                             nodes=["DC_N"])), surge)
    n2 = FOODNET.market_ids.index("MKT_N2")

    def fill(r: SimResult, m: int) -> float:
        return float(r.shipped[:, 5:, m].sum() / (r.demand[:, 5:, m].sum() + 1e-9))

    assert fill(protect, n2) > fill(plain, n2)


def test_chilled_stock_spoils_and_ambient_does_not() -> None:
    heavy = BaseStock(target=DaysOfCover(value=60))
    res = run(FOODNET, background(policy("heavy", heavy, nodes=FOODNET.dc_ids)))
    chilled = FOODNET.chilled
    assert res.spoiled[..., chilled].sum() > 0
    assert res.spoiled[..., ~chilled].sum() == 0
    assert res.cost["spoilage"].sum() > 0


def test_information_delay_and_noise_raise_order_variability() -> None:
    calm = run(FOODNET, background(), BASE, R=40, T=80)
    noisy = run(FOODNET, background(), Scenario(id="n", name="n", components=[SignalNoise(noise_cv=0.3,
                                                                                          extra_delay=2)]),
                R=40, T=80)
    dcs = slice(FOODNET.P, None)
    assert noisy.orders[:, 20:, dcs].std(axis=1).mean() > calm.orders[:, 20:, dcs].std(axis=1).mean()


def test_lost_sales_and_backorders_follow_the_sku() -> None:
    lay = build_layout(single_node(lost_sale=True))
    res = run(lay, [ample_plant(), policy("dc", BaseStock(target=Units(value=60)), nodes=["DC"])])
    assert res.lost.sum() > 0 and res.backorders.sum() == 0
    assert_conserved(res)
    assert set(res.cost) == set(COST_KEYS)


# ---------------------------------------------------------------- scenario generators
def test_scenario_generators_change_what_they_say() -> None:
    T = 60
    lay = FOODNET
    b = lay.supplier_ids.index("SUP_B")
    out = generate(lay, Scenario(id="x", name="x", components=[
        SupplierOutage(supplier="SUP_B", window=Window(start=10, duration=5), severity=0.8)]), 4, T, 1)
    assert np.allclose(out.supplier_cap[:, 10:15, b], 0.2) and np.allclose(out.supplier_cap[:, 15:, b], 1)
    base = generate(lay, BASE, 4, T, 1)
    infl = generate(lay, Scenario(id="x", name="x", components=[
        LeadTimeInflation(supplier="SUP_B", start=20, factor=2, ramp_periods=10)]), 4, T, 1)
    lanes_b = [i for i, ln in enumerate(lay.lanes) if ln.origin == "SUP_B"]
    ratio = infl.lt_days[:, :, lanes_b] / base.lt_days[:, :, lanes_b]
    assert np.allclose(ratio[:, :20], 1) and np.allclose(ratio[:, 29:], 2) and np.allclose(ratio[:, 24], 1.5)
    step = generate(lay, Scenario(id="x", name="x", components=[
        LeadTimeInflation(supplier="SUP_B", start=20, factor=3)]), 4, T, 1)
    assert np.allclose(step.lt_days[:, 20:, lanes_b] / base.lt_days[:, 20:, lanes_b], 3)
    cap = generate(lay, Scenario(id="x", name="x", components=[
        PlantCapacityLoss(plant="PLANT_N", window=Window(start=30), severity=0.5)]), 4, T, 1)
    assert np.allclose(cap.plant_cap[:, 30:, 0], 0.5) and np.allclose(cap.plant_cap[:, :30, 0], 1)
    shift = generate(lay, Scenario(id="x", name="x", components=[
        DemandShift(window=Window(start=5, duration=3), factor=2, markets=["MKT_S1"], categories=["chilled"])]),
        4, T, 1)
    m, k = lay.market_ids.index("MKT_S1"), lay.sku_ids.index("S01")
    assert np.allclose(shift.demand[:, 5:8, m, k], 2 * base.demand[:, 5:8, m, k])
    assert np.allclose(shift.demand[:, 5:8, m, lay.sku_ids.index("S04")], base.demand[:, 5:8, m,
                                                                                       lay.sku_ids.index("S04")])
    shock = generate(lay, Scenario(id="x", name="x", components=[
        CorrelatedShock(probability=0.5, earliest_start=5, latest_start=20, duration=4, suppliers=["SUP_A"],
                        supply_severity=1)]), 2000, T, 1)
    hit = shock.shocked.any(axis=1)
    assert 0.45 < hit.mean() < 0.55
    assert (shock.shocked.sum(axis=1)[hit] == 4).all()
    noise = generate(lay, Scenario(id="x", name="x", components=[SignalNoise(noise_cv=0.3, extra_delay=2)]), 4, T, 1)
    assert noise.extra_delay == 2 and 0.2 < noise.signal.std() < 0.4
    flat = generate(lay, Scenario(id="x", name="x", components=[BaselineDemand(seasonality=False)]), 4000, T, 1)
    assert flat.demand.mean(axis=(0, 1)) == pytest.approx(lay.demand_mean, rel=0.03)


def test_default_suite_has_eight_scenarios() -> None:
    suite = default_suite()
    assert len(suite.scenarios) == 8
    assert len({s.id for s in suite.scenarios}) == 8
