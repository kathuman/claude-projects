# Clockspeed Balancing — a management flight simulator for strategy misalignment

**Live: https://kathuman.github.io/claude-projects/clockspeed/ · version 1.2.0.**

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

| Version | Content | Status |
|---|---|---|
| 0.1 | Model core and validation | done |
| 1.0 | Cockpit: quarterly decisions, instruments, 20-year run, scenarios, save and replay, About page, AI Projects entry | done |
| 1.1 | Debrief: the misalignment decomposition (each clock alone, together, Shapley shares) and a timeline of each decision against when it took effect | done |
| 1.2 | **Make the tension real:** no strategy set once may beat steering. Competitor response, obsolescence, automation rigidity, NPV, the capability trap and the improvement programme, seeded uncertain weather, an aligned autopilot, and a no-free-lunch search in CI | done |
| 1.3 | Debrief, deeper: decision markers on the charts, branch and replay from any quarter, key moments (when the trap started, when the ratchet bit) | next |
| 1.4 | Model tab: stock-and-flow diagram, every equation tested against the model, a live view of which loop dominates, a validation report | |
| 1.5 | Autopilots (sales-led, operations-led) beside the aligned one, an optimised benchmark, missions with a par, a daily seeded challenge, shareable flight links | |
| 1.6 | Learning layer: a 3-level tutorial, facilitator notes, Spanish, a data-table alternative for every chart | |
| 2.0 | Role mode and classroom: Commercial, Product SC and Network each control only their own levers and see their own KPIs; hot-seat, then online | |

## The cockpit (`index.html`, `app.js`)

- **Briefing:** the three clocks, a choice of six weathers with the range each is drawn from, and *uncertain weather*
  (on by default): the flight gets a seed that draws its timing and size and makes demand noisy. Unticked, the central
  path is flown exactly.
- **Levers**, grouped by clock speed, each showing what is already in effect:
  - **Commercial:** price, service promise (with what customers now expect), promotions, launches (with the current
    range), rationalisation, markets served.
  - **Product supply chain:** inventory cover, flexible capacity, dual sourcing, each with its configuration in
    effect, and the improvement programme.
  - **Network:** capacity and what is being built per region, one-off orders and closures, automation targets.
- **Instruments:**
  - seven gauges: profit per quarter, cash, reliability, demand, capability, trust, suppliers. Each has a status shown
    with an icon and a word, not only colour;
  - three fit bars: the commercial promise kept, product supply chain fit, network fit;
  - advisories in plain words, raised when a condition starts and again when it ends, including the drawn weather's
    events, competitors matching a price cut, improvement stalling under firefighting, and interest on debt. The
    whole flight's log is kept; the latest 60 are shown;
  - a radar of decisions still in flight;
  - the regions this quarter;
  - six charts over the full 20 years with hover read-outs: money, reliability and fit, the inertial organisation,
    the promise ratchet, demand and capacity, product range.
- **Flying:** advance a quarter, a year, or to the end. Undo replays the flight without its last quarter (the model
  is deterministic given the seed). The flight autosaves in the browser and can be resumed; Save file and Load file
  move flights as JSON with their seed. A 1.0 file has no seed and replays on the central path, as it was flown.
- **Landing:** the score is net present value at 8% a year, against holding the starting course and against the
  aligned autopilot, both flying the same weather.
- **About:** `about.html`, with the author.

- **Debrief** (1.1.0), on the landing card: the flight is replayed with only one strategy level moving at a time, the
  others held at the starting course, in the flight's own weather, and measured in net present value (1.2.0). It shows what each clock made or cost on its own, what moving them together
  added (positive when they pulled together, negative when they pulled against each other), fair Shapley shares that
  add up exactly to the gap against the starting course, and a timeline of every decision against when about
  two-thirds of it was in effect at that level's tested clock speed.

The cockpit checks (`tests/cockpit.test.js`, 19, in CI) run the page in a simulated DOM: briefing, take-off, advance a
quarter and a year, undo, a whole flight through the cockpit's own decisions, the landing card and its debrief
(figures checked against the model), refusing a bad flight file, resuming an autosaved flight, and no script errors.
The simulated DOM has no layout, so drawing and phone width are not covered there.

