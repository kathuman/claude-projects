# Network Stress Test — a supply-network resilience sandbox

Build (or generate) a production/warehouse/consumer network connected by air/sea/road lanes,
run a real min-cost-flow solver against it, and stress-test it: deterministic disruption
scenarios, an N-1 contingency scan, Monte Carlo random-failure sampling, a Time-to-Survive vs.
Time-to-Recover resilience check, and a greedy adversarial worst-case search.

**Live demo:** `https://kathuman.github.io/claude-projects/network-stress-test/web/`

**Docs:** [`web/solver-guide.html`](web/solver-guide.html) — how to implement and swap in a
different flow solver: the exact interface contract `network.js` requires, a complete
alternative implementation (independently verified against the shipped solver before being
published), how to wire it in, how to test it, and what it would actually take to go beyond a
drop-in replacement to genuine joint multi-commodity optimization. Linked from an in-app
summary panel ("Swapping in a different solver", in the explanations at the bottom of the app).

**Version:** shown as a badge in the header and footer (currently v1.4.0), bumped on every
user-visible change — see the `APP_VERSION` constant at the top of `web/src/app.js`. The
header and footer also credit **Estay Dynamics**, with a header "Contact" button and the
footer's "get in touch" link both pointing at the same consulting contact destination used
site-wide (`github.com/kathuman`).

## Why this exists

A network-design consulting question — "how resilient is this supply network, and where
would it break first?" — needs somewhere to actually try things, not just a diagram. This app
is that sandbox: hundreds of editable nodes, real geography-based lane defaults, a genuine
flow solver (not a heuristic approximation of one), and several ways to push on the network
and see what gives.

## Architecture

```text
web/assets/
  land.json          simplified world land-outline data (lon/lat polygon rings), for the
                      World Map basemap toggle

web/src/
  modeDefaults.js   mode-characteristic (air/sea/road) lane defaults + haversine geography
  flowSolver.js      pure min-cost flow (successive shortest augmenting paths, node potentials)
  network.js         domain layer: node-capacitated split-graph construction, multi-product
                      sequential priority solving, scenario (disable/derate) application
  generator.js        parametric synthetic network generator (seeded, region-clustered,
                      connectivity + product-matching coverage guarantees)
  graphAnalysis.js    N-1 contingency scan (Phase 1)
  monteCarlo.js       random independent-failure sampling (Phase 2)
  resilienceSim.js    Time-to-Survive vs. Time-to-Recover static comparison (Phase 2)
  adversarial.js      greedy worst-k-combination search (Phase 2)
  csv.js              bulk import/export for nodes and edges
  mapView.js          two SVG layouts (geographic map + abstract diagram), pan/zoom,
                      click-to-select (browser-only)
  app.js              UI wiring / state management, incl. the guided tutorial (browser-only)
```

### Two ways to look at the same network

A **Map** view (real lat/lon positions) and a **Diagram** view (an abstract layered layout —
production / warehouse / consumer columns, nodes spread evenly by id) render from the same
node/edge data via one toggle. Geography is often the wrong lens for reading *topology*: at a
few hundred nodes, region-clustered coordinates put many lanes on top of each other, while the
diagram makes "how many hops, how many parallel paths" legible regardless of where things sit
on Earth. Zooming (scroll wheel) never resizes node markers or lane lines on screen in either
view — node radius is recomputed to a constant on-screen pixel size after every zoom step, and
lanes use SVG's native `vector-effect="non-scaling-stroke"` so their pixel width is never
affected by the viewBox transform at all.

Within Map view, a second toggle switches the basemap between an actual **World Map** (real,
simplified land outlines — `web/assets/land.json`, ~1,950 points across 92 land/island
polygons in plain lon/lat rings) and a plain lon/lat **Grid**. Since the projection is a
straight `x = lon, y = -lat` mapping with no real map-projection math, each ring draws directly
as an SVG path — no projection library needed. The basemap toggle hides itself in Diagram view,
where node positions aren't geographic and a world map would be misleading. `land.json` is a
lightweight, simplified, public-domain-derived land-boundary dataset (not survey-accurate —
it's meant to make the network's geographic clustering legible at a glance, not serve as a GIS
basemap).

