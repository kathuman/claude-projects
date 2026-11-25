# Warehouse Compare

Three order-picking warehouses compared on equal terms: **the same SKUs, the same orders and the same storage
capacity**.

| | Layout | Who travels | Status |
|---|---|---|---|
| **WH-A** | Moving racks: robots carry racks (pods) to fixed picking stations and put them back after picking wherever a put-away policy decides. The default policy brings popular pods closer to the stations | the racks (goods-to-person) | **phase 3 — done** |
| **WH-B** | Semicircular, a D-shaped building with the picking points at the middle of the flat wall: **radial** rows pointing out from an open hub, or **concentric** rows along arcs cut by radial aisles | the picker (person-to-goods) | **phase 2 — done** |
| **WH-C** | Rectangular, the [Warehouse Model](../warehouse-model/)'s layout | the picker (person-to-goods) | **phase 1 — done** |

The unit of work is the **order line**. Every layout is sized to the **smallest footprint that holds at least
`target_locations` storage locations**, so floor area is a result, not an input.

## How it is measured

```text
data/scenario.json ──► scenario.resolve() ──► the same sc (demand, pickers) for every layout
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
   layouts/wha.js            layouts/whb.js            layouts/whc.js ◄── warehouse-model computeLayout()
          └──────────── each builds a travel network (graph.js) ┘
                                     │
                     graph.keyMatrix(): shortest path between every
                     picking point and access point
                                     │
          demand.js (seeded orders) ─► slotting.js ─► routing.js ─► kpi.js   (WH-B, WH-C)
                                    └──────────► rmfs.js: discrete-event simulation (WH-A)
                                                 both report one KPI contract, with a trace
```

- **One distance engine.** The Warehouse Model uses closed-form rectilinear formulas, which only work for straight
  rows. Here every layout is a graph and travel is always the shortest path through it. That works for arcs,
  radial aisles and moving racks just as well as for rows.
- **WH-C is checked against the original.** Built from the Warehouse Model's own `computeLayout()`, its network
  reproduces two of that model's formulas to within 10⁻⁶ m:
  - door → slot travel from `slotGrid()`
  - aisle-to-aisle travel from `dcPair()`

  The check runs on the baseline and on 40 random designs (I/U-flow, 0–3 mid cross-aisles, every rack type).
  Breaking the cross-aisle links on purpose makes 41 of these checks fail.
- **WH-A is simulated, not estimated.** Its performance depends on what happened before: which pods are where,
  which orders are open at each station, and which robots are free. So [rmfs.js](src/rmfs.js) runs it event by
  event:
  - Orders arrive at the peak rate into a backlog.
  - Each station keeps `order_slots` orders open and claims the pod holding most of their lines.
  - The nearest idle robot drives under it, lifts it and brings it to the station, where it queues.
  - The picker takes every matching line on the pod (*pile-on*).
  - A robot puts the pod back where the **put-away policy** says:
    - `fixed`: its home slot
    - `random`: any free slot
    - `nearest`: the free slot nearest the station it left
    - `frequency` (default): the slot whose distance rank matches the pod's popularity rank, from smoothed visit
      counts

  WH-A is then sized on the same terms as the other two. It gets as many picker-stations as the peak needs, using
  the same staffing rule as WH-B/WH-C, and the smallest robot fleet that keeps the mean wait for a station within
  `max_order_wait`.

  The WH-A tests check:
  - the floor geometry, and station → slot distances against a closed form
  - one robot, one station and one pod against a hand-computed cycle
  - pod and slot conservation
  - "one robot fewer doesn't keep up"
  - the behaviour of each policy, including the demand shock

  Each check was mutation-tested. Not modelled: robot congestion (the speed is an effective speed), charging
  (`robot_availability`), and pods passed from station to station.
- **Demand curve.** The default is Bender's F(u) = (1 + A)u / (A + u), which puts `demand_skew` % of lines on the
  top 20% of SKUs. The Warehouse Model's u^k matches it at the 20% point, but gives the single top SKU of 6,000 about
  30% of all lines. That top SKU would make one pod a false bottleneck in WH-A, and it flattered WH-B's radial rows
  (see below). u^k remains selectable.
