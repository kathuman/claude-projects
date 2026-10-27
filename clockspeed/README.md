# Clockspeed Balancing — a management flight simulator for strategy misalignment

**Live: https://kathuman.github.io/claude-projects/clockspeed/ · version 1.1.0 (phases 1–3 of 6).**

Three strategies steer the same company, at different speeds:
- **commercial strategy** changes in quarters;
- **product supply chain strategy** follows in one to two years;
- **the network** follows in three to seven years.

Every commercial move leaves the slower layers fitting a strategy that no longer exists. The misfit costs money, and
it also drains the company's inertial stocks: capability, customer trust and expectations, supplier relationships,
cross-functional trust. That drain makes the next adjustment slower. Clockspeed Balancing lets you fly a company
through 20 years of this, one quarter at a time.

The name follows Charles Fine's *Clockspeed* (1998). The approach follows Sterman's management flight simulators.

## Plan

| Phase | Content | Version |
|---|---|---|
| 1 | Model core and validation | done |
| 2 | Cockpit: quarterly decisions, instruments, 20-year run, scenarios, save and replay, About page, AI Projects entry | done, 1.0.0 |
| 3 | Debrief: the misalignment decomposition, and a timeline of each decision against when it took effect | done, 1.1.0 |
| 4 | Model tab: stock-and-flow diagram and every equation, tested against the model | 1.2 |
| 5 | Autopilots (sales-led, operations-led, aligned), more scenarios, a scored challenge | 1.3 |
| 6 | Role mode: Commercial, Product SC and Network each control only their own levers | 1.4 |

## The cockpit (`index.html`, `app.js`)

- **Briefing:** the three clocks, and a choice of six weathers.
- **Levers**, grouped by clock speed, each showing what is already in effect:
  - **Commercial:** price, service promise (with what customers now expect), promotions, launches (with the current
    range), rationalisation, markets served.
  - **Product supply chain:** inventory cover, flexible capacity, dual sourcing, each with its configuration in
    effect.
  - **Network:** capacity and what is being built per region, one-off orders and closures, automation targets.
- **Instruments:**
  - seven gauges: profit per quarter, cash, reliability, demand, capability, trust, suppliers. Each has a status shown
    with an icon and a word, not only colour;
  - three fit bars: the commercial promise kept, product supply chain fit, network fit;
  - advisories in plain words, raised when a condition starts and again when it ends;
  - a radar of decisions still in flight;
  - the regions this quarter;
  - six charts over the full 20 years with hover read-outs: money, reliability and fit, the inertial organisation,
    the promise ratchet, demand and capacity, product range.
- **Flying:** advance a quarter, a year, or to the end. Undo replays the flight without its last quarter (the model
  is deterministic). The flight autosaves in the browser and can be resumed; Save file and Load file move flights as
  JSON.
- **Landing:** a comparison with holding the starting course in the same weather.
- **About:** `about.html`, with the author.

- **Debrief** (1.1.0), on the landing card: the flight is replayed with only one strategy level moving at a time, the
  others held at the starting course. It shows what each clock made or cost on its own, what moving them together
  added (positive when they pulled together, negative when they pulled against each other), fair Shapley shares that
  add up exactly to the gap against the starting course, and a timeline of every decision against when about
  two-thirds of it was in effect at that level's tested clock speed.

The cockpit checks (`tests/cockpit.test.js`, 19, in CI) run the page in a simulated DOM: briefing, take-off, advance a
quarter and a year, undo, a whole flight through the cockpit's own decisions, the landing card and its debrief
(figures checked against the model), refusing a bad flight file, resuming an autosaved flight, and no script errors.
The simulated DOM has no layout, so drawing and phone width are not covered there.

## The model (`src/model.js`)

Two product segments in three regions (Europe, Americas, Asia):
- **F (functional):** stable demand, price-sensitive.
- **I (innovative):** volatile demand, sensitive to service and product range.

Time is in months. Euler integration with a step of 1/4 month, decisions once a quarter, 80 quarters.

**Decisions:**

| Level | Levers | Clock speed (time to 63% of the effect, tested) |
|---|---|---|
| Commercial | price and service promise per segment, promotion intensity, SKU launches and rationalisation, presence per region | about 4 months |
| Product supply chain | inventory cover, reserved flexible capacity and dual sourcing per segment. The actual configuration chases the decided one over about 9 months, faster with capability and trust | about 10 months |
| Network | capacity orders (a third-order pipeline of 30 months), closures (12 months, with write-off and severance), automation (18 months) | about 33 months |

**Market:**
- Our share in each segment and region moves toward a logit share of our attractiveness against competitors.
- Attractiveness = price^−ε × (perceived reliability / reference)^β × (promise / expected promise)^π × (range / start)^ρ.
- Promotions lift demand now and pull part of it forward.
- Customers notice failures in about 3 months and recoveries in about 12.
- Expectations of the promise rise in about 12 months and fall in about 36. Customers come to expect the best promise
  on offer, ours or a competitor's.

