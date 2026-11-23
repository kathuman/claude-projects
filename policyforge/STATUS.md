# Status

## Phase 1: domain and data. Done, acceptance met.

**What works**
- **Pydantic v2 models** in `backend/core/domain/`:
  - `network`, the `policy` DSL (six rule types, quantities in units or days of cover), `condition`, `mandate`,
    `assumption` and `constitution`;
  - a closed variable vocabulary with units and bounds (`vocabulary`);
  - bounded distributions with seeded sampling (`distributions`).
- **Synthetic data:** FoodNet in `backend/data/foodnet/network.yaml`, with a field-by-field `README.md` and a
  generated `network.schema.json`.
- **Schemas:** JSON Schema export for network, policy, mandate, assumption and constitution in `backend/schemas/`.
  `docs/DSL_REFERENCE.md` is generated from the schema (`python -m core.domain.schema_export`).
- **Examples:** `core/domain/examples.py` has the demo constitution (chilled service ≥ 97 %, expedite ≤ €20k per
  month, service → resilience → cost → carbon) and one example policy per rule type.

**Acceptance**

| Criterion | Evidence |
|---|---|
| All models round-trip JSON | `test_policy_round_trips` (each rule type), `test_other_models_round_trip` |
| Invalid bounds rejected | 19 parametrised invalid cases; Hypothesis properties showing values are accepted exactly within bounds (days of cover, every authority-limit kind, conditions); network data errors (12 cases) |
| Schema docs generated | `test_schema_export_and_reference`; `test_every_number_in_the_schemas_is_bounded` |
| Quality gates | ruff clean, `mypy --strict` clean on `core/`, 57 tests, 97 % line coverage on `core/` |

**Known limitations**
- A DC's source plant per SKU is fixed (the nearest plant that makes it, D009).
- DC → market delivery is instantaneous within a period (D010).
- The cross-reference checks a policy needs against the network (do these ids exist?) belong to the P4
  validator. In P1, models check their own shape and bounds only.

## Phase 2: simulator. Done, acceptance met.

**What works**
- **Engine** (`core/sim/engine.py`): discrete time, vectorised over replications.
  - Echelons: supplier → plant (production queue with finite capacity) → DC → market.
  - Stochastic per-lane lead times, supplier capacity and random fill rates, FIFO aged stock with spoilage of
    chilled SKUs, backorders or lost sales per SKU.
  - Information delay and signal noise; exponential-smoothing forecasts.
  - Costs in eight categories (EUR), CO2 (t), escalations and limit hits, sourcing switches.
- **Executors** (`core/sim/executors.py`): one per rule type (base stock with review period, (s, S), allocation
  by fair share / priority / proportional to demand with reservation, expedite on projected stockout or low
  coverage with a cost cap, sourcing switch with persistence, dwell and switch-back). Mandate limits are enforced
  by blocking or flagging (D017).
- **Policy compilation** (`core/sim/program.py`): any bundle of policies maps onto cells, with precedence (D018).
- **Scenario library** (`core/sim/scenarios/`): baseline seasonal demand, demand shift and promotion, supplier
  outage, lead-time inflation (step or ramp), plant capacity loss, correlated shock (random onset, in a share of
  replications), signal noise and delay. The default suite has 8 scenarios.
- **Common random numbers:** all randomness is drawn up front from per-purpose seeded streams (D013).

**Acceptance**

| Criterion | Evidence |
|---|---|
| Conservation (inventory flow balance) | `assert_conserved`: per node and period, at the markets, for material and the production queue, and for the DC pipeline. Run on all 8 suite scenarios, plus a Hypothesis property over random rules, scenario components, seeds, mandate modes, allocation, sourcing and expedite (25 examples). |
| A seed reproduces results exactly | `test_same_seed_same_results_different_seed_different_results` (array-equal on 7 outputs, correlated shock included) |
| Common random numbers | `test_common_random_numbers` |
| 1,000 × 104 in under 30 s | **6.0 s** on this laptop (`test_one_thousand_replications_of_104_periods_in_under_30_seconds`) |
| Analytical single-node base stock within ±1 pp | L = 1: simulated 0.9941, theory 0.9941; L = 2: simulated 0.9767, theory 0.9764; L = 3: simulated 0.9318, theory 0.9315 (1,000 reps × 150 periods each) |
| Quality gates | 74 tests green at the end of P2 (75 with the tutorial example); ruff clean; `mypy --strict` clean on `core/`; 96 % line coverage on `core/` |

