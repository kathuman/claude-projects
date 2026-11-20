# PolicyForge: implementation plan for P1 and P2

This plan covers Phase 1 (domain and data) and Phase 2 (simulator). Later phases get their own plan section when
they start. Design decisions are logged in `DECISIONS.md` as they are made.

## Phase 1: domain and data

### Packages

`backend/core/domain/`, one module per concept:

| Module | Contents |
|---|---|
| `units.py` | The time base (a period is 7 days by default) and the unit labels used everywhere. |
| `vocabulary.py` | The fixed **state vocabulary** (inventory position, on-hand, backorders, pipeline, forecast, observed lead time, supplier fill rate, capacity utilisation) and the **exogenous vocabulary** (demand, lead time, supplier capacity, plant capacity). Each variable has a unit and hard bounds. `VarRef` is a variable plus qualifiers (node, SKU, supplier), written `lead_time[supplier_B]`. |
| `distributions.py` | Distributions as a discriminated union: deterministic, normal, gamma, triangular, discrete. All parameters are bounded. Used by the network (lead times) and by assumptions. |
| `network.py` | Suppliers, plants, DCs, markets, SKUs, lanes, emission factors, and the whole `Network` with referential checks: unique ids, lanes point to existing nodes in the right echelon order, every market is served, every SKU is made somewhere, chilled SKUs have a shelf life. |
| `policy.py` | The DSL: `Quantity` (units or days of cover), `Condition`, the six `DecisionRule` types (discriminated on `type`), `Scope`, `Provenance`, `Policy`. |
| `mandate.py` | `AuthorityLimit`, `EscalationRule`, `Mandate` (mandatory expiry, 90 days by default). |
| `assumption.py` | `Assumption` (a variable, an operator, and a threshold *or* a distribution). |
| `constitution.py` | Hard constraints, lexicographic priorities, soft weights, risk attitude, breach α. |
| `schema_export.py` | Writes the JSON Schema of every top-level model to `backend/schemas/`, and generates `docs/DSL_REFERENCE.md` from the schema. |

### Bounds

Every numeric DSL field declares `ge`/`le` in the schema. Thresholds on state variables also get a per-variable
check (a fill rate is in 0..1, a lead time in 0..730 days), because one schema field serves several variables. A
test walks the exported schema and fails on any number without both bounds.

### Synthetic data

`backend/data/foodnet/`:
- `network.yaml`: 3 suppliers, 2 plants, 3 DCs, 6 markets, 10 SKUs (2 chilled), lanes with lead-time
  distributions, costs, penalties, expedite multipliers, and CO₂ per unit-km;
- `network.schema.json`: generated from the Pydantic model;
- `README.md`: every field explained, with its unit.

Market demand is `sku.base_demand × market.size_factor`, with per-pair overrides. That keeps the file readable.

### Tests (P1 acceptance)

- Every model round-trips through JSON (`model_validate_json(model_dump_json()) == model`), including the loaded
  foodnet and one example of every rule type.
- Out-of-bounds values are rejected: parametrised tests, plus a Hypothesis property (a parameter is accepted
  exactly when it is within its declared bounds).
- Structure is enforced: no composite inside a composite, priorities must be a permutation, expiry after start,
  references outside the vocabulary rejected, assumptions need a threshold or a distribution but not both.
- The network loader rejects broken references.
- Schema export runs; every numeric leaf in the DSL schema has bounds; `DSL_REFERENCE.md` is generated.
- ruff and `mypy --strict` are clean on `core/`; coverage is at least 80 % on `core/`.

## Phase 2: simulator

### Model

- Discrete time, weekly periods. Echelons: **supplier → plant → DC → market**.
- **Stocking nodes:** plants (finished goods) and DCs. Markets are demand points served by their DC.
- **Suppliers** are sources: per-period capacity, random fill rate (the short part is lost, not backordered), and
  per-order lead-time draws.
- **Plants:** material that arrives from suppliers enters a production queue. At most the plant's weekly capacity
  turns into finished goods each period, shared across SKUs pro rata.
- **Shelf life:** chilled SKUs are held in age buckets, FIFO. Stock older than its shelf life spoils and is costed.
  Ambient stock never expires.
- **Information delay:** policies see the state from `lag` periods ago, through a ring buffer.

### State arrays

