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

import yaml
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.engine import Engine

from core.domain import network_health, network_io, schema_export
from core.domain.constitution import Constitution
from core.domain.network import Network, NetworkData, reference_problems
from core.domain.network_health import Health
from core.domain.network_io import TableError
from core.domain.policy import Policy
from core.domain.results import EvaluationReport, Verdict
from core.domain.scenario import Scenario, ScenarioSet
from core.evaluate.quick import QuickTest, quick_test
from core.evaluate.report import to_markdown
from core.llm.compiler import CompileError, CompileResult, compile_intent
from core.llm.provider import LLMProvider
from core.monitor.stream import Injection
from core.registry.diff import Change
from core.registry.monitoring import AlertStatus, AlertView, Monitoring, RetestView, StreamView
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
from core.sim.layout import build_layout
from core.sim.scenarios import default_suite
from core.sim.scenarios.preview import Preview, preview

API_VERSION = "0.7.0"
STUDIO = Path(__file__).resolve().parents[2] / "frontend" / "dist"
Actor = Annotated[str, Header(alias="X-Actor")]
INTENTS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "intents"
# The published Studio (GitHub Pages) and the Vite dev server may call a local API; override with POLICYFORGE_CORS.
CORS_ORIGINS = "https://kathuman.github.io,http://localhost:5173,http://127.0.0.1:5173"


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
    level: str = "field"  # "field" (types, bounds) or "reference" (how the parts fit together)


class ValidationResult(BaseModel):
    valid: bool
    errors: list[FieldError]


class CompileRequest(BaseModel):
    intent: str = Field(min_length=1, max_length=4000)
    answers: dict[str, str] | None = None


class NetworkCheck(BaseModel):
    valid: bool
    errors: list[FieldError]
    health: Health | None = None


class NetworkBody(BaseModel):
    network: dict[str, Any]


class QuickTestRequest(BaseModel):
    network: dict[str, Any]
    replications: int = Field(default=100, ge=10, le=500)
    periods: int = Field(default=52, ge=26, le=156)


class Tables(BaseModel):
    tables: dict[str, str]


class TablesResult(BaseModel):
    network: dict[str, Any] | None
    errors: list[TableError]
    draft: dict[str, Any] | None = Field(default=None, description="What could be read, valid or not, to fix in place")


class YamlText(BaseModel):
    text: str


class YamlResult(BaseModel):
    network: dict[str, Any] | None
    errors: list[FieldError]
    draft: dict[str, Any] | None = Field(default=None, description="The file's network, valid or not, to fix in place")


class PreviewRequest(BaseModel):
    scenario: Scenario
    network_id: str | None = None
    network: dict[str, Any] | None = Field(default=None, description="An unsaved network (the Studio's); wins over id")
    periods: int = Field(default=104, ge=26, le=156)


class EvaluateRequest(BaseModel):
    replications: int = Field(default=200, ge=10, le=2000)
    periods: int = Field(default=104, ge=26, le=156)
    seed: int = Field(default=1, ge=0)
    scenarios: list[str] | None = Field(default=None, description="Ids from the scenario set; empty = all")
    scenario_set: str | None = Field(default=None, description="A saved scenario set; empty = the default suite")
    scenario_set_version: int | None = None
    rolling_replications: int = Field(default=20, ge=2, le=200)


class EvaluateResponse(BaseModel):
    evaluation: EvaluationSummary
    verdict: Verdict


class Note(BaseModel):
    note: str = ""


class StreamRequest(BaseModel):
    seed: int = Field(default=1, ge=0)
    horizon: int = Field(default=104, ge=26, le=156)
    scenario_id: str = Field(default="baseline", description="The matching scenario the monitors compare against")
    network_id: str | None = None


class StepRequest(BaseModel):
    weeks: int = Field(default=1, ge=1, le=156)


class InjectRequest(BaseModel):
    component: Injection
    note: str = Field(default="", max_length=200)


class StepResult(BaseModel):
    stream: StreamView
    raised: list[AlertView]


class RetestRequest(BaseModel):
    replications: int = Field(default=200, ge=10, le=2000)
    periods: int = Field(default=104, ge=26, le=156)
    rolling_replications: int = Field(default=20, ge=2, le=200)


