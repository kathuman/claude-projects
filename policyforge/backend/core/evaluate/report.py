"""Export an EvaluationReport as Markdown: verdict, constitution, key KPIs per scenario, regret and notes.

Every number has its unit, and every table has a sentence on how to read it. PDF export comes with the frontend.
"""

from __future__ import annotations

from core.domain.results import EvaluationReport, MetricMeta, Stat

KEY_METRICS = ("fill_rate", "fill_rate.category.chilled", "otif", "cost_per_week", "expedite_month_max",
               "peak_service_loss", "recovery_periods", "bullwhip_dc", "co2_t", "escalations")
DECISION = {"approve": "APPROVE", "approve_with_conditions": "APPROVE WITH CONDITIONS", "reject": "REJECT",
            "none": "NO CANDIDATE"}


def fmt(x: float | None, unit: str) -> str:
    if x is None:
        return "—"
    if unit == "fraction":
        return f"{x:.1%}"
    if unit.startswith("EUR"):
        return f"€{x:,.0f}"
    if unit in ("periods", "ratio", "count", "switches"):
        return f"{x:,.2f}"
    return f"{x:,.1f}"


def _cell(s: Stat | None, m: MetricMeta) -> str:
    if s is None or s.mean is None:
        return "—"
    return f"{fmt(s.mean, m.unit)} ({fmt(s.p5, m.unit)}–{fmt(s.p95, m.unit)})"


def to_markdown(rep: EvaluationReport) -> str:
    out = [
        f"# Evaluation report {rep.id}",
        "",
        f"- **Candidate:** {rep.candidate_id or 'none'}",
        f"- **Network:** {rep.network} · **Constitution:** {rep.constitution_ref} (α = {rep.breach_alpha:.0%}, "
        f"risk: {rep.risk_measure.upper()} at {rep.risk_level:.0%})",
        f"- **Scenarios:** {rep.scenario_set}, {len(rep.scenarios)} scenarios · **Replications:** {rep.replications} "
        f"× {rep.periods} periods, seed {rep.seed}, first {rep.warmup} periods left out",
        f"- **Policies:** {', '.join(rep.policies)} · created {rep.created_at:%Y-%m-%d %H:%M} UTC "
        f"in {rep.seconds:.0f} s",
        "",
        f"## Verdict: {DECISION[rep.verdict.decision]}",
        "",
    ]
    for r in rep.verdict.reasons:
        out.append(f"- **{r.level}:** {r.text}")
    if rep.verdict.comparisons:
        out += ["", "Candidate against incumbent, in the constitution's priority order (averaged over scenarios):", "",
                "| Objective | Measure | Candidate | Incumbent | Outcome |", "|---|---|---|---|---|"]
        for c in rep.verdict.comparisons:
            out.append(f"| {c.objective} | {c.metric} ({c.measure}) | {fmt(c.candidate, c.unit)} | "
                       f"{fmt(c.incumbent, c.unit)} | {c.outcome} |")

    out += ["", "## Constitution", "",
            "Share of replications breaching each hard constraint. A constraint passes when the share is at most α.",
            ""]
    pols = rep.policies
    out += ["| Scenario | Constraint | " + " | ".join(pols) + " |", "|---|---|" + "---|" * len(pols)]
    for sc in rep.scenarios:
        first = sc.runs[0].constitution
        for i, con in enumerate(first):
            cells = []
            for p in pols:
                run = sc.run(p)
                row = run.constitution[i] if run else None
                cells.append("—" if row is None else f"{row.breach_share:.0%} {'✓' if row.passed else '✗'}")
            out.append(f"| {sc.name} | {con.description or con.text} | " + " | ".join(cells) + " |")

    out += ["", "## Key results by scenario", "",
            "Each cell is the mean over replications, with the 5th–95th percentile range in brackets.", ""]
    for sc in rep.scenarios:
        out += [f"### {sc.name}", "", sc.description, "",
                "| Metric | " + " | ".join(r.policy + (" (subsample)" if r.subsample else "") for r in sc.runs) + " |",
                "|---|" + "---|" * len(sc.runs)]
        for k in KEY_METRICS:
            m = rep.metric_info.get(k)
            if m is None:
                continue
            out.append(f"| {m.label} ({m.unit}) | " + " | ".join(_cell(r.metrics.get(k), m) for r in sc.runs) + " |")
        regret_rows = [r for r in sc.runs if r.regret]
        if regret_rows:
            out += ["", "Regret against the best policy in each replication (mean):", "",
                    "| Policy | Cost regret over the horizon (EUR) | Fill-rate regret |", "|---|---|---|"]
            for pr in regret_rows:
                out.append(f"| {pr.policy} | {fmt(pr.regret['cost_total'].mean, 'EUR')} | "
                           f"{fmt(pr.regret['fill_rate'].mean, 'fraction')} |")
        out.append("")
    if rep.notes:
        out += ["## Notes", ""] + [f"- {n}" for n in rep.notes]
    return "\n".join(out) + "\n"
