"""Evaluation results: the report object an evaluation run produces, as typed, JSON-serialisable models.

The report holds numbers only. Every sentence in the verdict is generated deterministically from these numbers, and
an optional LLM narrative (later) may cite only numbers present here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import AwareDatetime, Field

from core.domain.common import Model


class Stat(Model):
    """A metric's distribution over replications. CVaR is the mean of the worst tail, in the bad direction."""

    mean: float | None
    p5: float | None
    p50: float | None
    p95: float | None
    cvar: float | None
    n: int


class MetricMeta(Model):
    label: str
    unit: str
    higher_is_better: bool
    group: str


class ConstraintRow(Model):
    id: str
    text: str
    description: str
    breach_share: float = Field(description="Share of replications breaching the constraint")
    passed: bool = Field(description="breach_share ≤ α")
    worst: float | None = Field(description="Worst value seen, in the metric's unit")
    median: float | None


class Fan(Model):
    """Percentile bands of a per-period series over time (weeks after the warm-up)."""

    p5: list[float]
    p25: list[float]
    p50: list[float]
    p75: list[float]
    p95: list[float]


class PolicyRun(Model):
    policy: str = Field(description="candidate, incumbent, naive or rolling_opt")
    replications: int
    subsample: bool = Field(description="Run on the first replications only (rolling optimisation)")
    metrics: dict[str, Stat]
    constitution: list[ConstraintRow]
    samples: dict[str, list[float | None]] = Field(
        description="Per-replication values, for violin and scatter plots; null where undefined (no shock)")
    fans: dict[str, Fan]
    regret: dict[str, Stat] = Field(default_factory=dict, description="Against the best policy in each replication")
    solver: dict[str, Any] | None = None


class ScenarioRun(Model):
    scenario_id: str
    name: str
    description: str
    normal: bool = Field(description="No disruption: the scenario stands for normal conditions")
    runs: list[PolicyRun]

    def run(self, policy: str) -> PolicyRun | None:
        return next((r for r in self.runs if r.policy == policy), None)


class Reason(Model):
    level: Literal["reject", "condition", "info"]
    text: str
    scenario: str | None = None
    constraint: str | None = None
    objective: str | None = None


class Comparison(Model):
    """Candidate against incumbent on one objective, averaged over scenarios."""

    objective: str
    metric: str
    measure: Literal["cvar", "mean"]
    unit: str
    candidate: float | None
    incumbent: float | None
    outcome: Literal["better", "worse", "same", "n/a"]


class Verdict(Model):
    decision: Literal["approve", "approve_with_conditions", "reject", "none"]
    reasons: list[Reason]
    comparisons: list[Comparison]


class EvaluationReport(Model):
    id: str = Field(description="Hash of every input: the same id means the same run")
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))
    network: str
    constitution_ref: str
    breach_alpha: float
    risk_measure: str
    risk_level: float
    candidate_id: str | None
    candidate: dict[str, Any] | None = Field(description="The candidate policy as JSON")
    policies: list[str]
    scenario_set: str
    replications: int
    periods: int
    seed: int
    warmup: int
    rolling: dict[str, Any] = Field(default_factory=dict, description="Rolling-optimisation settings")
    metric_info: dict[str, MetricMeta]
    scenarios: list[ScenarioRun]
    verdict: Verdict
    notes: list[str] = Field(default_factory=list)
    seconds: float = 0.0
