# Tierwise — multi-tier capacity planning for a food supply chain

**Live: https://kathuman.github.io/claude-projects/tierwise/ · version 1.0.0.**

Tierwise turns a final consumption forecast into the capacity that each site of a six-tier food supply chain needs, and
shows when it needs it. The outlook covers 36 months in monthly periods, then 10 more years in yearly periods.

The example product is a fortified milk powder: packs of 20 sachets of 25 g each. The network spans latitudes from
Cork (52°N) to Gippsland (38°S). The six tiers, from the consumer upstream:

| Tier | Sites | Unit |
|---|---|---|
| Consumption points | Mexico City, São Paulo, Lagos, Johannesburg, Cairo, Dhaka (launching in month 19), Jakarta, Manila | packs |
| Warehouses | Guadalajara, Campinas, Apapa, Durban, Jebel Ali, Singapore | packs |
| Packaging CMOs | Querétaro, Cape Town, Johor | packs |
| Final dosing CMOs | Valencia, Penang, Rosario | sachets |
| Product manufacturing CMOs | Cork, Hamilton (NZ), Madison | t of powder |
| Raw ingredient CMOs | Normandy, Waikato, Gippsland, Wisconsin dairy co-ops | t of dairy base |

Every site above the consumer can source from several sites in the tier above, each with a share. All figures are
illustrative.

## How it plans (`src/plan.js`)

Requirements are planned tier by tier, from the consumer upstream, over 156 months:

- **Consumption points.** The forecast is a base volume with growth (one rate for years 1–3, another after), a
  seasonal swing that peaks in the local cold season, and an optional launch ramp. The southern hemisphere peaks six
  months after the northern.
- **Warehouses** ship what their markets need. They build or draw safety stock, a cover in weeks of coming demand.
  Each shipment leaves the handling time earlier.
- **CMOs.**
  - A CMO's output for month *m* is made the **release time** earlier (quality testing and hold).
  - Output is grossed up for **yield**.
  - Its inputs must arrive the **production lead time** earlier still.
- **Lanes.**
  - A site's need is split across its suppliers by share.
  - Each part is shifted earlier by the lane's **transit time**: estimated from great-circle distance, by road within
    1,500 km and by sea beyond, or overridden per lane.
  - It is converted through the bill of materials: 1 pack = 20 sachets, 1 sachet = 25 g, 1 t of powder = 0.7 t of
    dairy base.
- **Raw milk capacity** follows the grass season. The swing grows with distance from the equator, and the two
  hemispheres run six months apart. Expansions add capacity from a given month, and outages remove a share for a spell.

The yearly periods are built from their 12 months. Each keeps its average and its busiest month, so a seasonal
shortfall is never averaged away.

**Limits.**
- It is an infinite-capacity, lot-for-lot plan. It shows where and when capacity is short, but it does not re-route
  volume or pre-build stock.
- Inventory is held only at warehouses.
- There is one product, and sourcing shares are fixed.

## The page (`index.html`, `app.js`)

- **Controls:**
  - scenarios: base, fast growth in Africa and Asia, a New Zealand dry season, a capacity expansion programme, and dual
    sourcing of every dosing CMO;
  - demand against the forecast, warehouse safety-stock cover and the milk-season swing;
  - colouring of yearly cells by their busiest month or their average.
- **Headline, KPIs and a tier outlook:** load, capacity, utilisation, the busiest months and the first shortfall per tier.
- **Latitude map:** land, graticule, equator and tropics; sites coloured by tier; rings on sites that run short; lanes
  coloured by the supplying tier. Click a site to select it.
- **Selected site:** load against capacity across the 46 periods, the busiest month in each year, facts, and its
  suppliers and customers with shares and transit days.
- **Capacity heatmap:** every site against every period, blue at or under capacity and red over it. Each cell has a
  tooltip, and the heatmap has a table view.
- **Load by tier:** the sites of a tier stacked against the tier's capacity.
- **Lead-time ladder:** for each consumption point, how far ahead each tier must act along the main sourcing path.
- **Forecast small multiples:** one per market, on a shared scale.
- **Editor:** capacities, lead and release times, yields, handling, cover, sourcing shares, expansions, forecast
  parameters and the bill of materials. Changes re-plan at once.
- **CSV export** of the whole plan.

Every chart has a hover tooltip, and most have a table view.

## Tests

```
node tierwise/tests/plan.test.js
```

The 42 checks cover:
- the calendar and season phases in both hemispheres;
- exact time shifts;
- the bill of materials chain (1,000 packs → 20,000 sachets → 0.5 t → 0.35 t);
- yields and lead-time phasing;
- conservation of volume and the safety-stock balance;
- share normalisation;
- expansions, outages, utilisation and the first shortfall;
- the yearly roll-up;
- the example scenarios;
- refusal of invalid networks.

CI runs them on every change to `tierwise/`.

---

By Daniel Alberto Sepulveda Estay, PhD · [Estay Dynamics](https://kathuman.github.io/estay-dynamics/) · Available for
consulting: [get in touch](https://github.com/kathuman).
