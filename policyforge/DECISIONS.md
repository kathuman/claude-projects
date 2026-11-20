# Design decisions

One entry per non-trivial decision: context, options, choice, rationale. Newest last.

## D001: Repository location and toolchain (P1)
- **Context:** the brief defines a `policyforge/` repository with a Python 3.12 backend. The machine has Python
  3.14 and uv, but no Docker.
- **Options:** (a) a folder inside an existing repository; (b) a standalone repository.
- **Choice:** a standalone git repository at `C:\Users\kathu\policyforge`, using a uv-managed CPython 3.12.16
  virtual environment in `backend/.venv`.
- **Rationale:** the brief asks for a self-contained product with its own compose file and Makefile. 3.12 matches
  the brief exactly. Docker is needed only in P8.

## D002: Time units in the DSL (P1)
- **Context:** people state cover and lead times in days ("two weeks of cover", "lead time under 21 days") and
  persistence in weeks ("three weeks running"). The simulator works in periods.
- **Options:** everything in periods; everything in days; a mix that follows how people speak.
- **Choice:** cover, lead times and shelf life in **days**. Persistence (`for_periods`), review periods and dwell
  times in **periods** (weeks by default). The simulator converts days to periods with `ceil(days / period_days)`,
  and an order arrives at least one period after it is placed.
- **Rationale:** the compiler maps the user's words straight onto fields with fewer conversions, and so has fewer
  chances to get them wrong. Each field's description states its unit.

## D003: Bounds for thresholds that depend on the variable (P1)
- **Context:** every numeric DSL parameter must declare bounds. A condition's threshold means different things
  for different variables: a fill rate lies in 0..1, a lead time in 0..730 days.
- **Options:** a separate condition model per variable; one model with wide schema bounds plus a per-variable
  check.
- **Choice:** one `Condition` model. The schema declares wide bounds (±1e7), and a validator checks the threshold
  against the variable's own range in `vocabulary.VARIABLES`. Assumptions and authority limits work the same way.
- **Rationale:** it keeps the schema small for the LLM while still rejecting out-of-range values deterministically.
  A test checks that every number in every exported schema has both bounds.

## D004: The vocabulary is closed by construction (P1)
- **Context:** rules may reference only observable state variables, and the compiler must reject anything else.
- **Choice:** a variable name is an enum value (`Variable`). Rule conditions additionally require a *state*
  variable; assumptions may use exogenous ones. Each variable declares the qualifier it needs (a supplier or a
  node), and anything else is rejected. All models forbid unknown fields.
- **Rationale:** an unknown name fails schema validation before any custom code runs, which is exactly what the
  compiler's retry loop needs to report back to the model.

## D005: A composite holds simple rules only, and at most one replenishment rule (P1)
- **Context:** `Composite` is "an ordered list of rules with precedence". Nesting, and two replenishment rules
  competing for the same order, both make precedence ambiguous.
