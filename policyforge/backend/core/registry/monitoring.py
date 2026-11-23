"""Monitoring in the registry (P6): live streams over the deployed policies, the escalation inbox, re-tests.

A stream's state is its config and its current week; observations, monitor states and alarms are recomputed from them
(D058), so stepping and jumping agree. New alarms become inbox alerts, at most one open per monitor. After an alert
is closed, its monitor raises a new one only for an alarm after the week it was closed.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

from pydantic import Field
from sqlmodel import col, select

from core.domain.common import Model
from core.domain.policy import Policy
from core.domain.scenario import BaselineDemand, Scenario
from core.monitor.inbox import rank
from core.monitor.monitors import Alarm, MonitorState, Result, run_monitors
from core.monitor.retest import Retest, retest
from core.monitor.stream import Injection, Run, StreamConfig, Switch, run_reference, run_stream
from core.registry.registry import Registry, RegistryError
from core.registry.store import AlertRow, RetestRow, StreamRow, append_audit, content_hash
from core.sim.scenarios import default_suite

AlertStatus = Literal["open", "acknowledged", "resolved", "dismissed"]
OPEN = ("open", "acknowledged")
MOVES: dict[str, tuple[str, ...]] = {"open": ("acknowledged", "resolved", "dismissed"),
                                     "acknowledged": ("resolved", "dismissed"), "resolved": (), "dismissed": ()}


class StreamView(Model):
    id: int
    network_ref: str
    policies: list[str]  # policy_id@version
    scenario_id: str
    seed: int
    horizon: int
    week: int = Field(description="The last week observed")
    switches: list[Switch] | None = Field(default=None, description="The hidden world; only with reveal=true")
    monitors: list[MonitorState] = []
    service: list[float | None] = []
    cost: list[float | None] = []
    open_alerts: int = 0


class AlertView(Model):
    id: int
    stream_id: int
    monitor_id: str
    kind: str
    policy_id: str | None
    policy_version: int | None
    subject: str
    week: int
    message: str
    evidence: dict[str, Any]
    update: dict[str, Any] | None
    severity: str
    reversibility: float
    exposure_eur_per_week: float
    score: float
    basis: str
    status: AlertStatus
    note: str
    retest_id: int | None
    created_at: datetime
    updated_at: datetime


class RetestView(Model):
    id: int
    alert_id: int
    policy_id: str
    policy_version: int
    verdict: str
    retest: Retest
    actor: str
    created_at: datetime


def _alert_view(r: AlertRow) -> AlertView:
    assert r.id is not None
    return AlertView(id=r.id, stream_id=r.stream_id, monitor_id=r.monitor_id, kind=r.kind, policy_id=r.policy_id,
                     policy_version=r.policy_version, subject=r.subject, week=r.week, message=r.message,
                     evidence=json.loads(r.evidence), update=json.loads(r.update_), severity=r.severity,
                     reversibility=r.reversibility, exposure_eur_per_week=r.exposure, score=r.score, basis=r.basis,
                     status=r.status, note=r.note, retest_id=r.retest_id,  # type: ignore[arg-type]
                     created_at=r.created_at, updated_at=r.updated_at)


def _series(x: Any) -> list[float | None]:
    return [None if v != v else round(float(v), 4) for v in x]  # NaN != NaN


class Monitoring:
    def __init__(self, reg: Registry) -> None:
        self.reg = reg
        self._refs: dict[str, Run] = {}

    # ---------------------------------------------------------------- inputs of a stream
    def _row(self, sid: int) -> StreamRow:
        with self.reg.session() as s:
            row = s.get(StreamRow, sid)
        if row is None:
            raise RegistryError(404, "stream_not_found", f"no stream {sid}")
        return row

    def _policies(self, row: StreamRow) -> list[Policy]:
        return [self.reg.get_policy(pid, v) for pid, v in json.loads(row.policies)]

    def _reference(self, row: StreamRow, policies: list[Policy], cfg: StreamConfig) -> Run:
        net, _ = self.reg.get_network(row.network_ref.split("@")[0], int(row.network_ref.split("@")[1]))
        key = content_hash([row.network_ref, [p.model_dump(mode="json") for p in policies], row.scenario_id,
                            cfg.horizon])
        if key not in self._refs:
            scenario = self._scenario(row.scenario_id)
            self._refs[key] = run_reference(net, policies, scenario, cfg.horizon)
        return self._refs[key]

    @staticmethod
    def _scenario(scenario_id: str) -> Scenario:
        if scenario_id == "baseline":
            return Scenario(id="baseline", name="Baseline", components=[BaselineDemand()])
        for sc in default_suite().scenarios:
            if sc.id == scenario_id:
                return sc
        raise RegistryError(422, "unknown_scenario", f"no scenario {scenario_id!r} in the default suite")

    def _compute(self, row: StreamRow, week: int | None = None) -> tuple[StreamConfig, list[Policy], Run, Run, Result]:
        cfg = StreamConfig.model_validate_json(row.config)
        policies = self._policies(row)
        net, _ = self.reg.get_network(row.network_ref.split("@")[0], int(row.network_ref.split("@")[1]))
        live = run_stream(net, policies, cfg)
        ref = self._reference(row, policies, cfg)
        res = run_monitors(live, ref, policies, row.week if week is None else week, row.scenario_id)
        return cfg, policies, live, ref, res

    # ---------------------------------------------------------------- streams
    def create_stream(self, actor: str, seed: int = 1, horizon: int = 104, scenario_id: str = "baseline",
                      network_id: str | None = None) -> StreamView:
        """A stream over the network with every deployed policy, at week 0."""
        self._scenario(scenario_id)
        nid = network_id or self.reg.default_network_id()
        net_ref = self.reg.network_ref(nid)
        deployed = [(p.policy_id, p.version) for p in self.reg.policies(status="deployed")]
        cfg = StreamConfig(seed=seed, horizon=horizon)
        now = self.reg.clock()
        with self.reg.session() as s:
            row = StreamRow(network_ref=net_ref, policies=json.dumps(deployed), scenario_id=scenario_id,
                            config=cfg.model_dump_json(), week=0, actor=actor, created_at=now, updated_at=now)
            s.add(row)
            s.flush()
            append_audit(s, actor, "stream.created", "stream", str(row.id),
                         {"network": net_ref, "policies": [f"{p}@{v}" for p, v in deployed], "seed": seed,
                          "horizon": horizon, "scenario": scenario_id}, now)
            s.commit()
            s.refresh(row)
        assert row.id is not None
        return self.stream(row.id)

    def streams(self) -> list[dict[str, Any]]:
        """Every stream, newest first: id, network, policies, week and horizon."""
        with self.reg.session() as s:
            rows = s.exec(select(StreamRow)).all()
        out = []
        for r in rows:
            cfg = StreamConfig.model_validate_json(r.config)
            out.append({"id": r.id, "network_ref": r.network_ref, "scenario_id": r.scenario_id, "week": r.week,
                        "horizon": cfg.horizon, "seed": cfg.seed,
                        "policies": [f"{p}@{v}" for p, v in json.loads(r.policies)], "created_at": r.created_at})
        return sorted(out, key=lambda x: -int(x["id"] or 0))

    def stream(self, sid: int, reveal: bool = False) -> StreamView:
        row = self._row(sid)
        cfg, _, live, _, res = self._compute(row)
        with self.reg.session() as s:
            n_open = len(s.exec(select(AlertRow).where(AlertRow.stream_id == sid)
                                .where(col(AlertRow.status).in_(OPEN))).all())
        assert row.id is not None
        return StreamView(id=row.id, network_ref=row.network_ref,
                          policies=[f"{p}@{v}" for p, v in json.loads(row.policies)], scenario_id=row.scenario_id,
                          seed=cfg.seed, horizon=cfg.horizon, week=row.week, switches=cfg.switches if reveal else None,
                          monitors=res.states, service=_series(live.obs.service[0, : row.week + 1]),
                          cost=_series(live.obs.cost[0, : row.week + 1]), open_alerts=n_open)

    def step(self, sid: int, weeks: int, actor: str) -> list[AlertView]:
        """Advance the stream; returns the alerts raised on the way."""
        row = self._row(sid)
        cfg = StreamConfig.model_validate_json(row.config)
        target = min(cfg.horizon - 1, row.week + max(0, weeks))
        if target == row.week:
            return []
        with self.reg.session() as s:
            r = s.get(StreamRow, sid)
            assert r is not None
            r.week, r.updated_at = target, self.reg.clock()
            s.add(r)
            s.commit()
        return self._raise_alerts(self._row(sid), actor)

    def inject(self, sid: int, component: Injection, actor: str, note: str = "") -> StreamView:
        """Change the hidden world from the current week on (the component's window says when it bites)."""
        row = self._row(sid)
        cfg = StreamConfig.model_validate_json(row.config)
        net, _ = self.reg.get_network(row.network_ref.split("@")[0], int(row.network_ref.split("@")[1]))
        ids = {"supplier": [x.id for x in net.suppliers], "plant": [x.id for x in net.plants]}
        for field_, allowed in ids.items():
            v = getattr(component, field_, None)
            if v is not None and v not in allowed:
                raise RegistryError(422, "unknown_id", f"no {field_} {v!r} in {row.network_ref}")
        bad = [m for m in getattr(component, "markets", []) if m not in [x.id for x in net.markets]]
        if bad:
            raise RegistryError(422, "unknown_id", f"no market {bad[0]!r} in {row.network_ref}")
        # week `row.week` has been observed already: the change applies from the next week
        new = cfg.model_copy(update={"switches": [*cfg.switches, Switch(week=row.week + 1, component=component,
                                                                        note=note)]})
        StreamConfig.model_validate(new.model_dump())
        with self.reg.session() as s:
            r = s.get(StreamRow, sid)
            assert r is not None
            r.config, r.updated_at = new.model_dump_json(), self.reg.clock()
            s.add(r)
            append_audit(s, actor, "stream.injected", "stream", str(sid),
                         {"from_week": new.switches[-1].week, "component": component.model_dump(mode="json"),
                          "note": note}, self.reg.clock())
            s.commit()
        return self.stream(sid)

    # ---------------------------------------------------------------- the inbox
    def _raise_alerts(self, row: StreamRow, actor: str) -> list[AlertView]:
        _, policies, _, ref, res = self._compute(row)
        by_id = {p.id: p for p in policies}
        raised: list[AlertView] = []
        now = self.reg.clock()
        with self.reg.session() as s:
            existing = s.exec(select(AlertRow).where(AlertRow.stream_id == row.id)).all()
            for alarm in res.alarms:
                mine = [a for a in existing if a.monitor_id == alarm.monitor_id]
                if any(a.status in OPEN for a in mine):
                    continue
                if any(a.week >= alarm.week or (a.closed_week is not None and a.closed_week >= alarm.week)
                       for a in mine):
                    continue
                policy = by_id.get(alarm.policy_id or "")
                rk = rank(alarm, policy, ref)
                a = AlertRow(stream_id=row.id or 0, monitor_id=alarm.monitor_id, kind=alarm.kind,
                             policy_id=alarm.policy_id, policy_version=alarm.policy_version, subject=alarm.subject,
                             week=alarm.week, message=alarm.message, evidence=json.dumps(alarm.evidence, default=float),
                             update_=json.dumps(alarm.update), severity=rk.severity, reversibility=rk.reversibility,
                             exposure=rk.exposure_eur_per_week, score=rk.score, basis=rk.basis, status="open", note="",
                             closed_week=None, retest_id=None, created_at=now, updated_at=now)
                s.add(a)
                s.flush()
                existing = [*existing, a]
                append_audit(s, "monitor", "alert.raised", "alert", str(a.id),
                             {"stream": row.id, "monitor": alarm.monitor_id, "week": alarm.week,
                              "severity": rk.severity, "score": rk.score}, now)
                raised.append(_alert_view(a))
            s.commit()
        return raised

    def alerts(self, status: str | None = None, stream_id: int | None = None) -> list[AlertView]:
        """The inbox, highest score first."""
        with self.reg.session() as s:
            q = select(AlertRow)
            if status == "active":
                q = q.where(col(AlertRow.status).in_(OPEN))
            elif status:
                q = q.where(AlertRow.status == status)
            if stream_id is not None:
                q = q.where(AlertRow.stream_id == stream_id)
            rows = s.exec(q).all()
        return sorted((_alert_view(r) for r in rows), key=lambda a: (-a.score, a.week, a.id))

    def alert(self, aid: int) -> AlertView:
        with self.reg.session() as s:
            r = s.get(AlertRow, aid)
        if r is None:
            raise RegistryError(404, "alert_not_found", f"no alert {aid}")
        return _alert_view(r)

    def set_status(self, aid: int, status: AlertStatus, actor: str, note: str = "") -> AlertView:
        with self.reg.session() as s:
            r = s.get(AlertRow, aid)
            if r is None:
                raise RegistryError(404, "alert_not_found", f"no alert {aid}")
            if status not in MOVES[r.status]:
                raise RegistryError(409, "bad_transition", f"alert {aid} is {r.status}; it cannot become {status}")
            stream = s.get(StreamRow, r.stream_id)
            r.status, r.note, r.updated_at = status, note or r.note, self.reg.clock()
            if status in ("resolved", "dismissed"):
                r.closed_week = stream.week if stream else r.week
            s.add(r)
            append_audit(s, actor, f"alert.{status}", "alert", str(aid), {"note": note}, self.reg.clock())
            s.commit()
            s.refresh(r)
            return _alert_view(r)

    # ---------------------------------------------------------------- re-test
    def run_retest(self, aid: int, actor: str, replications: int = 200, periods: int = 104,
                   rolling_reps: int = 20, progress: Any = None) -> RetestView:
        """Re-run the stress test with the updated assumption: the policy, on the network as observed."""
        alert = self.alert(aid)
        row = self._row(alert.stream_id)
        policies = self._policies(row)
        policy = next((p for p in policies if p.id == alert.policy_id), None)
        if policy is None:
            if len(policies) != 1:
                raise RegistryError(409, "no_policy", "this alert is not about one policy: re-test a policy's alert")
            policy = policies[0]
        if alert.kind == "performance" or not alert.update:
            updates = [a.update for a in self.alerts("active", alert.stream_id) if a.update]
        else:
            updates = [alert.update]
        cfg, _, live, _, _ = self._compute(row)
        updates = [self._fresh(u, live, row.week) for u in updates]
        net, _ = self.reg.get_network(row.network_ref.split("@")[0], int(row.network_ref.split("@")[1]))
        result = retest(policy, self.reg.active_constitution(), net, updates, week=row.week,
                        replications=replications, periods=periods, seed=cfg.seed, rolling_reps=rolling_reps,
                        progress=progress)
        result = result.model_copy(update={"alert_id": aid})
        now = self.reg.clock()
        with self.reg.session() as s:
            rr = RetestRow(alert_id=aid, policy_id=policy.id, policy_version=policy.version,
                           verdict=result.report.verdict.decision, body=result.model_dump_json(), actor=actor,
                           created_at=now)
            s.add(rr)
            s.flush()
            a = s.get(AlertRow, aid)
            assert a is not None
            a.retest_id, a.updated_at = rr.id, now
            s.add(a)
            append_audit(s, actor, "retest.run", "alert", str(aid),
                         {"retest": rr.id, "policy": f"{policy.id}@{policy.version}",
                          "verdict": result.report.verdict.decision,
                          "changes": [c.path for c in result.changes]}, now)
            s.commit()
            s.refresh(rr)
        return self.retest(rr.id or 0)

    @staticmethod
    def _fresh(update: dict[str, Any], live: Run, week: int) -> dict[str, Any]:
        """The update with the latest observations: the mean of every week since the change began, up to now."""
        from core.domain.vocabulary import VarRef
        from core.monitor.monitors import _last_mean, series

        if "ratio" in update and "since_week" in update:
            return Monitoring._fresh_ratio(update, live, week)
        if "observed" not in update:
            return update
        try:
            ref = VarRef(var=update["variable"], supplier=update.get("supplier"), node=update.get("node"))
        except ValueError:
            return update
        x = series(live, ref)
        if x is None:
            return update
        start = int(update.get("since_week", max(0, week - 3)))
        obs = _last_mean(x[start: week + 1], week + 1 - start)
        return {**update, "observed": obs} if obs is not None else update

    @staticmethod
    def _fresh_ratio(update: dict[str, Any], live: Run, week: int) -> dict[str, Any]:
        """An input update with its level re-read over every week since the change began, up to now."""
        import numpy as np

        from core.monitor.stream import expected_demand, nominal_lead_time

        lay, start = live.lay, int(update["since_week"])
        if update.get("variable") == "demand" and update.get("node") in lay.market_ids:
            m = lay.market_ids.index(update["node"])
            x = live.obs.demand[0, :, m] / expected_demand(lay, live.obs.T)[:, m]
        elif update.get("variable") == "lead_time" and update.get("supplier") in lay.supplier_ids:
            s = lay.supplier_ids.index(update["supplier"])
            x = live.obs.lead_time[0, :, s] / nominal_lead_time(lay)[s]
        else:
            return update
        win = x[start: week + 1]
        win = win[~np.isnan(win)]
        return {**update, "ratio": float(win.mean())} if len(win) else update

    def retest(self, rid: int) -> RetestView:
        with self.reg.session() as s:
            r = s.get(RetestRow, rid)
        if r is None:
            raise RegistryError(404, "retest_not_found", f"no re-test {rid}")
        return RetestView(id=r.id or 0, alert_id=r.alert_id, policy_id=r.policy_id, policy_version=r.policy_version,
                          verdict=r.verdict, retest=Retest.model_validate_json(r.body), actor=r.actor,
                          created_at=r.created_at)


def alarms_by_week(res: Result) -> dict[int, list[Alarm]]:
    out: dict[int, list[Alarm]] = {}
    for a in res.alarms:
        out.setdefault(a.week, []).append(a)
    return out
