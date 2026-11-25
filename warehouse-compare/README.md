# Warehouse Compare

Three order-picking warehouses compared on equal terms: **the same SKUs, the same orders and the same storage
capacity**.

| | Layout | Who travels | Status |
|---|---|---|---|
| **WH-A** | Moving racks: robots carry racks (pods) to fixed picking points, and put them back after picking where a put-away policy decides, so popular racks drift towards the picking points | the racks (goods-to-person) | phase 3 |
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
   layouts/wha.js (ph. 3)    layouts/whb.js            layouts/whc.js ◄── warehouse-model computeLayout()
          └──────────── each builds a travel network (graph.js) ┘
                                     │
                     graph.keyMatrix(): shortest path between every
                     picking point and access point
                                     │
          demand.js (seeded orders) ─► slotting.js ─► routing.js ─► kpi.js
                                                                   one KPI contract,
                                                                   with a trace
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
- **Paired comparison.** Orders come from a seeded stream (popularity curve F(u) = u^k with F(0.2) = demand skew;
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

## Run

Open `index.html` through any static server from the repository root, because the page loads
`../warehouse-model/`:

```bash
python -m http.server 8765    # then http://127.0.0.1:8765/warehouse-compare/
```

Tests (Node ≥ 18, no dependencies):

```bash
node warehouse-compare/tests/whc.test.js    # WH-C graph = Warehouse Model formulas; equal-capacity sizing
node warehouse-compare/tests/whb.test.js    # WH-B closed-form distances, bay geometry, aisles clear, sizing
node warehouse-compare/tests/core.test.js   # graph, demand, routing vs brute force, slotting, KPIs
```

## Findings so far (WH-B vs WH-C, travel per line)

Default scenario: 7,000 locations, 6,000 SKUs. WH-B's footprint relative to WH-C's 1,411 m²: radial 2,142 m²
(+52%), concentric 1,500 m² (+6%).

| Slotting | Skew | Lines/order | WH-C | Radial | Concentric |
|---|---|---|---|---|---|
| Ranked | 50% | 3 | 22.7 m | +5% | +2% |
| Ranked | 80% | 1 | 17.9 m | −5% | +16% |
| Ranked | 80% | 3 | 15.4 m | +1% | +8% |
| Ranked | 95% | 1 | 10.2 m | **−22%** | +26% |
| Ranked | 95% | 3 | 12.0 m | −1% | +15% |
| Random | any | 1 | 53.1 m | −7% | −9% |
| Random | any | 3 | ≈31.5 m | +3% | −6% |

- **The rectangle is hard to beat at equal capacity.** Radial only wins clearly when there is little to route:
  skewed demand, single-line orders and the best slotting. There the top SKUs sit on straight rays from the
  picking points. Its cost is half as much floor again, lost in the wedges between rows.
- **Concentric is nearly as dense as the rectangle.** It does better when slotting is random, because its average
  location is closer. It does worse when slotting is good: its closest locations sit behind radial aisles that
  cut the inner rings.
- **Multi-line orders erase most differences.** Once a tour visits several aisles, the layout matters less than
  the routing.

## Roadmap

1. ✅ Graph distance engine, shared demand and KPI contract, WH-C adapter checked against the Warehouse Model
2. ✅ WH-B semicircular (radial and concentric), plans at one scale, B-vs-C column
3. WH-A moving racks: pods, robots, queues at the picking points, put-away policies (fixed home, random,
   nearest free, frequency-based), discrete-event simulation
4. Comparison page: side-by-side animation, sensitivity charts, demand-shock experiment
5. TCO, data import, share links, 3D, Spanish/Danish, About page, projects-page entry