- **Choice:** a composite contains simple rules only (enforced by the schema's union), and at most one `BaseStock`
  or `MinMax`. Allocation, expedite and sourcing rules then refine the replenishment orders in list order.
- **Rationale:** this is the simplest interpretation that still covers every example intent in the brief.

## D006: Prohibited actions are an enum, not free text (P1)
- **Context:** the brief types `Mandate.prohibited_actions` as `list[str]`.
- **Choice:** `list[ActionKind]`, a fixed enum of 8 actions.
- **Rationale:** a free-text prohibition cannot be enforced or checked deterministically. The enum is still a list
  of strings in JSON. Adding an action is a schema change that the validator and executors can follow.

## D007: Mandate term (P1)
- **Choice:** `expires_at` is required in the model. A *before* validator fills `valid_from + 90 days` when it is
  missing from input, and no term may exceed 366 days. All datetimes are timezone-aware.
- **Rationale:** the brief calls expiry mandatory, with a 90-day default. An upper limit stops "never expires" from
  being written as a date far in the future.

## D008: Plants carry a default sourcing split (P1)
- **Context:** sourcing-switch policies move volume between suppliers, so the network needs a normal state to
  switch away from.
- **Choice:** each plant has `sourcing: [{supplier, share}]`, with shares summing to 1. In FoodNet, SUP_C has no
  normal share: it is the backup.
- **Rationale:** it is the smallest addition that makes "shift 30 % of B's volume to C" well defined.

## D009: DCs buy each SKU from the nearest plant that makes it (P1)
- **Choice:** `Network.source_plant(dc, sku)` picks the plant with the shortest lane among those that make the
  SKU. It is a fixed assignment, not an optimised one.
- **Rationale:** the simplest rule that is deterministic and plausible. Network design is out of scope.

## D010: Market deliveries happen within the period (P1)
- **Choice:** DC → market lanes carry cost and distance (for CO2), but no pipeline: demand is filled from DC stock
  in the period it arises.
- **Rationale:** markets are demand points in the brief, not stocking nodes. This keeps the state arrays to plants
  and DCs.

## D011: Freight costs recalibrated (P2)
- **Context:** the first FoodNet draft priced freight at €0.03–0.11 per case. A truck at about €1.5/km carrying
  about 1,500 cases costs roughly €0.30 per case over 300 km.
- **Choice:** lane costs of €0.15–0.70 per unit, with expedite multipliers of 2.2–2.5 (express road) and 6 (air).
- **Rationale:** with costs that low, no expedite budget in the constitution could ever bind, and the demo's
  budget-breach finding would be impossible.

## D012: Event timing and lead-time rounding (P2)
- **Choice:** the brief's order of events within a period. An order placed in period t with a lead time of L
  periods arrives at the start of t + L, with L = max(1, ceil(days / period_days)). Pipelines are arrays indexed by
  periods until arrival.
- **Consequence:** a base-stock rule's protection interval is L periods, not L + 1, because orders are placed after
  that period's demand. The analytical test uses this. `docs/PLAN.md` first said L + 1 and was corrected.

## D013: All randomness is drawn up front, per purpose (P2)
- **Choice:** `generate()` draws demand, lead times per lane and period, expedite lead times, fill rates, signal
  noise and shocks before the run, each from its own stream spawned from one `SeedSequence(seed)`. All orders
  placed on one lane in one period share that period's lead-time draw, so orders can still cross between periods.
- **Rationale:** this gives common random numbers by construction. Every policy run on the same `Draws` sees
  identical futures. Scenarios that do not change demand share its draws for the same seed, so differences
  between scenarios are not sampling noise.

## D014: Supplier shortfalls are lost, not backordered (P2)
- **Choice:** when orders exceed a supplier's capacity they are cut back pro rata, then the fill-rate draw applies.
  The short part is never delivered later; the plant's inventory position sees less pipeline and it reorders. The
  observed fill rate is shipped ÷ ordered, capacity cuts included.
- **Rationale:** this is the simplest reading of "supplier fill-rate randomness". It also makes an outage visible
  in the very state variable that sourcing triggers watch.

## D015: The plant model (P2)
- **Choice:**
  - Material from suppliers enters a production queue. Each period the plant produces all of it, unless the total
    exceeds its capacity, in which case every SKU is produced pro rata. The bill of materials is one unit of
    material per unit of product.
  - A plant's replenishment rule governs its finished goods, and its inventory position includes the queue and
    the material pipeline.
  - Plants ship what DCs order, the backlog first, as stock allows. Unshipped orders stay owed and count as the
    DC's pipeline.
- **Rationale:** this keeps one stock point per plant and SKU while still making plant capacity binding.

## D016: Forecasts (P2)
- **Choice:** each cell forecasts by exponential smoothing (α = 0.3) of the demand signal it observes, after the
  information delay. A DC observes its markets' demand, multiplied by the scenario's signal noise. A plant
  observes the orders its DCs placed. Forecasts start at the network's mean demand and ignore seasonality.
- **Rationale:** demand forecasting is out of scope (brief §3). This is the standard minimal choice, and it lets
  noise and delay propagate upstream, which is where bullwhip comes from.

## D017: How mandates are enforced in the simulator (P2)
- `order_qty_change_pct`: a positive order compared with the cell's last positive order. Outside the band, the
  order is clipped (`on_limit = block`) or applied and flagged (`flag`); either way it counts as a limit hit.
- `expedite_spend_per_period`: per rule and period, cells are expedited in a fixed order until the cumulative cost
  would pass the rule's own cap. The cap is lowered to the mandate's limit when blocking.
- `volume_shift_pct`: a switch that moves more than the limit is cut back to the limit (block) or flagged.
- `consecutive_sourcing_switches`: switches counted from the start of the run. A switch beyond the limit is
  refused (block) or flagged.
- `parameter_drift_pct` is not used in simulation: parameters do not drift inside a run.
- Escalation rules with a condition count one escalation in each period the condition has held long enough.
- Escalations = limit hits + condition escalations.

## D018: Policy precedence in a run (P2)
- **Choice:** the simulator takes an ordered list of policies, from background to foreground. For each cell, the
  last policy whose scope covers it supplies the replenishment rule and the expedite trigger. For each node, the
  last one supplies the allocation rule. Every sourcing switch applies. Cells no policy covers get a default
  base-stock rule (`background_policies`: plants 35 days, DCs 14 days).
- **Rationale:** a candidate policy usually covers part of the network. The rest must still run on something, and
  in P3 that will be the incumbent policy.

## D019: Cost categories beyond the brief's list (P2)
- **Choice:** holding, ordering, expediting, penalty and spoilage as in the brief, plus **transport** (normal
  freight), **purchase** (material at the supplier's cost index) and **production**.
- **Rationale:** without purchase cost, switching to the expensive Supplier C would look free, and the trade-off at
  the heart of the demo would vanish.

## D020: Simplifications in P2 (see LIMITATIONS later)
- DC storage capacity is not enforced; holding cost is charged on stock in nodes only, not in transit or in the
  production queue.
- Stock ages only while it sits in a node (transit time does not count towards shelf life). Spoiled stock is costed
  at unit cost.
- Allocation is fair share by default, with backlog and new demand pooled in one request.
- The order-up-to level for days of cover uses the smoothed forecast, which already lags the signal by design.

## D021: PolicyForge moves into the AI Projects repository (supersedes D001's location)
- **Context:** the user asked for PolicyForge to live in the AI apps repository (`kathuman/claude-projects`) next to
  the other projects.
- **Choice:**
  - The code lives in `policyforge/` in that repository, with its own CI workflow (`policyforge-ci.yml`: ruff,
    `mypy --strict`, pytest, coverage at least 80 %).
  - GitHub Pages serves an about page (`index.html`) and a tutorial (`tutorial.html`). The backend does not run on
    Pages.
  - The tutorial's numbers come from `backend/examples/first_stress_test.py`, and a test keeps that example
    running and its story true.
- **Rationale:** one home and one gallery for the user's apps. A public, runnable demo is proposed for after P7
  (precomputed reports, or Pyodide).

## D022: The incumbent used in the tutorial (towards P3)
- **Context:** the default background policies (35 days of cover at plants, 14 at DCs) are so buffered that the
  stress scenarios barely move service. A leaner one (7/21) runs a permanent backlog, because a plant's
  order-up-to level must exceed demand over its lead time (Supplier A: 21–24 days, plus review).
- **Choice:** the tutorial's incumbent is 10 days at DCs and 35 at plants: 97.3 % fill in normal times, 95.4 % in a
  Supplier B outage, and 84.6 % at P5 under a correlated shock (300 replications, seed 42).
- **Rationale:** stress tests need an incumbent that is healthy in normal times and visibly fragile under shocks.
  P3 will formalise this as FoodNet's incumbent policy.

## D023: Metric definitions (P3)
- **Fill rate:** the share of demand met from stock in the period it arose. Backlog is served first, so the
  period's shortfall is min(demand, end backorders + lost sales).
- **OTIF:** the share of (market, SKU, period) lines with demand that were met in full in their period.
- **Backorder units:** units of demand not met on time.
- **Stockout periods:** periods with a shortfall, averaged over lines.
- **Resilience:** peak service loss is the pre-shock weekly fill (up to 12 periods before the scenario's onset)
  minus the lowest 4-week rolling fill after it. Recovery is the number of periods from the onset until the
  rolling fill is back within 1 pp (censored at the horizon). Undefined without a shock.
- **Bullwhip ratio:** the variance over time of an echelon's total orders ÷ the variance of total consumer demand.
  Network-level, so it includes the effect of pooling.
- **Nervousness:** the mean absolute period-to-period change of a cell's orders ÷ its mean order.
- **Regret:** measured on total cost (EUR, penalties included) and on fill rate, against the best policy in the same
  replication, among the policies run on all replications.
- **CVaR:** the mean of the worst (1 − level) share of replications, in each metric's bad direction.
- **Rationale:** each is the simplest standard reading of the brief's list, chosen so that it can be computed per
  replication from recorded arrays.

## D024: The naive baseline's lead time (P3)
- **Choice:** mean demand × the mean lead time *as the simulator applies it*: whole periods, at least 1. A plant
  uses the sourcing-weighted mean over its suppliers. The target is in units, so it ignores forecasts.

## D025: Plants see the DC orders placed in the same period (P3, fixes a P2 artefact)
- **Context:** in P2, plants decided on a snapshot taken before the DCs ordered, so they saw their own demand one
  period late. Base stock with a one-period-stale position oscillates: the plants' orders varied 12 times as much
  as consumer demand, even in calm conditions.
- **Choice:** DC orders are placed first and added to the plants' backorders in the current snapshot; then plants
  decide. With an information delay, plants see that updated snapshot when the delay has passed.

## D026: What an information delay means (P3)
- **Context:** "policies see state with a configurable lag" can mean everything is late, including the agent's own
  orders. That is the textbook supply-line-blind stressor. With order = S − IP(t − d), the inventory position
  follows x(t) = x(t−1) − x(t−1−d), which is unstable for d ≥ 2 (characteristic roots of modulus 1.15). Measured:
  2 weeks of delay gave DC bullwhip ratios of 34 and plant ratios of 366, and every policy fell to 55–71 % fill.
  Adding the agent's own orders back but nothing else leaves a systematic bias (the stale position misses the
  demand since the report), and fill collapses to 13–47 %.
- **Choice (default):** stock, backorders, demand and supplier state arrive late. The agent knows the orders it
  placed itself since the snapshot, and estimates consumption since then as forecast × delay. The inventory
  position is then stale but unbiased.
- **Option:** `SimConfig(own_orders_known=False)` keeps the literal, supply-line-blind reading for teaching.
- **Rationale:** an agent executing its own orders always knows its order log. Under the default, delay and noise
  degrade service and raise bullwhip gradually:

  | Noise, delay | Incumbent fill | Incumbent DC ratio | Naive DC ratio |
  |---|---|---|---|
  | 0, 0 | 97.8 % | 1.96 | 1.85 |
  | 0.3, 2 (default bullwhip scenario) | 93.0 % | 5.34 | 3.46 |

  This makes the stressor informative instead of catastrophic.

## D027: The verdict rules (P3)
- **Choice:** deterministic rules, each reason a sentence built from the report's numbers.
  1. A hard constraint breached in more than α of replications under **normal conditions** (a scenario that is
     baseline demand only) → **reject**.
  2. Breached beyond α under **stress** → a **condition**, but only if the candidate breaches it more often than
     the incumbent, by more than 2 pp. If it breaches it as often or less, that is reported for information.
  3. Candidate against incumbent **lexicographically**, in the constitution's priority order, each objective on
     its risk measure averaged over scenarios: service = fill-rate CVaR (tolerance 0.2 pp), resilience =
     peak-service-loss CVaR (0.2 pp), cost = weekly-cost CVaR (0.5 %), carbon = mean CO2 (1 %). The first
     objective that differs beyond tolerance decides: worse → reject; better → noted.
  4. In any single scenario, a fill-rate CVaR more than 0.5 pp below the incumbent's → a condition.
  5. Escalations are reported for information.
- **Alternatives considered:** the brief's literal "a policy breaching a hard constraint in more than α cannot be
  approved", applied to every scenario.
- **Rationale:** against eight deliberately harsh scenarios, the incumbent itself breaches the constitution under
  stress (chilled service under the correlated shock, for example). Under the literal reading, no policy could
  ever be approved, and the brief's own demo ends in "approve". Approval should judge what the policy changes.
  Under normal conditions the brief's rule applies in full.

## D028: The rolling-optimisation baseline (P3)
- **Model:** an LP over 8 periods, re-planned every 4 for each replication. It plans DC orders, plant material
  orders, a production queue within capacity, stock, backorders and plant backlog. Pipelines are assumed to arrive
  evenly over the mean lead time, because policies see pipeline totals. Material arrives at the suppliers' expected
  fill rate.
- **Objective:** holding cost (DC stock 1.2× plant stock), backorder or lost-sale penalties, plant backlog, and
  soft safety-stock targets (7 days at DCs, 14 at plants; each unit below target costs half a shortage).
- **Safety targets:** without them, the plan holds no buffer and reaches only 52 % fill, a straw man. With them,
  it is a fair planning-system comparator: in normal times 94.7 % fill at €30,551/week, cheaper than the incumbent
  (97.8 %, €30,699); under the correlated shock 87.7 % against 94.0 % (50 replications, before D029).
- **Speed:** Pyomo builds the model once and its persistent interface loads it into HiGHS. The state enters as
  variables whose bounds are set to the observed values (lower = upper), changed directly through HiGHS's
  `changeColsBounds`, which keeps the basis warm. 1,300 solves take 1.2 s instead of 61 s (fixed variables
  through appsi) or about 20 s (mutable parameters). A test checks that this path solves exactly the same LP as a
  fresh Pyomo solve.
- **Finding:** re-planning *every period* performs worse (55 % fill). The LP schedules its plant safety-stock
  build-up a few weeks ahead, where capacity is free. Re-planned weekly, the build-up slides forward every week
  and never happens, and low-penalty SKUs starve. Re-planning every 4 periods executes it. This is the classic
  receding-horizon procrastination effect, and itself an example of plan-based fragility. Default: every 4.
- **Bullwhip:** its orders follow lumpy plant production, so its DC bullwhip ratio is high (about 100). This is
  reported as is.

## D029: The incumbent meets the constitution under normal conditions (P3, revises D022)
- **Choice:** FoodNet's incumbent holds 12 days of cover at DCs for chilled SKUs (10 for ambient), 35 at plants.
  At 10 days, chilled fill averaged 97.0 % and breached the 97 % constraint in half the normal-conditions
  replications. At 12 days: 98.5 %, no breaches, no extra cost, and spoilage +€3 a week.
- **Rationale:** a deployed policy complies with the constitution in normal times. Otherwise every candidate would
  be rejected for a breach it did not cause.

## D030: Seasonal forecasts (P3, optional)
- **Choice:** `SimConfig(seasonal_forecast=True)` smooths the deseasonalised signal and reseasonalises it for
  the next period. Off by default.
- **Measured on FoodNet:** fill +0.02 pp, cost −€22/week. Seasonal amplitudes are at most ±20 %, and smoothing
  with α = 0.3 already tracks them. Kept as an option for networks with stronger seasonality.

## D031: Report identity and missing values (P3)
- The report id hashes only what determines the numbers: policies without provenance timestamps, the
  constitution without its creation date, scenarios, network, run settings and the simulator config. The same
  inputs give the same id.
- Per-replication samples are `null` where a metric is undefined (no shock, so no recovery time).

## D032: A Network Studio phase, P5b (user decision, 2026-11-20)
- **Context:** networks are written by hand in YAML, and the only feedback is a Python validation error. That is
  fine for the author of one fictional network, and unusable for a planner modelling their own. The brief only asks
  for a read-only Network screen in P7.
- **Options proposed:**
  1. a standalone browser-only page before P4;
  2. a new phase after P5 (registry and API);
  3. inside P7.
- **User decisions:**
  1. A **new phase P5b, after P5**.
  2. **Add latitude and longitude** and put FoodNet on a real map.
  3. **The full scope at once**: diagram, inspector, tables, live checks, quick test, import and export, map,
     versions with diffs, and the scenario builder.
- **Consequences:**
  - The React + TypeScript frontend starts in P5b, not P7, and the Studio becomes P7's first screen.
  - `Location` gets optional `lat` / `lon`.
  - Networks become versioned registry objects in P5, so P5's design must cover them.
  - Plan: `docs/PLAN.md`, section "Phase 5b".

## D033: Structured outputs, not tool calls, carry the compiled policy (P4)
- **Context:** the brief asks for "structured output or tool calls with schema validation". On the current models
  (Claude Opus 5.5 by default), forced tool choice returns a 400, so a tool call cannot be guaranteed.
- **Choice:** the compile call uses structured outputs (`output_config.format`) with the JSON Schema of
  `CompileOutput`. That schema can't carry numeric bounds, string lengths, patterns or array lengths, and wants
  `anyOf` rather than `oneOf`, so `core/llm/schema.py` adapts it. The dropped constraints are re-checked by Pydantic
  when the answer comes back, so every bound still binds. A test checks the schema has nothing the API would
  reject.

## D034: The model writes a mandate term, not dates (P4)
- **Choice:** `CompileOutput.mandate` has `term_days` (1–366, default 90). The compiler sets `valid_from` to the
  compile time and `expires_at` to `valid_from + term`.
- **Rationale:** models are unreliable with "now", and a policy's dates must come from the system that records
  it.

## D035: Errors retry, warnings inform (P4)
- **Choice:** the deterministic validator (`core/validate/policy.py`) separates issues into two kinds:
  - **errors** (wrong ids, empty scope, a constitution mismatch, an unreachable secondary supplier) are sent back to
    the model, with at most two retries as the brief says;
  - **warnings** (cover below the replenishment time, an expedite cap that can exceed the monthly budget, a shift
    beyond the mandate, an expedite mode the lanes don't offer) go to the person signing off and do not block.
- **Calibration:** "below the replenishment time" uses the lead time in whole weeks, as the simulator applies it
  (D012), plus extra review weeks. It flags 21 days at the South plant (needs about 24) and 12 days with a
  fortnightly review (needs 14), and passes the incumbent's 10 days at DCs. Simulation agrees on all three.

## D036: Refusal fallbacks on by default (P4)
- **Choice:** `AnthropicProvider` sends `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. If the
  model declines a request, the API re-runs it on a fallback model within the same call. A request that is still
  declined raises `LLMRefusalError`. Fallbacks can be turned off (`AnthropicProvider(fallbacks=False)`).
- **Rationale:** recommended for current models. Compiling supply chain policies should never be declined, but if
  a classifier misfires, the user gets an answer rather than an error.

## D037: Golden intents are hand-authored recordings (P4)
- **Context:** no Anthropic credentials were available while building P4.
- **Choice:** the 20 golden intents' model answers were written by hand, in the shape the model must return, and
  replayed by the mock provider. They exercise every rule type, mandates on their own, assumptions with both
  sources, clarifying questions, warnings, and one out-of-vocabulary intent whose first answer is invalid, which
  exercises the retry.
- **Consequence:** the tests prove the compiler pipeline (parse, schema, build, validate, retry, back-translate,
  provenance), not the model's judgement. Once a key is set, `python -m examples.compile_intent --live "..."`
  compiles with Claude. Re-recording the fixtures from live answers, and reviewing them, would give an eval of the
  model itself.

## D038: The report narrative may cite only the report's numbers (P4)
- **Choice:** `core/llm/narrative.py` gives the model a compact view of the report: verdict, reasons, comparisons,
  breach shares, and key metrics per scenario and policy. Every number in its answer must match a value in that
  view, in one of its displayed forms (as written, rounded to 0–3 decimals, or as a percentage with 0–2 decimals).
  If any number fails, the model is asked once more with the offending numbers named. If it still invents one, no
  summary is shown.

## D039: What "a passing evaluation" means (P5)
- **Choice:** a version can be approved only when all of these hold:
  - it is `tested`;
  - its latest evaluation is of **this exact content** (same content hash: everything but status, version number
    and provenance);
  - the verdict is **approve** (approve with conditions does not pass);
  - it was run against the **active constitution version** and the **current network version**;
  - the mandate has not expired.
  Every unmet condition is reported, in words, by `GET /policies/{id}/{version}/approval-blockers`, and in the 409
  that refuses the approval.
- **Rationale:** the brief's rule ("cannot be approved without a passing evaluation run against the current
  constitution version"), taken strictly. Conditions are for a person to resolve by editing and re-testing: the
  brief's demo does exactly that.

## D040: The audit log: triggers plus a hash chain (P5)
- **Choice:**
  - every entry stores a SHA-256 over its sequence number, time, actor, action, object, payload and the previous
    entry's hash;
  - SQLite triggers refuse `UPDATE` and `DELETE` on the table;
  - `GET /audit/verify` recomputes the chain and names the first entry that is missing, does not link, or was
    altered;
  - it also returns the head hash, which can be anchored elsewhere to detect truncation.
- **Rationale:** the triggers stop accidents; the chain catches anyone who goes around them (dropping a trigger,
  editing the file). Both are tested. Writes and their audit entries share one transaction.

## D041: One active mandate per agent (P5)
- **Choice:** deploying a version retires whatever is deployed for the same `agent_id` (recorded as "superseded").
  `GET /agents/{agent_id}/mandate` returns that one mandate, or 404.
- **Rationale:** an agent must never have to choose between two mandates.

## D042: Expiry is reported, not hidden (P5)
- **Choice:** a deployed mandate past `expires_at` stays deployed, but the agent API returns it with
  `status: "expired"`, and the expiry is written to the audit log once. An expired mandate cannot be approved or
  deployed; renewing it means a new version with new dates, re-tested.
- **Rationale:** the brief: "expired mandates are flagged and the agent API returns expired". The agent learns it
  must stop, rather than silently finding no mandate.

## D043: Versions and re-test flags (P5, for the Network Studio)
- **Choice:**
  - saving a network or constitution with changed content creates a new version, and identical content is not
    duplicated;
  - policies record the network version they were written for, and evaluations the network and constitution
    versions they ran on;
  - a tested, approved or deployed policy whose evaluation predates the current versions is flagged
    `needs_retest`, and cannot be approved until re-tested.
- **Rationale:** P5b's Studio edits networks. Every change must flow through to the policies that depend on it.

## D044: The API's actor and evaluation mode (P5)
- **Choice:** the acting person comes from the `X-Actor` header (default `local-user`), as the brief's
  single-user local mode allows. Evaluations run synchronously in the request, with the number of replications
  as a parameter (default 200).
- **Rationale:** real authentication is out of scope (brief §3). Background jobs with progress come with the
  frontend (P7), where a progress indicator is required.

## D045: Networks on a world map (P5b)
- **Choice:** `Location` gains optional `lat`/`lon` (both or neither), next to the old km grid. FoodNet's nodes sit
  on plausible, still fictional, European positions. Its lane distances are now great-circle × 1.25 (a road factor),
  which changed only the CO₂ figures of the locked incumbent KPIs; the golden file was regenerated.
- **Rationale:** the Studio's map needs coordinates, and a distance computed from them is a better default than a
  number typed by hand. It is only a suggestion: a lane's `distance_km` stays the truth, so sea or rail routes can
  differ.

## D046: Two levels of checks, one source of truth (P5b)
- **Choice:**
  - `NetworkData` holds the fields; `reference_problems()` returns each cross-reference problem with the dotted
    path of the field at fault; `Network` = both.
  - The browser checks fields at once from the exported JSON Schema (Ajv). Two rewrites make errors land on the
    right field: discriminated unions become `if/then` on the tag, and `anyOf [T, null]` becomes a nullable `T`.
    Messages are reworded as Pydantic words them.
  - The server checks references and health (`POST /networks/check`), debounced while editing.
  - One fixture of broken networks (`tests/fixtures/broken_networks.json`) is run by pytest, Vitest and
    Playwright; its `browser` flag says which cases the browser alone must catch.
- **Rationale:** the brief's "never fall out of step". Cross-field rules stay in Python only, rather than being
  written twice.

## D047: The frontend stack and where the Studio runs (P5b)
- **Choice:**
  - React 18 + TypeScript (strict) + Vite 6, TanStack Query for the API, Tailwind 4 for styling, Ajv for schemas,
    the `yaml` package for files; Vitest and Playwright for tests.
  - The build is committed (`frontend/dist`, relative paths). The API serves it at `/app`, and GitHub Pages serves
    it too.
  - Without the API, the Studio still edits, checks fields, and opens and saves YAML/JSON. Reference checks,
    health, the quick test, CSV, versions and scenarios say they need the API.
- **Rationale:** the brief's stack for P7, started early. A committed build keeps Pages working without a build
  step there.

## D048: Undo is over whole network states (P5b)
- **Choice:** every edit replaces the network with a new immutable state, kept in a 200-step history. Keystrokes in
  one field within 0.8 s merge into one step. Opening a file is undoable too.
- **Rationale:** exact restores by construction (the tests compare whole documents), and no per-edit inverse to get
  wrong.

## D049: Graph edits keep the network consistent, or show where it is not (P5b)
- **Choice:**
  - Renaming a node or SKU updates every reference.
  - Deleting a supplier removes its lanes and renormalises the plants' sourcing shares.
  - Deleting a market drops its demand overrides.
  - Deleting a DC leaves its markets unserved, shown as an error, rather than guessing a new DC.
  - Drawing a DC → market lane moves the market to that DC; drawing a supplier → plant lane adds the supplier to
    the plant's sourcing with share 0.
- **Rationale:** automatic fixes only where there is one right answer; elsewhere the error says what to decide.

## D050: Broken files open, to be fixed in place (P5b)
- **Choice:** opening a YAML/JSON file loads it even when it fails validation. The CSV import endpoint returns a
  `draft` (what could be read) alongside its errors by table, row and column.
- **Rationale:** errors are easier to fix on the element than from a list in a dialog.

## D051: Scenario sets are versioned in the registry (P5b)
- **Choice:**
  - the scenario builder saves named sets, versioned like networks (the built-in default suite is version 0);
  - an evaluation can name `scenario_set` (and version);
  - `POST /scenarios/preview` shows what a scenario changes as scenario draws ÷ baseline draws with common random
    numbers, so only the scenario's effect is left. It takes the Studio's unsaved network.
- **Rationale:** the brief's "saved as named scenario sets". The ratio view shows timing and size without the
  noise.

## D052: Tables and CSV templates share one layout (P5b)
- **Choice:**
  - the Studio's tables have the columns of the CSV templates;
  - lead times are written `gamma(21, 0.08)` and sourcing `SUP_A=0.5 SUP_B=0.5`;
  - paste from Excel (tab-separated) maps columns by a header row when there is one;
  - semicolon CSVs and decimal commas are accepted (European Excel);
  - the market × SKU demand grid is base × size factor, and a typed value becomes an override.
- **Rationale:** one mental model for files and screens, and data entry from the spreadsheets people already have.

## D053: The quick test is not a verdict (P5b)
- **Choice:** 100 futures × 52 weeks of the baseline scenario with the incumbent policies. It reports fill rates by
  market and DC, utilisation and cost per week, in well under a second for FoodNet.
- **Rationale:** it answers "does this network work at all?" while editing. Stress tests and verdicts remain the
  evaluation's job.