All state is held as arrays shaped `[R, N, K]` (replications, stocking nodes, SKUs), with an age axis for
inventory and a pipeline axis `[R, N, K, Lmax]` for arrivals. Market backorders are `[R, M, K]`. Each period runs
the spec's order of events, vectorised over replications:

1. receive arrivals;
2. observe demand;
3. fulfil and allocate;
4. record backorders or lost sales;
5. policy decisions;
6. place orders;
7. advance the pipeline.

### Randomness and common random numbers

A scenario plus a seed produces a `ScenarioDraws` object holding every random draw up front:
- demand `[R, T, M, K]`;
- lead time per lane and period `[R, T, lanes]`;
- supplier fill `[R, T, S]`;
- capacity factors;
- forecast noise.

An order placed on a lane in period `t` uses that period's lead-time draw. All policies under comparison read the
same `ScenarioDraws`, which gives common random numbers by construction. Each generator gets its own
`numpy.random.Generator` spawned from a `SeedSequence`, so the same seed and inputs give identical results.

### Scenario library (`core/sim/scenarios/`)

Composable generators. Each one either draws a base layer or transforms the draws:
- baseline seasonal demand;
- level shift or promotion;
- supplier outage;
- lead-time inflation (step or gradual);
- plant capacity loss;
- correlated shock;
- noise and information-delay increase (the bullwhip stressor).

A `ScenarioSet` stacks generators by name. The default suite has 8 scenarios.

### Executors (`core/sim/executors/`)

One deterministic executor per rule type. Each maps observed state to actions (orders, expedites, allocation
weights, sourcing shares). A composite applies its rules in order: later rules refine the actions of earlier ones
within their scope. `Mandate.autonomy` is enforced after the rule has acted. Actions beyond a limit are counted and
logged as escalations, then either blocked (clipped to the limit) or applied with a flag (`on_limit = "block" |
"flag"`).

### Tests (P2 acceptance)

- **Conservation (Hypothesis):** for every node and SKU, the starting stock plus receipts equals shipments, plus
  spoilage, plus the change in stock. Supplier totals and pipeline totals reconcile as well.
- **Determinism:** the same seed gives byte-identical results; a different seed gives different ones.
- **Common random numbers:** two policies see identical demand.
- **Performance:** 1,000 replications × 104 periods on foodnet in under 30 s (a timed test, also printed).
- **Analytical case:** one DC with order-up-to `S`, normal demand, a fixed lead time `L` and an ample upstream. Orders
  are placed after demand and arrive at the start of period `t + L`, so the protection interval is `L` periods. The
  simulated fill rate matches `1 − (E[(D_L − S)⁺] − E[(D_{L−1} − S)⁺])/μ` within ±1 percentage point. (Corrected
  during P2: the first draft of this plan used `L + 1`, which assumes orders are placed before demand.)
- **Executors:** unit tests for every rule type and for mandate clipping and flagging.

## Phase 3: baselines and evaluation

### Baselines (`core/baselines/`)

- **Incumbent:** FoodNet's current rule: base stock at 10 days of cover at DCs and 35 at plants (D022).
  `incumbent_policies()` is the single place to change it; once the registry exists (P5), it returns whatever is
  deployed for the scope.
- **Naive:** a fixed base stock per cell of mean demand × mean lead time (in simulator periods), in units, so it
  ignores forecasts entirely.
- **Rolling optimisation:** a Pyomo LP solved with HiGHS (persistent `appsi` interface) every `k` periods, for
  each replication, over a short horizon. It uses the expected forecast and plans orders, stock, backorders and
  plant production within capacity; the first `k` periods of the plan are executed (receding horizon). It plugs
  into the engine as an order "decider" in place of the rule executors. It runs on a subsample (default 50
  replications), and the report says so.

### Metrics (`core/evaluate/metrics.py`)

All per replication, after a warm-up:
- **service:** fill rate (overall, by class, by category, by market), OTIF line rate, backorder units, stockout
  periods;
- **cost:** the eight categories, the total, and the worst monthly expedite spend;
- **resilience:** peak service loss and time to recover after the scenario's shock onset;
- **stability:** bullwhip ratio per echelon, order nervousness, sourcing switches;
- **governance:** escalations and limit hits;
- **carbon:** t CO2e;
- **inventory days:** per DC.

Distributions get the mean, P5, P50, P95, and CVaR at the constitution's level (in each metric's bad direction).
Regret is measured against the best policy in each replication.

