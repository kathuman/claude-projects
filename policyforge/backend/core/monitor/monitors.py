"""The monitors: assumption drift, input drift, performance drift, and the agents' mandate escalations.

Each monitor reads the live observations up to the current week and the reference (what the stress test predicts),
and returns its state and the weeks at which it fired. Everything is a pure function of the data, so stepping a
stream week by week and jumping ahead give the same alarms.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np

from core.domain.assumption import Assumption
from core.domain.common import Model
from core.domain.policy import Policy
from core.domain.vocabulary import Variable, VarRef
from core.monitor.detectors import (
    Cusum,
    calibrate_limit,
    change_point,
    cusum_upper,
    ks_pvalue,
    psi,
    robust_scale,
)
from core.monitor.stream import Run, expected_demand, nominal_lead_time
from core.sim.layout import Layout

F = np.ndarray
WARMUP = 8  # weeks before monitors start: the stream starts from a steady stock, not a steady state
ASSUMPTION_CUSUM = Cusum(k=0.5, h=4.0)
INPUT_K = 0.5
INPUT_MIN_LIMIT = 5.0  # the CUSUM limit of an input monitor is calibrated on the reference, never below this
INPUT_WINDOW = 8
DISTRIBUTION_WINDOW = 12
FAMILY_TARGET = 0.05  # input and performance monitors together: at most this share of quiet futures raise any alarm

Kind = Literal["assumption", "input", "performance", "mandate"]
Status = Literal["ok", "alarm", "warming_up", "not_observable"]


class Alarm(Model):
    """A monitor firing at a week, with the evidence and what a re-test should update."""

    monitor_id: str
    kind: Kind
    week: int
    policy_id: str | None = None
    policy_version: int | None = None
    subject: str  # what it is about, e.g. "supplier_capacity[SUP_C]" or "demand[MKT_N1]"
    message: str
    evidence: dict[str, Any] = {}
    update: dict[str, Any] | None = None  # for the re-test: {"variable", "supplier"/"node", "observed", "nominal"}


class MonitorState(Model):
    id: str
    kind: Kind
    subject: str
    policy_id: str | None = None
    status: Status
    description: str
    value: float | None = None  # the latest observation (or rolling KPI)
    threshold: float | None = None
    statistic: float | None = None  # CUSUM (or run length) now
    limit: float | None = None  # where the statistic fires
    alarm_weeks: list[int] = []
    series: list[float | None] = []  # the monitored values, week 0 … now (None = no observation)


@dataclass
class Result:
    states: list[MonitorState] = field(default_factory=list)
    alarms: list[Alarm] = field(default_factory=list)


def _clean(x: F) -> list[float | None]:
    return [None if np.isnan(v) else round(float(v), 4) for v in x]


def _last_mean(x: F, n: int = 4) -> float | None:
    v = x[~np.isnan(x)][-n:]
    return float(v.mean()) if len(v) else None


# ---------------------------------------------------------------- reading a variable from the observations
def series(run: Run, ref: VarRef, r: int | None = 0) -> F | None:
    """The weekly values of `ref` ([T] for one replication `r`, [R, T] for all when r is None); None when the stream
    cannot observe it."""
    lay, o = run.lay, run.obs

    def pick(a: F) -> F:
        out: F = a[r] if r is not None else a
        return out

    v = ref.var
    if v in (Variable.lead_time, Variable.observed_lead_time, Variable.supplier_fill_rate,
             Variable.supplier_capacity) and ref.supplier in lay.supplier_ids:
        s = lay.supplier_ids.index(ref.supplier)
        arr = {Variable.lead_time: o.lead_time, Variable.observed_lead_time: o.lead_time,
               Variable.supplier_fill_rate: o.fill_rate, Variable.supplier_capacity: o.supplier_capacity}[v]
        out: F = pick(arr[..., s])
        return out
    if v in (Variable.plant_capacity, Variable.capacity_utilisation) and ref.node in lay.plant_ids:
        p = lay.plant_ids.index(ref.node)
        return pick((o.plant_capacity if v is Variable.plant_capacity else o.utilisation)[..., p])
    if v is Variable.demand:
        dem = run.result.demand  # [R, T, M, K]
        mk = np.ones(lay.M, dtype=bool)
        if ref.node is not None:
            if ref.node in lay.market_ids:
                mk = np.array([m == ref.node for m in lay.market_ids])
            elif ref.node in lay.dc_ids:
                mk = lay.market_dc == lay.dc_ids.index(ref.node)
            else:
                return None
        sk = np.ones(lay.K, dtype=bool) if ref.sku is None else np.array([k == ref.sku for k in lay.sku_ids])
        return pick(dem[:, :, mk][:, :, :, sk].sum(axis=(2, 3)))
    if v is Variable.on_hand and ref.node in lay.node_ids:
        n = lay.node_ids.index(ref.node)
        oh = o.on_hand[:, :, n]
        if ref.sku is not None:
            if ref.sku not in lay.sku_ids:
                return None
            return pick(oh[:, :, lay.sku_ids.index(ref.sku)])
        return pick(oh.sum(axis=2))
    return None


# ---------------------------------------------------------------- the monitors
def _violation(x: F, op: str, threshold: float, scale: float) -> F:
    return (threshold - x) / scale if op in ("ge", "gt") else (x - threshold) / scale


def assumption_monitor(a: Assumption, policy: Policy, live: Run, ref: Run,
                       week: int) -> tuple[MonitorState, list[Alarm]]:
    mid = f"assumption:{policy.id}:{a.id}"
    subject = str(a.variable)
    base: dict[str, Any] = {"id": mid, "kind": "assumption", "subject": subject, "policy_id": policy.id,
            "description": f"{a.statement} ({a.expression()})"}
    x = series(live, a.variable)
    if x is None:
        return MonitorState(**base, status="not_observable"), []
    x = x[: week + 1]
    if week < WARMUP:
        return MonitorState(**base, status="warming_up", threshold=a.threshold, series=_clean(x)), []
    alarms: list[Alarm] = []
    upd = {"variable": a.variable.var.value, "supplier": a.variable.supplier, "node": a.variable.node}
    if a.threshold is not None and a.operator is not None:
        ref_x = series(ref, a.variable, r=None)
        pooled = ref_x[:, WARMUP:].ravel() if ref_x is not None else np.array([])
        scale = robust_scale(pooled, floor=max(1e-9, 0.02 * abs(a.threshold)))
        z = _violation(x, a.operator, a.threshold, scale)
        z[:WARMUP] = np.nan
        stat, hits = cusum_upper(z, ASSUMPTION_CUSUM)
        for w in hits:
            start = change_point(stat, w)
            obs = _last_mean(x[start: w + 1], w + 1 - start)
            alarms.append(Alarm(
                monitor_id=mid, kind="assumption", week=w, policy_id=policy.id, policy_version=policy.version,
                subject=subject,
                message=f"Assumption breached: {a.statement}. Observed {obs:,.4g} {a.variable.spec.unit} since "
                        f"about week {start}; assumed {a.expression()}.",
                evidence={"assumption_id": a.id, "operator": a.operator, "threshold": a.threshold,
                          "observed_since_change": obs, "since_week": start, "scale": round(scale, 6),
                          "cusum_limit": ASSUMPTION_CUSUM.h, "source": a.source, "confidence": a.confidence},
                update={**upd, "observed": obs, "since_week": start}))
        return MonitorState(**base, status="alarm" if hits else "ok", value=_last_mean(x, 1), threshold=a.threshold,
                            statistic=round(float(stat[-1]), 4), limit=ASSUMPTION_CUSUM.h, alarm_weeks=hits,
                            series=_clean(x)), alarms
    # a distribution: does the recent window still look drawn from it?
    assert a.distribution is not None
    sample = a.distribution.sample(np.random.default_rng(17), (4000,))
    hits = []
    breached = False
    for w in range(WARMUP + DISTRIBUTION_WINDOW - 1, week + 1):
        window = x[w - DISTRIBUTION_WINDOW + 1: w + 1]
        p = ks_pvalue(sample, window)
        now = not np.isnan(p) and p < 0.01
        if now and not breached:
            hits.append(w)
            obs = _last_mean(x[: w + 1], DISTRIBUTION_WINDOW)
            alarms.append(Alarm(monitor_id=mid, kind="assumption", week=w, policy_id=policy.id,
                                policy_version=policy.version, subject=subject,
                                message=f"Assumption breached: {a.statement}. The last {DISTRIBUTION_WINDOW} weeks do "
                                        f"not fit {a.distribution} (KS p = {p:.3g}).",
                                evidence={"assumption_id": a.id, "ks_p": p, "observed_since_change": obs,
                                          "since_week": w - DISTRIBUTION_WINDOW + 1},
                                update={**upd, "observed": obs, "since_week": w - DISTRIBUTION_WINDOW + 1}))
        breached = now
    return MonitorState(**base, status="alarm" if hits else "ok", value=_last_mean(x, 1), alarm_weeks=hits,
                        series=_clean(x)), alarms


def _input(mid: str, subject: str, ratio_live: F, ratio_ref: F, week: int, update: dict[str, Any],
           what: str, target: float) -> tuple[MonitorState, list[Alarm]]:
    base: dict[str, Any] = {"id": mid, "kind": "input", "subject": subject,
                            "description": f"{what}, as a ratio to the model's level"}
    x = ratio_live[: week + 1]
    pooled = ratio_ref[:, WARMUP:].ravel()
    pooled = pooled[~np.isnan(pooled)]
    if len(pooled) < 20:
        return MonitorState(**base, status="not_observable"), []
    if week < WARMUP:
        return MonitorState(**base, status="warming_up", series=_clean(x)), []
    mu = float(np.mean(pooled))
    scale = robust_scale(pooled, floor=0.01)
    z_ref = (ratio_ref - mu) / scale
    z_ref[:, :WARMUP] = np.nan
    cusum = Cusum(k=INPUT_K, h=calibrate_limit(z_ref, INPUT_K, target, INPUT_MIN_LIMIT))
    z = (x - mu) / scale
    z[:WARMUP] = np.nan
    up, up_hits = cusum_upper(z, cusum)
    down, down_hits = cusum_upper(-z, cusum)
    stat = np.maximum(up, down)
    hits = sorted([(w, "up") for w in up_hits] + [(w, "down") for w in down_hits])
    alarms = []
    for w, direction in hits:
        start = change_point(up if direction == "up" else down, w)
        win = x[start: w + 1]
        if len(win[~np.isnan(win)]) == 0:  # nothing observed since: fall back to the usual window
            win = x[max(WARMUP, w - INPUT_WINDOW + 1): w + 1]
        recent = _last_mean(win, len(win))
        alarms.append(Alarm(
            monitor_id=mid, kind="input", week=w, subject=subject,
            message=f"{what} has shifted {direction}: ×{recent:.2f} of the model's level since about week {start} "
                    f"(the model says ×{mu:.2f}).",
            evidence={"direction": direction, "since_week": start, "recent_ratio": recent,
                      "reference_ratio": round(mu, 4), "psi": round(psi(pooled, win), 4),
                      "ks_p": ks_pvalue(pooled, win), "cusum_limit": cusum.h},
            update={**update, "ratio": (recent or mu) / mu, "since_week": start}))
    return MonitorState(**base, status="alarm" if hits else "ok", value=_last_mean(x, 1),
                        statistic=round(float(stat[-1]), 4), limit=cusum.h, alarm_weeks=[w for w, _ in hits],
                        series=_clean(x)), alarms


def family_size(lay: Layout) -> int:
    """Input monitors (demand per market, lead time per supplier with lanes) plus the two performance monitors."""
    return int(lay.M) + int(np.sum(~np.isnan(nominal_lead_time(lay)))) + 2


def input_monitors(live: Run, ref: Run, week: int) -> Result:
    out = Result()
    lay = live.lay
    target = FAMILY_TARGET / family_size(lay)
    exp = expected_demand(lay, live.obs.T)  # [T, M]
    for m, mid in enumerate(lay.market_ids):
        st, al = _input(f"input:demand:{mid}", f"demand[{mid}]", live.obs.demand[0, :, m] / exp[:, m],
                        ref.obs.demand[:, :, m] / exp[None, :, m], week,
                        {"variable": "demand", "node": mid}, f"Demand in {mid}", target)
        out.states.append(st)
        out.alarms += al
    nominal = nominal_lead_time(lay)
    for s, sid in enumerate(lay.supplier_ids):
        if np.isnan(nominal[s]):
            continue
        st, al = _input(f"input:lead_time:{sid}", f"lead_time[{sid}]", live.obs.lead_time[0, :, s] / nominal[s],
                        ref.obs.lead_time[:, :, s] / nominal[s], week,
                        {"variable": "lead_time", "supplier": sid}, f"{sid}'s lead time", target)
        out.states.append(st)
        out.alarms += al
    return out


def _rolling(x: F, n: int = 4) -> F:
    """Mean of the last n weeks (fewer at the start), along the last axis."""
    c = np.cumsum(np.nan_to_num(x), axis=-1)
    k = np.cumsum(~np.isnan(x), axis=-1)
    c_lag = np.concatenate([np.zeros_like(c[..., :n]), c[..., :-n]], axis=-1)
    k_lag = np.concatenate([np.zeros_like(k[..., :n]), k[..., :-n]], axis=-1)
    out: F = (c - c_lag) / np.maximum(k - k_lag, 1)
    return out


def _runs(outside: F) -> F:
    """Length of the current run of True, along the last axis."""
    out = np.zeros(outside.shape)
    run = np.zeros(outside.shape[:-1])
    for t in range(outside.shape[-1]):
        run = np.where(outside[..., t], run + 1, 0)
        out[..., t] = run
    return out


def calibrated_run_length(outside_ref: F, target: float) -> int:
    """The shortest run of weeks outside the envelope that fires in at most `target` of the quiet futures."""
    longest = _runs(outside_ref).max(axis=1)
    for n in range(2, 27):
        if float(np.mean(longest >= n)) <= target:
            return n
    return 26


def performance_monitors(live: Run, ref: Run, week: int, scenario_id: str) -> Result:
    out = Result()
    for name, arr_live, arr_ref, side, what in (
            ("service", live.obs.service[0], ref.obs.service, "low", "Fill rate (4-week rolling)"),
            ("cost", live.obs.cost[0], ref.obs.cost, "high", "Cost per week (4-week rolling)")):
        mid = f"performance:{name}"
        base: dict[str, Any] = {"id": mid, "kind": "performance", "subject": name,
                "description": f"{what} against the P5–P95 envelope the stress test predicts ({scenario_id})"}
        roll_ref = _rolling(arr_ref)
        p5, p50, p95 = (np.percentile(roll_ref, q, axis=0) for q in (5, 50, 95))
        bound = p5 if side == "low" else p95
        out_ref = (roll_ref < bound) if side == "low" else (roll_ref > bound)
        out_ref[:, :WARMUP] = False
        need = calibrated_run_length(out_ref, FAMILY_TARGET / family_size(live.lay))
        x = _rolling(arr_live[None, :])[0][: week + 1]
        if week < WARMUP:
            out.states.append(MonitorState(**base, status="warming_up", series=_clean(x)))
            continue
        outside = (x < bound[: week + 1]) if side == "low" else (x > bound[: week + 1])
        outside[:WARMUP] = False
        runs = _runs(outside[None, :])[0]
        hits = [int(w) for w in np.flatnonzero(runs == need)]
        for w in hits:
            out.alarms.append(Alarm(
                monitor_id=mid, kind="performance", week=w, subject=name,
                message=f"{what} has been {'below the P5' if side == 'low' else 'above the P95'} of the stress test's "
                        f"envelope for {need} weeks: {x[w]:,.4g} against {bound[w]:,.4g} (median {p50[w]:,.4g}).",
                evidence={"value": float(x[w]), "p5": float(p5[w]), "p50": float(p50[w]), "p95": float(p95[w]),
                          "weeks_outside": need, "scenario": scenario_id}))
        out.states.append(MonitorState(**base, status="alarm" if hits else "ok", value=float(x[-1]),
                                       threshold=float(bound[week]), statistic=float(runs[-1]), limit=float(need),
                                       alarm_weeks=hits, series=_clean(x)))
    return out


def mandate_monitors(live: Run, policies: list[Policy], week: int) -> Result:
    """An agent hitting its mandate's limits escalates: each limit kind of each policy is an inbox subject."""
    out = Result()
    for p in policies:
        for lim in p.mandate.autonomy:
            kind = lim.kind.value
            mid = f"mandate:{p.id}:{kind}"
            hits_arr = live.obs.limit_hits.get(kind)
            base: dict[str, Any] = {"id": mid, "kind": "mandate", "subject": kind, "policy_id": p.id,
                    "description": f"{p.mandate.agent_id} reaching its {kind} limit ({lim.value:g})"}
            if hits_arr is None:
                out.states.append(MonitorState(**base, status="ok"))
                continue
            h = hits_arr[0][: week + 1]
            weeks = [int(w) for w in np.flatnonzero(h > 0)]
            # one alarm per episode: a week with hits after a week without
            starts = [w for w in weeks if w == 0 or h[w - 1] <= 0]
            for w in starts:
                out.alarms.append(Alarm(
                    monitor_id=mid, kind="mandate", week=w, policy_id=p.id, policy_version=p.version, subject=kind,
                    message=f"{p.mandate.agent_id} wanted to go beyond its mandate ({kind} {lim.value:g}) and "
                            f"escalated to {p.mandate.owner}.",
                    evidence={"limit": kind, "value": lim.value, "hits_this_week": float(h[w])}))
            out.states.append(MonitorState(**base, status="alarm" if starts else "ok", value=float(h[-1]),
                                           alarm_weeks=starts, series=_clean(h)))
    return out


def run_monitors(live: Run, ref: Run, policies: list[Policy], week: int, scenario_id: str = "baseline") -> Result:
    """Every monitor, up to and including `week`."""
    out = Result()
    for p in policies:
        for a in p.assumptions:
            st, al = assumption_monitor(a, p, live, ref, week)
            out.states.append(st)
            out.alarms += al
    for part in (input_monitors(live, ref, week), performance_monitors(live, ref, week, scenario_id),
                 mandate_monitors(live, policies, week)):
        out.states += part.states
        out.alarms += part.alarms
    out.alarms.sort(key=lambda a: (a.week, a.monitor_id))
    return out
