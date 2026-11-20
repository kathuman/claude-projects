"""Phase 5: the registry (versions, the approval gate, deployment, expiry, audit chain) and the HTTP API."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from api.app import create_app
from core.domain.examples import default_constitution
from core.domain.network import load_foodnet
from core.domain.policy import DaysOfCover, Policy
from core.domain.results import EvaluationReport, Verdict
from core.domain.scenario import ScenarioSet
from core.evaluate.run import evaluate
from core.llm.mock import load_fixtures
from core.registry.diff import json_diff
from core.registry.registry import AgentMandate, Registry, RegistryError, seeded
from core.registry.store import make_engine
from core.sim.scenarios import default_suite
from examples.first_stress_test import candidate_policy

FIXTURES = Path(__file__).parent / "fixtures"
BASELINE = ScenarioSet(id="b", name="b", scenarios=default_suite().scenarios[:1])
T0 = datetime(2027, 1, 4, tzinfo=UTC)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture(scope="module")
def passing_report() -> EvaluationReport:
    rep = evaluate(candidate_policy(), default_constitution(), BASELINE, replications=10, periods=104,
                   baselines=("incumbent",))
    assert rep.verdict.decision == "approve"
    return rep


def with_verdict(rep: EvaluationReport, decision: str) -> EvaluationReport:
    return rep.model_copy(update={"verdict": Verdict(decision=decision, reasons=[], comparisons=[])})  # type: ignore[arg-type]


def registry(clock: Clock | None = None) -> Registry:
    return seeded(make_engine(), clock=clock or Clock(T0))


def policy(days_cover: float | None = None) -> Policy:
    p = candidate_policy()
    if days_cover is not None:  # a different rule, for edits
        p = p.model_copy(update={"name": f"{p.name} ({days_cover})"})
    return p


# ---------------------------------------------------------------- the approval gate (P5 acceptance)
def test_approval_is_blocked_without_a_passing_evaluation(passing_report: EvaluationReport) -> None:
    reg = registry()
    p = policy()
    reg.create_policy(p, "author")
    with pytest.raises(RegistryError, match="only a tested version can be approved") as e:
        reg.approve(p.id, 1, "approver")
    assert e.value.status == 409

    reg.record_evaluation(p.id, 1, with_verdict(passing_report, "reject"), "tester")
    assert reg.get_policy(p.id, 1).status == "tested"
    with pytest.raises(RegistryError, match="verdict is reject, not approve"):
        reg.approve(p.id, 1, "approver")
    reg.record_evaluation(p.id, 1, with_verdict(passing_report, "approve_with_conditions"), "tester")
    with pytest.raises(RegistryError, match="approve with conditions"):
        reg.approve(p.id, 1, "approver")

    # a new version has no evaluation of its own
    reg.edit_policy(p.id, policy(21), "author")
    reg.record_evaluation(p.id, 1, passing_report, "tester")
    assert reg.approval_blockers(p.id, 1) == []
    with pytest.raises(RegistryError, match="is draft"):
        reg.approve(p.id, 2, "approver")

    # passing evaluation of this exact version: approved
    reg.approve(p.id, 1, "Head of supply chain", note="checked the report")
    assert reg.get_policy(p.id, 1).status == "approved"
    with pytest.raises(RegistryError, match="is approved"):
        reg.approve(p.id, 1, "again")


def test_a_new_constitution_or_network_means_re_test(passing_report: EvaluationReport) -> None:
    reg = registry()
    p = policy()
    reg.create_policy(p, "author")
    reg.record_evaluation(p.id, 1, passing_report, "tester")
    assert reg.policies()[0].needs_retest is False
    stricter = default_constitution().model_copy(update={"breach_alpha": 0.02})
    v = reg.save_constitution(stricter, "governance", activate=True)
    assert v == 2 and reg.active_constitution().ref == "foodnet-constitution@2"
    assert any("re-test needed: evaluated against foodnet-constitution@1" in b
               for b in reg.approval_blockers(p.id, 1))
    assert reg.policies()[0].needs_retest is True
    reg.activate_constitution("foodnet-constitution", 1, "governance")
    assert reg.approval_blockers(p.id, 1) == []

    net = load_foodnet()
    changed = net.model_copy(update={"suppliers": [s.model_copy(update={"capacity_per_period": 1500})
                                                   if s.id == "SUP_C" else s for s in net.suppliers]})
    nid, version, created = reg.save_network(changed, "planner", network_id="foodnet")
    assert (nid, version, created) == ("foodnet", 2, True)
    assert reg.save_network(changed, "planner", network_id="foodnet") == ("foodnet", 2, False)
    assert any("evaluated on foodnet@1, but the network is now foodnet@2" in b
               for b in reg.approval_blockers(p.id, 1))
    assert reg.policies()[0].needs_retest is True
    diff = reg.network_diff("foodnet", 1, 2)
    assert [(c.path, c.before, c.after) for c in diff] == [("suppliers.2.capacity_per_period", 2000.0, 1500.0)]


# ---------------------------------------------------------------- deployment, agents, expiry
def deployed(reg: Registry, p: Policy, report: EvaluationReport, version: int = 1) -> str:
    if version == 1:
        reg.create_policy(p, "author")
    reg.record_evaluation(p.id, version, report, "tester")
    reg.approve(p.id, version, "Head of supply chain")
    return reg.deploy(p.id, version, "operator")


def test_deploy_gives_the_agent_one_active_mandate(passing_report: EvaluationReport) -> None:
    reg = registry()
    p = policy()
    with pytest.raises(RegistryError, match="approve it first"):
        reg.create_policy(p, "author")
        reg.deploy(p.id, 1, "op")
    reg.record_evaluation(p.id, 1, passing_report, "tester")
    reg.approve(p.id, 1, "Head of supply chain")
    h = reg.deploy(p.id, 1, "operator")
    m = reg.agent_mandate("sourcing-agent-01")
    assert m is not None and m.status == "active" and m.policy_version == 1 and m.audit_hash == h
    assert m.approved_by == "Head of supply chain"
    assert [(a.kind, a.value, a.unit) for a in m.autonomy] == [("volume_shift_pct", 30.0, "% of volume")]
    # a second version deployed for the same agent retires the first
    reg.edit_policy(p.id, policy(21), "author")
    deployed(reg, p, passing_report, version=2)
    assert reg.get_policy(p.id, 1).status == "retired"
    assert reg.agent_mandate("sourcing-agent-01").policy_version == 2  # type: ignore[union-attr]
    assert [x.status for x in reg.policies("deployed")] == ["deployed"]
    assert reg.agent_mandate("nobody") is None
    reg.retire(p.id, 2, "operator", "end of trial")
    assert reg.agent_mandate("sourcing-agent-01") is None
    with pytest.raises(RegistryError, match="is retired"):
        reg.retire(p.id, 2, "operator")


def test_expired_mandates_are_flagged_once(passing_report: EvaluationReport) -> None:
    clock = Clock(T0)
    reg = registry(clock)
    p = policy()
    p = p.model_copy(update={"mandate": p.mandate.model_copy(update={"valid_from": T0,
                                                                     "expires_at": T0 + timedelta(days=30)})})
    deployed(reg, p, passing_report)
    assert reg.agent_mandate("sourcing-agent-01").status == "active"  # type: ignore[union-attr]
    clock.now = T0 + timedelta(days=31)
    assert reg.agent_mandate("sourcing-agent-01").status == "expired"  # type: ignore[union-attr]
    reg.agent_mandate("sourcing-agent-01")
    assert len([e for e in reg.audit() if e.action == "mandate.expired"]) == 1
    assert reg.policies()[0].expired
    # an expired policy can be neither approved nor deployed
    reg.edit_policy(p.id, p, "author")
    reg.record_evaluation(p.id, 2, passing_report, "tester")
    assert "the mandate has already expired" in reg.approval_blockers(p.id, 2)


# ---------------------------------------------------------------- versions and diffs
def test_versions_and_diffs(passing_report: EvaluationReport) -> None:
    reg = registry()
    p = policy()
    reg.create_policy(p, "author")
    with pytest.raises(RegistryError, match="exists"):
        reg.create_policy(p, "author")
    rule = p.rule.model_copy(update={"shift_fraction": 0.25})
    reg.edit_policy(p.id, p.model_copy(update={"rule": rule}), "author")
    assert [v.version for v in reg.policy_versions(p.id)] == [1, 2]
    d = reg.policy_diff(p.id, 1, 2)
    assert [(c.path, c.before, c.after) for c in d] == [("rule.shift_fraction", 0.3, 0.25)]
    assert reg.get_policy(p.id).version == 2 and reg.get_policy(p.id, 1).version == 1
    with pytest.raises(RegistryError, match="not b-to-c"):
        reg.edit_policy("b-to-c", p, "author")
    with pytest.raises(RegistryError) as e:
        reg.get_policy("missing")
    assert e.value.status == 404
    assert json_diff({"a": [1, 2]}, {"a": [1]})[0].op == "removed"
    assert json_diff({"a": 1}, {"a": 1, "b": 2})[0].op == "added"
    assert json_diff(1, 2)[0].path == "(root)"


# ---------------------------------------------------------------- the audit log (P5 acceptance)
def test_the_audit_log_is_append_only_and_tampering_is_detected(passing_report: EvaluationReport) -> None:
    engine = make_engine()
    reg = seeded(engine, clock=Clock(T0))
    deployed(reg, policy(), passing_report)
    v = reg.verify()
    assert v.ok and v.entries == len(reg.audit()) >= 6 and v.head == reg.audit()[-1].hash
    actions = [e.action for e in reg.audit()]
    for a in ("network.saved", "constitution.saved", "policy.created", "evaluation.recorded", "policy.approved",
              "policy.deployed"):
        assert a in actions
    # the database refuses edits and deletions
    with engine.connect() as conn, pytest.raises(DatabaseError, match="append-only"):
        conn.execute(text("UPDATE audit SET actor = 'mallory' WHERE seq = 4"))
    with engine.connect() as conn, pytest.raises(DatabaseError, match="append-only"):
        conn.execute(text("DELETE FROM audit WHERE seq = 4"))
    # someone goes around the triggers: the chain shows exactly where
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER audit_no_update"))
        conn.execute(text("UPDATE audit SET payload = '{\"verdict\":\"approve\",\"note\":\"looked fine\"}' "
                          "WHERE seq = 5"))
    v = reg.verify()
    assert not v.ok and v.first_bad_seq == 5 and "altered" in v.reason


def test_a_deleted_or_relinked_entry_is_detected(passing_report: EvaluationReport) -> None:
    engine = make_engine()
    reg = seeded(engine, clock=Clock(T0))
    deployed(reg, policy(), passing_report)
    with engine.begin() as conn:
        conn.execute(text("DROP TRIGGER audit_no_delete"))
        conn.execute(text("DELETE FROM audit WHERE seq = 3"))
    v = reg.verify()
    assert not v.ok and v.first_bad_seq == 4 and "missing" in v.reason


# ---------------------------------------------------------------- the HTTP API
@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(make_engine(), provider=load_fixtures(FIXTURES / "intents")))


def test_api_end_to_end_demo_flow(client: TestClient) -> None:
    """§10, through the API: compile the demo intent, create, evaluate, approve, deploy, read the agent mandate."""
    demo = json.loads(next((FIXTURES / "intents").glob("05-*.json")).read_text(encoding="utf-8"))["intent"]
    r = client.post("/compile", json={"intent": demo}, headers={"X-Actor": "strategist"})
    assert r.status_code == 200, r.text
    compiled = r.json()
    assert compiled["clarifying_questions"] and len(compiled["policy"]["assumptions"]) == 3
    pid = compiled["policy"]["id"]
    assert client.post("/policies", json=compiled["policy"]).status_code == 201
    r = client.post(f"/policies/{pid}/1/approve")
    assert r.status_code == 409 and r.json()["code"] == "approval_blocked"
    r = client.post(f"/policies/{pid}/1/evaluate", json={"replications": 10, "periods": 104,
                                                         "scenarios": ["baseline"], "rolling_replications": 2})
    assert r.status_code == 200, r.text
    assert r.json()["verdict"]["decision"] == "approve"
    eid = r.json()["evaluation"]["id"]
    assert client.get(f"/evaluations/{eid}").json()["candidate_id"] == pid
    assert client.get(f"/evaluations/{eid}/markdown").text.startswith("# Evaluation report")
    assert client.get(f"/policies/{pid}/1/approval-blockers").json() == []
    assert client.post(f"/policies/{pid}/1/approve", json={"note": "ok"},
                       headers={"X-Actor": "Head of supply chain"}).status_code == 204
    assert client.post(f"/policies/{pid}/1/deploy").status_code == 200
    r = client.get("/agents/sourcing-agent-01/mandate")
    assert r.status_code == 200
    m = AgentMandate.model_validate(r.json())
    assert m.status == "active" and m.policy_id == pid and m.approved_by == "Head of supply chain"
    assert client.get("/agents/nobody/mandate").status_code == 404
    listed = client.get("/policies", params={"status": "deployed"}).json()
    assert [x["policy_id"] for x in listed] == [pid]
    v = client.get("/audit/verify").json()
    assert v["ok"] is True and v["entries"] >= 7
    assert any(e["action"] == "policy.compiled" and e["actor"] == "strategist" for e in client.get("/audit").json())


def test_agent_mandate_contract() -> None:
    """The agent API's response schema is a published contract: a change must be deliberate."""
    path = FIXTURES / "agent_mandate.schema.json"
    schema = AgentMandate.model_json_schema()
    if os.environ.get("UPDATE_GOLDEN") or not path.exists():
        path.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    assert schema == json.loads(path.read_text(encoding="utf-8"))
    for field in ("agent_id", "status", "autonomy", "escalation", "prohibited_actions", "expires_at", "rule",
                  "audit_hash"):
        assert field in schema["properties"]
    assert set(schema["properties"]["status"]["enum"]) == {"active", "expired"}


