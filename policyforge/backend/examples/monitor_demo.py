"""The §10 demo, step 6: monitor a deployed policy, catch a broken assumption, re-test it.

Run from backend/:  python -m examples.monitor_demo

1. The demo intent compiles (offline, from the recorded answer) into a B → C sourcing switch with three assumptions,
   one of them "Supplier C has spare capacity of at least 1,100 units a week". It is evaluated, approved and deployed.
2. A live stream starts. At week 10, Supplier C quietly loses 60 % of its capacity from week 20.
3. The stream runs week by week until the inbox has an alert; the assumption monitor fires and tops the inbox.
4. One click re-runs the stress test on the network as observed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from core.domain.examples import default_constitution
from core.domain.network import load_foodnet
from core.domain.scenario import SupplierOutage, Window
from core.llm.compiler import compile_intent
from core.llm.mock import load_fixtures
from core.registry.monitoring import AlertView, Monitoring
from core.registry.registry import seeded
from core.registry.store import make_engine

INTENTS = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "intents"
INJECT_AT, BITES_AT, SEVERITY = 10, 20, 0.6


def run(seed: int = 1, replications: int = 100, quiet: bool = False, severity: float = SEVERITY) -> dict[str, Any]:
    say = (lambda *_: None) if quiet else print
    reg = seeded(make_engine())
    intent = json.loads((INTENTS / "05-demo-b-to-c-30.json").read_text(encoding="utf-8"))["intent"]
    policy = compile_intent(intent, provider=load_fixtures(INTENTS), net=load_foodnet(),
                            constitution=default_constitution()).policy
    reg.create_policy(policy, "strategist")
    reg.evaluate(policy.id, 1, "tester", replications=20, periods=104, rolling_reps=2)
    reg.approve(policy.id, 1, "Head of supply chain")
    reg.deploy(policy.id, 1, "operator")
    say(f"Deployed {policy.name!r} with {len(policy.assumptions)} assumptions:")
    for a in policy.assumptions:
        say(f"  - {a.statement}  [{a.expression()}]")

    mon = Monitoring(reg)
    st = mon.create_stream("operator", seed=seed)
    mon.step(st.id, INJECT_AT - 1, "operator")
    mon.inject(st.id, SupplierOutage(supplier="SUP_C", window=Window(start=BITES_AT), severity=severity), "trainer",
               note="quietly")
    say(f"\nWeek {INJECT_AT}: Supplier C will lose {severity:.0%} of its capacity from week {BITES_AT} "
        "(hidden from the monitors).")
    raised: list[AlertView] = []
    week = INJECT_AT - 1
    while not any(a.kind == "assumption" for a in raised) and week < 60:
        raised += mon.step(st.id, 1, "operator")
        week += 1
    inbox = mon.alerts("active")
    if not any(a.kind == "assumption" for a in raised):
        say(f"Week {week}: no assumption alert. Supplier C still has the capacity the policy assumes.")
        return {"policy": policy, "alert_week": None, "inbox": inbox, "retest": None}
    say(f"Week {week}: the assumption monitor fired, {week - BITES_AT} week(s) after the capacity loss.")
    for i, a in enumerate(inbox, start=1):
        say(f"  {i}. [{a.severity}] score {a.score:,.0f}  {a.message}")
        say(f"     reversibility {a.reversibility}, exposure €{a.exposure_eur_per_week:,.0f}/week ({a.basis})")
    top = next(a for a in inbox if a.kind == "assumption")
    rt = mon.run_retest(top.id, "planner", replications=replications, periods=104)
    say("\nRe-test on the network as observed:")
    for c in rt.retest.changes:
        say(f"  {c.path}: {c.before} → {c.after} ({c.why})")
    say(f"  verdict: {rt.verdict.upper()}")
    for r in rt.retest.report.verdict.reasons[:4]:
        say(f"  - {r.text}")
    return {"policy": policy, "alert_week": week, "inbox": inbox, "retest": rt}


if __name__ == "__main__":  # pragma: no cover
    run(seed=int(sys.argv[1]) if len(sys.argv) > 1 else 1)
