# User guide

PolicyForge is a workbench for supply chain managers who delegate execution to AI agents. You state what you want;
it becomes a typed decision rule with a **mandate** (what the agent may decide alone, and when it must ask). The
rule is stress-tested against thousands of futures, approved, handed to the agent, and watched. This guide shows
how to run it and how to use each screen, following the demo in the brief (§10).

All data is synthetic: FoodNet, a fictional food manufacturer (3 suppliers, 2 plants, 3 DCs, 6 markets, 10 SKUs).

## 1. Run it

### With Docker (recommended)

```bash
cd policyforge
docker compose up -d --build      # or: make up
```

Open **http://localhost:8080/**. The API and its interactive documentation are at http://localhost:8000/docs. The
database is kept in a Docker volume: `docker compose down` keeps it, and `docker compose down -v` starts fresh.

The compiler runs **offline** by default. It replays recorded answers for 20 example intents (see
`backend/tests/fixtures/intents/`), including the demo's. To compile any intent with Claude:

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-… docker compose up -d
```

### Without Docker

You need Python 3.12 (uv installs it) and, to change the app, Node 22.

```bash
cd policyforge/backend
uv venv --python 3.12 .venv
uv pip install --python .venv -e ".[dev]"
.venv/bin/python -m uvicorn api.app:app        # Windows: .venv\Scripts\python
```

Open **http://127.0.0.1:8000/app/**. The built app is committed, so no Node step is needed. On the public site the
Network area works without a server; the other areas need the API.

## 2. The screens, through the demo

The header has one link per area, the API status, and **acting as**: the name recorded in the audit log with
every change (there is no login).

### Network

The Network Studio, where the model of the supply chain is built and kept:
- a diagram in four columns and a world map;
- spreadsheet tables that take a paste from Excel;
- an inspector for every field, with its bounds and units;
- live checks, a health panel and a one-second quick test;
- versions with diffs, and a scenario builder.

Its own page in the about site explains it in detail. Every other screen tests policies against the network saved
in the registry.

### Constitution: the organisation's rules

The active constitution, as a form:
- **Hard limits:** each a metric, a scope, ≥ or ≤, a threshold and a window. For example, chilled SKUs' fill rate
  at least 97 %, or expedite spend at most €20,000 in any month.
- **α:** a limit may be breached in at most this share of futures (5 % by default).
- **Priorities:** the order in which objectives decide between policies (service → resilience → cost → carbon in
  the demo).
- **Soft weights**, for a tie-break.
- **The risk attitude:** CVaR at 95 % means "judge each policy by the average of its worst 5 % of futures".

Save as a new version (and make it active). Every policy tested against an older constitution is then flagged for
re-test.

### Author: from intent to policy

1. Type the intent, for example the demo's: *"If Supplier B misses more than 10% of orders for three weeks running,
   shift ambient volume to Supplier C, don't switch back for a month, and the sourcing agent can do this alone up
   to 30% of volume—beyond that, ask me."* Press **Compile**.
2. Read the **back-translation** next to your words. If it is not what you meant, the rule is not either.
3. Answer the **questions**. They only appear where a missing detail would change the rule; the demo asks whether the
   agent should ask above 30 % or never go above it. Press **Recompile with answers**.
4. Check the **assumptions**. Each one becomes a drift monitor once the policy is deployed. Adjust a threshold if
   you know better than the compiler's guess, and remove one that is not true of your business.
5. Adjust the rule itself if needed, as a **form** (every field with its bounds) or as **JSON**. Errors appear on
   the field. Warnings, such as cover shorter than the lead time, are for you to weigh.
6. **Save to the registry**. Editing a saved policy saves a new version.

**Writing intents that compile well:**
- Rules can only read what an agent can observe: inventory position, on-hand stock, backorders, pipeline, forecast,
  observed lead time, supplier fill rate and capacity utilisation. Anything else (competitor prices, weather) is
  refused, and the compiler says so.
- Give numbers with units ("three weeks of cover", "€20k a month"), say where ("chilled SKUs at all DCs"), and say
  who decides ("the sourcing agent alone up to 30 %").
- The offline compiler knows only its recorded intents; any other intent says "no recorded compile answer". Run with
  `LLM_PROVIDER=anthropic` to compile anything.

### Stress test: does it hold up?

Choose the policy version, the scenario set and which of its scenarios to run, the baselines and the number of
futures. The default suite has eight scenarios: a baseline, a demand surge, a promotion spike, a supplier outage,
lead-time creep, a plant capacity loss, a correlated shock, and noisy, delayed signals. The baselines are:
- the **incumbent**, the current policy, always run;
- a **naive** base-stock rule;
- **rolling optimisation**, a linear program re-solved every four weeks, run on a subsample because it is slow.

**Run** starts a background job with a progress bar; 200 futures take about a minute.

**Reading the report:**
- **The verdict:** approve, approve with conditions, or reject. Each reason is built from the numbers:
  - breaching a hard limit in normal times rejects the policy;
  - breaching one only under stress is a condition, but only when the policy does worse than the incumbent;
  - otherwise the objectives decide in priority order, on CVaR.
- **The constitution table:** for each scenario and policy, the share of futures breaching each limit. Red means
  more than α.
- **Fan charts:** weekly fill rate and cost over time. The line is the median; the bands are P25–P75 and P5–P95
  of the futures.
- **Distributions:** one per policy, with P5, the median and P95 marked.
- **Cost against service:** one panel per scenario, one dot per future; down and left is cheaper and worse.
- **Export Markdown** for the record, or **Export PDF** (your browser's print dialog).

### Registry: approve, deploy, retire

Every version with its status (draft → tested → approved → deployed → retired), owner, agent, expiry, scope, latest
verdict and re-test flag. For a selected version:
- **What blocks approval.** A version is approved only when the latest evaluation of that exact version says
  approve, against the active constitution and the current network, and the mandate has not expired.
- **Approve** (with a note), **Deploy** and **Retire**. Deploying gives the agent this mandate and retires any
  other version it had.
- **What the agent reads:** the live `GET /agents/{agent_id}/mandate` response.
- **The diff** against another version, the evaluations, and the policy's audit trail.
- **Audit log:** every change. **Verify the chain** recomputes the hash chain and names the first entry that was
  altered or removed.

### Monitor: is the world still the one we tested for?

**New stream** runs the network week by week with the deployed policies, from a "true" world the monitors cannot
see.
- **Play**, **Pause** or **Step**. "Pause on a new alert" stops the stream when the inbox gets something.
- **Inject drift** changes that hidden world from the next week on: a supplier or plant losing capacity, lead times
  stretching, demand shifting. The week it bites can be later ("quietly, from week 20"). "Show the hidden world"
  reveals what was injected, for demos.

Four kinds of monitor watch what an operations team would see:

| Monitor | Watches | Fires when |
|---|---|---|
| Assumption | each assumption of each deployed policy | the evidence (CUSUM) says it no longer holds |
| Input | demand per market, lead time per supplier (as shipments arrive) | the level shifts (CUSUM), with PSI and KS as evidence |
| Performance | 4-week fill rate and cost | they stay outside the P5–P95 the stress test predicted |
| Mandate | the agents' escalations | an agent hits a limit of its mandate |

Their limits are set so that a quiet world raises a false alarm in at most 5 % of runs.

The **inbox** ranks alerts by severity × 1/reversibility × financial exposure (€/week); each alert shows how. Work
it with **Acknowledge**, **Resolve** or **Dismiss**. **Re-test with what we now see** sets the model to the
observation (for example Supplier C's capacity as reported now), re-runs the stress test, and shows the new verdict
and what changed in the model. It does not change the policy's approval record: acting on it is your decision.

In the demo, Supplier C loses 60 % of its capacity from week 20. The assumption "C has spare capacity of at least
1,100 units a week" fires that same week and tops the inbox. The re-test, on C at about 830 units, still approves:
even a smaller backup is better than none.

### The agent's side

```bash
curl http://localhost:8080/agents/sourcing-agent-01/mandate
```

The response has the active mandate: its limits, escalation rules, prohibited actions, the rule, its expiry and
status (`active` or `expired`), who approved it, and the hash of the audit entry that deployed it. An agent without a deployed
mandate gets 404.

## 3. From the command line

From `backend/`, with the virtual environment:

| Command | What it does |
|---|---|
| `python -m examples.first_stress_test` | The tutorial's stress test, as a table |
| `python -m examples.evaluate_report` | A full verdict report into `docs/example-report.md` |
| `python -m examples.compile_intent` | The demo intent compiled offline (`--live "…"` with a key) |
| `python -m examples.monitor_demo` | Deploy, inject a capacity loss, catch it, re-test |
| `make test` | Every check: lint, types, backend tests with coverage, frontend tests, browser tests |

The tutorial page walks through the first of these step by step.

## 4. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "API offline" in the header | The API is not running or not reachable: start it (section 1). On GitHub Pages only the Network area works offline |
| "no recorded compile answer" | The offline compiler only knows its recorded intents: use one of them, or run with `LLM_PROVIDER=anthropic` and a key |
| Approve is greyed out | Read the blockers above it: usually a re-test is needed after a constitution or network change |
| A stress test takes long | Rolling optimisation dominates: reduce its futures, or untick it |
| Start again from scratch | `docker compose down -v` (Docker) or delete `backend/policyforge.db` (local) |
| Port 8000 or 8080 is taken | Change the left side of `ports:` in `docker-compose.yml` |

What the model leaves out, and where its results could mislead, is in [LIMITATIONS.md](LIMITATIONS.md).