**Known limitations** (also in D020)
- No DC storage limit; no holding cost in transit or in the production queue; shelf life does not run in transit.
- Forecasts ignore seasonality (D016).
- With the background policies (35 days at plants, 14 at DCs), FoodNet is well buffered: fill stays at 99 %+ in
  most stress scenarios. The incumbent policy in P3 should be leaner, so that stress tests can tell policies
  apart.

**Not yet built:** everything from Phase 3 on (baselines, metrics, evaluation, compiler, registry, API,
monitoring, frontend, packaging).

## Housekeeping after P2 (2026-11-18)

- Moved into the AI Projects repository as `policyforge/`, with CI in `.github/workflows/policyforge-ci.yml` (D021).
- Added the about page with the roadmap (`index.html`) and the tutorial (`tutorial.html`). The tutorial runs
  `backend/examples/first_stress_test.py`, which `tests/test_examples.py` keeps working.
- Listed on the AI Projects page as early development.

## Phase 3: baselines and evaluation. Done, acceptance met.

**What works**
- **Baselines** (`core/baselines/`):
  - incumbent: 35 days at plants, 10 at DCs, 12 for chilled SKUs, compliant under normal conditions (D029);
  - naive: mean demand × lead time;
  - rolling optimisation: Pyomo LP solved with HiGHS, re-planned every 4 periods, with safety targets and expected
    yields (D028).
- **Metrics** (`core/evaluate/metrics.py`, D023), per replication:
  - service: fill rate overall and by class, category, market and SKU; OTIF; backorder units; stockout periods;
  - cost: eight categories and the total, per week, and the worst monthly expedite spend;
  - resilience: peak service loss and recovery time;
  - stability: bullwhip per echelon, nervousness, switches;
  - governance: escalations and limit hits;
  - carbon, and inventory days per DC.
  Each gets a mean, P5, P50, P95 and CVaR, plus regret against the best policy in each replication.
- **Constitution check** (`core/evaluate/constitution.py`): every hard-constraint metric, on its scope (class,
  category, SKU, market, DC) and window (horizon, worst month, worst period).
- **Verdict** (`core/evaluate/verdict.py`, D027): approve, approve with conditions, or reject, with deterministic
  reasons and a lexicographic comparison with the incumbent.
- **Report** (`core/domain/results.py`, `core/evaluate/run.py`, `core/evaluate/report.py`): a typed, JSON-ready
  `EvaluationReport`. It holds distributions, samples for violin and scatter plots, fan-chart percentile series,
  constitution tables, regret and solver statistics, and exports to Markdown. `examples/evaluate_report.py` writes
  `docs/example-report.md` and `.json` (500 replications, about a minute).
- **Engine fixes and options:**
  - plants see same-period DC orders (D025);
  - information delay with the agent's own orders known (D026), or supply-line-blind as an option;
  - seasonal forecasts as an option (D030);
  - shock onset per replication, draw subsets, and an order-decider hook for baselines.

**Acceptance**

| Criterion | Evidence |
|---|---|
| Bullwhip ratio > 1 under the information-delay scenario for the naive policy | DC ratio 3.59 under noisy, delayed signals against 1.87 without; plant ratio > 1 as well (`test_naive_bullwhip_ratio_exceeds_one_under_information_delay`) |
| The rolling-optimisation baseline solves with HiGHS | every solve optimal, the expected number of solves, capacity respected; the fast solve path checked against a fresh Pyomo solve (same objective to 1e-7) |
| Reports are generated for the default suite | `test_reports_are_generated_for_the_default_suite` (8 scenarios × 4 policies, JSON round trip, Markdown sections, same inputs give the same id and numbers); `docs/example-report.md` at 500 replications: verdict **approve** for the tutorial's sourcing switch |
| Regression lock (brief §12) | `test_incumbent_default_suite_kpis_are_locked`: 7 KPIs × 8 scenarios against `tests/fixtures/incumbent_kpis.json` (regenerate with `UPDATE_GOLDEN=1`) |
| Quality gates | 89 tests green; ruff clean; `mypy --strict` clean on `core/`; 96 % line coverage on `core/` |

