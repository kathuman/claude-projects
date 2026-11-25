# Warehouse Compare

Three order-picking warehouses compared on equal terms: **the same SKUs, the same orders and the same storage
capacity**.

| | Layout | Who travels | Status |
|---|---|---|---|
| **WH-A** | Moving racks: robots carry racks (pods) to fixed picking points, and put them back after picking where a put-away policy decides, so popular racks drift towards the picking points | the racks (goods-to-person) | phase 3 |
| **WH-B** | Semicircular: storage in arcs and radial aisles around the picking points | the picker (person-to-goods) | phase 2 |
| **WH-C** | Rectangular, the [Warehouse Model](../warehouse-model/)'s layout | the picker (person-to-goods) | **phase 1 — done** |

The unit of work is the **order line**. Every layout is sized to the **smallest footprint that holds at least
`target_locations` storage locations**, so floor area is a result, not an input.

## How it is measured

```text
data/scenario.json ──► scenario.resolve() ──► the same sc (demand, pickers) for every layout
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
   layouts/wha.js (ph. 3)    layouts/whb.js (ph. 2)    layouts/whc.js ◄── warehouse-model computeLayout()
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
- **Slotting** is random, ABC classes, or ranked (the k-th most popular SKU goes in the k-th closest location).
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
node warehouse-compare/tests/core.test.js   # graph, demand, routing vs brute force, slotting, KPIs
```

## Roadmap

1. ✅ Graph distance engine, shared demand and KPI contract, WH-C adapter checked against the Warehouse Model
2. WH-B semicircular geometry: estimate, 2D plan
3. WH-A moving racks: pods, robots, queues at the picking points, put-away policies (fixed home, random,
   nearest free, frequency-based), discrete-event simulation
4. Comparison page: side-by-side animation, sensitivity charts, demand-shock experiment
5. TCO, data import, share links, 3D, Spanish/Danish, About page, projects-page entry