- **Paired comparison.** Orders come from a seeded stream (the popularity curve above, or your own data;
  geometric lines per order), so every layout picks exactly the same orders.
- **Layout-agnostic routing.** S-shape and largest-gap routing were designed for rectangular warehouses and would
  favour WH-C. Instead, each order's tour is exact (Held–Karp) up to 9 stops, and nearest neighbour + 2-opt
  above that.
- **WH-B is checked by closed forms and geometry.** Starting from a picking point at the centre of the hub, the
  walk to every location matches a closed-form distance:
  - radial, first zone: exactly the straight-line distance
  - radial, second zone: radius + ring radius × angle to the nearest inner aisle
  - concentric: aisle radius × (1 + angle to the nearest radial aisle)

  The tests also prove the geometry on the scenario and 40 random designs:
  - no two bays overlap
  - neighbouring units keep the flue gap
  - every bay lies inside the half-disc and outside the hub
  - every aisle path keeps half its width clear. The only exception is a chord bay's face bowing into a curved
    aisle, which is at most w²/8r.

  Each check was mutation-tested: breaking the code on purpose makes it fail.
- **Same racks, different arrangement.** WH-B inherits WH-C's rack dimensions and picking points; its floor area is
  πR²/2 to the outermost rack corner.
- **Slotting** is random, ABC classes, or ranked (the k-th most popular SKU goes in the k-th closest location).
  Random and ABC are judged **in expectation over every possible slotting**: each order's SKUs get fresh
  locations, uniform over their class. With a single draw, the few top SKUs land near or far by luck, and that
  luck moved WH-C's travel per line by ±15% between seeds.
- **KPIs:** locations, floor area, locations/m², travel per order and per line, picker time per line,
  lines per picker-hour, pickers needed at the peak, and share of time walking. Each comes with a readable trace of
  how it was derived.

## The views

- **WH-A / WH-B / WH-C:** each plan at one scale, coloured by travel time or by the popularity class stored
  there. It can show the travel network and one sample order: walked in WH-B and WH-C, robot trips in WH-A.
- **Side by side:** 20 minutes of the peak hour with the same orders in all three ([replay.js](src/replay.js)).
  Pickers walk the travel network's real paths, arcs included; WH-A's robots replay the simulation's own legs.
- **Sensitivity:** vary skew, lines per order, volume, capacity or pick time, and chart any result for all three
  ([experiments.js](src/experiments.js), [charts.js](src/charts.js)). Every point re-sizes all three
  warehouses.
- **Demand shock:** see the findings below.
- **3D:** the 3D button on a plan shows the same layout in three.js, reusing the Warehouse Model's vendored copy:
  shelving to the top of the top load, WH-A's pods as they stand at the end of the simulation, coloured like the
  plan, with orbit and zoom ([scene3d.js](src/scene3d.js) describes the boxes and is tested;
  [view3d.mjs](src/view3d.mjs) draws them, rendering only when something changes).
- **Your order data:** import a CSV of order lines (an order column and a SKU column; a date column is optional;
  headers in English, Spanish or Danish; comma, semicolon or tab). The comparison then uses the data's own
  popularity curve, lines per order, largest order and lines per day, with storage sized to the data's SKUs at the
  scenario's 85% fill. "Try the sample data" loads [data/sample-orders.csv](data/sample-orders.csv) (two days,
  3,000 orders, made by [tools/make_sample.py](tools/make_sample.py)). Files are read in the browser and never
  uploaded ([dataimport.js](src/dataimport.js)).
- **Cost:** build cost, cost per year and cost per 1,000 lines for each layout ([cost.js](src/cost.js)):
  - Building, storage (shelving or pods), stations and robots are turned into annual costs with the Warehouse
    Model's capital-recovery factor.
  - Pickers are paid for the hours the day's lines take: lines × time per line ÷ efficiency. No layout is charged
    for a peak-hour crew all day.
  - Robots add upkeep.

  All figures are illustrative, not a quotation.
