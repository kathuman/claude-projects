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