**Known limitations**
- The rolling optimiser re-plans every 4 periods. Weekly re-planning procrastinates (D028). It runs on a
  subsample (50 replications by default), and its regret is not computed.
- A full default-suite evaluation at 1,000 replications takes about 2 minutes.
- PDF export is not built yet: Markdown now, PDF with the frontend (P7).
- The LLM narrative summary (brief §8.2) belongs with the compiler work (P4).
- Results from P2 changed with D025 and D029. The tutorial and its test were updated.

## Phase 4: LLM compiler. Done, acceptance met.

**What works**
- **Providers** (`core/llm/`):
  - a provider-agnostic interface;
  - an Anthropic provider (official SDK; model from `LLM_MODEL`, default `claude-opus-5-5`; structured outputs;
    adaptive thinking with effort `high` to compile and `low` for prose; refusal fallbacks on by default; typed
    errors);
  - a deterministic mock that replays recorded answers.
- **Compiler** (`core/llm/compiler.py`): intent → `CompileOutput`, then:
  - parse, Pydantic validation and deterministic validation, with at most two retries;
  - errors are passed back to the model, and every attempt is recorded;
  - a `Policy` draft with provenance (model, prompt hash), clarifying questions, interpretation notes, confidence
    per field, warnings, and a back-translation by a second call.

  Answers to clarifying questions are passed back in.
- **Prompts** (`core/llm/prompts.py`): a fixed system prompt explaining the DSL, units, vocabulary, scope,
  mandates, and asking rather than guessing. The context gives the network, constitution, vocabulary and existing
  policies. The prompt hash is SHA-256 of the template and the schema.
- **Validator** (`core/validate/policy.py`): errors and warnings (D035).
- **Narrative** (`core/llm/narrative.py`): an optional report summary that may cite only the report's numbers
  (D038).
- **Try it:** `python -m examples.compile_intent` (offline, the 20 recorded intents) or `--live "..."` with a key.

**Acceptance**

| Criterion | Evidence |
|---|---|
| All 20 golden intents compile to the expected DSL with the mock | `test_golden_intent_compiles_to_the_expected_dsl` (×20: scope, rule, mandate limits and prohibitions, numbers of assumptions, questions and attempts, provenance, a valid draft, the back-translation, JSON round trip); the brief's demo intent: a composite with a sourcing switch, a 30 % mandate, three assumptions and one question |
| References outside the vocabulary are rejected | by the schema (`competitor_price`, intent 20) and by the validator (unknown nodes, SKUs, suppliers, lanes, priorities, wrong node kinds) |
| Failed validations retry with errors | intent 20 recovers on the second attempt, with the errors in the retry message; a policy that keeps failing raises after 3 attempts, all recorded |
| Quality gates | 125 tests green; ruff clean; `mypy --strict` clean on `core/`; 96 % line coverage on `core/` |

**Known limitations**
- No live model calls were made while building (no credentials): the golden answers are hand-authored (D037). The
  Anthropic provider is tested against a stand-in client (request shape, errors, refusal, truncation).
- The narrative's number check is textual. A number written in words ("three scenarios") is not checked.
- Mandate review triggers (links to monitors) are accepted but not used until P6.

## Phase 5: registry and API. Done, acceptance met.

**What works**
- **Registry** (`core/registry/`), on SQLite through SQLModel:
  - versioned networks, constitutions and policies;
  - evaluations stored with their full reports;
  - the lifecycle draft → tested → approved → deployed → retired, with the approval gate (D039) and one active
    mandate per agent (D041);
  - expiry reporting (D042) and re-test flags (D043);
  - path-level diffs between versions of a policy or a network;
  - an append-only, hash-chained audit log (D040).
