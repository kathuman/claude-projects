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
