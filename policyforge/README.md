# PolicyForge

A policy authoring and simulation workbench for supply chain managers who delegate execution to AI agents.

- **What it does:** you state an intent. It becomes a typed, bounded decision rule with a mandate (what the agent
  may decide alone, and when it must escalate). The rule is then stress-tested against the incumbent across
  thousands of futures, approved, and monitored.
- **Pages:** [about](https://kathuman.github.io/claude-projects/policyforge/) ·
  [tutorial](https://kathuman.github.io/claude-projects/policyforge/tutorial.html)
- **Status:** v0.4.0, early development. Phases 1–4 of 8 (plus the planned P5b) are done: domain and data, the
  simulator, baselines with evaluation, and the LLM compiler. There is no web interface yet. See [STATUS.md](STATUS.md) and the roadmap on the about
  page.

## Run it

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv -e ".[dev]"
.venv/bin/python -m pytest -q              # 125 tests
.venv/bin/python -m examples.first_stress_test
.venv/bin/python -m examples.evaluate_report  # full verdict report into docs/
.venv/bin/python -m examples.compile_intent   # intent → policy, offline; --live "..." with a key
```

Or use `make check` from this folder to run ruff, `mypy --strict` and the tests with coverage.

## Layout

```
backend/core/domain/     policy DSL, mandate, assumptions, constitution, network, scenarios (Pydantic v2)
backend/core/sim/        vectorised simulator, executors, policy compilation, scenario generators
backend/core/baselines/  incumbent, naive, rolling optimisation (Pyomo + HiGHS)
backend/core/evaluate/   metrics, constitution check, verdict, report runner, Markdown export
backend/core/llm/        provider interface, Anthropic provider, mock, prompts, compiler, narrative
backend/core/validate/   deterministic policy validator (errors and warnings)
backend/data/foodnet/    the synthetic network (YAML, schema, README)
backend/schemas/         exported JSON Schemas
backend/examples/        the tutorial's runnable example, and the example report
backend/tests/           pytest + Hypothesis
docs/                    PLAN.md, DSL_REFERENCE.md (generated), example-report.md
DECISIONS.md, STATUS.md  design log and phase status
index.html, tutorial.html  the about page and tutorial on GitHub Pages
```

All data is synthetic.