def create_app(engine: Engine | None = None, registry: Registry | None = None,
               provider: LLMProvider | None = None) -> FastAPI:
    reg = registry or seeded(engine or make_engine(os.environ.get("POLICYFORGE_DB", "sqlite:///policyforge.db")))
    llm = provider or default_provider()
    app = FastAPI(title="PolicyForge API", version=API_VERSION,
                  description="Policies for agent-run supply chains: compile, evaluate, approve, deploy, monitor.")
    app.state.registry = reg
    origins = os.environ.get("POLICYFORGE_CORS", CORS_ORIGINS).split(",")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins if o.strip()],
                       allow_methods=["*"], allow_headers=["*"])

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

    def field_errors(body: dict[str, Any]) -> list[FieldError]:
        """Field errors first; if the fields are fine, the cross-reference problems, each with its path."""
        try:
            data = NetworkData.model_validate(body)
        except ValidationError as e:
            return [FieldError(path=".".join(str(x) for x in err["loc"]) or "(network)", message=err["msg"],
                               type=err["type"]) for err in e.errors()]
        return [FieldError(path=p.path, message=p.message, type="reference", level="reference")
                for p in reference_problems(data)]

    def parse(body: dict[str, Any]) -> Network:
        errs = field_errors(body)
        if errs:
            raise HTTPException(422, detail={"code": "invalid_network", "message": errs[0].message,
                                             "errors": [e.model_dump() for e in errs]})
        return Network.model_validate(body)

    @app.post("/networks/validate", response_model=ValidationResult)
    def validate_network(body: dict[str, Any] = Body(...)) -> ValidationResult:  # noqa: B008
        errs = field_errors(body)
        return ValidationResult(valid=not errs, errors=errs)

    @app.post("/networks/check", response_model=NetworkCheck)
    def check_network(req: NetworkBody) -> NetworkCheck:
        """Everything the Studio shows while editing: errors with their paths, and health once valid."""
        errs = field_errors(req.network)
        return NetworkCheck(valid=not errs, errors=errs,
                            health=None if errs else network_health.check(Network.model_validate(req.network)))

    @app.post("/networks/quick-test", response_model=QuickTest)
    def run_quick_test(req: QuickTestRequest) -> QuickTest:
        return quick_test(parse(req.network), replications=req.replications, periods=req.periods)

    @app.post("/networks/to-csv", response_model=Tables)
    def to_tables(req: NetworkBody) -> Tables:
        return Tables(tables=network_io.to_csv(parse(req.network)))

    @app.post("/networks/csv-zip")
    def to_zip(req: NetworkBody) -> Response:
        import io
        import zipfile

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, text in network_io.to_csv(parse(req.network)).items():
                z.writestr(f"{name}.csv", text)
        return Response(buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": 'attachment; filename="network-csv.zip"'})

    @app.post("/networks/from-csv", response_model=TablesResult)
    def from_tables(req: Tables) -> TablesResult:
        net, errs = network_io.from_csv(req.tables)
        draft = network_io.read_csv(req.tables)[0] if errs else None
        return TablesResult(network=net.model_dump(mode="json") if net else None, errors=errs, draft=draft)

    @app.post("/networks/to-yaml", response_class=PlainTextResponse)
    def to_yaml(req: NetworkBody) -> str:
        return str(yaml.safe_dump(parse(req.network).model_dump(mode="json"), sort_keys=False, allow_unicode=True))

    @app.post("/networks/from-yaml", response_model=YamlResult)
    def from_yaml(req: YamlText) -> YamlResult:
        try:
            data = yaml.safe_load(req.text)
        except yaml.YAMLError as e:
            return YamlResult(network=None, errors=[FieldError(path="(file)", message=f"not valid YAML or JSON: {e}",
                                                               type="parse")])
        if not isinstance(data, dict):
            return YamlResult(network=None, errors=[FieldError(path="(file)", message="the file is not a network",
                                                               type="parse")])
        errs = field_errors(data)
        if errs:
            return YamlResult(network=None, errors=errs, draft=data)
        return YamlResult(network=Network.model_validate(data).model_dump(mode="json"), errors=[])

    @app.get("/networks/suggest-distance")
    def suggest(origin_lat: float, origin_lon: float, dest_lat: float, dest_lon: float) -> dict[str, float]:
        km = network_health.great_circle_km(origin_lat, origin_lon, dest_lat, dest_lon)
        return {"great_circle_km": round(km, 1), "road_km": round(km * network_health.ROAD_FACTOR)}

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

    # ---------------------------------------------------------------- schemas and scenarios
    @app.get("/schemas/{name}")
    def schema(name: str) -> dict[str, Any]:
        schemas = schema_export.schemas()
        if name not in schemas:
            raise HTTPException(404, detail={"code": "no_schema", "message": f"no schema {name!r}"})
        return schemas[name]

    @app.get("/scenario-sets")
    def scenario_sets() -> list[dict[str, Any]]:
        return reg.scenario_sets()

    @app.post("/scenario-sets", response_model=Created, status_code=201)
    def save_scenario_set(ss: ScenarioSet, actor: Actor = "local-user") -> Created:
        version, created = reg.save_scenario_set(ss, actor)
        return Created(id=ss.id, version=version, created=created)

    @app.get("/scenario-sets/{set_id}", response_model=ScenarioSet)
    def get_scenario_set(set_id: str, version: int | None = None) -> ScenarioSet:
        return reg.get_scenario_set(set_id, version)[0]

    @app.post("/scenarios/preview", response_model=Preview)
    def preview_scenario(req: PreviewRequest) -> Preview:
        net = parse(req.network) if req.network else reg.get_network(req.network_id or reg.default_network_id())[0]
        return preview(build_layout(net), req.scenario, periods=req.periods)

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
        suite = reg.get_scenario_set(req.scenario_set, req.scenario_set_version)[0] if req.scenario_set \
            else default_suite()
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

    # ---------------------------------------------------------------- monitoring (P6)
    mon = Monitoring(reg)
    app.state.monitoring = mon

    @app.post("/streams", response_model=StreamView, status_code=201)
    def create_stream(req: StreamRequest | None = None, actor: Actor = "local-user") -> StreamView:
        r = req or StreamRequest()
        return mon.create_stream(actor, seed=r.seed, horizon=r.horizon, scenario_id=r.scenario_id,
                                 network_id=r.network_id)

    @app.get("/streams/{sid}", response_model=StreamView)
    def get_stream(sid: int, reveal: bool = False) -> StreamView:
        return mon.stream(sid, reveal=reveal)

    @app.post("/streams/{sid}/step", response_model=StepResult)
    def step_stream(sid: int, req: StepRequest | None = None, actor: Actor = "local-user") -> StepResult:
        raised = mon.step(sid, (req or StepRequest()).weeks, actor)
        return StepResult(stream=mon.stream(sid), raised=raised)

    @app.post("/streams/{sid}/inject", response_model=StreamView)
    def inject(sid: int, req: InjectRequest, actor: Actor = "local-user") -> StreamView:
        return mon.inject(sid, req.component, actor, req.note)

    @app.get("/alerts", response_model=list[AlertView])
    def alerts(status: str | None = Query(default=None, description="open, acknowledged, resolved, dismissed, or "
                                                                     "active (open or acknowledged)"),
               stream_id: int | None = None) -> list[AlertView]:
        return mon.alerts(status, stream_id)

    @app.get("/alerts/{aid}", response_model=AlertView)
    def alert(aid: int) -> AlertView:
        return mon.alert(aid)

    def _move(aid: int, status: AlertStatus, body: Note | None, actor: str) -> AlertView:
        return mon.set_status(aid, status, actor, (body or Note()).note)

    @app.post("/alerts/{aid}/acknowledge", response_model=AlertView)
    def acknowledge(aid: int, body: Note | None = None, actor: Actor = "local-user") -> AlertView:
        return _move(aid, "acknowledged", body, actor)

    @app.post("/alerts/{aid}/resolve", response_model=AlertView)
    def resolve(aid: int, body: Note | None = None, actor: Actor = "local-user") -> AlertView:
        return _move(aid, "resolved", body, actor)

    @app.post("/alerts/{aid}/dismiss", response_model=AlertView)
    def dismiss(aid: int, body: Note | None = None, actor: Actor = "local-user") -> AlertView:
        return _move(aid, "dismissed", body, actor)

    @app.post("/alerts/{aid}/retest", response_model=RetestView)
    def run_retest(aid: int, req: RetestRequest | None = None, actor: Actor = "local-user") -> RetestView:
        r = req or RetestRequest()
        return mon.run_retest(aid, actor, replications=r.replications, periods=r.periods,
                              rolling_reps=r.rolling_replications)

    @app.get("/retests/{rid}", response_model=RetestView)
    def get_retest(rid: int) -> RetestView:
        return mon.retest(rid)

    @app.get("/retests/{rid}/markdown", response_class=PlainTextResponse)
    def retest_md(rid: int) -> str:
        rt = mon.retest(rid)
        lines = [f"# Re-test after alert {rt.alert_id}", "",
                 f"Policy `{rt.policy_id}` v{rt.policy_version}, on the network as observed. Verdict: "
                 f"**{rt.verdict}**.", "", "## What changed in the model", ""]
        lines += [f"- `{c.path}`: {c.before} → {c.after} ({c.why})" for c in rt.retest.changes] or ["- nothing"]
        lines += [f"- {n}" for n in rt.retest.notes]
        return "\n".join(lines) + "\n\n" + to_markdown(rt.retest.report)

    if STUDIO.exists():  # the built frontend (npm run build in frontend/)
        app.mount("/app", StaticFiles(directory=STUDIO, html=True), name="studio")

        @app.get("/", include_in_schema=False)
        def root() -> RedirectResponse:
            return RedirectResponse("/app/")

    return app


def __getattr__(name: str) -> Any:  # pragma: no cover - lazy `uvicorn api.app:app`
    if name == "app":
        return create_app()
    raise AttributeError(name)