- **API** (`api/app.py`, FastAPI):
  - health;
  - networks, with versions, diffs and field-level validation for the Studio;
  - constitutions;
  - compile (the mock by default, Claude with `LLM_PROVIDER=anthropic`);
  - policies: create, edit, versions, diffs, evaluate, approval blockers, approve, deploy, retire;
  - evaluation reports as JSON or Markdown;
  - the audit log and its verification;
  - **`GET /agents/{agent_id}/mandate`**.

  Run it with `uvicorn api.app:app` from `backend/`: FoodNet and the default constitution are loaded on first
  start. OpenAPI docs are at `/docs`.

**Acceptance**

| Criterion | Evidence |
|---|---|
| Approval is blocked without a passing evaluation | `test_approval_is_blocked_without_a_passing_evaluation`: a draft, a reject verdict, approve with conditions, a version with no evaluation of its own; then approval after a passing one. `test_a_new_constitution_or_network_means_re_test`: blocked again after a constitution or network change, cleared when the constitution is switched back. Over HTTP: a 409 with the reason. |
| Tampering with the audit log is detected by a verification endpoint | `UPDATE` and `DELETE` refused by triggers; after dropping a trigger, an edited payload is reported at entry 5 ("altered") and a deleted entry at 4 ("missing"); `GET /audit/verify` |
| Agent mandate API contract (brief §12) | `test_agent_mandate_contract`: the response schema matches the snapshot in `tests/fixtures/agent_mandate.schema.json`. The demo flow over HTTP ends with `GET /agents/sourcing-agent-01/mandate` returning the active mandate (30 % volume limit, approver, audit hash). |
| Quality gates | 136 tests green; ruff clean; `mypy --strict` clean on `core/` and `api/`; 96 % line coverage |

**Known limitations**
- One person, no authentication: the actor is whatever `X-Actor` says (D044).
- Evaluations run inside the request; a large one keeps the request open for minutes. Background jobs come with P7.
- The incumbent used in evaluations is still the fixed FoodNet incumbent, not the policies deployed in the
  registry.
- The hash chain proves integrity within the database, not against someone who rewrites the whole chain. The head
  hash (`GET /audit/verify`) is there to be anchored elsewhere.

## Phase 5b: Network Studio. Done, acceptance met.

**What works**
- **The model on a map** (D045): `lat`/`lon` on every location. FoodNet sits on plausible, fictional European
  positions; lane distances follow the map (great circle × 1.25) and stay editable.
- **Checks with paths** (D046): field errors and reference problems carry the dotted path of the field at fault
  (`markets.0.served_by`). `network_health` flags plant and supplier load against mean demand, chilled shelf life
  against transit time, idle markets, backup suppliers and lane distances far from the map's.