Browser checks (23, run locally with Playwright for 1.2) cover the seed and the central path, the improvement lever and the radar, undo, resume
and flight files replaying the same weather, a 1.0 file without a seed, the drawn events in the log, the landing
against both references, the matched-price-cut and stalled-improvement advisories, phone width and the About page.

## The model (`src/model.js`)

Two product segments in three regions (Europe, Americas, Asia):
- **F (functional):** stable demand, price-sensitive.
- **I (innovative):** volatile demand, sensitive to service and product range.

Time is in months. Euler integration with a step of 1/4 month, decisions once a quarter, 80 quarters.

**Decisions:**

| Level | Levers | Clock speed (time to 63% of the effect, tested) |
|---|---|---|
| Commercial | price and service promise per segment, promotion intensity, SKU launches and rationalisation, presence per region | about 6 months |
| Product supply chain | inventory cover, reserved flexible capacity and dual sourcing per segment. The actual configuration chases the decided one over about 9 months, faster with capability and trust | about 11 months |
| Network | capacity orders (a third-order pipeline of 30 months), closures (12 months, with write-off and severance), automation (18 months) | about 33 months |

**Market:**
- Our share in each segment and region moves toward a logit share of our attractiveness against competitors.
- Attractiveness = (price / competitors' price)^−ε × (perceived reliability / reference)^β × (promise / expected
  promise)^π × (range / start)^ρ.
- **Competitors match a price cut** within about 6 months, and drift back over about 3 years once we are no cheaper.
  They do not follow a rise. The demand curve is kinked at the going price, so a cut buys share only for a while and
  a rise loses customers.
- **Customers punish unreliability more than they reward reliability** beyond what they are used to: above the
  reference, β is cut to a quarter.
- Promotions lift demand now and pull part of it forward.
- Customers notice failures in about 3 months and recoveries in about 12.
- Expectations of the promise rise in about 12 months and fall in about 36. Customers come to expect the best promise
  on offer, ours or a competitor's.

**Operations:**
- Effective capacity = capacity × (0.75 + 0.25 × capability) × a complexity drag from range growth × any disruption
  × the share an improvement programme takes. Dual sourcing softens disruptions.
- Reserved flexible capacity is delivered only as well as supplier relationships allow.
- Shortfalls are imported from regions with spare capacity: slower and costlier, and dearer under tariffs.
- **Required responsiveness:** volatility (which rises with range and promotions) × promise^1.5.
- **Achieved responsiveness:** √capability × (effective cover + flexibility × supplier relationship) × locality ×
  congestion × (1 − rigidity × automation).
- **Fisher's matching:** cover has diminishing returns (it saturates at about 6 weeks for functional products and 3
  for innovative ones), and innovative stock goes obsolete at 4% a month against 0.5%. Automation costs
  responsiveness, five times more for innovative products. Efficient supply suits functional products; responsive
  capacity suits innovative ones.
- Missed orders = 5% × e^(−3·(achieved/required − 1)). They are expedited at a cost, and they feed firefighting.

**Organisation (the inertial stocks):**
- **Capability** moves toward 0.25 + 0.70 × (1 − firefighting)². Firefighting comes from misses, expediting and the
  load of change in progress. It is lost faster than it is built, and **building stalls** as firefighting nears 30%:
  the time needed to improve is taken by fighting fires (Repenning and Sterman). A long overreach tips the company into
  a trap it does not leave when the pressure ends.
- **The improvement programme** protects time for improving: it halves the firefighting that capability feels and
  builds capability faster. It costs up to 600 a month and 5% of capacity, so it gets worse before it gets better, and
  in a healthy company a permanent programme does not pay.
- **Cross-functional trust** falls when promises are missed and when commercial strategy churns.
- **Supplier relationships** suffer from expediting and promotions.
- **Product range** grows with launches and shrinks with retirement over about 3 years.
- **Book value** of the network and cash. Negative cash pays 12% a year.

