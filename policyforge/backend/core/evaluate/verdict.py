"""The robustness verdict: approve, approve with conditions, or reject, with reasons built from the numbers.

Rules (D027):
1. A hard constraint breached in more than α of replications under **normal conditions** → reject.
2. Breached beyond α under **stress** → a condition, but only where the candidate breaches it in a larger share of
   replications than the incumbent (by more than 2 pp). A breach the incumbent has as well is reported for
   information: under stress, approval judges the change, not the network (D027).
3. Candidate against incumbent, **lexicographically** in the constitution's priority order, each objective on its
   risk measure averaged over scenarios: the first objective that differs beyond its tolerance decides. Worse →
   reject; better → noted. If none differs → noted.
4. In any single scenario, a fill-rate CVaR more than 0.5 pp below the incumbent's → a condition.
5. Escalations are reported for information.
Any reject → reject; else any condition → approve with conditions; else approve.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from core.domain.constitution import Constitution, Objective
from core.domain.results import Comparison, Reason, ScenarioRun, Verdict


@dataclass(frozen=True)
class ObjectiveRule:
    metric: str
    measure: Literal["cvar", "mean"]
    unit: str
    higher_is_better: bool
    tolerance: float
    relative: bool  # tolerance as a share of the incumbent's value


OBJECTIVES: dict[Objective, ObjectiveRule] = {
    Objective.service: ObjectiveRule("fill_rate", "cvar", "fraction", True, 0.002, False),
    Objective.resilience: ObjectiveRule("peak_service_loss", "cvar", "fraction", False, 0.002, False),
    Objective.cost: ObjectiveRule("cost_per_week", "cvar", "EUR/week", False, 0.005, True),
    Objective.carbon: ObjectiveRule("co2_t", "mean", "t CO2e", False, 0.01, True),
}
SCENARIO_SERVICE_TOLERANCE = 0.005
BREACH_TOLERANCE = 0.02  # how much more often than the incumbent a stress breach must happen to count


def _fmt(x: float, unit: str) -> str:
    if unit == "fraction":
        return f"{x:.1%}"
    if unit.startswith("EUR"):
        return f"€{x:,.0f}{unit[3:]}"
    return f"{x:,.2f} {unit}"


def _measure(runs: list[ScenarioRun], policy: str, rule: ObjectiveRule) -> float | None:
    vals = []
    for sc in runs:
        r = sc.run(policy)
        if r is None or rule.metric not in r.metrics:
            continue
        stat = r.metrics[rule.metric]
        v = stat.cvar if rule.measure == "cvar" else stat.mean
        if v is not None:
            vals.append(v)
    return float(np.mean(vals)) if vals else None


def decide(scenarios: list[ScenarioRun], constitution: Constitution, candidate: str = "candidate",
           incumbent: str = "incumbent") -> Verdict:
    if not any(sc.run(candidate) for sc in scenarios):
        return Verdict(decision="none", reasons=[Reason(level="info", text="No candidate policy was evaluated.")],
                       comparisons=[])
    reasons: list[Reason] = []
    alpha = constitution.breach_alpha

    # 1, 2: hard constraints
    for sc in scenarios:
        run, base = sc.run(candidate), sc.run(incumbent)
        assert run is not None
        base_rows = {c.id: c for c in base.constitution} if base else {}
        for c in run.constitution:
            if c.passed:
                continue
            what = f"“{c.description or c.text}” in {c.breach_share:.1%} of replications"
            if sc.normal:
                reasons.append(Reason(level="reject", scenario=sc.scenario_id, constraint=c.id,
                                      text=f"Breaches {what} under normal conditions, above α = {alpha:.0%}."))
                continue
            inc = base_rows.get(c.id)
            if inc is not None and c.breach_share <= inc.breach_share + BREACH_TOLERANCE:
                how = (f"fewer than the incumbent's {inc.breach_share:.1%}: improved by this policy"
                       if c.breach_share < inc.breach_share - BREACH_TOLERANCE
                       else f"as the incumbent does ({inc.breach_share:.1%}): not made worse by this policy")
                reasons.append(Reason(level="info", scenario=sc.scenario_id, constraint=c.id,
                                      text=f"Under {sc.name}, breaches {what}, {how}."))
            else:
                was = f", against the incumbent's {inc.breach_share:.1%}" if inc is not None else ""
                reasons.append(Reason(level="condition", scenario=sc.scenario_id, constraint=c.id,
                                      text=f"Under {sc.name}, breaches {what}{was}, above α = {alpha:.0%}."))

    # 3: lexicographic comparison with the incumbent
    comparisons: list[Comparison] = []
    decided = False
    for obj in constitution.priorities:
        rule = OBJECTIVES[obj]
        cand_v, inc_v = _measure(scenarios, candidate, rule), _measure(scenarios, incumbent, rule)
        if cand_v is None or inc_v is None:
            comparisons.append(Comparison(objective=obj, metric=rule.metric, measure=rule.measure, unit=rule.unit,
                                          candidate=cand_v, incumbent=inc_v, outcome="n/a"))
            continue
        tol = rule.tolerance * abs(inc_v) if rule.relative else rule.tolerance
        diff = (cand_v - inc_v) if rule.higher_is_better else (inc_v - cand_v)  # > 0: candidate better
        outcome: Literal["better", "worse", "same"] = "better" if diff > tol else "worse" if diff < -tol else "same"
        comparisons.append(Comparison(objective=obj, metric=rule.metric, measure=rule.measure, unit=rule.unit,
                                      candidate=cand_v, incumbent=inc_v, outcome=outcome))
        if decided or outcome == "same":
            continue
        decided = True
        label = f"{rule.metric.replace('_', ' ')} ({'CVaR' if rule.measure == 'cvar' else 'mean'})"
        text = (f"{'Better' if outcome == 'better' else 'Worse'} than the incumbent on {obj}, the first priority "
                f"where they differ: {label} {_fmt(cand_v, rule.unit)} against {_fmt(inc_v, rule.unit)}.")
        reasons.append(Reason(level="info" if outcome == "better" else "reject", objective=obj, text=text))
    if not decided:
        reasons.append(Reason(level="info", text="No material difference from the incumbent on any objective."))

    # 4: no scenario where service falls clearly behind the incumbent
    for sc in scenarios:
        c_run, i_run = sc.run(candidate), sc.run(incumbent)
        if c_run is None or i_run is None:
            continue
        cv, iv = c_run.metrics["fill_rate"].cvar, i_run.metrics["fill_rate"].cvar
        if cv is not None and iv is not None and iv - cv > SCENARIO_SERVICE_TOLERANCE:
            reasons.append(Reason(level="condition", scenario=sc.scenario_id, objective="service",
                                  text=f"Under {sc.name}, the worst-case fill rate (CVaR) is {cv:.1%} against the "
                                       f"incumbent's {iv:.1%}."))

    # 5: governance, for information
    for sc in scenarios:
        c_run = sc.run(candidate)
        esc = c_run.metrics.get("escalations") if c_run else None
        if esc is not None and esc.mean:
            reasons.append(Reason(level="info", scenario=sc.scenario_id,
                                  text=f"Under {sc.name}, the agent escalates {esc.mean:.1f} times per replication "
                                       f"on average."))

    levels = {r.level for r in reasons}
    decision: Literal["approve", "approve_with_conditions", "reject"] = (
        "reject" if "reject" in levels else "approve_with_conditions" if "condition" in levels else "approve")
    return Verdict(decision=decision, reasons=reasons, comparisons=comparisons)
