# Limitations

PolicyForge gives a verdict built from numbers, and numbers can look more certain than they are. This page says
what the model leaves out and where a result could mislead. Read it before relying on a verdict.

## What the simulator does not model

- **Time is weekly.** Everything happens once a period, in a fixed order (arrivals, demand, fulfilment, decisions,
  orders). Anything that happens within a week is invisible, including the order of events inside it. Lead times
  are rounded to whole periods.
- **Capacity is a single number per site.** A plant makes up to its units per week of any mix of SKUs: there are no
  changeovers, no batch sizes, no product-specific lines, no labour or shifts. A supplier ships up to its weekly
  capacity across everything it supplies.
- **DC storage is unlimited.** The network records each DC's storage capacity, but the simulator does not enforce
  it. Inventory is limited only by the policies and by the constitution's "days of stock" limit, which is checked
  afterwards, not prevented.
- **Lanes have no capacity**, and transport is a cost and CO₂ per unit or tonne-kilometre: no truckloads, no
  minimum shipments, no carriers.
- **There are no minimum order quantities, lot sizes or price breaks.** Costs are linear in volume.
- **Material is aggregate.** Plants buy "material" by supplier shares, not a bill of materials per SKU.
- **The network has fixed paths.** Each market is served by one DC, and there are no transfers between DCs, no
  substitution between SKUs and no backhauls.
- **Demand is normal noise around a seasonal mean.** Each market and SKU is independent and clipped at zero, with
  one cosine season per SKU. It has no trend (beyond scenario shifts), no autocorrelation and no promotions unless
  a scenario adds them. It does not respond to service (a stock-out does not lose the customer for next week).
  Correlations between markets or suppliers exist only inside a scenario that creates them (the correlated shock).
- **Supplier behaviour** is a fill rate drawn each week (mean and spread) and a capacity factor. There is no
  learning, no relationship and no penalty for switching volume back and forth beyond the mandate's own limits.
- **Shelf life** spoils chilled stock by age (FIFO). There is no quality grading and no markdown.
- **Agents are rule executors.** The simulator runs the DSL rules exactly as written. It does not model an LLM agent
  improvising within its mandate, or agents of different policies interacting beyond the shared network.
- **Information delay and noise** follow a simple model (delayed and noisy observed demand, own orders known by
  default). Real systems have richer failure modes: missing data, wrong data, late master-data changes.

## Where the evaluation could mislead

- **FoodNet is synthetic.** The numbers describe a fictional network. A verdict on it says what the method does,
  not what a real company should do. A real deployment needs a network calibrated on its own data.
- **The scenarios are choices.** The default suite's sizes and timings (a 30 % surge, a six-week outage) are
  plausible but arbitrary. A policy that passes the suite has passed *these* stresses. Scenarios that matter to a
  real business must be added, and the Network Studio's scenario builder is there for that.
- **Tails are estimated from few futures.** At 200 futures, CVaR at 95 % averages the worst 10. Breach shares near
  α (5 %) move by a few points from one seed to the next. Close calls deserve more futures, or several seeds.
- **The verdict is lexicographic.** The first objective on which candidate and incumbent differ decides. "Differ"
  uses tolerances, so a tiny difference in service can outweigh a large difference in cost. That is what a
  service-first constitution says, but read the comparisons, not only the verdict.
- **The incumbent is fixed.** Evaluations compare against FoodNet's encoded incumbent (35 days of cover at plants,
  10 at DCs, 12 for chilled SKUs), not against the policies actually deployed in the registry. Once several
  policies are deployed, "better than the incumbent" is no longer "better than what runs today".
- **Rolling optimisation is a simplified planner.** It is a linear program on the expected forecast, with safety
  targets, re-solved every four weeks, on a subsample of futures. It is a fair stand-in for a plan-driven process,
  but it is not a commercial APS, and its regret is not computed.
- **Interactions between policies** are evaluated only as far as the candidate is added on top of the incumbent.
  Two candidates are not tested together unless you deploy one and evaluate the other.
- **Cost includes penalties set by hand.** Backorder and lost-sale penalties per unit are inputs. Changing them
  changes which policy is "cheaper".

## The compiler

- **Offline, it only knows its recorded intents.** The mock replays 20 recorded intents and one recorded answer.
  Any other intent needs Claude (`LLM_PROVIDER=anthropic`).
- **Validation proves form, not meaning.** The schema and the validator guarantee that a compiled rule is
  well-formed, within bounds, refers only to things that exist, and uses only observable variables. They cannot
  guarantee it is the rule you meant. The back-translation and the clarifying questions are there for that, and
  reading them is the human's job.
- **The vocabulary is small** on purpose. Intents that depend on anything outside it (prices, weather, a customer's
  mood) are refused, not approximated.
- **The narrative** may cite only numbers present in the report, and this is checked. It can still emphasise the
  wrong thing.

## Monitoring

- **The live stream is simulated.** It is one replication of the same model, so it can only drift in the ways the
  injections allow (capacity, lead time, demand). Connecting real data feeds is not built.
- **Capacity is "reported".** A supplier with no volume reveals nothing about its capacity through shipments, so
  the stream assumes it reports its capacity (with 2 % noise). In reality that report may be late, optimistic, or
  missing.
- **Lead-time drift is seen late.** It is seen only as shipments arrive: one lead time after it starts, plus the
  weeks CUSUM needs to be sure.
- **Calibration is to the model.** False-alarm rates (5 % of quiet futures) and limits are computed on the stress
  test's own futures. If the model's noise is wrong, so is the calibration. A planned change (a promotion) must be
  added to the matching scenario, or it is reported as drift.
- **Exposure is a first-order estimate** (volume × value at risk), not a simulated loss. The inbox ranking is a
  prompt for attention, not a cost estimate.
- **A re-test is not a decision.** It evaluates the policy on the network as observed; acting on it (editing the
  policy, re-approving) stays with a person.

## Governance and operation

- **There is no authentication.** Whoever calls the API is who `X-Actor` says. This is the single-user local mode
  the brief allows; anything shared needs real identity in front of it.
- **The audit chain proves integrity within the database.** Triggers refuse edits, and the chain detects changes
  made around them. Someone who rewrites the whole chain consistently would not be detected: anchor the head hash
  (`GET /audit/verify`) somewhere else.
- **One process, one SQLite file.** Background jobs run in memory: a restart loses running jobs and progress bars
  (not stored results). There is no horizontal scaling.
- **Expiry is reported, not enforced on the agent.** An expired mandate stays deployed and the agent API answers
  "expired". Stopping is the agent's responsibility.
