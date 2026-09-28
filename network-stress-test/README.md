# Network Stress Test — a supply-network resilience sandbox

Build (or generate) a production/warehouse/consumer network connected by air/sea/road lanes,
run a real min-cost-flow solver against it, and stress-test it: deterministic disruption
scenarios, an N-1 contingency scan, Monte Carlo random-failure sampling, a Time-to-Survive vs.
Time-to-Recover resilience check, and a greedy adversarial worst-case search.

**Live demo:** `https://kathuman.github.io/claude-projects/network-stress-test/web/`

## Why this exists

A network-design consulting question — "how resilient is this supply network, and where
would it break first?" — needs somewhere to actually try things, not just a diagram. This app
is that sandbox: hundreds of editable nodes, real geography-based lane defaults, a genuine
flow solver (not a heuristic approximation of one), and several ways to push on the network
and see what gives.

## Architecture

```text
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
  mapView.js          plain equirectangular SVG map, pan/zoom, click-to-select (browser-only)
  app.js              UI wiring / state management (browser-only)
```

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

**Browser-level (real Chromium via Playwright)**, 34 checks across two suites covering the
full user-facing pipeline: initial generate+solve, map rendering (node/edge SVG element
counts), click-to-select syncing map/table/inspector, scenario disable/clear, inline table
editing, add/delete rows, CSV export *and* import round-trips, the N-1 scan with
click-to-apply, and all three Phase 2 panels (Monte Carlo, resilience check, adversarial
search) including their own click-to-apply actions — with the console asserted error-free
throughout every sequence.

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
