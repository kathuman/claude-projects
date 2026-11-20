"""P5b (backend side): locations on a map, broken networks located, CSV round trips, health, quick test, scenarios."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.app import create_app
from core.domain.network import FOODNET, Location, Network, NetworkData, load_foodnet, reference_problems
from core.domain.network_health import check, great_circle_km, suggested_distance_km
from core.domain.network_io import dist_from_text, dist_to_text, from_csv, to_csv
from core.domain.scenario import DemandShift, Scenario, ScenarioSet, SupplierOutage, Window
from core.evaluate.quick import quick_test
from core.llm.mock import load_fixtures
from core.registry.store import make_engine
from core.sim.layout import build_layout
from core.sim.scenarios import default_suite, generate
from core.sim.scenarios.preview import preview

FIXTURES = Path(__file__).parent / "fixtures"
BROKEN = json.loads((FIXTURES / "broken_networks.json").read_text(encoding="utf-8"))
NET = load_foodnet()


def foodnet_json() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(NET.model_dump_json())
    return data


def apply(doc: dict[str, Any], ops: list[dict[str, Any]]) -> dict[str, Any]:
    """The tiny patch language the broken-network fixtures use (the TypeScript tests apply the same)."""
    for op in ops:
        *parents, last = op["path"].split(".")
        node: Any = doc
        for key in parents:
            node = node[int(key)] if isinstance(node, list) else node[key]
        if op["op"] == "set":
            if isinstance(node, list):
                node[int(last)] = op["value"]
            else:
                node[last] = op["value"]
        elif op["op"] == "remove":
            if isinstance(node, list):
                node.pop(int(last))
            else:
                node.pop(last)
        elif op["op"] == "append":
            node = node[last]
            node.append(op["value"])
    return doc


# ---------------------------------------------------------------- the model on a map
def test_locations_take_latitude_and_longitude() -> None:
    assert all(x.location.lat is not None for g in (NET.suppliers, NET.plants, NET.dcs, NET.markets) for x in g)
    assert Location(lat=50, lon=4).x_km == 0
    with pytest.raises(ValidationError, match="give both"):
        Location(lat=50)
    with pytest.raises(ValidationError):
        Location(lat=91, lon=0)
    assert great_circle_km(48.8566, 2.3522, 51.5074, -0.1278) == pytest.approx(344, abs=2)  # Paris–London
    assert suggested_distance_km(NET, "PLANT_N", "DC_N") == pytest.approx(82, abs=1)
    assert suggested_distance_km(NET, "PLANT_N", "nowhere") is None
    for ln in NET.lanes:  # FoodNet's distances follow its map
        assert ln.distance_km == suggested_distance_km(NET, ln.origin, ln.destination)


# ---------------------------------------------------------------- broken networks: errors carry their paths
@pytest.mark.parametrize("case", BROKEN, ids=[c["name"] for c in BROKEN])
def test_broken_network_is_rejected_at_the_right_path(case: dict[str, Any]) -> None:
    doc = apply(foodnet_json(), case["ops"])
    exp = case["expect"]
    if case["level"] == "field":
        with pytest.raises(ValidationError) as e:
            NetworkData.model_validate(doc)
        hits = [err for err in e.value.errors() if ".".join(str(x) for x in err["loc"]) == exp["path"]]
        assert hits, [err["loc"] for err in e.value.errors()]
        assert any(exp["message"] in err["msg"] for err in hits)
    else:
        problems = reference_problems(NetworkData.model_validate(doc))
        assert any(p.path == exp["path"] and exp["message"] in p.message for p in problems), problems
        with pytest.raises(ValidationError, match=exp["message"]):
            Network.model_validate(doc)


def test_the_set_covers_both_levels_and_both_places() -> None:
    assert len(BROKEN) >= 12
    assert {c["level"] for c in BROKEN} == {"field", "reference"}
    assert {c["browser"] for c in BROKEN} == {True, False}


# ---------------------------------------------------------------- CSV
def test_csv_round_trip_and_errors_by_row() -> None:
    tables = to_csv(NET)
    assert set(tables) == {"network", "skus", "suppliers", "plants", "dcs", "markets", "lanes", "demand_overrides"}
    back, errs = from_csv(tables)
    assert errs == [] and back == NET
    semicolons = {k: v.replace(",", ";") if k != "lanes" else v for k, v in tables.items()}
    assert from_csv(semicolons)[0] is not None, "semicolon-separated files (European Excel) are read too"
    bad = dict(tables)
    bad["lanes"] = tables["lanes"].replace('"gamma(21, 0.08)"', '"gamma(21)"', 1)
    _, errs = from_csv(bad)
    assert [(e.table, e.row, e.column) for e in errs] == [("lanes", 1, "lead_time_days")]
    bad = dict(tables)
    bad["markets"] = tables["markets"].replace(",DC_N", ",PLANT_N", 1)
    _, errs = from_csv(bad)
    assert (errs[0].table, errs[0].row, errs[0].column) == ("markets", 1, "served_by")
    bad = dict(tables)
    bad["plants"] = tables["plants"].replace("SUP_A=0.5", "SUP_A:0.5", 1)
    assert from_csv(bad)[1][0].column == "sourcing"
    assert from_csv({**tables, "weird": "a,b"})[1][0].table == "weird"
    for text in ("deterministic(1)", "normal(5, 1)", "gamma(12, 0.35)", "triangular(1, 2, 4)",
                 "discrete(1 2 3 | 0.2 0.5 0.3)"):
        assert dist_to_text(NetworkData.model_validate(
            {**foodnet_json(), "lanes": [{**foodnet_json()["lanes"][0], "lead_time_days": dist_from_text(text)}]}
        ).lanes[0].lead_time_days) == text
    for bad_text in ("gamma", "beta(1, 2)", "discrete(1 2)", "triangular(1, 2)"):
        with pytest.raises(ValueError):
            dist_from_text(bad_text)


# ---------------------------------------------------------------- health and the quick test
def test_health_checks() -> None:
    h = check(NET)
    assert h.plant_load["PLANT_N"] == pytest.approx(0.69, abs=0.01) and h.supplier_load["SUP_C"] == 0
    assert [f.target for f in h.findings] == ["SUP_C"]
    tight = NET.model_copy(update={"plants": [p.model_copy(update={"capacity_per_period": 4000})
                                              for p in NET.plants]})
    tight = Network.model_validate(tight.model_dump())
    msgs = [f.message for f in check(tight).findings]
    assert any("cannot keep up" in m for m in msgs)
    short = Network.model_validate({**foodnet_json(), "skus": [
        {**s, "shelf_life_days": 9} if s["id"] == "S01" else s for s in foodnet_json()["skus"]]})
    assert any(f.target == "S01" for f in check(short).findings)


def test_quick_test_runs_in_seconds() -> None:
    q = quick_test(NET, replications=50, periods=40)
    assert 0.9 < q.fill_rate <= 1 and set(q.fill_by_dc) == {"DC_N", "DC_C", "DC_S"}
    assert 0.5 < q.plant_utilisation["PLANT_N"] < 0.9 and q.supplier_utilisation["SUP_C"] == 0
    assert q.seconds < 10


# ---------------------------------------------------------------- scenarios
def test_scenario_preview_shows_only_the_scenario() -> None:
    lay = build_layout(NET)
    pv = preview(lay, Scenario(id="x", name="x", components=[
        SupplierOutage(supplier="SUP_B", window=Window(start=10, duration=5), severity=0.6),
        DemandShift(window=Window(start=20, duration=4), factor=1.5, markets=["MKT_S1"])]), periods=40)
    assert pv.supplier_capacity["SUP_B"][10:15] == [0.4] * 5 and pv.supplier_capacity["SUP_B"][15] == 1
    assert pv.supplier_capacity["SUP_A"] == [1.0] * 40
    assert pv.demand["MKT_S1"][20:24] == [1.5] * 4 and pv.demand["MKT_N1"] == [1.0] * 40
    assert pv.shock_share == [0.0] * 40 and pv.extra_delay == 0


def test_a_scenario_built_as_json_draws_exactly_like_python() -> None:
    """The scenario builder emits JSON; the engine must draw the same futures as the same scenario in Python."""
    py = default_suite().scenarios[6]
    from_json = Scenario.model_validate(json.loads(py.model_dump_json()))
    lay = build_layout(NET)
    a, b = generate(lay, py, 20, 52, 3), generate(lay, from_json, 20, 52, 3)
    for field in ("demand", "lt_days", "supplier_cap", "plant_cap", "shocked"):
        assert np.array_equal(getattr(a, field), getattr(b, field))


def test_the_studio_scenario_fixture_draws_like_python() -> None:
    """The browser test builds this set in the scenario builder and checks the saved set equals the fixture; here the
    fixture is checked against the same set written in Python, draw for draw."""
    built = ScenarioSet.model_validate_json((FIXTURES / "studio_scenario_set.json").read_text(encoding="utf-8"))
    py = ScenarioSet(id="north-outage", name="North outage", scenarios=[Scenario(
        id="sup-b-outage", name="Supplier B outage",
        components=[SupplierOutage(supplier="SUP_B", window=Window(start=20, duration=6), severity=0.8)])])
    assert built == py
    lay = build_layout(NET)
    a, b = generate(lay, built.scenarios[0], 30, 52, 11), generate(lay, py.scenarios[0], 30, 52, 11)
    assert np.array_equal(a.supplier_cap, b.supplier_cap) and np.array_equal(a.demand, b.demand)


# ---------------------------------------------------------------- the API for the Studio
@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(make_engine(), provider=load_fixtures(FIXTURES / "intents")))


def test_studio_endpoints(client: TestClient) -> None:
    doc = foodnet_json()
    r = client.post("/networks/check", json={"network": doc}).json()
    assert r["valid"] and r["errors"] == [] and r["health"]["plant_load"]["PLANT_S"] > 0.6
    for case in BROKEN:
        r = client.post("/networks/check", json={"network": apply(foodnet_json(), case["ops"])}).json()
        assert not r["valid"] and r["health"] is None
        assert any(e["path"] == case["expect"]["path"] and e["level"] == case["level"] for e in r["errors"]), case
    q = client.post("/networks/quick-test", json={"network": doc, "replications": 20, "periods": 30}).json()
    assert 0.8 < q["fill_rate"] <= 1
    bad = apply(foodnet_json(), BROKEN[0]["ops"])
    r = client.post("/networks/quick-test", json={"network": bad})
    assert r.status_code == 422 and r.json()["detail"]["errors"][0]["path"] == "skus.0.unit_cost"

    tables = client.post("/networks/to-csv", json={"network": doc}).json()["tables"]
    back = client.post("/networks/from-csv", json={"tables": tables}).json()
    assert back["errors"] == [] and Network.model_validate(back["network"]) == NET
    z = zipfile.ZipFile(io.BytesIO(client.post("/networks/csv-zip", json={"network": doc}).content))
    assert sorted(z.namelist()) == sorted(f"{t}.csv" for t in tables)
    text = client.post("/networks/to-yaml", json={"network": doc}).text
    assert text.startswith("name: FoodNet")
    assert Network.model_validate(client.post("/networks/from-yaml", json={"text": text}).json()["network"]) == NET
    assert client.post("/networks/from-yaml", json={"text": FOODNET.read_text(encoding="utf-8")}).json()["errors"] == []
    assert client.post("/networks/from-yaml", json={"text": "a: [1,"}).json()["errors"][0]["path"] == "(file)"
    not_a_map = client.post("/networks/from-yaml", json={"text": "- 1"}).json()
    assert not_a_map["errors"][0]["message"].startswith("the file")
    r = client.post("/networks/from-yaml", json={"text": json.dumps(bad)}).json()
    assert r["network"] is None and r["errors"][0]["path"] == "skus.0.unit_cost"
    assert r["draft"]["skus"][0]["unit_cost"] == -1, "the Studio loads the broken file to fix it in place"
    broken_tables = {**tables, "markets": tables["markets"].replace(",DC_N", ",PLANT_N", 1)}
    r = client.post("/networks/from-csv", json={"tables": broken_tables}).json()
    assert r["network"] is None and r["draft"]["markets"][0]["served_by"] == "PLANT_N"
    d = client.get("/networks/suggest-distance",
                   params={"origin_lat": 50.63, "origin_lon": 3.06, "dest_lat": 51.05, "dest_lon": 3.72}).json()
    assert d["road_km"] == 82

    for name in ("network", "policy", "scenario", "scenario_set", "constitution"):
        assert "$defs" in client.get(f"/schemas/{name}").json() or name == "scenario_set"
    assert client.get("/schemas/nope").status_code == 404

    sets = client.get("/scenario-sets").json()
    assert sets[0]["set_id"] == "default-suite" and sets[0]["builtin"]
    mine = ScenarioSet(id="north-stress", name="North stress", scenarios=default_suite().scenarios[1:3])
    assert client.post("/scenario-sets", json=mine.model_dump(mode="json")).json() == {
        "id": "north-stress", "version": 1, "created": True}
    assert client.get("/scenario-sets/north-stress").json()["name"] == "North stress"
    assert client.get("/scenario-sets/default-suite").json()["id"] == "default-suite"
    assert client.get("/scenario-sets/none").status_code == 404
    pv = client.post("/scenarios/preview", json={"scenario": default_suite().scenarios[3].model_dump(mode="json"),
                                                 "periods": 40}).json()
    assert pv["supplier_capacity"]["SUP_B"][20] == pytest.approx(0.2)
    renamed = apply(foodnet_json(), [{"op": "set", "path": "suppliers.1.id", "value": "SUP_BB"}])
    for ln in renamed["lanes"]:
        ln["origin"] = "SUP_BB" if ln["origin"] == "SUP_B" else ln["origin"]
    for p in renamed["plants"]:
        for sh in p["sourcing"]:
            sh["supplier"] = "SUP_BB" if sh["supplier"] == "SUP_B" else sh["supplier"]
    outage = default_suite().scenarios[3].model_dump(mode="json")
    outage["components"] = [{**c, "supplier": "SUP_BB"} if c.get("supplier") == "SUP_B" else c
                            for c in outage["components"]]
    pv = client.post("/scenarios/preview", json={"scenario": outage, "network": renamed, "periods": 40}).json()
    assert pv["supplier_capacity"]["SUP_BB"][20] == pytest.approx(0.2)

    from examples.first_stress_test import candidate_policy

    p = json.loads(candidate_policy().model_dump_json())
    client.post("/policies", json=p)
    r = client.post(f"/policies/{p['id']}/1/evaluate", json={"replications": 10, "periods": 52,
                                                             "scenario_set": "north-stress",
                                                             "rolling_replications": 2})
    assert r.status_code == 200
    eid = r.json()["evaluation"]["id"]
    assert [s["scenario_id"] for s in client.get(f"/evaluations/{eid}").json()["scenarios"]] == [
        "demand-surge", "promotion"]
