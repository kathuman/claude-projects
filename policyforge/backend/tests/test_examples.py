"""The tutorial's example keeps running, and keeps telling the story the tutorial tells."""

from __future__ import annotations

from examples.first_stress_test import SCENARIOS, candidate_policy, run, table


def test_tutorial_example_runs_and_the_switch_helps_in_an_outage() -> None:
    res = run(reps=60)
    assert set(res) == set(SCENARIOS)
    out = res["supplier-b-outage"]
    assert out["candidate"].fill > out["incumbent"].fill
    assert out["candidate"].switches > 0 and out["incumbent"].switches == 0
    assert res["baseline"]["incumbent"].fill > res["correlated-shock"]["incumbent"].fill_p5
    assert "supplier-b-outage" in table(res)
    assert candidate_policy().rule.type == "sourcing_switch"


def test_monitor_demo_catches_the_capacity_loss_and_re_tests() -> None:
    from examples.monitor_demo import BITES_AT
    from examples.monitor_demo import run as run_demo

    out = run_demo(replications=20, quiet=True)
    assert BITES_AT <= out["alert_week"] <= BITES_AT + 4
    top = out["inbox"][0]
    assert top.kind == "assumption" and "spare capacity" in top.message
    change = out["retest"].retest.changes[0]
    assert change.path == "suppliers.2.capacity_per_period" and 750 < change.after < 900
    mild = run_demo(quiet=True, severity=0.4)  # C keeps 1,200 units: the assumption holds
    assert mild["alert_week"] is None and mild["retest"] is None
    assert not [a for a in mild["inbox"] if a.kind == "assumption"]
