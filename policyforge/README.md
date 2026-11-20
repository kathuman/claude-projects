# PolicyForge

A policy authoring and simulation workbench for supply chain managers who delegate execution to AI agents.

- **What it does:** you state an intent. It becomes a typed, bounded decision rule with a mandate (what the agent
  may decide alone, and when it must escalate). The rule is then stress-tested against the incumbent across
  thousands of futures, approved, and monitored.
- **Pages:** [about](https://kathuman.github.io/claude-projects/policyforge/) ·
  [tutorial](https://kathuman.github.io/claude-projects/policyforge/tutorial.html) ·
  [Network Studio](https://kathuman.github.io/claude-projects/policyforge/frontend/dist/index.html)
- **Status:** v0.7.0, early development. Phases 1–6 are done: domain and data, the simulator, baselines with
  evaluation, the LLM compiler, the registry with its API, the Network Studio (a visual editor for networks and
  scenarios), and monitoring (a live stream, drift monitors, a ranked escalation inbox and one-click re-tests).
  Next: P7, the remaining screens. See [STATUS.md](STATUS.md) and the roadmap on the about page.

## Run it

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv -e ".[dev]"
.venv/bin/python -m pytest -q              # 179 tests
.venv/bin/python -m examples.first_stress_test
.venv/bin/python -m examples.evaluate_report  # full verdict report into docs/
.venv/bin/python -m examples.compile_intent   # intent → policy, offline; --live "..." with a key
.venv/bin/python -m examples.monitor_demo     # deploy, inject a capacity loss, catch it, re-test
.venv/bin/python -m uvicorn api.app:app        # the API on http://127.0.0.1:8000 (docs at /docs)
```

Or use `make check` from this folder to run ruff, `mypy --strict` and the tests with coverage.

### The Network Studio

The built Studio is committed in `frontend/dist`, so the API serves it at http://127.0.0.1:8000/app/ with no
build step. To work on it (Node 22):

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173, proxying the API on port 8000
npx vitest run     # unit tests, including the shared broken networks
npm run e2e        # build, start the API on port 8765 with a fresh database, run Playwright
npm run build      # refresh frontend/dist after changes
```

The Python models stay the one source of truth: the Studio reads the JSON Schemas exported to `backend/schemas/`
(`make schemas` refreshes them; CI fails if they are stale).

## Layout

```
backend/core/domain/     policy DSL, mandate, assumptions, constitution, network, scenarios (Pydantic v2);
                         network checks with paths, health, CSV templates
backend/core/sim/        vectorised simulator, executors, policy compilation, scenario generators
backend/core/baselines/  incumbent, naive, rolling optimisation (Pyomo + HiGHS)
backend/core/evaluate/   metrics, constitution check, verdict, report runner, Markdown export
backend/core/llm/        provider interface, Anthropic provider, mock, prompts, compiler, narrative
backend/core/validate/   deterministic policy validator (errors and warnings)
backend/core/monitor/    live stream, observations, reference, drift monitors, inbox ranking, re-test
backend/core/registry/   versioned networks, constitutions, policies; lifecycle gate; hash-chained audit log;
                         streams, alerts and re-tests
backend/api/             FastAPI app: networks (check, quick test, CSV/YAML), scenario sets, constitutions,
                         compile, policies, evaluations, streams, alerts, re-tests, audit, agents; serves the
                         Studio at /app
backend/data/foodnet/    the synthetic network (YAML, schema, README)
backend/schemas/         exported JSON Schemas
backend/examples/        the tutorial's runnable example, and the example report
backend/tests/           pytest + Hypothesis; fixtures shared with the frontend (broken networks, scenario set)
frontend/src/lib/        the Studio's pure logic: schema checks, edits, history, tables, map projection, diff
frontend/src/            React screens: diagram, map, tables, inspector, issues, quick test, versions, scenarios
frontend/tests/, e2e/    Vitest unit tests; Playwright end to end against the real API
frontend/dist/           the built Studio (committed, served by the API and by GitHub Pages)
docs/                    PLAN.md, DSL_REFERENCE.md (generated), example-report.md
DECISIONS.md, STATUS.md  design log and phase status
index.html, tutorial.html  the about page and tutorial on GitHub Pages
```

All data is synthetic.