### Guided tutorial

A "Tutorial" button in the top bar opens a floating step-by-step walkthrough of one concrete
worked example (generate a small network → find its single biggest weak point → apply it →
check whether it's actually survivable → compare against natural random risk → push it further
with an adversarial search). Every step's action button dispatches a real click on the actual
control it's teaching (rather than re-implementing that control's behavior in the tutorial
itself), so the walkthrough can never drift out of sync with what the button really does.

Every module except `mapView.js` and `app.js` is dual-exported (`module.exports` for Node,
`window.NST.<module>` for the browser) so the actual algorithms are independently unit-tested
in Node before ever touching a DOM.

### The solver

Each product is its own min-cost flow problem: production and warehouse nodes are
node-capacitated via the standard split-node technique (in-node → out-node joined by an
internal edge capped at that node's own capacity for that product); consumer demand is the
sink. Products are solved **sequentially in ascending priority order**, each consuming from
whatever edge capacity earlier products left behind — a deliberate, documented approximation
of the much harder general multi-commodity flow problem, not a global joint optimum across
products.

### Phase 1 — deterministic stress testing

- **Scenarios**: disable or derate specific nodes/lanes, re-solve, compare Key Results.
- **N-1 contingency scan**: re-solves once per currently-*active* node/lane (only elements
  actually carrying flow in the baseline solve — an unused element provably can't reduce the
  achievable max flow if removed, which is what makes a scan at hundreds-of-nodes scale
  tractable at all), ranked by service-level drop. The power-grid "N-1 contingency" idea.

### Phase 2 — randomized and adversarial stress testing

- **Monte Carlo**: samples many independent scenarios (each edge fails at its own lane
  `baseFailureRate`; each node fails at a configurable rate, since nodes don't carry a
  per-node rate in the base schema) and reports the distribution of outcomes — mean,
  percentiles, worst trial — instead of one hand-picked "what if". Independent-failure
  assumption: correlated regional events aren't modeled.
- **Time-to-Survive vs. Time-to-Recover**: for the currently applied scenario, compares how
  long a consumer's inventory buffer covers its shortfall against how long the disrupted
  element takes to come back (`meanDisruptionDays`). This is a **static, single comparison**
  reusing the same solver as everything else — not a day-by-day dynamic simulation with
  depleting/replenishing inventories and cascading recovery. That's an intentional
  simplification of the full MIT CTL / Sheffi resilience framework this app is anchored on,
  not a claim of full dynamic realism; see the in-app "How this works" panel.
- **Adversarial worst-case search**: greedily finds the worst combination of up to *k*
  simultaneous failures by repeatedly re-running the N-1 scan against the network as already
  degraded by prior steps (network-interdiction framing). A tractable heuristic, not a
  guaranteed global worst case — exhaustively checking every combination of even a handful of
  failures out of hundreds of elements is computationally infeasible.

### The generator

Produces a random starting network clustered around real-world trade regions (so the map
looks like a plausible trade network, not uniform noise), with mode-characteristic lane
defaults and a two-pass coverage guarantee (plain connectivity, then per-product matched
connectivity) so every node has at least one upstream path for each product it handles. It is
**not** calibrated to a pristine 100% baseline service level — a freshly generated network
typically clears 55-70% of demand out of the box, the same way a real, un-optimized network
would. That's an intentional, honest starting point for a stress-testing tool, not a bug to
chase to zero.

## Verification

**Node-level (pure algorithm) tests**, run directly against each module with no browser:

- `flowSolver.js` — 7 tests: bottleneck capacity, cost-based path selection with overflow
  spillover, infeasible-demand capping, flow conservation, disconnected-graph handling,
  node-capacity-via-split-edge, a 300-node random-network performance check.
- `network.js` — 13 tests: baseline bottleneck/shortfall reporting, node/edge/partial-derate
  scenarios, full multi-product priority-sharing propagation through the whole pipeline.
- `generator.js` — 8 tests: structural validity (unique ids, referential integrity, valid
  coordinates), solve performance, and a regression guard on the connectivity/product-matching
  coverage passes (catches a future edit reintroducing the ~29%-zero-consumer bug found and
  fixed during development).
- `graphAnalysis.js` — 14 tests: correctness of the active-element filter and ranking against
  a hand-built network with known bottlenecks, plus a 330-node scale/performance check.
- `monteCarlo.js` — 12 tests: deterministic zero-failure-rate reproduction of the exact
  baseline, guaranteed single-point-failure trials, percentile ordering, per-node vs.
  fallback failure rates, seeded reproducibility.
- `resilienceSim.js` — 17 tests: TTR falling back correctly vs. picking up per-element
  overrides, TTS arithmetic against hand-computed values, per-node buffer overrides, the
  all-nodes-disabled edge case.
- `adversarial.js` — 14 tests: budget-1 exactly matches a direct N-1 scan's top result,
  budget-2 is monotonically at least as damaging and hits two independent chains, large-budget
  termination, cumulative-drop bookkeeping, a 330-node performance check.

`web/solver-guide.html`'s worked-example alternative solver (plain Bellman-Ford successive
shortest paths, no node potentials) was itself verified the same way before being published as
a "correct, complete" reference implementation: 8 Node checks confirming it produces identical
flow and cost to the shipped solver across a hand-built bottleneck network, a cost-ordering
case, an infeasible-demand case, a disconnected graph, and a 150-node random network — plus a
timed comparison at the app's real 330-node/~1,100-edge reference scale, which is where the
guide's honest performance note comes from (measured, not assumed).

