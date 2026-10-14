# Tierwise — multi-tier capacity planning for a food supply chain

**Live: https://kathuman.github.io/claude-projects/tierwise/ · version 1.1.0 · English, Español, Dansk.**

Tierwise turns a final consumption forecast into the capacity that each site of a six-tier food supply chain needs,
and shows when it needs it. The outlook covers 36 months in monthly periods, then 10 more years in yearly periods.
You can load your own supply chain from CSV, Excel or JSON.

## The example

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

## Plan

| Phase | Content | Version |
|---|---|---|
| 1 | Explain and share: tracing, capacity to add, comparison, links and files, your own supply chain, tutorial, Spanish and Danish | done, 1.1.0 |
| 2 | Constrained plan: finite-capacity re-routing and pre-building (LP in the browser), unmet demand and fill rate | 2.0 |
| 3 | Capacity investment: candidate expansions and new CMOs with build and qualification times, capex, an optimiser | 2.1 |
| 4 | Uncertainty: forecast ranges, variable yields and lead times, milk-season variance, probability of shortfall | 3.0 |
| 5 | Products and food rules: product families sharing lines, changeovers, registrations, shelf life, landed cost | 3.1 |
| 6 | Finish: planning report, accessibility, a background solver, a published benchmark | 4.0 |

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
    1,500 km and by sea beyond, or set per lane.
  - It is converted through the bill of materials.
- **Raw milk capacity** follows the grass season. The swing grows with distance from the equator, and the two
  hemispheres run six months apart. Expansions add capacity from a given month, and outages remove a share for a spell.
- **Tracing.** The plan is linear, so each requirement is carried split by the consumption point it serves. Every
  site's load divides exactly into its markets and into its direct customers.
- **Capacity to add** (`requiredCapacity`). These are the additions that keep a site at or under a utilisation target
  in every month:
  - capacity is reviewed once a year;
  - each addition is sized for the busiest month until the next review, which for a raw site means the leanest milk
    month;
  - additions are rounded up to two significant digits.

The yearly periods are built from their 12 months. Each keeps its average and its busiest month, so a seasonal
shortfall is never averaged away.

**Limits.**
- It is an infinite-capacity, lot-for-lot plan. It shows where and when capacity is short and how much to add, but it
  does not re-route volume or pre-build stock. That is phase 2.
- Inventory is held only at warehouses.
- There is one product, and sourcing shares are fixed.

## Your own supply chain (`src/io.js`)

The **Your supply chain** box loads a network from a file. You can also drop the file onto it. **Template · CSV** and
**Template · Excel** export the network on screen, ready to edit.

### File format

- **One row per site:**
  - `id`, `tier` (`market`, `warehouse`, `packaging`, `dosing`, `product`, `raw`), `name`, `country`, `lat`, `lon`.
  - Consumption points: `base`, `growth`, `longGrowth`, `season`, `launch` (YYYY-MM), `ramp`.
  - Other sites: `capacity`. Warehouses add `handling` and `cover`; CMOs add `lead`, `release` and `yield`.
  - `suppliers`, written `id:share[:transit days] | …`.
  - `expansions`, written `YYYY-MM:+amount | …`.
  - `outages`, written `YYYY-MM:months:loss% | …`.
- **Settings (optional).** A `setting,value` table, or an Excel **Settings** sheet, covers:
  - the product;
  - the calendar (`startYear`, `startMonth` 1–12);
  - the bill of materials (`packPerUnit`, `kgPerSachet`, `rawPerProduct`);
  - the seasons;
  - the tiers' own names and units (`tier.dosing.name`, `tier.dosing.unit`, …), for a chain that isn't milk powder.
- **Separators.** Files can be comma, semicolon or tab separated. In a semicolon file, decimal commas and point
  thousands are read (1.000,5).
- **Errors** name the row they come from.
- **Excel files** are read and written with SheetJS, which is loaded only when needed.
- **JSON** holds the network exactly as Tierwise does.
- Files never leave the browser.

**Copy share link** puts the whole network into the link itself, compressed after `#net=`.

## The page (`index.html`, `app.js`)

- **Controls:**
  - scenarios;
  - demand against the forecast, warehouse safety stock and the milk-season swing;
  - a utilisation target;
  - yearly cells by busiest month or average;
  - **Compare with** a scenario, a pinned plan or the loaded network;
  - plan CSV and reset.
- **Headline, KPIs and a tier outlook.**
- **Latitude map:** the frame fits the network, sites are coloured by tier, rings mark sites that run short, and lanes
  are coloured by the supplying tier.
- **Selected site:**
  - load against capacity and the busiest month in each year, with the comparison as a dashed line;
  - **what drives the load** in any period, by consumption point and by direct customer;
  - the **capacity to add**, with one-click expansions;
  - suppliers and customers with shares and transit days.
- **Capacity heatmap:** every site against every period, or the change against the comparison in points.
- **Capacity to add:** every site's additions, earliest first, with **Add all as expansions**.
- **Load by tier, lead-time ladder and forecast small multiples.**
- **Editor:**
  - sites (add, remove, rename, move), capacities, times, yields and expansions;
  - sourcing lanes, with a supplier picker, share and transit override;
  - forecast parameters, the calendar, the bill of materials, and tier names and units.

Every chart has a hover tooltip, and most have a table view.

## Tutorial (`tour.js`, `tour-content*.js`)

The **Tutorial** button opens three levels:

| Level | Steps | Topics |
|---|---|---|
| Beginner | 8 | read the plan |
| Intermediate | 9 | time and tiers |
| Advanced | 10 | from plan to decision |

Each step sets up the page, highlights what it is about and quotes live numbers. Some steps ask a question.
`?tour=advanced&step=3` opens a step directly.

## Languages (`i18n.js`, `i18n-es.js`, `i18n-da.js`)

- **Languages:** English, Latin American Spanish and Danish.
- **Choosing the language:**
  - the picker in the header;
  - `?lang=es|da|en` in the address;
  - otherwise the browser's language.
- **Numbers:** Danish uses decimal commas.
- **What is translated:**
  - the example network's site names, countries and scenarios;
  - the engine's messages and file errors;
  - the About page.

## Tests

```
node tierwise/tests/plan.test.js   # 61: the engine, tracing, capacity to add, custom tiers
node tierwise/tests/io.test.js     # 34: CSV / Excel / JSON round trips, decimal commas, errors with row numbers
node tierwise/tests/i18n.test.js   # 19: every text, page key and engine message in Spanish and Danish
node tierwise/tests/tour.test.js   # 268: every step in three languages, and every claim the tutorial makes
```

CI runs them on every change to `tierwise/`. A browser suite runs locally with Playwright. It covers 59 checks across
the flows, file loading and links, and every tutorial step in three languages. It also scans the Spanish and Danish
pages for leftover English.

---

By Daniel Alberto Sepulveda Estay, PhD · [Estay Dynamics](https://kathuman.github.io/estay-dynamics/) · Available for
consulting: [get in touch](https://github.com/kathuman).