def test_api_networks_constitutions_and_errors(client: TestClient) -> None:
    assert client.get("/health").json()["constitution"] == "foodnet-constitution@1"
    nets = client.get("/networks").json()
    assert nets[0]["network_id"] == "foodnet"
    body = client.get("/networks/foodnet").json()["network"]
    assert client.post("/networks/validate", json=body).json() == {"valid": True, "errors": []}
    broken = json.loads(json.dumps(body))
    broken["markets"][0]["served_by"] = "PLANT_N"
    broken["skus"][0]["unit_cost"] = -1
    res = client.post("/networks/validate", json=broken).json()
    assert res["valid"] is False and any(e["path"] == "skus.0.unit_cost" for e in res["errors"])
    body["suppliers"][2]["capacity_per_period"] = 1500
    r = client.post("/networks", json=body, params={"network_id": "foodnet"}, headers={"X-Actor": "planner"})
    assert r.json() == {"id": "foodnet", "version": 2, "created": True}
    assert [v["version"] for v in client.get("/networks/foodnet/versions").json()] == [1, 2]
    assert client.get("/networks/foodnet/diff", params={"from": 1, "to": 2}).json()[0]["after"] == 1500
    assert client.get("/networks/nowhere").status_code == 404

    con = client.get("/constitutions/active").json()
    con["breach_alpha"] = 0.02
    assert client.post("/constitutions", json=con, params={"activate": True}).json()["version"] == 2
    assert client.get("/constitutions/active").json()["version"] == 2
    assert client.post("/constitutions/foodnet-constitution/1/activate").status_code == 204
    assert client.post("/constitutions/x/9/activate").status_code == 404

    p = json.loads(candidate_policy().model_dump_json())
    assert client.post("/policies", json=p).status_code == 201
    assert client.post("/policies", json=p).status_code == 409
    assert client.put("/policies/other", json=p).status_code == 422
    p["name"] = "Renamed"
    assert client.put(f"/policies/{p['id']}", json=p).json()["version"] == 2
    assert client.get(f"/policies/{p['id']}/diff", params={"from": 1, "to": 2}).json()[0]["path"] == "name"
    assert [v["version"] for v in client.get(f"/policies/{p['id']}/versions").json()] == [1, 2]
    assert client.get(f"/policies/{p['id']}/1").json()["name"] != "Renamed"
    assert client.get(f"/policies/{p['id']}").json()["name"] == "Renamed"
    assert client.get(f"/policies/{p['id']}/2/evaluations").json() == []
    assert client.post(f"/policies/{p['id']}/2/retire").status_code == 409
    r = client.post(f"/policies/{p['id']}/2/evaluate", json={"scenarios": ["nope"]})
    assert r.status_code == 422
    r = client.post("/compile", json={"intent": "Something nobody recorded"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "compile_failed"
    assert client.post("/policies", json={"id": "x"}).status_code == 422
    assert client.get("/evaluations/999").status_code == 404
    assert isinstance(client.get("/audit", params={"object_ref": f"{p['id']}@2"}).json(), list)


def test_policy_mandate_dates_survive_storage() -> None:
    reg = registry()
    p = policy()
    reg.create_policy(p, "a")
    got = reg.get_policy(p.id)
    assert got.mandate.expires_at == p.mandate.expires_at and got.status == "draft" and got.version == 1
    assert isinstance(p.rule, type(got.rule))
    assert DaysOfCover(value=1).unit == "days_of_cover"