**Operations:**
- Effective capacity = capacity × (0.75 + 0.25 × capability) × a complexity drag from range growth × any disruption.
  Dual sourcing softens disruptions.
- Reserved flexible capacity is delivered only as well as supplier relationships allow.
- Shortfalls are imported from regions with spare capacity: slower and costlier, and dearer under tariffs.
- **Required responsiveness:** volatility (which rises with range and promotions) × promise^1.5.
- **Achieved responsiveness:** √capability × (cover + flexibility × supplier relationship) × locality × congestion.
- Missed orders = 5% × e^(−3·(achieved/required − 1)). They are expedited at a cost, and they feed firefighting.

**Organisation (the inertial stocks):**
- **Capability** moves toward 0.95 × √(1 − firefighting). Firefighting comes from misses, expediting and the load of
  change in progress. It is lost faster than it is built.
- **Cross-functional trust** falls when promises are missed and when commercial strategy churns.
- **Supplier relationships** suffer from expediting and promotions.
- **Product range** grows with launches and shrinks with retirement over about 3 years.
- **Book value** of the network and cash.

**Scenarios:**
- Calm skies.
- Innovation wave: demand shifts toward innovative products.
- Eastern growth: Asia doubles.
- Promise war: competitors promise faster delivery.
- Storm: a European supply disruption, then tariffs.
- Perfect storm: all of them.

**Starting point:** the model starts in its own equilibrium. Customers' and the organisation's stocks are settled
first, and the requirement is calibrated so that the starting configuration fits its strategy.

**API:**
- `Clockspeed.create(params, scenario)` gives a simulator. Call `sim.quarter(decisions)` up to 80 times.
- `sim.decisions()` returns the standing decisions. Capacity orders and closures are one-off and reset each quarter.
- `Clockspeed.run(params, scenario, policy)` plays a whole game with a policy function.

## Tests

`node clockspeed/tests/model.test.js` runs 42 checks:
- **Set-up:**
  - the company starts as designed: demand of 1,000 a month, utilisation about 0.87, fitted on every level, and the
    organisation in equilibrium;
  - a steady strategy in calm skies changes nothing for 20 years;
  - runs are deterministic.
- **Accounting:**
  - product range, capacity (built or still in the pipeline), and cash = ∫profit − ∫capex − severance;
  - write-offs on closure;
  - served + lost = demand, with every share in [0, 1].
- **Clock speeds:** commercial 4 months < product supply chain 10 months < network 33 months.
- **Promise ratchet:**
  - three years after a faster promise is withdrawn, customers still expect more of it;
  - demand stays below its old level (956 against 1,000);
  - a bigger overreach casts a longer shadow.
- **Unsupported push:**
  - revenue rises in the first quarter;
  - then reliability, capability and trust fall, and revenue ends below where it started;
  - supporting the push beats pushing alone (795k against 484k);
  - pacing it (support first, push two years later) beats doing both at once (855k).
- **Firefighting:**
  - an overreach erodes capability, and rebuilding takes years;
  - changing too much at once loads the organisation.
- **Complexity:**
  - doubling launches doubles the range, cuts effective capacity and raises cost;
  - a range takes about 2 years to halve once launches stop.
- **Resilience:** in the storm, dual sourcing keeps Europe supplied, with no imports and reliability 0.941 against
  0.908.
- **Scenarios, strategy unchanged:**
  - in the innovation wave, product supply chain fit falls to 0.90;
  - in Eastern growth, network fit falls to 0.85 and imports grow;
  - in the promise war, demand falls to 897. Preparing the supply chain and then matching the competitors keeps 974.
- **Debrief:**
  - holding the course has no gap and an empty timeline;
  - replaying every level reproduces the flight's own profit exactly;
  - the Shapley parts, and each level alone plus the interaction, both add up exactly to the gap;
  - in the promise war, matching alone loses 62k, preparing alone gains 65k, and preparing then matching gains 161k:
    159k of it comes from moving the two clocks together;
  - a flight that moves only one clock is charged entirely to it;
  - decisions taken in the same quarter land commercial first, then product supply chain, then network.
- **Numerics:**
  - halving the time step changes 20-year profit by 0.02%;
  - decisions are clamped to their limits;
  - extreme strategies stay finite.

## Found while building phase 1

- **Capacity orders must be one-off.** A first version carried them forward as standing decisions, so one order was
  repeated every quarter for 20 years.
- **Expectations follow the best promise on offer.** At first they followed only ours, with the competitors' promise
  added on top. Matching a competitor then raised our own bar and gained nothing (900 against 896). With the
  correction, matching keeps 974 against 897.
- **A push and its support must not overload the organisation.** At first, the implementation load of supporting
  changes was strong enough that support made a push worse. It is now a moderate cost, still enough that changing
  everything at once dips capability.
- **Capability recovers in about three years after an overreach ends.** At these settings the firefighting trap slows
  recovery but does not lock the company in.
