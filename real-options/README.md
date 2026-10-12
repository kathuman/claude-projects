# Real Options for Network Design

**Live: https://kathuman.github.io/claude-projects/real-options/ · version 2.0.0 (roadmap phase 0 of 5).**

What is the right to decide later worth in a supply network design? The app values four strategies on a binomial
demand lattice, each with its optimal policy, and reports the value of flexibility against the **best fixed
design**, not against a straw man:

- **Commit now:** build the full footprint today.
- **Best fixed:** build today the capacity that maximises NPV without options.
- **Wait & see:** serve demand through a 3PL and build the full site once, at the best moment inside the decision window.
- **Stage & expand:** build an initial stage now and add steps where they pay, one project at a time.

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 0 | Defensible numbers: decision window vs asset life, adaptive lattice step, consistent outsourcing and penalties, best fixed baseline, lead times, risk-neutral basis, tests and CI, equations, blueprint theme, About | done, 2.0.0 |
| 1 | Contract & switch: leases, break clauses, abandonment | next |
| 2 | Several sites and regions; compound options | |
| 3 | Calibration from data: volatility and growth from demand history | |
| 4 | Decision report and scenario comparison | |
| 5 | Teaching mode and guided cases | |

## The model

`src/model.js` (UMD; the same file runs in the page and in Node):

- Demand: `u = e^(σ√Δt)`, `d = 1/u`, `p = (e^(gΔt) − d)/(u − d)`, capped at a market ceiling. Δt is quarterly, or
  monthly/weekly when needed so that `p` stays in (0, 1) and the growth set is reproduced exactly; the page says so.
- Cash flow: own sales at the margin, unmet demand to a 3PL at a lower margin up to a limit, the rest lost with a
  penalty, minus the holding cost of capacity. The same rule for every strategy, including while waiting or building.
- Lead times: a project started at step t keeps the old capacity running for L steps and the new one after it
  (an L-step binomial expectation).
- No terminal perpetuity: the asset life is explicit, and decisions are allowed only inside the decision window.
- Bases: expected cash flows at a WACC, or risk-neutral (drift `g − λσ`, discounted at `r_f`).
- `simulate()` replays every optimal policy along seeded paths for the payoff charts.

## The page

`index.html` + `app.js`:
- headline value of flexibility and four scorecards;
- a decision map of demand bands with build and expansion triggers;
- payoff by outcome, and the NPV distribution;
- value against volatility, and a sensitivity tornado (computed in the background);
- the equations;
- five presets and scenario links in the address.

## Tests

`node real-options/tests/model.test.js` checks 35 things. CI runs it on every change (`.github/workflows/real-options-ci.yml`):
- the lattice: no clamping, exact growth, convergence to Black–Scholes, and a deterministic closed form;
- the dominance relations between the strategies;
- how option value responds to volatility, the window, lead times, penalties and escalation;
- that the simulated policies reproduce the lattice values;
- convergence as the step shrinks.
