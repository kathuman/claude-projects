"""Your first stress test: the tutorial's code, end to end.

Compares the incumbent replenishment policy with a candidate that adds a sourcing switch (move 30 % of Supplier B's
ambient volume to Supplier C when B's fill rate stays under 90 % for three weeks), on four scenarios, with common
random numbers. Run from backend/:

    python -m examples.first_stress_test            # 300 replications × 104 weeks, about 15 s
    python -m examples.first_stress_test --reps 50  # quicker

The summary metrics here are deliberately simple; Phase 3 adds the full metric set and the evaluation report.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np

from core.baselines import incumbent_policies
from core.domain.condition import Condition
from core.domain.examples import EPOCH, default_constitution
from core.domain.mandate import DEFAULT_TERM, AuthorityLimit, LimitKind, Mandate
from core.domain.network import load_foodnet
from core.domain.policy import Policy, Scope, SourcingSwitch
from core.domain.vocabulary import Variable, VarRef
from core.sim.engine import SimResult, simulate
from core.sim.layout import Layout, build_layout
from core.sim.program import compile_program
from core.sim.scenarios import default_suite, generate

SCENARIOS = ["baseline", "supplier-b-outage", "correlated-shock", "lead-time-inflation"]
WARMUP = 8  # weeks left out of the statistics while the system settles


# ---- step 2: the candidate policy, written in the DSL
def candidate_policy() -> Policy:
    fill_b = VarRef(var=Variable.supplier_fill_rate, supplier="SUP_B")
    return Policy(
        id="b-to-c-switch",
        name="Shift ambient volume from B to C when B under-delivers",
        intent_text="If Supplier B misses more than 10% of orders for three weeks running, shift ambient volume to "
                    "Supplier C, don't switch back for a month, and the sourcing agent can do this alone up to 30% "
                    "of volume.",
        scope=Scope(categories=["ambient"]),
        rule=SourcingSwitch(
            primary="SUP_B", secondary="SUP_C",
            trigger=Condition(var=fill_b, op="lt", threshold=0.90, for_periods=3),
            switch_back=Condition(var=fill_b, op="ge", threshold=0.90, for_periods=2),
            shift_fraction=0.30, min_dwell_periods=4,
        ),
        mandate=Mandate(owner="Planning manager", approver="Head of supply chain", agent_id="sourcing-agent-01",
                        autonomy=[AuthorityLimit(kind=LimitKind.volume_shift_pct, value=30)],
                        valid_from=EPOCH, expires_at=EPOCH + DEFAULT_TERM),
        constitution_ref=default_constitution().ref,
    )


# ---- step 4: a few numbers per run
@dataclass
class Summary:
    fill: float  # mean fill rate over replications
    fill_p5: float  # 5th percentile: the bad futures
    chilled_fill: float
    cost_per_week: float  # EUR
    switches: float  # sourcing switches per replication
    escalations: float  # per replication


def fill_rate(res: SimResult, skus: np.ndarray | None = None) -> np.ndarray:
    """Per replication: share of demand met from stock in the period it arose (backlog is served first)."""
    dem = res.demand[:, WARMUP:]
    short = np.minimum(dem, res.backorders[:, WARMUP:] + res.lost[:, WARMUP:])
    if skus is not None:
        dem, short = dem[..., skus], short[..., skus]
    out: np.ndarray = 1 - short.sum(axis=(1, 2, 3)) / dem.sum(axis=(1, 2, 3))
    return out


def summarise(res: SimResult, lay: Layout) -> Summary:
    f = fill_rate(res)
    return Summary(fill=float(f.mean()), fill_p5=float(np.percentile(f, 5)),
                   chilled_fill=float(fill_rate(res, lay.chilled).mean()),
                   cost_per_week=float(res.total_cost[:, WARMUP:].mean()),
                   switches=float(res.switches.sum(axis=1).mean()),
                   escalations=float(res.escalations.sum(axis=1).mean()))


def run(reps: int = 300, seed: int = 42) -> dict[str, dict[str, Summary]]:
    # ---- step 1: the network
    lay = build_layout(load_foodnet())
    # ---- step 2: the incumbent (base stock: 35 days of cover at plants; at DCs 10 days, 12 for chilled SKUs) and the
    # candidate on top of it
    incumbent = incumbent_policies(lay)
    policies = {"incumbent": incumbent, "candidate": [*incumbent, candidate_policy()]}
    # ---- step 3: the same futures for both policies (common random numbers)
    suite = {s.id: s for s in default_suite().scenarios}
    out: dict[str, dict[str, Summary]] = {}
    for sid in SCENARIOS:
        draws = generate(lay, suite[sid], R=reps, T=104, seed=seed)
        out[sid] = {name: summarise(simulate(lay, draws, compile_program(lay, pols)), lay)
                    for name, pols in policies.items()}
    return out


def table(results: dict[str, dict[str, Summary]]) -> str:
    rows = [f"{'scenario':22s} {'policy':10s} {'fill':>6s} {'P5':>6s} {'chilled':>8s} {'EUR/week':>9s} "
            f"{'switches':>8s} {'escal.':>6s}"]
    for sid, by in results.items():
        for name, s in by.items():
            rows.append(f"{sid:22s} {name:10s} {s.fill:6.1%} {s.fill_p5:6.1%} {s.chilled_fill:8.1%} "
                        f"{s.cost_per_week:9,.0f} {s.switches:8.1f} {s.escalations:6.1f}")
    return "\n".join(rows)


def main() -> None:  # pragma: no cover - exercised through run() in the tests
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--reps", type=int, default=300)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    print(candidate_policy().rule.model_dump_json(indent=2))
    print()
    print(table(run(args.reps, args.seed)))


if __name__ == "__main__":  # pragma: no cover
    main()
