# Tierwise — multi-tier capacity planning for a food supply chain

**Live: https://kathuman.github.io/claude-projects/tierwise/ · version 2.3.1 · English, Español, Dansk.**

Tierwise turns a final consumption forecast into the capacity that each site of a six-tier food supply chain needs,
and shows when it needs it. The outlook covers 36 months in monthly periods, then 10 more years in yearly periods.
You can load your own supply chain from CSV, Excel or JSON, and plan it within capacity: what actually reaches the
shelves when no site may exceed what it can make.

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
| 2 | Within capacity: a linear program (HiGHS in the browser) that builds stock ahead, re-sources and reports unmet demand, fill rates and bottlenecks | done, 2.0.0 |
| – | Network Studio: the network drawn and edited by tier, custom parameters, routes tables | done, 2.1.0 |
| – | World map: the network on the globe, zoom and pan, great-circle routes, edited in place | done, 2.2.0 |
| 3 | Capacity investment: candidate expansions with build and qualification times, capex, an optimiser | done, 2.3.0 |
| A1 | Investment economics: lost margin discounted like capex, a terminal value, opex, priority as a tie-breaker, availability in months | done, 2.3.1 |
| A2 | The optimiser sees the monthly plan's constraints (stock between years, cover, peak months) and is verified by it | 2.4.0 |
| B | Foundations: autosave, named scenarios with history and a diff, modules and type checks, offline, the browser suite in CI | 2.5 |
| C | Scale: variable time buckets, the model built as arrays, lane pruning, screen-and-verify, published benchmarks | 3.0 |
| D | A general network: optional tiers, multi-level bills of materials, several products, stock at any node | 3.1 |
| E | Design decisions: new sites, closures, transport modes, landed cost, the cost against fill-rate frontier | 3.2 |
| F | Uncertainty and risk: forecast ranges, Monte Carlo, robust investment, a disruption library | 4.0 |
| G | Polish, alongside C–F: the Studio at scale, ERP import, a board report, accessibility, translation tooling | – |

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
- The requirement plan assumes unlimited capacity (lot-for-lot). It shows where and when capacity is short and how
  much to add. The plan within capacity, below, shows what happens instead.
- Inventory is held only at warehouses.
- There is one product, and sourcing shares are fixed.

## Within capacity (`src/constrained.js`, `src/solve-worker.js`)

**Capacity · Within capacity** solves the whole 13-year horizon again as one linear program, month by month, with no
site above its capacity.

**What the program decides:**
- what each site makes or ships;
- which lane carries it;
- how much stock is built ahead of a peak;
- what demand cannot be supplied.

**Units.** Every quantity is in pack-equivalents, so the bill of materials becomes a factor of 1 and only yields change
quantities.

**Stock:**
- finished stock is held at every site;
- input stock is held at every CMO that buys;
- each consumption point has a small buffer;
- stock may be held at most the chosen number of months (0–12; CMOs keep at least one month, warehouses at least two).

The buffers mean fractional lead, release and transit times never force exact month-by-month matches, which would make
shipments oscillate.

**Sourcing** has three modes:
- keep the planned shares;
- re-source among the existing (qualified) lanes, at a cost per pack moved;
- open every lane from the tier above.

