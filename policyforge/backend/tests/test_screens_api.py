"""P7 (backend side): background jobs, baseline choice, listings and policy validation for the screens."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from core.llm.mock import load_fixtures
from core.registry.jobs import Jobs
from core.registry.store import make_engine

INTENTS = Path(__file__).parent / "fixtures" / "intents"
DEMO = json.loads((INTENTS / "05-demo-b-to-c-30.json").read_text(encoding="utf-8"))
ANSWERED = json.loads((INTENTS / "answers" / "demo-b-to-c-30.json").read_text(encoding="utf-8"))


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(make_engine(), provider=load_fixtures(INTENTS)))


def wait(client: TestClient, jid: str, timeout: float = 300) -> dict[str, Any]:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        j = client.get(f"/jobs/{jid}").json()
        if j["status"] in ("done", "failed"):
            return j  # type: ignore[no-any-return]
        time.sleep(0.1)
    raise TimeoutError(jid)


def create_demo(client: TestClient) -> str:
    policy = client.post("/compile", json={"intent": DEMO["intent"]}).json()["policy"]
    assert client.post("/policies", json=policy).status_code == 201
    return str(policy["id"])


def test_jobs_run_in_order_and_report_progress_and_failure() -> None:
    jobs = Jobs()
    seen: list[float] = []

    def work(progress: Any) -> dict[str, Any]:
        for i in range(4):
            progress(i / 4, f"step {i}")
            seen.append(i / 4)
        return {"answer": 42}

    j = jobs.submit("test", "a test", work)
    assert j.status == "queued" and jobs.get(j.id) is not None
    done = jobs.wait(j.id)
    assert done.status == "done" and done.result == {"answer": 42} and done.progress == 1.0 and seen[-1] == 0.75

    def broken(progress: Any) -> dict[str, Any]:
        raise ValueError("no such scenario")

    failed = jobs.wait(jobs.submit("test", "broken", broken).id)
    assert failed.status == "failed" and failed.error == "ValueError: no such scenario"
    assert [x.title for x in jobs.all()] == ["broken", "a test"] and jobs.get("nope") is None
    with pytest.raises(TimeoutError):
        jobs.wait("nope", timeout=0.1)


def test_answering_the_demo_question_offline(client: TestClient) -> None:
    first = client.post("/compile", json={"intent": DEMO["intent"]}).json()
    assert first["clarifying_questions"] == list(ANSWERED["answers"])
    r = client.post("/compile", json={"intent": DEMO["intent"], "answers": ANSWERED["answers"]})
    assert r.status_code == 200 and r.json()["clarifying_questions"] == []
    assert "You confirmed" in r.json()["interpretation_notes"]
    assert r.json()["policy"]["rule"] == first["policy"]["rule"]


def test_background_evaluation_with_chosen_baselines(client: TestClient) -> None:
    pid = create_demo(client)
    r = client.post(f"/policies/{pid}/1/evaluate", params={"background": True},
                    json={"replications": 10, "periods": 52, "scenarios": ["baseline", "supplier-b-outage"],
                          "baselines": ["incumbent"]})
    assert r.status_code == 202 and r.json()["status"] in ("queued", "running")
    job = wait(client, r.json()["id"])
    assert job["status"] == "done" and job["kind"] == "evaluation" and job["result"]["verdict"]
    report = client.get(f"/evaluations/{job['result']['evaluation_id']}").json()
    assert {run["policy"] for sc in report["scenarios"] for run in sc["runs"]} == {"candidate", "incumbent"}
    assert client.get("/jobs").json()[0]["id"] == job["id"]
    assert client.get("/jobs/nope").status_code == 404
    assert client.post("/policies/nope/1/evaluate", params={"background": True}).status_code == 404
    bad = client.post(f"/policies/{pid}/1/evaluate", json={"baselines": ["oracle"]})
    assert bad.status_code == 422


def test_constitution_versions(client: TestClient) -> None:
    listed = client.get("/constitutions").json()
    assert [(c["id"], c["version"], c["active"]) for c in listed] == [("foodnet-constitution", 1, True)]
    con = client.get("/constitutions/foodnet-constitution/1").json()
    con["breach_alpha"] = 0.02
    assert client.post("/constitutions", json=con, params={"activate": True}).json()["version"] == 2
    listed = client.get("/constitutions").json()
    assert [(c["version"], c["active"]) for c in listed] == [(2, True), (1, False)]
    assert client.get("/constitutions/active").json()["breach_alpha"] == 0.02
    assert client.get("/constitutions/foodnet-constitution/9").status_code == 404


def test_policy_validation(client: TestClient) -> None:
    policy = client.post("/compile", json={"intent": DEMO["intent"]}).json()["policy"]
    ok = client.post("/policies/validate", json=policy).json()
    assert ok["valid"] is True
    bad = json.loads(json.dumps(policy))
    bad["rule"]["rules"][0]["shift_fraction"] = 3
    r = client.post("/policies/validate", json=bad).json()
    assert r["valid"] is False and r["issues"][0]["code"] == "schema"
    assert r["issues"][0]["path"].endswith("shift_fraction")
    unknown = json.loads(json.dumps(policy))
    unknown["rule"]["rules"][0]["secondary"] = "SUP_X"
    r = client.post("/policies/validate", json=unknown).json()
    assert r["valid"] is False and any("SUP_X" in i["message"] for i in r["issues"])


def test_streams_listing_and_background_retest(client: TestClient) -> None:
    pid = create_demo(client)
    client.post(f"/policies/{pid}/1/evaluate", json={"replications": 10, "periods": 104,
                                                    "scenarios": ["baseline"], "rolling_replications": 2})
    client.post(f"/policies/{pid}/1/approve", headers={"X-Actor": "Head of supply chain"})
    client.post(f"/policies/{pid}/1/deploy")
    sid = client.post("/streams", json={"seed": 2}).json()["id"]
    assert client.get("/streams").json()[0]["id"] == sid
    client.post(f"/streams/{sid}/step", json={"weeks": 10})
    client.post(f"/streams/{sid}/inject", json={"component": {
        "kind": "supplier_outage", "supplier": "SUP_C", "window": {"start": 15}, "severity": 0.7}})
    client.post(f"/streams/{sid}/step", json={"weeks": 10})
    aid = client.get("/alerts", params={"status": "active"}).json()[0]["id"]
    r = client.post(f"/alerts/{aid}/retest", params={"background": True},
                    json={"replications": 10, "periods": 52, "rolling_replications": 2})
    assert r.status_code == 202
    job = wait(client, r.json()["id"])
    assert job["status"] == "done" and job["kind"] == "retest"
    rt = client.get(f"/retests/{job['result']['retest_id']}").json()
    assert rt["alert_id"] == aid and rt["retest"]["changes"][0]["path"] == "suppliers.2.capacity_per_period"
    assert client.post("/alerts/999/retest", params={"background": True}).status_code == 404
