"""An optional plain-language summary of an evaluation report, which may cite only numbers in the report.

The model is given a compact view of the report (verdict, comparisons, constitution table, key metrics per scenario)
and asked for a short summary. Every number in its text is then checked against the numbers in that same view, in
the forms they are displayed (0.953 may be written 0.953, 95.3% or 95%; 31310.2 may be written €31,310). If any
number is not found, the model is asked once more, with the offending numbers named. If it still invents one, no
summary is shown.
"""

from __future__ import annotations

import json
import re
from typing import Any

from core.domain.common import Model
from core.domain.results import EvaluationReport
from core.llm.prompts import NARRATIVE_SYSTEM
from core.llm.provider import LLMError, LLMProvider

KEY_METRICS = ("fill_rate", "fill_rate.category.chilled", "otif", "cost_per_week", "expedite_month_max",
               "peak_service_loss", "co2_t", "escalations")
NUMBER = re.compile(r"(?<![\w.])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?%?")


class Narrative(Model):
    text: str | None
    accepted: bool
    invented: list[str]
    attempts: int


def report_view(rep: EvaluationReport) -> dict[str, Any]:
    """The compact view the model sees, and the numbers it may cite."""
    scenarios = []
    for sc in rep.scenarios:
        runs = {}
        for r in sc.runs:
            runs[r.policy] = {k: {"mean": s.mean, "p5": s.p5, "p95": s.p95, "cvar": s.cvar}
                              for k, s in r.metrics.items() if k in KEY_METRICS}
            runs[r.policy]["breaches"] = {c.id: c.breach_share for c in r.constitution}
        scenarios.append({"scenario": sc.name, "normal": sc.normal, "policies": runs})
    return {
        "candidate": rep.candidate_id,
        "verdict": rep.verdict.decision,
        "reasons": [r.text for r in rep.verdict.reasons],
        "comparison": [c.model_dump() for c in rep.verdict.comparisons],
        "breach_alpha": rep.breach_alpha,
        "replications": rep.replications,
        "scenarios": scenarios,
    }


def _forms(v: float) -> set[str]:
    out = {f"{v:g}", f"{v:.0f}", f"{v:.1f}", f"{v:.2f}", f"{v:.3f}"}
    if abs(v) <= 1.5:
        p = v * 100
        out |= {f"{p:.0f}%", f"{p:.1f}%", f"{p:.2f}%"}
    return out


def allowed_numbers(view: Any) -> set[str]:
    found: set[str] = set()

    def walk(x: Any) -> None:
        if isinstance(x, bool) or x is None:
            return
        if isinstance(x, int | float):
            found.update(_forms(float(x)))
        elif isinstance(x, str):
            for m in NUMBER.finditer(x):
                found.add(_norm(m.group()))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(view)
    return found


def _norm(s: str) -> str:
    return s.replace(",", "").replace(" ", "")


def invented_numbers(text: str, view: dict[str, Any]) -> list[str]:
    allowed = allowed_numbers(view)
    out = []
    for m in NUMBER.finditer(text):
        raw = m.group().strip()
        if _norm(raw) not in allowed:
            out.append(raw)
    return out


def narrate(rep: EvaluationReport, provider: LLMProvider) -> Narrative:
    view = report_view(rep)
    body = json.dumps(view, ensure_ascii=False)
    messages: list[dict[str, Any]] = [{"role": "user", "content": body}]
    for attempt in (1, 2):
        try:
            resp = provider.generate(system=NARRATIVE_SYSTEM, messages=messages, schema=None, purpose="narrative",
                                     trace_key=rep.id)
        except LLMError:
            return Narrative(text=None, accepted=False, invented=[], attempts=attempt)
        bad = invented_numbers(resp.text, view)
        if not bad:
            return Narrative(text=resp.text.strip(), accepted=True, invented=[], attempts=attempt)
        messages = [*messages, {"role": "assistant", "content": resp.text},
                    {"role": "user", "content": "These numbers are not in the report: " + ", ".join(bad)
                     + ". Rewrite the summary using only numbers that appear in the report."}]
    return Narrative(text=None, accepted=False, invented=bad, attempts=2)
