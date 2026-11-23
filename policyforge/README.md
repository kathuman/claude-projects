# PolicyForge

A policy authoring and simulation workbench for supply chain managers who delegate execution to AI agents.

- **What it does:** you state an intent. It becomes a typed, bounded decision rule with a mandate (what the agent
  may decide alone, and when it must escalate). The rule is then stress-tested against the incumbent across
  thousands of futures, approved, and monitored.
- **Pages:** [about](https://kathuman.github.io/claude-projects/policyforge/) ·
  [tutorial](https://kathuman.github.io/claude-projects/policyforge/tutorial.html) ·
  [the app](https://kathuman.github.io/claude-projects/policyforge/frontend/dist/index.html)
- **Docs:** [user guide](docs/USER_GUIDE.md) · [architecture](docs/ARCHITECTURE.md) ·
  [limitations](docs/LIMITATIONS.md) · [DSL reference](docs/DSL_REFERENCE.md) · [decisions](DECISIONS.md) ·
  [status](STATUS.md)
- **Status:** v1.0.0. All eight phases of the brief are done: domain and data, the simulator, baselines with
  evaluation, the LLM compiler, the registry with its API (plus the Network Studio), monitoring, the screens, and
  hardening. The brief's whole demo runs end to end in the browser, tested on every change, also against the
  Docker stack. What it does not do is in [LIMITATIONS.md](docs/LIMITATIONS.md).

## Run it

With Docker:

```bash
docker compose up -d --build     # or: make up
```

Then open http://localhost:8080/ (the API's docs are at http://localhost:8000/docs). The compiler replays recorded
answers offline; set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to compile any intent with Claude.

Without Docker (Python 3.12; uv installs it):

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv -e ".[dev]"
.venv/bin/python -m pytest -q              # 185 tests
.venv/bin/python -m examples.first_stress_test
.venv/bin/python -m examples.evaluate_report  # full verdict report into docs/
.venv/bin/python -m examples.compile_intent   # intent → policy, offline; --live "..." with a key
.venv/bin/python -m examples.monitor_demo     # deploy, inject a capacity loss, catch it, re-test
.venv/bin/python -m uvicorn api.app:app        # the API on http://127.0.0.1:8000 (docs at /docs)
```

`make test` from this folder runs every check: ruff, `mypy --strict`, the tests with the 80 % coverage gate, the
frontend's TypeScript and unit tests, and the browser tests. `make help` lists the rest.

### The app

The built app (the Network Studio and the five other screens) is committed in `frontend/dist`, so the API serves it
at http://127.0.0.1:8000/app/ with no build step. To work on it (Node 22):

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
frontend/src/            React: the Studio (diagram, map, tables, inspector, versions, scenarios) and the screens
                         (Constitution, Author, Stress test, Registry, Monitor), a schema form, SVG charts
frontend/tests/, e2e/    Vitest unit tests; Playwright end to end against the real API, the §10 demo included
frontend/dist/           the built Studio (committed, served by the API and by GitHub Pages)
docs/                    USER_GUIDE.md, ARCHITECTURE.md, LIMITATIONS.md, DSL_REFERENCE.md (generated), PLAN.md,
                         example-report.md
docker-compose.yml       api (backend/Dockerfile) + web (frontend/Dockerfile, nginx.conf)
Makefile                 make up / down / test / demo
DECISIONS.md, STATUS.md  design log and phase status
index.html, tutorial.html  the about page and tutorial on GitHub Pages
```

All data is synthetic.
