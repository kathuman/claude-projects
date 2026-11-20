"""Phase 1: domain models round-trip through JSON, reject what they must, and export documented schemas."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
import pytest
import yaml
from hypothesis import given
from hypothesis import strategies as st
from pydantic import BaseModel, ValidationError

from core.domain import schema_export
from core.domain.assumption import Assumption
from core.domain.condition import Condition
from core.domain.constitution import Constitution, HardConstraint, Metric, Objective
from core.domain.distributions import Deterministic, Discrete, Gamma, Normal, Triangular
from core.domain.examples import default_constitution, example_mandate, example_policy, example_rules
from core.domain.mandate import AuthorityLimit, LimitKind, Mandate
from core.domain.network import FOODNET, Network, load_foodnet
from core.domain.policy import (
    AllocationRule,
    BaseStock,
    Composite,
    DaysOfCover,
    ExpediteTrigger,
    MinMax,
    Policy,
    ProjectedStockout,
    SourcingSwitch,
    Units,
)
from core.domain.vocabulary import Variable, VarRef

RULE_TYPES = list(example_rules())


def roundtrip(obj: BaseModel) -> None:
    cls = type(obj)
    again = cls.model_validate_json(obj.model_dump_json())
    assert again == obj
    assert again.model_dump_json() == obj.model_dump_json()


# ---------------------------------------------------------------- round trips
@pytest.mark.parametrize("rule_type", RULE_TYPES)
def test_policy_round_trips(rule_type: str) -> None:
    roundtrip(example_policy(rule_type))


def test_other_models_round_trip() -> None:
    roundtrip(load_foodnet())
    roundtrip(default_constitution())
    roundtrip(example_mandate())
    roundtrip(example_policy().assumptions[0])


def test_policy_from_plain_json_dict() -> None:
    data = json.loads(example_policy("composite").model_dump_json())
    assert Policy.model_validate(data) == example_policy("composite")


# ---------------------------------------------------------------- the network
def test_foodnet_shape() -> None:
    n = load_foodnet()
    assert (len(n.suppliers), len(n.plants), len(n.dcs), len(n.markets), len(n.skus)) == (3, 2, 3, 6, 10)
    assert sum(s.category == "chilled" for s in n.skus) == 2
    assert {s.abc_class for s in n.skus} == {"A", "B", "C"}
    assert n.source_plant("DC_N", "S03") == "PLANT_N"
    assert n.source_plant("DC_S", "S03") == "PLANT_S"
    assert n.demand_mean("MKT_N1", "S04") == pytest.approx(2000 * 0.22)
    assert n.demand_cv("MKT_N1", "S04") == 0.15
    assert n.lane("SUP_A", "PLANT_N") is not None and n.lane("PLANT_N", "SUP_A") is None
    assert n.node_kind("DC_C") == "dc" and n.node_kind("nowhere") is None
    assert n.emission_factors.factor("rail") == 0.028


def _foodnet_dict() -> dict[str, Any]:
    with open(FOODNET, encoding="utf-8") as f:
        data: dict[str, Any] = yaml.safe_load(f)
    return data


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda d: d["markets"][0].update(served_by="PLANT_N"), "not a DC"),
        (lambda d: d["lanes"].append(dict(d["lanes"][0], id="L_BACK", origin="PLANT_N", destination="SUP_A")),
         "not allowed"),
        (lambda d: d["lanes"].append(dict(d["lanes"][0], id="L_GHOST", origin="SUP_X")), "unknown node"),
        (lambda d: d["plants"][0].update(skus=["S01", "S99"]), "unknown SKUs"),
        (lambda d: d["skus"][0].pop("shelf_life_days"), "needs shelf_life_days"),
        (lambda d: d["skus"][2].update(shelf_life_days=10), "must not have a shelf life"),
        (lambda d: d["dcs"].append(dict(d["dcs"][0])), "unique"),
        (lambda d: d["plants"][0]["sourcing"][0].update(share=0.9), "sum to 1"),
        (lambda d: d["plants"][0]["sourcing"].append({"supplier": "SUP_Z", "share": 0}), "no lane"),
        (lambda d: d["demand_overrides"].append({"market": "MKT_N1", "sku": "S99", "mean": 5}), "unknown market"),
        (lambda d: d["lanes"].append(dict(d["lanes"][0], id="L_DUP")), "one lane per"),
        (lambda d: d["skus"][0].update(unit_cost=-1), "greater than 0"),
    ],
)
def test_network_rejects_broken_data(change: Any, message: str) -> None:
    d = _foodnet_dict()
    change(d)
    with pytest.raises(ValidationError, match=message):
        Network.model_validate(d)


def test_network_demand_override() -> None:
    d = _foodnet_dict()
    d["demand_overrides"] = [{"market": "MKT_N1", "sku": "S04", "mean": 999, "cv": 0.5}]
    n = Network.model_validate(d)
    assert n.demand_mean("MKT_N1", "S04") == 999
    assert n.demand_cv("MKT_N1", "S04") == 0.5


# ---------------------------------------------------------------- bounds and structure
@pytest.mark.parametrize(
    "build",
    [
        lambda: BaseStock(target=DaysOfCover(value=400)),
        lambda: BaseStock(target=Units(value=-1)),
        lambda: BaseStock(target=DaysOfCover(value=14), review_period=0),
        lambda: MinMax(reorder_point=DaysOfCover(value=20), order_up_to=DaysOfCover(value=10)),
        lambda: MinMax(reorder_point=Units(value=5), order_up_to=DaysOfCover(value=10)),
        lambda: AllocationRule(method="priority"),
        lambda: AllocationRule(method="fair_share", reservation_pct=10),
        lambda: AllocationRule(method="fair_share", reservation_pct=101, priority=["MKT_N1"]),
        lambda: ExpediteTrigger(condition=ProjectedStockout(within_periods=0), mode="air", cost_cap_per_period=1),
        lambda: ExpediteTrigger(condition=ProjectedStockout(within_periods=2), mode="air", cost_cap_per_period=-5),
        lambda: SourcingSwitch(primary="SUP_B", secondary="SUP_B",
                               trigger=Condition(var=VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B"),
                                                 op="lt", threshold=0.9)),
        lambda: SourcingSwitch(primary="SUP_B", secondary="SUP_C",
                               trigger=Condition(var=VarRef(var=Variable.supplier_fill_rate, supplier="SUP_A"),
                                                 op="lt", threshold=0.9)),
        lambda: Condition(var=VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B"), op="lt", threshold=1.5),
        lambda: Condition(var=VarRef(var=Variable.lead_time, supplier="SUP_B"), op="gt", threshold=10),
        lambda: Condition(var=VarRef(var=Variable.on_hand), op="lt", threshold=10, for_periods=0),
        lambda: Composite(rules=[]),
        lambda: Composite(rules=[BaseStock(target=Units(value=1)), MinMax(reorder_point=Units(value=1),
                                                                          order_up_to=Units(value=2))]),
        lambda: AuthorityLimit(kind=LimitKind.order_qty_change_pct, value=150),
        lambda: AuthorityLimit(kind=LimitKind.consecutive_sourcing_switches, value=2.5),
    ],
)
def test_invalid_rules_are_rejected(build: Any) -> None:
    with pytest.raises(ValidationError):
        build()


def test_composite_cannot_nest() -> None:
    inner = {"type": "composite", "rules": [{"type": "base_stock", "target": {"unit": "units", "value": 5}}]}
    with pytest.raises(ValidationError):
        Composite.model_validate({"type": "composite", "rules": [inner]})


def test_references_outside_the_vocabulary_are_rejected() -> None:
    with pytest.raises(ValidationError):
        VarRef.model_validate({"var": "competitor_price"})
    with pytest.raises(ValidationError):
        VarRef(var=Variable.lead_time)  # needs a supplier
    with pytest.raises(ValidationError):
        VarRef(var=Variable.lead_time, supplier="SUP_B", node="DC_N")
    with pytest.raises(ValidationError):
        VarRef(var=Variable.on_hand, supplier="SUP_B")
    with pytest.raises(ValidationError):
        VarRef(var=Variable.capacity_utilisation)  # needs a node
    with pytest.raises(ValidationError):
        Policy.model_validate({**json.loads(example_policy().model_dump_json()), "secret": 1})


def test_varref_and_condition_text() -> None:
    assert str(VarRef(var=Variable.lead_time, supplier="SUP_B")) == "lead_time[SUP_B]"
    assert str(VarRef(var=Variable.forecast)) == "forecast"
    c = Condition(var=VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B"), op="lt", threshold=0.9, for_periods=3)
    assert str(c) == "supplier_fill_rate[SUP_B] < 0.9 fraction for 3 periods"


def test_mandate_expiry() -> None:
    m = example_mandate()
    assert m.expires_at - m.valid_from == timedelta(days=90)
    assert not m.expired(m.valid_from) and m.expired(m.expires_at)
    assert m.limit(LimitKind.order_qty_change_pct) == 15
    assert m.limit(LimitKind.volume_shift_pct) is None
    assert m.autonomy[0].unit == "% vs previous order"
    start = datetime(2027, 1, 1, tzinfo=UTC)
    with pytest.raises(ValidationError, match="after valid_from"):
        Mandate(owner="o", approver="a", agent_id="ag", valid_from=start, expires_at=start)
    with pytest.raises(ValidationError, match="366 days"):
        Mandate(owner="o", approver="a", agent_id="ag", valid_from=start, expires_at=start + timedelta(days=400))
    with pytest.raises(ValidationError, match="once"):
        Mandate(owner="o", approver="a", agent_id="ag", valid_from=start,
                autonomy=[AuthorityLimit(kind=LimitKind.volume_shift_pct, value=10)] * 2)
    from_text = Mandate.model_validate({"owner": "o", "approver": "a", "agent_id": "ag",
                                        "valid_from": "2027-01-01T00:00:00+00:00"})
    assert from_text.expires_at == start + timedelta(days=90)
    assert Mandate(owner="o", approver="a", agent_id="ag").expires_at > datetime.now(UTC)


def test_assumption_forms() -> None:
    lt = VarRef(var=Variable.lead_time, supplier="SUP_B")
    a = Assumption(id="a1", statement="B under 21 days", variable=lt, operator="lt", threshold=21,
                   source="user_stated", confidence=0.9)
    assert a.expression() == "lead_time[SUP_B] < 21 days"
    d = Assumption(id="a2", statement="B lead time is about 12 days", variable=lt,
                   distribution=Gamma(mu=12, cv=0.3), source="compiler_inferred", confidence=0.5)
    assert d.expression().startswith("lead_time[SUP_B] ~")
    for bad in (
        {"operator": "lt"},  # neither
        {"operator": "lt", "threshold": 21, "distribution": {"kind": "gamma", "mu": 12, "cv": 0.3}},  # both
        {"threshold": 21},  # threshold without operator
        {"operator": "lt", "threshold": 9999},  # out of the variable's bounds
    ):
        with pytest.raises(ValidationError):
            Assumption.model_validate({"id": "x", "statement": "s", "variable": lt.model_dump(),
                                       "source": "user_stated",
                                       "confidence": 0.5, **bad})
    with pytest.raises(ValidationError):
        Assumption(id="x", statement="s", variable=lt, operator="lt", threshold=5, source="user_stated",
                   confidence=1.5)


def test_constitution_rules() -> None:
    c = default_constitution()
    assert c.ref == "foodnet-constitution@1"
    assert str(c.hard_constraints[0]) == "fill_rate [category=chilled] ≥ 0.97 fraction per horizon"
    base = json.loads(c.model_dump_json())
    for change in (
        {"priorities": ["service", "cost", "carbon"]},
        {"priorities": ["service", "service", "cost", "carbon"]},
        {"soft_weights": {"service": 0, "cost": 0}},
        {"soft_weights": {"service": 2}},
        {"breach_alpha": 0.9},
        {"risk": {"measure": "cvar", "level": 0.3}},
        {"hard_constraints": base["hard_constraints"] * 2},
    ):
        with pytest.raises(ValidationError):
            Constitution.model_validate({**base, **change})
    with pytest.raises(ValidationError, match="within"):
        HardConstraint(id="h", metric=Metric.fill_rate, op="ge", threshold=97)
    assert Objective.carbon in c.priorities


# ---------------------------------------------------------------- distributions
def test_distributions_sample_with_their_moments() -> None:
    rng = np.random.default_rng(1)
    cases = [Deterministic(value=3), Normal(mu=50, sigma=5), Gamma(mu=12, cv=0.3),
             Triangular(low=1, mode=2, high=4), Discrete(values=[1, 2, 3], probs=[0.2, 0.5, 0.3])]
    for d in cases:
        x = d.sample(rng, (200_000,))
        assert x.shape == (200_000,)
        assert x.mean() == pytest.approx(d.mean(), rel=0.01, abs=0.01)
        assert x.std() == pytest.approx(d.sd(), rel=0.02, abs=0.01)
    with pytest.raises(ValidationError):
        Triangular(low=3, mode=2, high=4)
    with pytest.raises(ValidationError):
        Discrete(values=[1, 2], probs=[0.5])
    with pytest.raises(ValidationError):
        Discrete(values=[1, 2], probs=[0.5, 0.6])


# ---------------------------------------------------------------- bounds as a property
@given(st.floats(min_value=-1e3, max_value=1e3, allow_nan=False))
def test_days_of_cover_accepted_exactly_within_bounds(v: float) -> None:
    ok = 0 <= v <= 365
    try:
        BaseStock(target=DaysOfCover(value=v))
        accepted = True
    except ValidationError:
        accepted = False
    assert accepted == ok


@given(st.floats(min_value=-10, max_value=10, allow_nan=False), st.sampled_from(list(LimitKind)))
def test_authority_limits_accepted_exactly_within_bounds(v: float, kind: LimitKind) -> None:
    from core.domain.mandate import LIMIT_SPECS

    hi = LIMIT_SPECS[kind][1]
    whole = kind != LimitKind.consecutive_sourcing_switches or v == int(v)
    ok = 0 <= v <= hi and whole
    try:
        AuthorityLimit(kind=kind, value=v)
        accepted = True
    except ValidationError:
        accepted = False
    assert accepted == ok


@given(st.floats(min_value=-2, max_value=2, allow_nan=False), st.integers(min_value=-2, max_value=60))
def test_conditions_accepted_exactly_within_bounds(threshold: float, periods: int) -> None:
    ok = 0 <= threshold <= 1 and 1 <= periods <= 52
    try:
        Condition(var=VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B"), op="lt", threshold=threshold,
                  for_periods=periods)
        accepted = True
    except ValidationError:
        accepted = False
    assert accepted == ok


# ---------------------------------------------------------------- schemas
def _numeric_leaves(node: Any, path: str = "") -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    if isinstance(node, dict):
        if node.get("type") in ("number", "integer"):
            out.append((path, node))
        for k, v in node.items():
            out += _numeric_leaves(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += _numeric_leaves(v, f"{path}/{i}")
    return out


@pytest.mark.parametrize("name", ["policy", "mandate", "assumption", "constitution", "network"])
def test_every_number_in_the_schemas_is_bounded(name: str) -> None:
    schema = schema_export.schemas()[name]
    leaves = _numeric_leaves(schema)
    assert leaves, "the schema has numbers"
    unbounded = [
        p for p, n in leaves
        if not ({"minimum", "exclusiveMinimum"} & n.keys() and {"maximum", "exclusiveMaximum"} & n.keys())
    ]
    assert unbounded == []


def test_schema_export_and_reference(tmp_path: Any, monkeypatch: Any) -> None:
    monkeypatch.setattr(schema_export, "BACKEND", tmp_path / "backend")
    monkeypatch.setattr(schema_export, "ROOT", tmp_path)
    (tmp_path / "backend" / "data" / "foodnet").mkdir(parents=True)
    written = schema_export.export()
    assert len(written) == 9 and all(p.exists() for p in written)
    ref = (tmp_path / "docs" / "DSL_REFERENCE.md").read_text(encoding="utf-8")
    for heading in ("## Variable vocabulary", "## BaseStock", "## SourcingSwitch", "## Mandate", "## Assumption"):
        assert heading in ref
    assert "| `review_period` | `integer` |  | ≥ 1, ≤ 13 | 1 |" in ref
    policy_schema = json.loads((tmp_path / "backend" / "schemas" / "policy.schema.json").read_text(encoding="utf-8"))
    assert policy_schema["title"] == "Policy"
