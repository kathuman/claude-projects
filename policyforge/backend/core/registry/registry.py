"""The mandate registry: versioned networks, constitutions and policies, a gated lifecycle, and the audit log.

Lifecycle: draft → tested → approved → deployed → retired.
- **tested:** an evaluation of this exact version has been recorded.
- **approve:** only with a *passing* evaluation (verdict `approve`) of this exact version (same content hash),
  against the active constitution version and the current network version. Anything else is refused, with the
  reason.
- **deploy:** an approved, unexpired version. A policy already deployed for the same agent is retired, so one agent
  has one active mandate.
- **retire:** from tested, approved or deployed.

Every change is appended to the hash-chained audit log in the same transaction.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal

from pydantic import Field
from sqlalchemy.engine import Engine
from sqlmodel import Session, col, select

from core.domain.common import Model
from core.domain.constitution import Constitution
from core.domain.mandate import AuthorityLimit, EscalationRule
from core.domain.network import Network
from core.domain.policy import DecisionRule, Policy, PolicyStatus, Scope
from core.domain.results import EvaluationReport
from core.domain.scenario import ScenarioSet
from core.registry.diff import Change, json_diff
from core.registry.store import (
    AuditRow,
    ConstitutionRow,
    EvaluationRow,
    NetworkRow,
    PolicyRow,
    ScenarioSetRow,
    append_audit,
    canonical,
    content_hash,
    utcnow,
    verify_chain,
)


class RegistryError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _slug(s: str) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return out if out and out[0].isalpha() else f"n-{out}"


def policy_content_hash(p: Policy) -> str:
    """What an evaluation tests: everything but the status, the version number and the provenance."""
    return content_hash(p.model_dump(mode="json", exclude={"status", "version", "provenance"}))


# ---------------------------------------------------------------- views returned by the registry
class VersionInfo(Model):
    version: int
    content_hash: str
    actor: str
    created_at: datetime


class ConstitutionVersion(Model):
    id: str
    version: int
    name: str
    active: bool
    content_hash: str
    actor: str
    created_at: datetime


class PolicySummary(Model):
    policy_id: str
    version: int
    name: str
    status: PolicyStatus
    owner: str
    approver: str
    agent_id: str
    expires_at: datetime
    expired: bool
    scope: Scope
    network_ref: str
    latest_verdict: str | None
    needs_retest: bool = Field(description="Its evaluation predates the current network or constitution")


class EvaluationSummary(Model):
    id: int
    report_id: str
    policy_id: str
    policy_version: int
    verdict: str
    network_ref: str
    constitution_ref: str
    replications: int
    created_at: datetime


class LimitView(Model):
    kind: str
    value: float
    unit: str


class AgentMandate(Model):
    """What an executing agent reads: its active mandate, the rule it executes, and when it must escalate."""

    agent_id: str
    status: Literal["active", "expired"]
    policy_id: str
    policy_version: int
    policy_name: str
    owner: str
    approver: str
    valid_from: datetime
    expires_at: datetime
    autonomy: list[LimitView]
    escalation: list[EscalationRule]
    prohibited_actions: list[str]
    rule: DecisionRule
    scope: Scope
    constitution_ref: str
    network_ref: str
    approved_by: str | None
    audit_hash: str = Field(description="Hash of the audit entry that deployed this mandate")


class Verification(Model):
    ok: bool
    entries: int
    first_bad_seq: int | None
    reason: str
    head: str | None = Field(description="Hash of the latest entry: anchor it elsewhere to detect truncation")


class AuditEntry(Model):
    seq: int
    ts: str
    actor: str
    action: str
    object_type: str
    object_ref: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


class Registry:
    def __init__(self, engine: Engine, clock: Callable[[], datetime] = utcnow) -> None:
        self.engine = engine
        self.clock = clock

    def session(self) -> Session:
        return Session(self.engine)

    # ---------------------------------------------------------------- networks
    def save_network(self, net: Network, actor: str, network_id: str | None = None) -> tuple[str, int, bool]:
        """Store a network. Returns (id, version, whether a new version was created)."""
        nid = network_id or _slug(net.name)
        body = net.model_dump(mode="json")
        h = content_hash(body)
        with self.session() as s:
            last = s.exec(select(NetworkRow).where(NetworkRow.network_id == nid)
                          .order_by(NetworkRow.version.desc())).first()  # type: ignore[attr-defined]
            if last and last.content_hash == h:
                return nid, last.version, False
            version = (last.version + 1) if last else 1
            s.add(NetworkRow(network_id=nid, version=version, content_hash=h, body=canonical(body), actor=actor,
                             created_at=self.clock()))
            append_audit(s, actor, "network.saved", "network", f"{nid}@{version}", {"content_hash": h},
                         self.clock())
            s.commit()
        return nid, version, True

    def _network_row(self, s: Session, nid: str, version: int | None = None) -> NetworkRow:
        q = select(NetworkRow).where(NetworkRow.network_id == nid)
        q = q.where(NetworkRow.version == version) if version else q.order_by(NetworkRow.version.desc())  # type: ignore[attr-defined]
        row = s.exec(q).first()
        if row is None:
            raise RegistryError(404, "network_not_found", f"no network {nid}" + (f"@{version}" if version else ""))
        return row

    def get_network(self, nid: str, version: int | None = None) -> tuple[Network, int]:
        with self.session() as s:
            row = self._network_row(s, nid, version)
            return Network.model_validate_json(row.body), row.version

    def network_ref(self, nid: str) -> str:
        with self.session() as s:
            return f"{nid}@{self._network_row(s, nid).version}"

    def networks(self) -> list[dict[str, Any]]:
        with self.session() as s:
            rows = s.exec(select(NetworkRow).order_by(col(NetworkRow.network_id), col(NetworkRow.version))).all()
        latest: dict[str, NetworkRow] = {}
        for r in rows:
            latest[r.network_id] = r
        return [{"network_id": r.network_id, "version": r.version, "name": Network.model_validate_json(r.body).name,
                 "content_hash": r.content_hash, "created_at": r.created_at} for r in latest.values()]

    def network_versions(self, nid: str) -> list[VersionInfo]:
        with self.session() as s:
            rows = s.exec(select(NetworkRow).where(NetworkRow.network_id == nid)
                          .order_by(col(NetworkRow.version))).all()
        if not rows:
            raise RegistryError(404, "network_not_found", f"no network {nid}")
        return [VersionInfo(version=r.version, content_hash=r.content_hash, actor=r.actor, created_at=r.created_at)
                for r in rows]

    def network_diff(self, nid: str, a: int, b: int) -> list[Change]:
        na, _ = self.get_network(nid, a)
        nb, _ = self.get_network(nid, b)
        return json_diff(na.model_dump(mode="json"), nb.model_dump(mode="json"))

    def default_network_id(self) -> str:
        nets = self.networks()
        if not nets:
            raise RegistryError(409, "no_network", "save a network first")
        return str(nets[0]["network_id"])

    # ---------------------------------------------------------------- constitutions
    def save_constitution(self, con: Constitution, actor: str, activate: bool = False) -> int:
        with self.session() as s:
            rows = s.exec(select(ConstitutionRow).where(ConstitutionRow.constitution_id == con.id)
                          .order_by(ConstitutionRow.version.desc())).all()  # type: ignore[attr-defined]
            body_no_v = con.model_dump(mode="json", exclude={"version", "created_at"})
            h = content_hash(body_no_v)
            if rows and rows[0].content_hash == h:
                version = rows[0].version
            else:
                version = (rows[0].version + 1) if rows else 1
                stored = con.model_copy(update={"version": version})
                s.add(ConstitutionRow(constitution_id=con.id, version=version, content_hash=h,
                                      body=stored.model_dump_json(), actor=actor, created_at=self.clock()))
                append_audit(s, actor, "constitution.saved", "constitution", f"{con.id}@{version}",
                             {"content_hash": h}, self.clock())
            s.commit()
        if activate:
            self.activate_constitution(con.id, version, actor)
        return version

    def activate_constitution(self, cid: str, version: int, actor: str) -> None:
        with self.session() as s:
            target = s.exec(select(ConstitutionRow).where(ConstitutionRow.constitution_id == cid,
                                                          ConstitutionRow.version == version)).first()
            if target is None:
                raise RegistryError(404, "constitution_not_found", f"no constitution {cid}@{version}")
            for row in s.exec(select(ConstitutionRow).where(ConstitutionRow.active == True)).all():  # noqa: E712
                row.active = False
                s.add(row)
            target.active = True
            s.add(target)
            append_audit(s, actor, "constitution.activated", "constitution", f"{cid}@{version}", {}, self.clock())
            s.commit()

    def constitutions(self) -> list[ConstitutionVersion]:
        """Every stored constitution version, newest first, with the active one marked."""
        with self.session() as s:
            rows = s.exec(select(ConstitutionRow)).all()
        out = [ConstitutionVersion(id=r.constitution_id, version=r.version, name=Constitution.model_validate_json(
            r.body).name, active=r.active, content_hash=r.content_hash, actor=r.actor, created_at=r.created_at)
               for r in rows]
        return sorted(out, key=lambda c: (c.id, -c.version))

    def get_constitution(self, cid: str, version: int) -> Constitution:
        with self.session() as s:
            row = s.exec(select(ConstitutionRow).where(ConstitutionRow.constitution_id == cid,
                                                       ConstitutionRow.version == version)).first()
        if row is None:
            raise RegistryError(404, "constitution_not_found", f"no constitution {cid}@{version}")
        return Constitution.model_validate_json(row.body)

    def active_constitution(self) -> Constitution:
        with self.session() as s:
            row = s.exec(select(ConstitutionRow).where(ConstitutionRow.active == True)).first()  # noqa: E712
        if row is None:
            raise RegistryError(409, "no_constitution", "no constitution is active")
        return Constitution.model_validate_json(row.body)

    # ---------------------------------------------------------------- scenario sets
    def save_scenario_set(self, ss: ScenarioSet, actor: str) -> tuple[int, bool]:
        """Store a named scenario set; changed content becomes a new version. Returns (version, created)."""
        body = ss.model_dump(mode="json")
        h = content_hash(body)
        with self.session() as s:
            last = s.exec(select(ScenarioSetRow).where(ScenarioSetRow.set_id == ss.id)
                          .order_by(col(ScenarioSetRow.version).desc())).first()
            if last and last.content_hash == h:
                return last.version, False
            version = (last.version + 1) if last else 1
            s.add(ScenarioSetRow(set_id=ss.id, version=version, content_hash=h, body=canonical(body), actor=actor,
                                 created_at=self.clock()))
            append_audit(s, actor, "scenario_set.saved", "scenario_set", f"{ss.id}@{version}", {"content_hash": h},
                         self.clock())
            s.commit()
        return version, True

    def get_scenario_set(self, set_id: str, version: int | None = None) -> tuple[ScenarioSet, int]:
        if set_id == "default-suite" and version is None:
            with self.session() as s:
                stored = s.exec(select(ScenarioSetRow).where(ScenarioSetRow.set_id == set_id)).first()
            if stored is None:
                from core.sim.scenarios import default_suite

                return default_suite(), 0
        with self.session() as s:
            q = select(ScenarioSetRow).where(ScenarioSetRow.set_id == set_id)
            q = q.where(ScenarioSetRow.version == version) if version else q.order_by(
                col(ScenarioSetRow.version).desc())
            row = s.exec(q).first()
        if row is None:
            raise RegistryError(404, "scenario_set_not_found", f"no scenario set {set_id}")
        return ScenarioSet.model_validate_json(row.body), row.version

    def scenario_sets(self) -> list[dict[str, Any]]:
        from core.sim.scenarios import default_suite

        with self.session() as s:
            rows = s.exec(select(ScenarioSetRow).order_by(col(ScenarioSetRow.set_id),
                                                          col(ScenarioSetRow.version))).all()
        latest: dict[str, ScenarioSetRow] = {r.set_id: r for r in rows}
        out = [{"set_id": "default-suite", "version": 0, "name": default_suite().name, "scenarios": 8,
                "builtin": True}] if "default-suite" not in latest else []
        for r in latest.values():
            ss = ScenarioSet.model_validate_json(r.body)
            out.append({"set_id": r.set_id, "version": r.version, "name": ss.name, "scenarios": len(ss.scenarios),
                        "builtin": False})
        return out

    # ---------------------------------------------------------------- policies
    def _row(self, s: Session, pid: str, version: int | None = None) -> PolicyRow:
        q = select(PolicyRow).where(PolicyRow.policy_id == pid)
        q = q.where(PolicyRow.version == version) if version else q.order_by(PolicyRow.version.desc())  # type: ignore[attr-defined]
        row = s.exec(q).first()
        if row is None:
            raise RegistryError(404, "policy_not_found", f"no policy {pid}" + (f"@{version}" if version else ""))
        return row

    def _store_version(self, s: Session, policy: Policy, version: int, actor: str, network_id: str,
                       action: str) -> PolicyRow:
        ref = f"{network_id}@{self._network_row(s, network_id).version}"
        now = self.clock()
        p = policy.model_copy(update={"version": version, "status": PolicyStatus.draft})
        h = policy_content_hash(p)
        row = PolicyRow(policy_id=p.id, version=version, status=PolicyStatus.draft, content_hash=h,
                        agent_id=p.mandate.agent_id, owner=p.mandate.owner, expires_at=p.mandate.expires_at,
                        network_ref=ref, body=p.model_dump_json(), actor=actor, created_at=now, updated_at=now)
        s.add(row)
        append_audit(s, actor, action, "policy", f"{p.id}@{version}",
                     {"content_hash": h, "network_ref": ref, "constitution_ref": p.constitution_ref}, now)
        return row

    def create_policy(self, policy: Policy, actor: str, network_id: str | None = None) -> int:
        nid = network_id or self.default_network_id()
        with self.session() as s:
            if s.exec(select(PolicyRow).where(PolicyRow.policy_id == policy.id)).first():
                raise RegistryError(409, "policy_exists", f"policy {policy.id} exists; edit it to add a version")
            self._store_version(s, policy, 1, actor, nid, "policy.created")
            s.commit()
        return 1

    def edit_policy(self, pid: str, policy: Policy, actor: str) -> int:
        if policy.id != pid:
            raise RegistryError(422, "id_mismatch", f"the body is policy {policy.id}, not {pid}")
        with self.session() as s:
            last = self._row(s, pid)
            nid = last.network_ref.split("@")[0]
            version = last.version + 1
            self._store_version(s, policy, version, actor, nid, "policy.edited")
            s.commit()
        return version

    def get_policy(self, pid: str, version: int | None = None) -> Policy:
        with self.session() as s:
            return Policy.model_validate_json(self._row(s, pid, version).body)

    def policy_versions(self, pid: str) -> list[VersionInfo]:
        with self.session() as s:
            rows = s.exec(select(PolicyRow).where(PolicyRow.policy_id == pid).order_by(col(PolicyRow.version))).all()
        if not rows:
            raise RegistryError(404, "policy_not_found", f"no policy {pid}")
        return [VersionInfo(version=r.version, content_hash=r.content_hash, actor=r.actor, created_at=r.created_at)
                for r in rows]

    def policy_diff(self, pid: str, a: int, b: int) -> list[Change]:
        pa, pb = self.get_policy(pid, a), self.get_policy(pid, b)
        keep = {"name", "intent_text", "scope", "rule", "mandate", "assumptions", "constitution_ref"}
        return json_diff(pa.model_dump(mode="json", include=keep), pb.model_dump(mode="json", include=keep))

    def _latest_eval(self, s: Session, row: PolicyRow) -> EvaluationRow | None:
        q = (select(EvaluationRow).where(EvaluationRow.policy_id == row.policy_id,
                                         EvaluationRow.policy_version == row.version,
                                         EvaluationRow.policy_hash == row.content_hash)
             .order_by(EvaluationRow.id.desc()))  # type: ignore[union-attr]
        return s.exec(q).first()

    def _needs_retest(self, s: Session, row: PolicyRow, ev: EvaluationRow | None) -> bool:
        if row.status not in (PolicyStatus.tested, PolicyStatus.approved, PolicyStatus.deployed) or ev is None:
            return False
        nid = row.network_ref.split("@")[0]
        current_net = f"{nid}@{self._network_row(s, nid).version}"
        try:
            con_ref = self.active_constitution().ref
        except RegistryError:
            con_ref = ev.constitution_ref
        return ev.network_ref != current_net or ev.constitution_ref != con_ref

    def _summary(self, s: Session, row: PolicyRow) -> PolicySummary:
        p = Policy.model_validate_json(row.body)
        ev = self._latest_eval(s, row)
        return PolicySummary(policy_id=row.policy_id, version=row.version, name=p.name,
                             status=PolicyStatus(row.status), owner=row.owner, approver=p.mandate.approver,
                             agent_id=row.agent_id, expires_at=p.mandate.expires_at,
                             expired=p.mandate.expired(self.clock()), scope=p.scope, network_ref=row.network_ref,
                             latest_verdict=ev.verdict if ev else None, needs_retest=self._needs_retest(s, row, ev))

    def policies(self, status: str | None = None) -> list[PolicySummary]:
        """The latest version of every policy (and every deployed version), optionally by status."""
        with self.session() as s:
            rows = s.exec(select(PolicyRow).order_by(col(PolicyRow.policy_id), col(PolicyRow.version))).all()
            latest: dict[str, PolicyRow] = {}
            extra: list[PolicyRow] = []
            for r in rows:
                latest[r.policy_id] = r
            for r in rows:
                if r.status == PolicyStatus.deployed and latest[r.policy_id] is not r:
                    extra.append(r)
            out = [self._summary(s, r) for r in [*latest.values(), *extra]]
        return [x for x in out if status is None or x.status == status]

    def record_compile(self, actor: str, intent: str, model: str, prompt_hash: str, attempts: int,
                       policy_id: str | None) -> None:
        with self.session() as s:
            append_audit(s, actor, "policy.compiled", "intent", policy_id or "-",
                         {"intent": intent, "model": model, "prompt_hash": prompt_hash, "attempts": attempts},
                         self.clock())
            s.commit()

    # ---------------------------------------------------------------- evaluation
    def record_evaluation(self, pid: str, version: int, report: EvaluationReport, actor: str) -> EvaluationSummary:
        with self.session() as s:
            row = self._row(s, pid, version)
            if row.status == PolicyStatus.retired:
                raise RegistryError(409, "retired", f"{pid}@{version} is retired")
            nid = row.network_ref.split("@")[0]
            net_ref = f"{nid}@{self._network_row(s, nid).version}"
            ev = EvaluationRow(report_id=report.id, policy_id=pid, policy_version=version,
                               policy_hash=row.content_hash, network_ref=net_ref,
                               constitution_ref=report.constitution_ref, verdict=report.verdict.decision,
                               replications=report.replications, body=report.model_dump_json(), actor=actor,
                               created_at=self.clock())
            s.add(ev)
            if row.status == PolicyStatus.draft:
                row.status = PolicyStatus.tested
                row.updated_at = self.clock()
                row.body = Policy.model_validate_json(row.body).model_copy(
                    update={"status": PolicyStatus.tested}).model_dump_json()
                s.add(row)
            s.flush()
            append_audit(s, actor, "evaluation.recorded", "policy", f"{pid}@{version}",
                         {"report_id": report.id, "verdict": report.verdict.decision, "network_ref": net_ref,
                          "constitution_ref": report.constitution_ref, "replications": report.replications},
                         self.clock())
            s.commit()
            s.refresh(ev)
            return EvaluationSummary(id=ev.id or 0, report_id=ev.report_id, policy_id=pid, policy_version=version,
                                     verdict=ev.verdict, network_ref=ev.network_ref,
                                     constitution_ref=ev.constitution_ref, replications=ev.replications,
                                     created_at=ev.created_at)

    def evaluate(self, pid: str, version: int, actor: str, scenarios: ScenarioSet | None = None,
                 replications: int = 200, periods: int = 104, seed: int = 1, rolling_reps: int = 20,
                 baselines: tuple[str, ...] | None = None,
                 progress: Callable[[float, str], None] | None = None) -> tuple[EvaluationSummary, EvaluationReport]:
        """Evaluate a stored policy and record the result. `progress(fraction, message)` hears each scenario."""
        from core.evaluate.run import BASELINES
        from core.evaluate.run import evaluate as run_evaluation
        from core.sim.scenarios import default_suite

        policy = self.get_policy(pid, version)
        with self.session() as s:
            nid = self._row(s, pid, version).network_ref.split("@")[0]
        net, _ = self.get_network(nid)
        suite = scenarios or default_suite()
        done = [0]

        def tick(message: str) -> None:
            if progress:
                progress(done[0] / len(suite.scenarios), message)
                done[0] += 1

        report = run_evaluation(policy, self.active_constitution(), suite, net=net, replications=replications,
                                periods=periods, seed=seed, rolling_reps=rolling_reps,
                                baselines=baselines or BASELINES, progress=tick)
        if progress:
            progress(1.0, "recording the report")
        return self.record_evaluation(pid, version, report, actor), report

    def evaluations(self, pid: str, version: int | None = None) -> list[EvaluationSummary]:
        with self.session() as s:
            q = select(EvaluationRow).where(EvaluationRow.policy_id == pid)
            if version:
                q = q.where(EvaluationRow.policy_version == version)
            rows = s.exec(q.order_by(EvaluationRow.id)).all()  # type: ignore[arg-type]
        return [EvaluationSummary(id=r.id or 0, report_id=r.report_id, policy_id=r.policy_id,
                                  policy_version=r.policy_version, verdict=r.verdict, network_ref=r.network_ref,
                                  constitution_ref=r.constitution_ref, replications=r.replications,
                                  created_at=r.created_at) for r in rows]

    def evaluation_report(self, evaluation_id: int) -> EvaluationReport:
        with self.session() as s:
            row = s.get(EvaluationRow, evaluation_id)
        if row is None:
            raise RegistryError(404, "evaluation_not_found", f"no evaluation {evaluation_id}")
        return EvaluationReport.model_validate_json(row.body)

    # ---------------------------------------------------------------- lifecycle
    def _set_status(self, s: Session, row: PolicyRow, status: PolicyStatus) -> None:
        row.status = status
        row.updated_at = self.clock()
        row.body = Policy.model_validate_json(row.body).model_copy(update={"status": status}).model_dump_json()
        s.add(row)

    def approval_blockers(self, pid: str, version: int) -> list[str]:
        """Why this version cannot be approved now (empty when it can)."""
        with self.session() as s:
            row = self._row(s, pid, version)
            if row.status != PolicyStatus.tested:
                return [f"{pid}@{version} is {row.status}; only a tested version can be approved"]
            ev = self._latest_eval(s, row)
            if ev is None:
                return ["no evaluation of this exact version has been recorded"]
            out = []
            if ev.verdict != "approve":
                out.append(f"the latest evaluation's verdict is {ev.verdict.replace('_', ' ')}, not approve")
            con = self.active_constitution().ref
            if ev.constitution_ref != con:
                out.append(f"re-test needed: evaluated against {ev.constitution_ref}, but {con} is active")
            nid = row.network_ref.split("@")[0]
            current = f"{nid}@{self._network_row(s, nid).version}"
            if ev.network_ref != current:
                out.append(f"re-test needed: evaluated on {ev.network_ref}, but the network is now {current}")
            if Policy.model_validate_json(row.body).mandate.expired(self.clock()):
                out.append("the mandate has already expired")
            return out

    def approve(self, pid: str, version: int, actor: str, note: str = "") -> None:
        blockers = self.approval_blockers(pid, version)
        if blockers:
            raise RegistryError(409, "approval_blocked", "cannot approve: " + "; ".join(blockers))
        with self.session() as s:
            row = self._row(s, pid, version)
            ev = self._latest_eval(s, row)
            self._set_status(s, row, PolicyStatus.approved)
            append_audit(s, actor, "policy.approved", "policy", f"{pid}@{version}",
                         {"evaluation_id": ev.id if ev else None, "report_id": ev.report_id if ev else None,
                          "note": note}, self.clock())
            s.commit()

    def deploy(self, pid: str, version: int, actor: str) -> str:
        with self.session() as s:
            row = self._row(s, pid, version)
            if row.status != PolicyStatus.approved:
                raise RegistryError(409, "not_approved", f"{pid}@{version} is {row.status}; approve it first")
            if Policy.model_validate_json(row.body).mandate.expired(self.clock()):
                raise RegistryError(409, "expired", "the mandate has expired; edit the policy to renew it")
            for other in s.exec(select(PolicyRow).where(PolicyRow.agent_id == row.agent_id,
                                                        PolicyRow.status == PolicyStatus.deployed)).all():
                self._set_status(s, other, PolicyStatus.retired)
                append_audit(s, actor, "policy.retired", "policy", f"{other.policy_id}@{other.version}",
                             {"reason": f"superseded by {pid}@{version} for agent {row.agent_id}"}, self.clock())
            self._set_status(s, row, PolicyStatus.deployed)
            entry = append_audit(s, actor, "policy.deployed", "policy", f"{pid}@{version}",
                                 {"agent_id": row.agent_id, "expires_at": row.expires_at.isoformat()}, self.clock())
            s.commit()
            return entry.hash

    def retire(self, pid: str, version: int, actor: str, reason: str = "") -> None:
        with self.session() as s:
            row = self._row(s, pid, version)
            if row.status in (PolicyStatus.draft, PolicyStatus.retired):
                raise RegistryError(409, "cannot_retire", f"{pid}@{version} is {row.status}")
            self._set_status(s, row, PolicyStatus.retired)
            append_audit(s, actor, "policy.retired", "policy", f"{pid}@{version}", {"reason": reason},
                         self.clock())
            s.commit()

    # ---------------------------------------------------------------- expiry and the agent's view
    def check_expiry(self) -> list[str]:
        """Deployed mandates past their expiry: recorded in the audit log once each. Returns their refs."""
        now = self.clock()
        with self.session() as s:
            expired = []
            for row in s.exec(select(PolicyRow).where(PolicyRow.status == PolicyStatus.deployed)).all():
                if Policy.model_validate_json(row.body).mandate.expired(now):
                    ref = f"{row.policy_id}@{row.version}"
                    expired.append(ref)
                    seen = s.exec(select(AuditRow).where(AuditRow.action == "mandate.expired",
                                                         AuditRow.object_ref == ref)).first()
                    if seen is None:
                        append_audit(s, "system", "mandate.expired", "policy", ref,
                                     {"agent_id": row.agent_id, "expires_at": row.expires_at.isoformat()}, now)
            s.commit()
        return expired

    def agent_mandate(self, agent_id: str) -> AgentMandate | None:
        self.check_expiry()
        with self.session() as s:
            row = s.exec(select(PolicyRow).where(PolicyRow.agent_id == agent_id,
                                                 PolicyRow.status == PolicyStatus.deployed)).first()
            if row is None:
                return None
            ref = f"{row.policy_id}@{row.version}"
            deployed = s.exec(select(AuditRow).where(AuditRow.action == "policy.deployed",
                                                     AuditRow.object_ref == ref)
                              .order_by(AuditRow.seq.desc())).first()  # type: ignore[union-attr]
            approved = s.exec(select(AuditRow).where(AuditRow.action == "policy.approved",
                                                     AuditRow.object_ref == ref)
                              .order_by(AuditRow.seq.desc())).first()  # type: ignore[union-attr]
        p = Policy.model_validate_json(row.body)
        m = p.mandate
        return AgentMandate(
            agent_id=agent_id, status="expired" if m.expired(self.clock()) else "active", policy_id=p.id,
            policy_version=p.version, policy_name=p.name, owner=m.owner, approver=m.approver,
            valid_from=m.valid_from, expires_at=m.expires_at,
            autonomy=[LimitView(kind=str(a.kind), value=a.value, unit=AuthorityLimit(kind=a.kind, value=a.value).unit)
                      for a in m.autonomy],
            escalation=m.escalation, prohibited_actions=[str(a) for a in m.prohibited_actions], rule=p.rule,
            scope=p.scope, constitution_ref=p.constitution_ref, network_ref=row.network_ref,
            approved_by=approved.actor if approved else None, audit_hash=deployed.hash if deployed else "")

    # ---------------------------------------------------------------- audit
    def audit(self, limit: int = 200, offset: int = 0, object_ref: str | None = None) -> list[AuditEntry]:
        import json

        with self.session() as s:
            q = select(AuditRow)
            if object_ref:
                q = q.where(AuditRow.object_ref == object_ref)
            rows = s.exec(q.order_by(AuditRow.seq).offset(offset).limit(limit)).all()  # type: ignore[arg-type]
        return [AuditEntry(seq=r.seq or 0, ts=r.ts, actor=r.actor, action=r.action, object_type=r.object_type,
                           object_ref=r.object_ref, payload=json.loads(r.payload), prev_hash=r.prev_hash,
                           hash=r.hash) for r in rows]

    def verify(self) -> Verification:
        with self.session() as s:
            rows = list(s.exec(select(AuditRow).order_by(AuditRow.seq)).all())  # type: ignore[arg-type]
        ok, bad, reason = verify_chain(rows)
        return Verification(ok=ok, entries=len(rows), first_bad_seq=bad, reason=reason,
                            head=rows[-1].hash if rows else None)


def seeded(engine: Engine, actor: str = "setup", clock: Callable[[], datetime] = utcnow) -> Registry:
    """A registry with FoodNet and the default constitution (active), as the app starts."""
    from core.domain.examples import default_constitution
    from core.domain.network import load_foodnet

    reg = Registry(engine, clock)
    if not reg.networks():
        reg.save_network(load_foodnet(), actor, network_id="foodnet")
    try:
        reg.active_constitution()
    except RegistryError:
        reg.save_constitution(default_constitution(), actor, activate=True)
    return reg