### Constitution and verdict (`core/evaluate/verdict.py`)

- **Constitution check:** each hard constraint is evaluated per replication on its scope and window, and its
  breach share is compared with α.
- **Verdict:** deterministic rules, with reasons built from the numbers:
  - **reject** if a constraint is breached beyond α under normal conditions (the baseline scenario), or if the
    candidate is worse than the incumbent on the first priority objective where they differ;
  - **approve with conditions** if constraints are breached beyond α only under stress, or the candidate is
    worse on a lower priority;
  - **approve** otherwise.

### Report (`core/evaluate/report.py`)

A Pydantic `EvaluationReport` holding:
- run metadata (seed, replications, horizon, a hash of the inputs);
- per scenario and policy: metric summaries, KPI samples for violin and scatter plots, and percentile fan series
  over time;
- the constitution table, the verdict and regret.

It exports to Markdown; PDF follows with the frontend (P7).

### Tests (P3 acceptance)

- the naive policy's bullwhip ratio exceeds 1 under the noisy, delayed scenario;
- the rolling-optimisation baseline solves with HiGHS (status optimal, plans respect capacity);
- reports are generated for the full default suite;
- a regression test locks the incumbent's default-suite KPIs at a fixed seed;
- unit tests for every metric, the constitution check, the verdict rules, CVaR and regret.

## Phase 5b: Network Studio (added 2026-11-20 at the user's request, D032)

A visual editor for creating and maintaining networks, in the spirit of Tierwise's Network Studio: rebuilt for
PolicyForge's model and its React + TypeScript frontend, reusing Tierwise's proven patterns, not its code. It comes
right after P5, because it needs the API for validation, versions and the quick test. It starts the frontend early
and becomes the first screen of P7, replacing the brief's read-only Network screen.

### Model change

`Location` gains optional `lat` / `lon` in degrees, alongside the km grid:
- the Studio's map draws nodes by latitude and longitude;
- a lane's distance is *suggested* from the great-circle distance × a road factor, and stays editable;
- FoodNet gets plausible, still fictional, European positions.

Existing files without coordinates stay valid.

### Scope (all in this phase)

1. **Diagram view:**
   - four columns (suppliers → plants → DCs → markets), with lanes as arrows;
   - modes to select, add, connect (drag from node to node) and delete; drag to reorder;
   - undo and redo for every edit;
   - colour by a measure: utilisation, cost, lead time, quick-test fill rate.
2. **Inspector:**
   - a form **generated from the JSON Schema**, with units, bounds and descriptions, so it can never fall out of
     step with the model;
   - lead-time distributions edited with a small preview.