- **Share links:** the URL always carries the inputs you changed (`#s=…`), and "Copy link" copies it
  ([share.js](src/share.js)). A link is untrusted input, so only inputs the scenario defines are accepted:
  numbers are clamped to their range and choices are limited to their options. Imported data is not carried in
  a link.
- **Languages:** English, Latin American Spanish and Danish (`?lang=es|da`, or the selector in the header).
  Danish uses decimal commas and thousands points.
  - Every message, control, choice and page text comes from one table, [tools/translations.py](tools/translations.py),
    built into `i18n-es.js` and `i18n-da.js` by `tools/build_i18n.py`.
  - [tests/i18n.test.js](tests/i18n.test.js) fails if anything is untranslated or left over.
  - CI fails if the built files are out of date.
  - WH-C's own layout warnings come from the Warehouse Model and stay in English.
- **About:** [about.html](about.html) has the author and how to cite the app.

Chart colours were checked with the dataviz palette validator against the navy chart surface `#0a2f52`:
- WH-A/B/C (blue, orange, aqua) pass every pair.
- The four WH-A policies (yellow, magenta, green, violet) pass adjacent pairs.

Every chart has a crosshair tooltip, a legend, direct labels and a table view.

## Run

Open `index.html` through any static server from the repository root, because the page loads
`../warehouse-model/`:

```bash
python -m http.server 8765    # then http://127.0.0.1:8765/warehouse-compare/
```

Tests (Node ≥ 18, no dependencies):

```bash
node warehouse-compare/tests/whc.test.js    # WH-C graph = Warehouse Model formulas; equal-capacity sizing
node warehouse-compare/tests/wha.test.js    # WH-A floor, hand-computed cycle, conservation, fleet sizing, put-away, shock
node warehouse-compare/tests/experiments.test.js   # animation timelines (continuity, speed), sweeps (monotone), the shock
node warehouse-compare/tests/cost.test.js          # cost by hand, in the comparison; share links (round trip, hostile links)
node warehouse-compare/tests/dataimport.test.js    # order-line import: hand-checked file, formats, languages, bad files, sample
node warehouse-compare/tests/scene3d.test.js       # what the 3D view draws
node warehouse-compare/tests/i18n.test.js          # every text translated into Spanish and Danish
node warehouse-compare/tests/whb.test.js    # WH-B closed-form distances, bay geometry, aisles clear, sizing
node warehouse-compare/tests/core.test.js   # graph, demand, routing vs brute force, slotting, KPIs
```

## Findings so far

Default scenario: 7,000 locations, 6,000 SKUs, 80/20 demand (Bender), 3 lines per order on average, 12,000
lines a day, peak 1,125 lines/h.

| | WH-A moving racks | WH-B radial | WH-B concentric | WH-C rectangle |
|---|---|---|---|---|
| Floor area | 2,011 m² | 2,142 m² | 1,500 m² | 1,411 m² |
| Picker time per line | 21.5 s | 34.0 s | 35.1 s | 34.5 s |
| Pickers at the peak | **9** | 14 | 14 | 14 |
| Robots at the peak | 32 | — | — | — |

### WH-A: what put-away buys

Same floor and the same orders throughout. Popular pods' distance is the popularity-weighted loaded distance of
pods to their nearest station. The demand shock moves popularity half-way down the SKU order at 3 h.

| Policy | Steady demand | After a demand shock |
|---|---|---|
| fixed, ranked placement | best: 30 robots, popular pods 10 m from the stations | stays stuck at 25 m |
| nearest | 33 robots, popular pods about 22 m away: it never sorts pods by popularity | barely notices the shock |
| frequency (default) | 32 robots, popular pods about 15 m away | jumps to 22 m, then re-learns to about 17 m within roughly 1.5 h |

- **Robots replace walking, not picking.** WH-A's picker spends 21 s per line against WH-C's 34 s, so it needs 9
  pickers instead of 14. It pays for that with 32 robots and 43% more floor. A pod holds 16 locations of shelf size
  on 1.44 m², and 15% of the slots stay free so the put-away policy has somewhere to choose.
- **Few lines per pod visit (1.2).** With 6,000 SKUs over 438 pods and 8 orders open per station, a pod rarely
  serves two lines at once. More open orders per station raise it (tested).