**Objective**, in pack-equivalents (×1,000 for unmet demand, scaled by the market's priority of 1–3):

| Item | Cost |
|---|---|
| Unmet demand | 1,000 |
| Safety stock below target | 1 a month |
| Re-sourcing | 0.5 |
| Holding stock | 0.02 a month |
| Transport | 0.0005 a transit day |

Safety stock is cheap enough that a long crunch draws on it rather than losing sales.

**Horizon.** The model runs over a warm-up before the first month and a run-out after the last. The warm-up has the
first month's demand and fills the slowest pipeline, step by step. The run-out has the last month's demand and weighs
less. Together they keep the edges of the horizon from being distorted. In the warm-up, a site makes at most 110% of
what the first month needs, so the plan does not start with stock built in advance.

**Solving.**
- HiGHS 1.15.3, compiled to WebAssembly, runs in a Web Worker and is loaded from jsDelivr on first use.
- It uses the interior-point method without crossover. If that fails, it falls back to crossover, then the dual simplex.
- The example (about 20,000 constraints) solves in 3–8 s.
- Results are cached by network and options.

**What the page shows within capacity:**
- **Headline and KPIs:** fill rate, demand not supplied, first unmet month, markets short, the first bottleneck, and the
  volume re-sourced.
- **What reaches the shelves:** delivered against unmet demand per period, per-market fill rates, and the lanes off their
  planned share.
- **Heatmap:** bottlenecks in amber. No cell is ever over capacity.
- **Each site:** its load, what unlimited capacity would need (dashed), its stock, and its lanes' actual shares against
  the plan.
- **Plan CSV:** the within-capacity columns.

**Example results:**

| Configuration | Fill rate | First unmet demand |
|---|---|---|
| Fixed shares, no stock ahead | 88.1% | |
| Fixed shares, 6 months of stock ahead | 88.7% | |
| Qualified lanes | 90.1% | December 2032 |
| Any supplier | 90.5% | |
| Expansion programme | 99.4% | |

With qualified lanes, the first bottleneck (Valencia Dosing) comes in February 2030, but the first unmet demand only in
December 2032. Within capacity, the New Zealand drought costs nothing: stock built ahead and re-sourcing absorb it.

## Capacity investment (`src/invest.js`, `src/invest-worker.js`)

**Capacity investment**, below the "Capacity to add" panel, answers which candidate expansions are worth building,
and about when — not what ships in a given month. A site can list `candidates`: capacity expansions with a capex, a
build time and a qualification time before they are usable.

**A separate, year-resolution model.** The month-by-month "within capacity" plan above is already a large linear
program (around 20,000 rows for the example network), and wrapping it in a mixed-integer search for build decisions
does not converge interactively: even a handful of binary choices needs minutes to find a better answer than "build
nothing", because every branch re-solves the whole relaxation. At year resolution — one decision point per year,
matching the yearly cadence `requiredCapacity` already uses — the same problem is two orders of magnitude smaller and
solves in a few seconds, with a genuine joint search across candidates.

**How a year is represented.** Both a market's demand and a site's capacity are annual totals (the sum of their 12
months), not monthly rates — using each site's own worst month independently was tried and discarded: a network's
peaks do not line up (raw-milk troughs, dosing peaks and market peaks fall in different months at different sites by
design), so overlaying every site's bad month onto one simulated instant made the whole network look saturated
everywhere at once. Lead, release and transit times are not modelled within a year (days to a few weeks against a
one-year resolution); what a site ships in year *y* is matched by what it receives in year *y*, converted by yield.
There is no stock carried between years and no peak within a year. This is a screening model: cross-check a chosen
investment against the month-by-month plan before committing (see the example below for why).

**The decision.** A binary per candidate per review year (0–12) decides whether and when to start it, at most one
review year per candidate. Started at the beginning of review year *y*, a candidate is ready in month
`12·y + ceil(build + qualify)`. From then on it adds its monthly capacity: the year it becomes ready gets the months
left in it, and later years get all twelve. (Before 2.3.1, availability was rounded up to whole years.) The addition is
a bound increase, not a toggle, so no big-M is needed. A candidate that could only be ready after the horizon is not
offered. **Add the chosen investments as expansions** adds each from its ready month.

**The objective is in currency.** Every term is discounted the same way: year *y* weighs 1 / (1 + *r*)^*y*, with *r*
the `discountRate`.

| Term | What it is |
|---|---|
| Capex | paid at the start of the review year |
| Opex | a candidate's fixed running cost a year (`opex`, default 0), from the month it is ready, prorated |
| Lost margin | `packValue` per pack of unmet demand |
| Terminal value | the last year's lost margin and opex also count for `terminalYears` more years, each discounted further |

- **Discounting.** Before 2.3.1 only capex was discounted. A pack lost in year 13 then cost as much as one lost today,
  which made capacity that pays off late look better than it is. Tested: a candidate whose benefit comes only in years
  11–13 is built at 0% and refused at 50%.
- **Terminal value.** Capacity keeps paying after the horizon. `terminalYears` defaults to 5, a cautious tail for
  equipment that lives 15–20 years: it credits late builds for part of their life without assuming year 13's demand
  holds for ever. 0 turns it off.
- **Market priority** is not a currency, so it no longer multiplies the margin. It is a tie-breaker (0.1% more per
  level above 1) that decides which market goes short when the same capacity could serve either. The reported
  objective is recomputed in plain currency.
- **Net present value.** The same model is solved once more with nothing to build. The margin the package recovers is
  the difference in lost margin, and NPV = margin recovered − capex − opex, all present values.
- An optional budget caps total nominal capex. Re-sourcing, making and transport carry tiny regularising costs that are
  left out of the reported objective.

**Solving.** One HiGHS simplex solve (which warm-starts far better across a mixed-integer search than the interior-
point method used above), with a 60-second budget and a 0.2% gap — generous because this is a considered,
infrequent decision, not a plan re-solved on every slider change. A run that hits the time limit is still reported
(`timedOut`), with its best incumbent found rather than failing outright. The example (810 rows) proves optimal in
about a second.

**Example result** (four candidates, qualified lanes, 8% discount rate, 5 terminal years, no budget cap). The optimiser
chooses Valencia's fourth dosing line, ready December 2031, and Cape Town's second packaging line, ready December 2033:
$6.7M of capex, $4.6M present value. The screening model estimates fill rising from 86.3% to 89.6%, and an NPV of
$16.1M.

**The month-by-month plan disagrees.** Priced there (qualified lanes, 6 months of stock ahead), the same package lifts
fill only from 90.1% to 90.2%, and recovers $0.6M present value of margin: an NPV of −$4.0M. Every figure in this
paragraph and the one before is checked by `tests/invest.test.js`. The yearly model does not see the monthly
bottlenecks. (2.3.0 also chose Jebel Ali's bay, but on an undiscounted lost margin, so its answer was no more
trustworthy.) Until 2.4.0 makes the yearly model see stock, cover and peak
months, and checks its pick against the monthly plan automatically, treat its recommendation as a shortlist to price in
**Within capacity**.

**Limits.**
- Candidates are expansions of existing sites only. A new site would need its own candidate supply lanes, which are
  left for a later phase.
- With no months within a year, capacity added mid-year counts against the whole year's shortfall, including the
  months before it is ready.

## Network Studio (`studio.js`, `src/graph.js`)

The Studio draws the chain by tier, in columns from raw ingredients on the left to consumption points on the right.
Shapes tell the roles apart:

| Role | Shape |
|---|---|
| Production sites (the four CMO tiers) | Squares |
| Warehouses | Hexagons |
| Consumption points | Pills |

**Transport routes** are arrows from a supplier to its customer:
- width shows their share of what the customer buys, or the actual share within capacity;
- the dash pattern shows the mode (road, sea, rail or air), estimated when not set.

**World map** (`src/geo.js` for the geometry): the same network on the globe.
- **Same look:** the diagram's symbols, colours, highlighting, selection and problem badges.
- **Zoom and pan:** buttons, Ctrl + wheel, or drag the map; plus **Fit the network** and **Whole world** views.
- **Routes** follow the great circle and are drawn from both edges where they cross the date line.
- **Editing:** a site is moved by dragging it to its new place, and **+ Add site** puts a new one where you click, in a
  chosen tier.
- **Overlap:** sites at the same place are spread apart on screen only.

**Viewing options:**
- **Highlight** brings forward production sites, warehouses, consumption points or routes.
- **Colour by** uses the tier, the status in the plan, or any custom parameter.
- **Tiers / World map:** switch between the tier diagram and the world map.

**Editing modes:**
- **Select & move:** drag a site up or down its column, and the order is saved with the network.
- **+ Add site:** click where it goes. It starts from a neighbour's parameters.
- **Connect:** drag between sites in neighbouring tiers, in either direction. Only valid targets light up, and a route
  that skips a tier is refused.
- **Delete:** click a site or a route. The Delete key works too.

**The inspector** edits the selected site:
- name, id (routes follow), country, location (or *pick the place on the map*);
- capacity, times and yield, or the forecast and priority;
- expansions, candidate expansions for the investment optimiser, and custom parameters.

For a selected route it edits share, transit days, mode and route parameters.

**Checking and undo:**
- Problems show as red badges with an issues list that links to each site. Sites no one buys from get an amber badge.
- **Undo / Redo** (Ctrl+Z, Ctrl+Y) covers every change, from the Studio or the tables.
- The diagram saves as **SVG** or **PNG**.

**Custom parameters** are your own fields for sites or routes:
- types: number, text, yes/no or a choice, with a unit, a default and the tiers they apply to;
- shown in the inspector and the tables, used to colour the diagram, and carried by every file;
- they describe the network, and the plan does not use them;
- the example has *Halal certified* on its CMOs.

`src/graph.js` holds the pure parts, tested on their own:
- adding and removing sites and routes, renaming ids;
- the six-tier connection rule;
- the column order, chosen to cross fewer routes, with saved orders kept;
- the problems per site;
- parameter definitions and values;
- the undo history.

## Your own supply chain (`src/io.js`)

The **Your supply chain** box loads a network from a file. You can also drop the file onto it. **Template · CSV** and
**Template · Excel** export the network on screen, ready to edit.

### File format

Since 2.1, routes and parameters have their own place in the file:
- **Routes:** a separate table (or **Routes** sheet), `from,to,share,days,mode,…`, with one column per route parameter.
  When present, it replaces the `suppliers` column.
- **Custom parameters:** columns of the site table. Their definitions go in the settings as
  `param.<key>.label / type / unit / applies / tiers / options / default`.
- **Unknown columns:** become new parameters, with the type guessed from the values.
- **Diagram order:** the `order` column. Markets have a `priority` column.

- **One row per site:**
  - `id`, `tier` (`market`, `warehouse`, `packaging`, `dosing`, `product`, `raw`), `name`, `country`, `lat`, `lon`.
  - Consumption points: `base`, `growth`, `longGrowth`, `season`, `launch` (YYYY-MM), `ramp`.
  - Other sites: `capacity`. Warehouses add `handling` and `cover`; CMOs add `lead`, `release` and `yield`.
  - `suppliers`, written `id:share[:transit days] | …`.
  - `expansions`, written `YYYY-MM:+amount | …`.
  - `outages`, written `YYYY-MM:months:loss% | …`.
  - `candidates` for the investment optimiser, written `label:add:capex:build:qualify[:opex] | …` (build and qualify in months; the optional
    `opex` is a running cost a year, added in 2.3.1, so older files still read).
- **Settings (optional).** A `setting,value` table, or an Excel **Settings** sheet, covers:
  - the product;
  - the calendar (`startYear`, `startMonth` 1–12);
  - the bill of materials (`packPerUnit`, `kgPerSachet`, `rawPerProduct`);
  - the seasons;
  - the investment optimiser's `packValue`, `discountRate`, `terminalYears` (default 5) and `currency`;
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
- **Capacity investment:** pack value, discount rate, the years credited after the horizon, a budget cap, and **Run
  the investment optimiser**. It shows the net present value, the margin recovered, capex (and opex) as present values,
  the screening model's fill with nothing built and with the package, and the candidates chosen with their review year
  and ready month. **Add the chosen investments as expansions** applies them.
- **Load by tier, lead-time ladder and forecast small multiples.**
- **Editor:**
  - sites (add, remove, rename, move), capacities, times, yields and expansions;
  - sourcing lanes, with a supplier picker, share and transit override;
  - forecast parameters, the calendar, the bill of materials, and tier names and units.

Every chart has a hover tooltip, and most have a table view.

## Tutorial (`tour.js`, `tour-content*.js`)

The **Tutorial** button opens five levels:

| Level | Steps | Topics |
|---|---|---|
| Beginner | 8 | read the plan |
| Intermediate | 9 | time and tiers |
| Build a network | 10 | the Network Studio and the world map |
| Advanced | 10 | from plan to decision |
| Expert | 8 | planning within capacity |

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
node tierwise/tests/graph.test.js  # 41: sites and routes, the tier rule, column order, problems, parameters, undo
node tierwise/tests/geo.test.js    # 16: the world projection, great-circle routes over the date line, map views
node tierwise/tests/io.test.js     # 59: CSV / Excel / JSON round trips, routes tables, custom parameters, errors by row
node tierwise/tests/i18n.test.js   # 19: every text, page key and engine message in Spanish and Danish
node tierwise/tests/tour.test.js   # 443: every step in three languages, and every claim the tutorial makes
cd tierwise && npm install --no-save highs@1.15.3 && node tests/constrained.test.js
                                   # 41: the plan within capacity on chains with known answers, and the example
node tierwise/tests/invest.test.js # 52: the investment optimiser on chains with known answers, and the example,
                                   # priced again in the month-by-month plan
```

CI runs them on every change to `tierwise/`. A browser suite runs locally with Playwright. It covers 103 checks across
the flows, file loading and links, and every tutorial step in three languages. It also scans the Spanish and Danish
pages for leftover English.

---

By Daniel Alberto Sepulveda Estay, PhD · [Estay Dynamics](https://kathuman.github.io/estay-dynamics/) · Available for
consulting: [get in touch](https://github.com/kathuman).