3. **Map view:** nodes on a world map (Tierwise's projection, great-circle lanes, zoom and pan), the same editing
   modes as the diagram.
4. **Tables:** the SKU catalogue, the market × SKU demand grid (base × size factor, plus overrides) and lanes, as
   spreadsheets with paste from Excel.
5. **Live checks:**
   - field errors at once, from the JSON Schema;
   - cross-reference errors from `POST /networks/validate`, shown on the element concerned;
   - a health panel: plant and supplier utilisation against demand, shelf life against lead time, unreachable SKUs.
6. **Quick test:** a ~2-second simulation with the incumbent; the diagram and map coloured by fill rate.
7. **Import and export:** YAML / JSON (the engine's own format) and CSV templates (nodes, lanes, SKUs, demand), with
   errors by row.
8. **Versions:**
   - networks are versioned in the registry, and reports already record the network by hash;
   - editing a network marks policies tested on an older version "re-test needed";
   - a diff view between versions.
9. **Scenario builder:**
   - scenarios composed on a timeline: outages, lead-time inflation, capacity loss, demand shifts, correlated
     shocks, signal noise;
   - parameters from the scenario schema; saved as named scenario sets;
   - a preview of what each component changes.

### One source of truth

The Python models stay authoritative. The browser uses the exported JSON Schema for instant field checks and the
API for everything else. A shared set of deliberately broken networks is tested by both the Python and the
TypeScript suites, so they cannot drift apart.

### Acceptance (proposed)

- **Build FoodNet from scratch** in the Studio (diagram, tables, map), export it, and the engine loads a network
  equal to the shipped one.
- **Errors in place:** every broken network in the shared set is rejected in the browser, with the message on the
  right element.
- **Undo and redo** restore exact states; YAML and CSV round-trip.
- **Versions:** a change to a network flags dependent policies for re-test; the diff shows exactly the changed
  fields.
- **Scenario builder:** a scenario built there generates the same draws as the same scenario written in Python.
- **End to end:** a browser test (Playwright) of build, check, quick test, save version, and build and run a scenario.

## Phase 4: LLM compiler

### Packages

- **`core/llm/provider.py`:** the `LLMProvider` protocol, with one method, `generate(system, messages, schema,
  purpose, trace_key)`, which returns text plus the model id and stop reason. Its errors are `LLMRefusal`,
  `LLMTruncated` and `LLMError`.
- **`core/llm/anthropic_provider.py`:** Claude through the official `anthropic` SDK. The model comes from `LLM_MODEL`
  (default `claude-opus-5-5`).
  - Structured outputs (`output_config.format`) carry the compile schema; forced tool choice is not available on
    current models.
  - Adaptive thinking; effort `high` to compile, `low` for prose.
  - Server-side refusal fallbacks are on by default (`fallbacks: "default"`).
  - SDK errors map to typed errors, most specific first.
- **`core/llm/mock.py`:** a deterministic provider that replays fixtures, keyed by purpose and the intent plus
  answers. A sequence of responses per key lets tests script a bad first answer.
- **`core/llm/schema.py`:** turns a Pydantic model's JSON Schema into one structured outputs accept:
  - `oneOf` becomes `anyOf`;
  - numeric bounds, string lengths, patterns, array lengths, titles and defaults are dropped (Pydantic re-checks
    them on the way back);
  - every object gets `additionalProperties: false`.
- **`core/llm/prompts.py`:** the system prompts (compile, back-translation, narrative) and the context builder:
  - the network: nodes with ids, names and regions; SKUs; suppliers with their character; lanes;
  - the active constitution, existing policies, and the vocabulary with units and bounds.
  The **prompt hash** is SHA-256 of the compile prompt template plus the API schema.
- **`core/llm/compiler.py`:** `compile_intent(intent, answers=…)`. The model returns a `CompileOutput`:
  - `name`, `scope`, `rule`;
  - a mandate draft with `term_days` instead of dates;
  - `assumptions`, `clarifying_questions` (at most 3, only for material ambiguity), `interpretation_notes`;
  - confidence for scope, rule, mandate and assumptions.

  The compiler then:
  1. parses the output;
  2. validates the schema with Pydantic;
  3. builds the `Policy` (draft, provenance with model and prompt hash);
  4. runs the deterministic validator.

  Errors go back to the model, **at most two retries**. Then a second call back-translates the DSL into plain
  language for the side-by-side check.
- **`core/llm/narrative.py`:** the optional report summary. Every number in it must appear in the report object,
  checked by extracting the numbers and matching them against the report's values in their displayed forms. If any
  number fails, it retries once with the offending numbers named.
- **`core/validate/policy.py`:** the deterministic validator, giving issues with a severity (error or warning), a
  path and a message.
  - **References:** scope nodes, SKUs, suppliers and lanes; condition and assumption variables; allocation
    priorities; sourcing suppliers and lanes.
  - **Scope:** it covers something the rule acts on.
  - **Constitution:** the policy's constitution reference matches the active one; the expedite cap, over a month,
    against the expedite budget.
  - **Sanity warnings:** days of cover below the lead time; a review period longer than the cover; a shift beyond
    the mandate with no escalation rule; air expediting where lanes only offer road.

### The 20 golden intents (`tests/fixtures/intents/`)

They cover every rule type, mandates on their own, assumptions, clarifying questions, warnings, and one intent
that names something outside the vocabulary (its first recorded answer is invalid, which exercises the retry).
Each fixture holds:
- the intent;
- the recorded model response(s);
- the back-translation;
- the expected DSL: scope, rule, mandate limits, and the numbers of assumptions, questions and attempts.

### Tests (P4 acceptance)

- All 20 golden intents compile to the expected DSL with the mock.
- References outside the vocabulary are rejected: by the schema, and by the validator for unknown ids.
- Failed validations retry with the errors passed back; after two retries compiling fails with every attempt
  recorded.
- The API schema has no unsupported keywords, `additionalProperties: false` everywhere, and no `oneOf`.
- The Anthropic provider's requests are checked against a stand-in client: model from `LLM_MODEL`, the schema in
  `output_config`, effort, fallbacks, no forced tool choice; refusal and truncation are raised.
- The narrative check rejects an invented number and accepts the real ones.

## Phase 5: registry and API

### Registry (`core/registry/`), SQLModel on SQLite

- **Tables:**
  - `networks`: id, version, content hash, body;
  - `constitutions`: id, version, body, which one is active;
  - `policies`: id, version, status, content hash, agent, owner, expiry, the network version it was written for,
    body;
  - `evaluations`: the full report, the policy version and content hash it tested, network and constitution refs,
    verdict;
  - `audit`: append-only.
- **Versions:**
  - saving a network or constitution whose content changed creates a new version (unchanged content: no new
    version);
  - editing a policy creates a new version in `draft`;
  - a version's content never changes after it is written; only a policy's status moves.
- **Lifecycle:** draft → tested → approved → deployed → retired.
  - *Tested:* an evaluation has been recorded for this exact version.
  - *Approve:* only with a **passing** evaluation (verdict `approve`) of this exact version (same content hash),
    against the **active constitution version** and the **current network version**. Otherwise the request is
    refused with the reason ("re-test needed: the network changed since the evaluation", for example).
  - *Deploy:* an approved version. Any policy already deployed for the same agent is retired, so one agent has one
    active mandate.
  - *Retire:* from any status except draft.
- **Expiry:** a deployed mandate past `expires_at` is reported as expired (once, in the audit log), and the agent
  API returns `status: "expired"` with it.
- **Re-test flags:** a tested, approved or deployed policy whose evaluation predates the current network or
  constitution version is flagged `needs_retest`. This is what P5b's Studio relies on.
- **Audit log:** every save, edit, compilation, evaluation, approval, deployment, retirement and expiry is
  appended with actor, time, object, and a payload (hashes, report id, verdict).
  - Each entry's hash is SHA-256 over its fields and the previous entry's hash: a hash chain.
  - SQLite triggers refuse `UPDATE` and `DELETE` on the table.
  - Verification recomputes the chain and reports the first entry that does not match. This catches edits made by
    going around the triggers.
- **Diffs:** a path-level JSON diff between any two versions of a policy (DSL and mandate) or a network.

### API (`api/`), FastAPI

| Endpoint | What it does |
|---|---|
| `GET /health` | liveness and versions |
| `GET/POST /networks`, `GET /networks/{id}`, `GET /networks/{id}/versions`, `GET /networks/{id}/diff` | versioned networks |
| `POST /networks/validate` | the Pydantic model's errors as a list of `{path, message}`, for the Studio (P5b) |
| `GET /constitutions/active`, `POST /constitutions`, `POST /constitutions/{id}/{version}/activate` | the constitution |
| `POST /compile` | an intent becomes a compile result: the mock by default, Claude when `LLM_PROVIDER=anthropic` |
| `GET/POST /policies`, `GET /policies/{id}`, `GET /policies/{id}/versions`, `GET /policies/{id}/{version}`, `PUT /policies/{id}`, `GET /policies/{id}/diff` | versioned policies |
| `POST /policies/{id}/{version}/evaluate` | runs the evaluation (synchronous, with replications as a parameter; P7 adds background jobs), records it, and returns the report summary |
| `POST /policies/{id}/{version}/approve`, `/deploy`, `/retire` | the lifecycle, gated |
| `GET /audit`, `GET /audit/verify` | the log, and the chain check |
| `GET /agents/{agent_id}/mandate` | the agent's active mandate: limits, escalation rules, prohibitions, rule and scope, expiry and status. 404 if it has none. |

The actor for every change is taken from an `X-Actor` header (single-user local mode, brief §3).

### Tests (P5 acceptance)

- **Approval is blocked without a passing evaluation:**
  - no evaluation;
  - a rejecting one;
  - one for an older version;
  - one against an outdated constitution or network.

  Then approval succeeds after a passing one.
- **Tampering is detected:**
  - direct `UPDATE` and `DELETE` are refused by the triggers;
  - an edit made after dropping them is found by `GET /audit/verify` at the right entry.
- **Agent mandate contract:** the response matches its published schema (a snapshot) and the brief's demo
  (`sourcing-agent-01`).
- **Lifecycle:** versions, diffs, expiry, one active mandate per agent, re-test flags after a network change.