**Money and score:** net present value of the monthly cash flow (profit − capex − interest, and severance) at 8% a
year.

**Scenarios** (central path; a seeded flight draws from the range):
- Calm skies.
- Innovation wave: demand shifts from functional to innovative products, keeping the total, and innovative demand
  grows more volatile. Starts in year 2 (2–4), takes 6 years (5–8), shifts 45% (30–60%).
- Eastern growth: Asia grows 100% (60–140%), from year 4 (3–5) over 9 years (8–10).
- Promise war: competitors promise 30% (20–40%) faster from year 5 (4–6).
- Storm: Europe loses 40% (30–50%) of its supply for 10 months (6–14) from year 5 (4–7); tariffs raise the cost of
  moving goods between regions by 100% (60–140%) from year 7 (6–9).
- Perfect storm: all of them.

A seeded flight also has demand noise: AR(1) with a 3-month correlation time, 3% for functional and 10% for
innovative products in each region.

**Starting point:** the model starts in its own equilibrium. Customers' and the organisation's stocks are settled
first, and the requirement is calibrated so that the starting configuration fits its strategy.

**API:**
- `Clockspeed.create(params, scenario, seed)` gives a simulator. Call `sim.quarter(decisions)` up to 80 times. Without
  a seed it flies the central path with no noise. `sim.weatherParams` and `sim.events` describe the weather it flies.
- `sim.decisions()` returns the standing decisions. Capacity orders and closures are one-off and reset each quarter.
- `Clockspeed.run(params, scenario, policy, seed)` plays a whole game with a policy function.
- `Clockspeed.aligned` is the aligned autopilot, a policy. Each quarter it reads the cockpit, smoothed over 6–12
  months. It adds flexible capacity while the product supply chain falls short, matches customers' expected promise
  once the supply chain can carry it, and orders capacity ahead of growth that shows over both half a year and a year.
- The settled starting state is cached per set of parameters, so a run takes about 12 ms.

## Tests

`node clockspeed/tests/model.test.js` runs 62 checks:
- **Set-up:**
  - the company starts as designed: demand of 1,000 a month, utilisation about 0.87, fitted on every level, and the
    organisation in equilibrium;
  - a steady strategy in calm skies changes nothing for 20 years;
  - runs are deterministic.
- **Accounting:**
  - product range, capacity (built or still in the pipeline), and cash = ∫profit − ∫capex − severance;
  - write-offs on closure;
  - served + lost = demand, with every share in [0, 1].
- **Clock speeds:** commercial 6 months < product supply chain 11 months < network 33 months.
- **Promise ratchet:**
  - three years after a faster promise is withdrawn, customers still expect more of it;
  - demand stays below its old level (941 against 1,000);
  - a bigger overreach casts a longer shadow.
- **Unsupported push:**
  - revenue rises in the first quarter;
  - then reliability, capability and trust fall, and revenue ends below where it started;
  - supporting the push beats pushing alone (566k against 107k of 20-year profit);
  - pacing it (support first, push two years later) beats doing both at once (740k).
- **Firefighting:**
  - an overreach erodes capability, and rebuilding takes years (71% of the loss back seven years later);
  - changing too much at once loads the organisation.
- **The capability trap:**
  - three years of overreach leave capability at 0.37 eight years after the promise is withdrawn (0.81 at the start);
  - an improvement programme lifts it to 0.76 within three years and pays for itself (NPV 372k against 306k);
  - the programme gets worse before it gets better, and a permanent one does not pay in a healthy company.
- **Complexity:**
  - doubling launches doubles the range, cuts effective capacity and raises the cost per unit;
  - a range takes about 2 years to halve once launches stop.
- **Resilience:** in the storm, dual sourcing keeps Europe supplied, with no imports and reliability 0.936 against
  0.902.
- **Scenarios, strategy unchanged:**
  - in the innovation wave, product supply chain fit falls to 0.82;
  - in Eastern growth, network fit falls to 0.85 and imports grow;
  - in the promise war, demand falls to 893. Preparing the supply chain and then matching the competitors keeps 934.