- **Dynamic repositioning is insurance, not a gain.** While demand holds, a correctly ranked fixed layout is
  best. Frequency-based put-away gives up a little of that, then recovers by itself when demand moves, while the
  fixed layout stays wrong until someone re-slots it. The comparison page in Phase 4 will make that trade-off
  explorable.

### The demand shock (Demand shock view)

At 3 h the best-sellers become the SKUs half-way down the ranking. WH-A runs its four policies on the same floor
with the same fleet (+15% headroom); WH-B and WH-C keep their slotting. Travel per line, 2 h before against 2–4 h
after:

| | Before | After | Change |
|---|---|---|---|
| WH-A · fixed home slot | 57 m robot | 80 m | **+41%** |
| WH-A · random free slot | 84 m | 85 m | +1% |
| WH-A · nearest free slot | 67 m | 73 m | +10% |
| WH-A · by popularity rank | 67 m | 69 m | **+4%** |
| WH-B · slotting unchanged | 16 m picker | 32 m | **+96%** |
| WH-C · slotting unchanged | 17 m picker | 27 m | **+64%** |

- **This is the case for moving racks that re-sort themselves.** Any layout whose slotting is fixed pays heavily
  when demand moves, and WH-B pays most: its advantage was entirely in where the best-sellers sat. Until someone
  re-slots, a picker walks 64–96% further. WH-A's popularity-rank put-away fixes itself as it works.
- **Fleet headroom decides whether that shows up as waiting.** With the bare fleet sized for steady demand, every
  policy's queue grows after the shock. With +15%, only random put-away's does.

### Cost (default scenario)

| | WH-A | WH-B | WH-C |
|---|---|---|---|
| Build cost | $2.66M | $1.42M | $1.03M |
| Cost per year | $1.08M | $1.25M | $1.24M |
| **Cost per 1,000 lines** | **$359** | $417 | $413 |
| Paid picker-hours a day | 90 | 142 | 144 |

WH-A costs 2.6× as much to build: robots, goods-to-person stations, and 43% more floor. It is still the cheapest
per line, because pickers' pay dominates the yearly cost and WH-A needs about 37% fewer picker-hours. On the sample
order data, at its own volume of 4,547 lines a day, it is $361 against $392–399 per 1,000 lines.

### WH-B vs WH-C, travel per line

| Slotting | Skew | Lines/order | WH-C | Radial | Concentric |
|---|---|---|---|---|---|
| Ranked | 50% | 1 | 31.2 m | +5% | +10% |
| Ranked | 50% | 3 | 22.7 m | +4% | +0% |
| Ranked | 80% | 1 | 19.7 m | +3% | +24% |
| Ranked | 80% | 3 | 16.6 m | −3% | +4% |
| Ranked | 95% | 1 | 12.3 m | −9% | +35% |
| Ranked | 95% | 3 | 10.4 m | −6% | +20% |
| Random | any | 1 | 53.1 m | −7% | −9% |
| Random | any | 3 | 31.3 m | +3% | −6% |

- **The rectangle is hard to beat at equal capacity.** Radial gains at most 9%, at high skew. Under the old u^k
  curve that looked like 22%, because the single top SKU (30% of all lines) sat at the end of a straight ray from
  the picking points. Radial also needs half as much floor again, lost in the wedges between rows.
- **Concentric is nearly as dense as the rectangle.** It does better when slotting is random, and worse when
  slotting is good: its closest locations sit behind the radial aisles that cut the inner rings.

## Roadmap

1. ✅ Graph distance engine, shared demand and KPI contract, WH-C adapter checked against the Warehouse Model
2. ✅ WH-B semicircular (radial and concentric), plans at one scale, B-vs-C column
3. ✅ WH-A moving racks: discrete-event simulation, stations and robot fleet sized, four put-away policies, demand shock
4. ✅ Comparison views: side-by-side animation, sensitivity sweeps, demand-shock experiment
5. ✅ Cost of ownership, order-data import, share links, 3D, Spanish and Danish, About page, AI Projects entry
