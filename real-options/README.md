# Real Options for Network Design

**Live: https://kathuman.github.io/claude-projects/real-options/ · version 2.1.0 (roadmap phases 0 and 1 of 5).**

What is the right to decide later worth in a supply network design? The app values five strategies on a binomial
demand lattice, each with its optimal policy, and reports the value of flexibility against the **best fixed
design**, not against a straw man:

- **Commit now:** build the full footprint today.
- **Best fixed:** build today the capacity that maximises NPV without options.
- **Wait & see:** serve demand through a 3PL and build the full site once, at the best moment inside the decision window.
- **Stage & expand:** build an initial stage now and add steps where they pay, one project at a time.
- **Lease & break:** rent capacity instead of building, with break clauses to hand it back at set dates for a fee.

Every owned site can also be sold at any time for a resale value that declines to zero over its life, so the
baseline is not penalised for lacking an exit.

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 0 | Defensible numbers: decision window vs asset life, adaptive lattice step, consistent outsourcing and penalties, best fixed baseline, lead times, risk-neutral basis, tests and CI, equations, blueprint theme, About | done, 2.0.0 |
| 1 | Contract & exit: resale of owned sites (all strategies), leases with break clauses, sell and break thresholds on the decision map | done, 2.1.0 |
| 1b | Switching: mothballing and reactivation, partial contraction | later |
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
- Resale: `salvF·(F + v·K)·(1 − t/N)`; selling is irreversible and the 3PL takes over. Staging can sell at any stage.
- Lease: rent on top of operating cost, fit-out cost and time, break dates at the minimum term and then at fixed
  intervals, a fee in years of rent; the leased capacity maximises NPV.
- `simulate()` replays every optimal policy along seeded paths for the payoff charts.

## The page

`index.html` + `app.js`:
- headline value of flexibility and five scorecards;
- a decision map of demand bands with build, expansion, sell and lease-break thresholds;
- payoff by outcome, and the NPV distribution;
- value against volatility, and a sensitivity tornado (computed in the background);
- the equations;
- five presets and scenario links in the address.

## Tests

`node real-options/tests/model.test.js` checks 54 things. CI runs it on every change (`.github/workflows/real-options-ci.yml`):
- the lattice: no clamping, exact growth, convergence to Black–Scholes, and a deterministic closed form;
- the dominance relations between the strategies;
- how option value responds to volatility, the window, lead times, penalties and escalation;
- resale and break clauses: zero resale reproduces 2.0.0 exactly, neither right ever lowers a value, both are worth
  more the more uncertain demand is, fees and rent move the lease the right way, and a deterministic closed form;
- that the simulated policies reproduce the lattice values;
- convergence as the step shrinks.