- **Debrief:**
  - holding the course has no gap and an empty timeline;
  - replaying every level reproduces the flight's own profit and NPV exactly;
  - the Shapley parts, and each level alone plus the interaction, both add up exactly to the gap;
  - in the promise war, matching alone loses 86k of NPV, preparing alone loses 3k (stock is no longer free), and
    preparing then matching gains 29k: the interaction is worth 117k, so the whole gain comes from moving the two
    clocks together;
  - a flight that moves only one clock is charged entirely to it;
  - decisions taken in the same quarter land commercial first, then product supply chain, then network.
- **No free lunch (1.2):**
  - in calm skies no lever moved once and held gains more than 2% of NPV (best +1.3%), and none of 150 random
    strategies set once does (best −4.3%);
  - the set-and-forget strategy that won 1.0 by 45–59% in every weather now loses 24–48% in every weather.
- **The mechanisms (1.2):** a price cut is matched and its extra demand fades within two years; a rise loses
  customers; in the innovation wave flexible capacity for innovative products pays (+21%) where 12 weeks of cover does
  not; that cover costs more than it earns in calm skies; full automation costs 16% in calm skies and 39% in the
  innovation wave; negative cash pays interest, with exact cash accounting; NPV discounts every month.
- **Seeded weather (1.2):** a seed replays exactly; 200 draws stay inside the briefing's ranges; the advisories'
  events follow the draw; seeded demand is noisy (±28 a month), the central path is not.
- **Steering pays (1.2):** averaged over eight seeded weathers, the aligned autopilot beats holding course by 3% or
  more wherever the weather changes the business (by 7% to 47%) and holds even in the storm. It beats the best of 120
  strategies set once by 10% in the promise war and 4% in the perfect storm, and comes within 2% of it in the
  innovation wave and Eastern growth, where preparing early for a trend the briefing announced is fair anticipation.
- **Numerics:**
  - halving the time step changes 20-year profit by 0.02%;
  - decisions are clamped to their limits;
  - extreme strategies stay finite.

## Found while building 1.2

- **1.0 and 1.1 could be won in the first quarter.** Setting innovative price ×1.4, rationalising 30% a year, 12 weeks of
  cover and full automation once, then never touching a lever, beat holding course by 45–59% in every weather with
  100% reliability. Innovative demand was price-inelastic, and nothing answered a price rise. Stock never dated,
  reliability beyond the reference kept paying, the range was barely valued, and money had no time value. The
  no-free-lunch checks were written first and watched failing (+42.6% for the best random set-once strategy, +12.5% for
  one nudge of the innovative price).
- **Competitors that follow rises make the exploit worse.** Partial following lowers the long-run elasticity. The
  kinked curve (cuts matched, rises not) puts the optimum at the going price.
- **A trap needs a floor and a stall.** With capability allowed to fall to zero, long overreaches collapsed it to 0.03,
  which is not credible. With a floor of 0.25 alone, every overreach healed. The trap comes from building that stalls
  as firefighting takes the time to improve, which is Repenning and Sterman's mechanism.
- **Noise punishes naive steering.** The first autopilot projected one-sided monthly trends over the 30-month build
  and ratcheted capacity up on noise, losing to holding course even in calm skies. It now smooths over 6–12 months and
  acts only on growth of 8% a year that shows in both windows. Players face the same lesson.
- **The innovation wave grew the total market**, so it stressed the network, not the product supply chain. It is now
  a shift that keeps the total, with innovative demand growing more volatile.
- **Rounding drawn months to whole quarters** let a 6–14-month storm last 15 months. Draws are now whole months, and a
  check holds every draw to the briefing's range.
- **The advisory log dropped its oldest entries after 60**, losing the early weather events by landing. The radar did
  not refresh while a slider moved, and the gauges' "start" values included the first quarter's decisions. All three
  are fixed.

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
  recovery but does not lock the company in. (1.2 changed this on purpose: see above.)
