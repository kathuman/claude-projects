"""The PolicyForge HTTP API (FastAPI).

Run it:  uvicorn api.app:app --reload        (from backend/; SQLite file policyforge.db, FoodNet and the default
                                              constitution are loaded on first start)

Single-user local mode (brief §3): the actor for every change comes from the `X-Actor` header (default
"local-user"). Agents read their mandates at GET /agents/{agent_id}/mandate.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Any

from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.engine import Engine

from core.domain.constitution import Constitution
from core.domain.network import Network
from core.domain.policy import Policy
from core.domain.results import EvaluationReport, Verdict
from core.domain.scenario import ScenarioSet
from core.evaluate.report import to_markdown
from core.llm.compiler import CompileError, CompileResult, compile_intent
from core.llm.provider import LLMProvider
from core.registry.diff import Change
from core.registry.registry import (
    AgentMandate,
    AuditEntry,
    EvaluationSummary,
    PolicySummary,
    Registry,
    RegistryError,
    Verification,
    VersionInfo,
    seeded,
)
from core.registry.store import make_engine
from core.sim.scenarios import default_suite

API_VERSION = "0.5.0"
Actor = Annotated[str, Header(alias="X-Actor")]
INTENTS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "intents"


def default_provider() -> LLMProvider:
    """Claude when LLM_PROVIDER=anthropic, else the offline mock with the recorded intents."""
    if os.environ.get("LLM_PROVIDER", "mock").lower() == "anthropic":
        from core.llm.anthropic_provider import AnthropicProvider

        return AnthropicProvider()
    from core.llm.mock import load_fixtures

    return load_fixtures(INTENTS)


# ---------------------------------------------------------------- request and response bodies
class Created(BaseModel):
    id: str
    version: int
    created: bool = True


class FieldError(BaseModel):
    path: str
    message: str
    type: str


class ValidationResult(BaseModel):
    valid: bool
    errors: list[FieldError]


class CompileRequest(BaseModel):
    intent: str = Field(min_length=1, max_length=4000)
    answers: dict[str, str] | None = None


class EvaluateRequest(BaseModel):
    replications: int = Field(default=200, ge=10, le=2000)
    periods: int = Field(default=104, ge=26, le=156)
    seed: int = Field(default=1, ge=0)
    scenarios: list[str] | None = Field(default=None, description="Ids from the default suite; empty = all eight")
    rolling_replications: int = Field(default=20, ge=2, le=200)


class EvaluateResponse(BaseModel):
    evaluation: EvaluationSummary
    verdict: Verdict


class Note(BaseModel):
    note: str = ""


def create_app(engine: Engine | None = None, registry: Registry | None = None,
               provider: LLMProvider | None = None) -> FastAPI:
    reg = registry or seeded(engine or make_engine(os.environ.get("POLICYFORGE_DB", "sqlite:///policyforge.db")))
    llm = provider or default_provider()
    app = FastAPI(title="PolicyForge API", version=API_VERSION,
                  description="Policies for agent-run supply chains: compile, evaluate, approve, deploy, monitor.")
    app.state.registry = reg

    @app.exception_handler(RegistryError)
    async def registry_error(_: Request, e: RegistryError) -> JSONResponse:
        return JSONResponse(status_code=e.status, content={"code": e.code, "message": e.message})

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "version": API_VERSION, "networks": len(reg.networks()),
                "constitution": reg.active_constitution().ref}

    # ---------------------------------------------------------------- networks
    @app.get("/networks")
    def networks() -> list[dict[str, Any]]:
        return reg.networks()

    @app.post("/networks", response_model=Created, status_code=201)
    def save_network(net: Network, actor: Actor = "local-user",
                     network_id: str | None = Query(default=None)) -> Created:
        nid, version, created = reg.save_network(net, actor, network_id)
        return Created(id=nid, version=version, created=created)

    @app.post("/networks/validate", response_model=ValidationResult)
    def validate_network(body: dict[str, Any] = Body(...)) -> ValidationResult:  # noqa: B008
        try:
            Network.model_validate(body)
        except ValidationError as e:
            return ValidationResult(valid=False, errors=[
                FieldError(path=".".join(str(x) for x in err["loc"]) or "(network)", message=err["msg"],
                           type=err["type"]) for err in e.errors()])
        return ValidationResult(valid=True, errors=[])

    @app.get("/networks/{nid}")
    def get_network(nid: str, version: int | None = None) -> dict[str, Any]:
        net, v = reg.get_network(nid, version)
        return {"network_id": nid, "version": v, "network": net.model_dump(mode="json")}

    @app.get("/networks/{nid}/versions", response_model=list[VersionInfo])
    def network_versions(nid: str) -> list[VersionInfo]:
        return reg.network_versions(nid)

    @app.get("/networks/{nid}/diff", response_model=list[Change])
    def network_diff(nid: str, a: int = Query(alias="from"), b: int = Query(alias="to")) -> list[Change]:
        return reg.network_diff(nid, a, b)

    # ---------------------------------------------------------------- constitutions
    @app.get("/constitutions/active", response_model=Constitution)
    def active_constitution() -> Constitution:
        return reg.active_constitution()

    @app.post("/constitutions", response_model=Created, status_code=201)
    def save_constitution(con: Constitution, actor: Actor = "local-user", activate: bool = False) -> Created:
        return Created(id=con.id, version=reg.save_constitution(con, actor, activate=activate))

    @app.post("/constitutions/{cid}/{version}/activate", status_code=204)
    def activate(cid: str, version: int, actor: Actor = "local-user") -> None:
        reg.activate_constitution(cid, version, actor)

    # ---------------------------------------------------------------- compiling intents
    @app.post("/compile", response_model=CompileResult)
    def compile_(req: CompileRequest, actor: Actor = "local-user") -> CompileResult:
        net, _ = reg.get_network(reg.default_network_id())
        existing = [reg.get_policy(s.policy_id, s.version) for s in reg.policies("deployed")]
        try:
            res = compile_intent(req.intent, provider=llm, net=net, constitution=reg.active_constitution(),
                                 existing=existing, answers=req.answers)
        except CompileError as e:
            raise HTTPException(422, detail={"code": "compile_failed", "message": str(e),
                                             "attempts": [a.model_dump() for a in e.attempts]}) from e
        reg.record_compile(actor, req.intent, res.model, res.prompt_hash, len(res.attempts), res.policy.id)
        return res

    # ---------------------------------------------------------------- policies
    @app.get("/policies", response_model=list[PolicySummary])
    def policies(status: str | None = None) -> list[PolicySummary]:
        return reg.policies(status)

    @app.post("/policies", response_model=Created, status_code=201)
    def create_policy(policy: Policy, actor: Actor = "local-user",
                      network_id: str | None = Query(default=None)) -> Created:
        return Created(id=policy.id, version=reg.create_policy(policy, actor, network_id))

    @app.put("/policies/{pid}", response_model=Created)
    def edit_policy(pid: str, policy: Policy, actor: Actor = "local-user") -> Created:
        return Created(id=pid, version=reg.edit_policy(pid, policy, actor))

    @app.get("/policies/{pid}", response_model=Policy)
    def get_latest(pid: str) -> Policy:
        return reg.get_policy(pid)

    @app.get("/policies/{pid}/versions", response_model=list[VersionInfo])
    def versions(pid: str) -> list[VersionInfo]:
        return reg.policy_versions(pid)

    @app.get("/policies/{pid}/diff", response_model=list[Change])
    def diff(pid: str, a: int = Query(alias="from"), b: int = Query(alias="to")) -> list[Change]:
        return reg.policy_diff(pid, a, b)

    @app.get("/policies/{pid}/{version}", response_model=Policy)
    def get_version(pid: str, version: int) -> Policy:
        return reg.get_policy(pid, version)

    @app.get("/policies/{pid}/{version}/evaluations", response_model=list[EvaluationSummary])
    def evaluations(pid: str, version: int) -> list[EvaluationSummary]:
        return reg.evaluations(pid, version)

    @app.get("/policies/{pid}/{version}/approval-blockers", response_model=list[str])
    def blockers(pid: str, version: int) -> list[str]:
        return reg.approval_blockers(pid, version)

    @app.post("/policies/{pid}/{version}/evaluate", response_model=EvaluateResponse)
    def evaluate(pid: str, version: int, req: EvaluateRequest | None = None,
                 actor: Actor = "local-user") -> EvaluateResponse:
        req = req or EvaluateRequest()
        suite = default_suite()
        if req.scenarios:
            chosen = [s for s in suite.scenarios if s.id in req.scenarios]
            unknown = set(req.scenarios) - {s.id for s in chosen}
            if unknown:
                raise HTTPException(422, detail={"code": "unknown_scenario", "message": f"unknown {sorted(unknown)}"})
            suite = ScenarioSet(id=f"{suite.id}-subset", name=suite.name, scenarios=chosen)
        ev, report = reg.evaluate(pid, version, actor, scenarios=suite, replications=req.replications,
                                  periods=req.periods, seed=req.seed, rolling_reps=req.rolling_replications)
        return EvaluateResponse(evaluation=ev, verdict=report.verdict)

    @app.post("/policies/{pid}/{version}/approve", status_code=204)
    def approve(pid: str, version: int, body: Note | None = None, actor: Actor = "local-user") -> None:
        reg.approve(pid, version, actor, (body or Note()).note)

    @app.post("/policies/{pid}/{version}/deploy")
    def deploy(pid: str, version: int, actor: Actor = "local-user") -> dict[str, str]:
        return {"audit_hash": reg.deploy(pid, version, actor)}

    @app.post("/policies/{pid}/{version}/retire", status_code=204)
    def retire(pid: str, version: int, body: Note | None = None, actor: Actor = "local-user") -> None:
        reg.retire(pid, version, actor, (body or Note()).note)

    @app.get("/evaluations/{eid}", response_model=EvaluationReport)
    def report(eid: int) -> EvaluationReport:
        return reg.evaluation_report(eid)

    @app.get("/evaluations/{eid}/markdown", response_class=PlainTextResponse)
    def report_md(eid: int) -> str:
        return to_markdown(reg.evaluation_report(eid))

    # ---------------------------------------------------------------- audit and agents
    @app.get("/audit", response_model=list[AuditEntry])
    def audit(limit: int = Query(default=200, le=1000), offset: int = 0,
              object_ref: str | None = None) -> list[AuditEntry]:
        return reg.audit(limit, offset, object_ref)

    @app.get("/audit/verify", response_model=Verification)
    def verify() -> Verification:
        return reg.verify()

    @app.get("/agents/{agent_id}/mandate", response_model=AgentMandate)
    def agent_mandate(agent_id: str) -> AgentMandate:
        m = reg.agent_mandate(agent_id)
        if m is None:
            raise HTTPException(404, detail={"code": "no_mandate", "message": f"agent {agent_id} has no deployed "
                                             "mandate"})
        return m

    return app


def __getattr__(name: str) -> Any:  # pragma: no cover - lazy `uvicorn api.app:app`
    if name == "app":
        return create_app()
    raise AttributeError(name)