**Browser-level (real Chromium via Playwright)**, 97 checks across six suites covering the
full user-facing pipeline: initial generate+solve, map rendering (node/edge SVG element
counts), click-to-select syncing map/table/inspector, scenario disable/clear, inline table
editing, add/delete rows, CSV export *and* import round-trips, the N-1 scan with
click-to-apply, all three Phase 2 panels (Monte Carlo, resilience check, adversarial search)
including their own click-to-apply actions, zoom actually rescaling the viewBox while node
markers converge back to a constant on-screen pixel size, the Map/Diagram layout toggle
(including that every production node shares one column x-coordinate in Diagram mode), a full
run through every tutorial step (including that its actions produce real results, not just UI
motion), the World Map/Grid basemap toggle (a real multi-continent land path renders by
default, toggles cleanly to/from the grid, and correctly hides itself in Diagram view), the
version badge/brand credit/Contact link, and navigation into and back out of the solver guide
(including that its code blocks render with comparison operators intact, not broken by
unescaped HTML) — with the console asserted error-free throughout every sequence.

**Not verified:** cross-browser testing beyond Chromium, mobile/touch interaction on an actual
device, and GitHub Pages deployment of this specific sub-app post-push (the parent repo's
Pages pipeline is proven by every other sub-app already live there, but this one hasn't
round-tripped through an actual push + rebuild + reload as of writing).

## What's next

Not built, and out of scope for now:

- A true day-by-day dynamic simulation (depleting/replenishing inventories, gradual — not
  instantaneous — recovery, cascading effects through the chain) in place of the current
  static TTS/TTR comparison.
- Correlated failure modeling in Monte Carlo (a single regional event affecting several
  geographically- or mode-clustered lanes at once, rather than independent per-element draws).
- An unlimited/background N-1 scan with progress reporting, instead of the current capped
  synchronous scan (roughly 200ms per element at 330-node scale).
- A globally optimal adversarial search (the current greedy heuristic is not guaranteed to
  find the worst possible k-combination).
