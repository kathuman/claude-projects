"""Evaluate the tutorial's candidate on the default suite and write the report as Markdown and JSON.

    python -m examples.evaluate_report                      # 500 replications, about 4 minutes
    python -m examples.evaluate_report --reps 100 --out /tmp

The Markdown is what a planner reads; the JSON is the full report object (every distribution, sample and fan) that
the frontend will chart.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from core.domain.examples import default_constitution
from core.evaluate.report import to_markdown
from core.evaluate.run import evaluate
from core.sim.scenarios import default_suite
from examples.first_stress_test import candidate_policy


def main() -> None:  # pragma: no cover - a command-line wrapper around evaluate()
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--reps", type=int, default=500)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "docs")
    args = ap.parse_args()
    rep = evaluate(candidate_policy(), default_constitution(), default_suite(), replications=args.reps,
                   seed=args.seed, progress=lambda m: print(m, flush=True))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "example-report.md").write_text(to_markdown(rep), encoding="utf-8")
    (args.out / "example-report.json").write_text(rep.model_dump_json(), encoding="utf-8")
    print(f"verdict: {rep.verdict.decision} · {rep.seconds:.0f} s · written to {args.out}")


if __name__ == "__main__":  # pragma: no cover
    main()
