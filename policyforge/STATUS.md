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
