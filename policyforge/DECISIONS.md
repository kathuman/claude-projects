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