- **Backend for the Studio:**
  - `POST /networks/check` (errors and health);
  - `/networks/quick-test`: 100 futures × 52 weeks with the incumbent, about 0.2 s;
  - CSV templates in and out with errors by table, row and column, and YAML in and out, both returning a `draft`
    of a broken file (D050);
  - scenario sets saved and versioned in the registry, and named by evaluations (D051);
  - `POST /scenarios/preview` (scenario ÷ baseline with common random numbers, on the Studio's unsaved network);
  - every JSON Schema served and exported;
  - CORS for the Pages Studio and the dev server.
- **The Studio** (`frontend/`, React + TypeScript + Vite, D047), served at `/app` and on GitHub Pages:
  - **Diagram:** four columns, modes to select, add, connect and delete, drag to reorder, colour by utilisation,
    cost, lead time or quick-test fill rate, error badges on elements.
  - **Map:** the Tierwise projection with the land basemap, great-circle lanes, zoom, pan, drag to move, click to
    add, and a tray of nodes not yet placed.
  - **Tables:** every table with the CSV columns, paste from Excel (header-aware), copy for Excel, and the market ×
    SKU demand grid with overrides (D052).
  - **Inspector:** generated from the JSON Schema, with bounds, units and descriptions. Ids rename with every
    reference; references are pickers; sourcing shares can be renormalised; lead times have a live distribution
    preview (mean, sd, 95th percentile) and switch kind while keeping the mean.
  - **Issues, Health, Quick test:** issues jump to their element.
  - **File:** new, FoodNet, open YAML/JSON/CSV, export YAML/JSON/CSV zip.
  - **Undo and redo** over every edit (D048), with a draft kept across reloads.
  - **Versions:** save, history, open any version, diff two versions, unsaved changes against the saved version,
    and the policies on the network with "re-test needed".
  - **Scenarios:** sets of scenarios built on a timeline (drag to move in time), forms from the scenario schema,
    instant checks, save and open sets, and a preview of what each changes.
  - Works offline for editing, field checks and YAML/JSON. The rest says it needs the API.

**Acceptance**

| Criterion | Evidence |
|---|---|
| Build FoodNet from scratch in the Studio; the export loads as the shipped network | Playwright `build FoodNet from scratch…`: an empty network; SKUs, suppliers, plants, DCs, markets and lanes pasted from the CSV templates as Excel would; one market placed on the map; the last lane drawn in the diagram and set up in the inspector; "consistent ✓"; Export YAML, loaded by the engine, **equals** `data/foodnet/network.json` |
| Errors in place: every broken network in the shared set is rejected, with the message on the right element | `broken_networks.json` (15 cases, field and reference). pytest checks each path and message on `NetworkData`, `reference_problems`, `Network` and `/networks/check`. Vitest checks the browser catches every `browser: true` case (in Pydantic's words) and leaves the rest to the server. Playwright opens each one, clicks the issue, and finds the message in that element's inspector |
| Undo and redo restore exact states; YAML and CSV round-trip | Vitest (history, merged keystrokes); Playwright deletes, renames and adds, then undoes back to exactly FoodNet and redoes to exactly the edited state. CSV: Python round trip, plus browser copy → paste for every table; YAML: the from-scratch test |
| Versions: a change flags dependent policies for re-test; the diff shows exactly the changed fields | Playwright: a policy compiled, created and evaluated on `foodnet@1`; a capacity change saved as v2; the policy shows "re-test needed"; the v1 → v2 diff has exactly one row, `plants.0.capacity_per_period` 6000 → 6500 |
| Scenario builder: a scenario built there draws exactly like the same scenario in Python | Playwright builds a Supplier B outage (dragged to period 20 on the timeline) and saves it; the saved set **equals** `tests/fixtures/studio_scenario_set.json`. pytest checks that fixture equals the set written in Python, with identical draws |
| End to end in a browser | `frontend/e2e/studio.spec.ts`: 5 tests, about 30 s, against the real API on a fresh database (`npm run e2e`) |
| Quality gates | Backend: 160 tests green, ruff and `mypy --strict` clean, 96 % line coverage; exported schemas checked fresh in CI. Studio: TypeScript strict, 50 Vitest tests, 5 Playwright tests, in a CI job of their own |

**Known limitations**
- The Studio edits one network at a time. Comparing two networks side by side is the Versions diff only.
- Map lanes are drawn as great circles; routes that cross the antimeridian are not split.
- On GitHub Pages the Studio reaches a local API only if the browser allows a public page to call `127.0.0.1`
  (some ask permission). `http://127.0.0.1:8000/app/` always works.
- The JS bundle is about 550 kB (170 kB gzipped); code splitting comes with P7's other screens.
- The other screens of the brief (Constitution, Author, Stress test, Registry, Monitor) come in P7.

## Phase 6: monitoring. Done, acceptance met.

**What works** (`core/monitor/`, `core/registry/monitoring.py`)
- **The live stream** (D054): the network runs week by week with the deployed policies, from a hidden true
  scenario. Injections (demand shift, supplier outage, lead-time inflation, plant capacity loss) change the world
  from the next week on, and never the past.
- **Observations** (D055): demand per market; lead time on arrival; fill rate; reported capacity; utilisation;
  stock; weekly fill rate and cost; the agents' escalations.
- **The reference** (D056): the stress test under the matching scenario (baseline by default), 400 replications,
  observed the same way.
- **Four kinds of monitor:**
  - **Assumption drift:** one per assumption of each deployed policy: CUSUM on the violation, KS for
    distribution assumptions, "not observable" where the stream cannot see the variable (D057).
  - **Input drift:** demand per market and lead time per supplier: CUSUM, with PSI and KS as evidence.
  - **Performance drift:** the rolling fill rate and cost against the stress test's P5–P95 envelope.
  - **Mandate escalations** (D062).

  Input and performance limits are calibrated on the reference, for at most 5 % false alarms overall (D058).
- **The escalation inbox:** ranked by severity × 1/reversibility × exposure, each factor explained on the alert
  (D059); one open alert per monitor; open → acknowledged → resolved or dismissed; audited (D060).
- **Re-test** (D061): one call evaluates the policy on the network as observed. The report and verdict are kept with
  the alert, and also served as Markdown.
- **API:** `POST /streams`, `GET /streams/{id}` (with `reveal=true` for the hidden world),
  `POST /streams/{id}/step`, `POST /streams/{id}/inject`, `GET /alerts`,
  `POST /alerts/{id}/acknowledge|resolve|dismiss`, `POST /alerts/{id}/retest`, `GET /retests/{id}` (and
  `/markdown`).
- **Example:** `python -m examples.monitor_demo` runs §10's step 6 end to end.

**Acceptance**

| Criterion | Evidence |
|---|---|
| The scripted demo (§10) triggers an assumption-drift alert within 4 periods of injected drift | `test_acceptance_the_demo_fires_the_assumption_within_four_periods`: the demo policy deployed; capacity loss at Supplier C from week 20, injected at week 10; the "C has spare capacity ≥ 1,100" monitor fires at week 20 for seeds 1, 2 and 3, and never in the same streams without the loss. Through the registry and over HTTP, the alert is raised by week 23, tops the inbox, and its re-test runs on C's capacity as observed (about 830 units/week) |
| Three monitor types | Assumption: as above, plus a distribution assumption caught by KS. Input: Supplier B's lead time ×1.6 from week 20 caught at week 29 (shipments take 2 weeks to reveal it), with PSI > 0.25 and KS p < 0.01; demand ×1.5 in one market caught within 2 weeks, with the change point found. Performance: an outage at Supplier A drives the rolling fill rate below the envelope's P5 |
| No false alarms in normal times | 10 quiet streams over 104 weeks: no assumption alarms; at most one stream with an input or performance alarm (the calibrated target is 5 %) |
| Escalation inbox and re-test action | Ranking checked for every kind of subject. The lifecycle with the 409 on a bad transition. One alert per monitor until it is closed, then a new one for later alarms. Audit entries verified. A demand alert re-tests with the market's size factor × 1.4 |
| Determinism | Injecting never changes the past (every series equal before the switch); stepping 50 times equals jumping 50 weeks |
| Quality gates | 179 tests green; ruff and `mypy --strict` clean; 95 % line coverage |

**What the demo shows.** The alert fires in week 20, the week Supplier C's capacity drops to about 830. It tops
the inbox with a score of about 32,000: high severity, reversibility 0.5 for a sourcing switch, and exposure of about
€5,400 a week, the 30 % of B's volume the policy may move to C. The re-test on the observed network still says
**approve**: even a smaller Supplier C is a better backup than none, and the policy still beats the incumbent
under the shocks. That is useful to know, and it is the planner's call whether to lower the 30 %.

**Known limitations**
- One stream runs one replication of one network; there is no streaming from real systems.
- The reference assumes the world of the matching scenario. A planned change (a promotion) should be added to the
  matching scenario, or the monitors will report it as drift.
- Exposure is a first-order estimate (volume × value at risk), not a simulation of the loss.
- The Monitor screen (play, pause, inject, the inbox) is P7.

## Phase 7: the screens. Done, acceptance met.

**What works** (`frontend/`; one app at `/app`, D063)
- **Network:** the Network Studio (P5b), unchanged.
- **Constitution:**
  - the active constitution as a generated form: hard limits, the priority ranking, soft weights, risk attitude, α;
  - unsaved changes against the active version;
  - saving a new version, active or not;
  - the version history, with "Load" and "Make active".
- **Author:**
  - intent → Compile (the mock offline, Claude with `LLM_PROVIDER=anthropic`);
  - clarifying questions with answers and "Recompile";
  - the intent next to the back-translation, interpretation notes, confidence;
  - the assumptions as an editable table;
  - the policy as a generated form and as JSON, in sync;
  - live checks from the schema and the server's validator, located on the fields;
  - save as a new policy or a new version, then "Stress test it".
- **Stress test:**
  - policy and version, scenario set and which of its scenarios, baselines, futures;
  - runs as a background job with a progress bar (D064);
  - the report:
    - the verdict and its reasons, and the objective-by-objective comparison;
    - the constitution table per scenario and policy;
    - fan charts of weekly fill rate and cost;
    - per-future distributions;
    - cost against service as small multiples per scenario (D069);
  - export to Markdown or PDF (print).
- **Registry:**
  - every version with its status, owner, agent, expiry, scope, verdict and re-test flag;
  - approval blockers; Approve, Deploy and Retire with a note;
  - the agent's live mandate (`GET /agents/{id}/mandate`) once deployed;
  - version diffs, evaluations, the audit trail per policy;
  - the whole log with chain verification.
- **Monitor:**
  - start streams; Play, Pause, Step, speed, pause on a new alert;
  - inject drift (supplier or plant capacity, lead time, demand), from the next week;
  - optionally show the hidden world;
  - KPIs and every monitor with a sparkline, its threshold and alarm weeks;
  - the ranked inbox with Acknowledge, Resolve, Dismiss and one-click **Re-test**, run as a job, showing the
    verdict, the model changes and the full report.
- **Shared:**
  - a schema form generated from the JSON Schemas (D065);
  - SVG charts with colours checked by the palette validator;
  - "acting as" for the audit log (D068).
- **Backend:**
  - background jobs (`GET /jobs/{id}`) for evaluations and re-tests;
  - a choice of baselines;
  - `GET /constitutions`, `GET /constitutions/{id}/{version}`, `GET /streams`, `POST /policies/validate`;
  - the demo's answer recorded for offline compiles (D066).

**Acceptance**

| Criterion | Evidence |
|---|---|
| The full demo script runs end to end in the browser | `frontend/e2e/demo.spec.ts`, against the real API on a fresh database, about 1.2 minutes. (1) The constitution checked and saved as version 2, active. (2) The demo intent compiled: a sourcing switch, three assumptions, one question; answered; recompiled with none; saved. (3) A stress test on the default suite against the incumbent and rolling optimisation, run as a job; the report's constitution table has 8 scenarios. (4) The rule edited (an expedite-spend cap in the mandate), saved as v2, re-tested: **approve**; approved with a note, deployed; the Registry shows its expiry, its audit trail (edited, evaluation, approved, deployed) and the agent's mandate; the chain verifies. (5) Monitor: a stream, Supplier C's capacity loss from week 20 injected, Play; the assumption alert tops the inbox by week 24; one click re-tests on C's observed capacity. (6) `GET /agents/sourcing-agent-01/mandate` returns version 2, active |
| The screens of §11 | All six areas; the Network area is P5b's Studio, its 5 browser tests unchanged and green |
| Quality gates | Backend: 185 tests green, ruff and `mypy --strict` clean, 95 % line coverage. Frontend: TypeScript strict, 59 Vitest tests, 6 Playwright tests |

**Notes**
- §10 narrates a first verdict of "approve with conditions or reject" (an expedite-budget breach). The compiled demo
  rule has no expediting, so it gets **approve** at once; the test performs every step of the script anyway (D067).
- The browser test found two real bugs, both fixed:
  - empty 204 responses broke the screen's refresh after Approve (D070);
  - nullable unions and enums were rejected by the browser's checks (D065).

**Known limitations**
- Jobs live in memory: a restart loses progress bars (never results).
- One acting person, no login (D044, D068).
- On GitHub Pages only the Network area works without a local API.
- The JS bundle is about 600 kB; code splitting is not done yet.

## Phase 8: hardening. Done, acceptance met.

**What works**
- **`docker compose up`** (D071):
  - `api` (FastAPI, SQLite on a volume, health check, non-root);
  - `web` (the app built from source, served by nginx at `/app/`, the API proxied: one origin on port 8080).

  The offline compiler is the default; `LLM_PROVIDER=anthropic` with a key switches to Claude.
- **The clean-machine check** (D072): a CI job builds both images on a fresh runner and starts the stack. Then it
  runs every Playwright test against it (the §10 demo included) and reads the agent's mandate through the proxy.
- **Makefile** (D073):
  - `make up`, `down` and `logs`;
  - `make test` runs everything: ruff, mypy, pytest with the coverage gate, TypeScript, Vitest, Playwright;
  - `make e2e-docker` and `make demo`.

  CI runs the backend half through the Makefile.
- **Docs:**
  - [USER_GUIDE.md](docs/USER_GUIDE.md): run it, the §10 demo screen by screen, intents that compile well,
    reading a report, the agent API, troubleshooting;
  - [ARCHITECTURE.md](docs/ARCHITECTURE.md): Mermaid component and sequence diagrams, modules, guarantees, tests,
    runtime;
  - [LIMITATIONS.md](docs/LIMITATIONS.md): what the simulator does not model, where the evaluation could mislead,
    and the compiler's, monitoring's and governance's limits;
  - [DSL_REFERENCE.md](docs/DSL_REFERENCE.md), generated.
- **Version 1.0.0** (D074).

**Acceptance**

| Criterion | Evidence |
|---|---|
| `docker-compose up` works on a clean machine | The CI job `docker` on a fresh Ubuntu runner: `docker compose up -d --build --wait`, the proxy answers (`/health`, `/app/`, `/` → 302), all six Playwright tests against the containers, `GET /agents/sourcing-agent-01/mandate` active. **Passed on its first run**, the 1.0.0 commit bbb53b4 ([run 45257589612](https://github.com/kathuman/claude-projects/actions/runs/45257589612)); it repeats on every change |
| Coverage ≥ 80 % on `core/` | 95 % line coverage, enforced in CI (`--cov-fail-under=80`) |
| docs/USER_GUIDE.md and docs/ARCHITECTURE.md written | Both, plus LIMITATIONS.md, from §13 |

**The brief's final checklist (§13)**

| Item | Where |
|---|---|
| Running app via `docker-compose up` | `docker-compose.yml`, checked in CI |
| All phases' acceptance criteria met and recorded in STATUS.md | Phases 1–8 above, and 5b |
| DECISIONS.md with all design decisions | D001–D074 |
| docs/ARCHITECTURE.md (with a component diagram in Mermaid), docs/USER_GUIDE.md, docs/DSL_REFERENCE.md (generated from schema) | `docs/` |
| The demo script in §10 reproducible end to end | `frontend/e2e/demo.spec.ts`, against a local server and against Docker; `examples/monitor_demo.py` for its monitoring step |
| docs/LIMITATIONS.md | `docs/LIMITATIONS.md` |

**Testing requirements (§12)**, all in place:
- unit tests for validators, executors and metrics;
- Hypothesis for conservation laws and DSL bounds;
- golden compiler tests with the mock;
- the incumbent's KPIs locked at a fixed seed;
- the agent-mandate contract test;
- the Playwright §10 demo.

Overall: 185 backend tests, 59 Vitest, 6 Playwright.

**Known limitations:** see [LIMITATIONS.md](docs/LIMITATIONS.md).
