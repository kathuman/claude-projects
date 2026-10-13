# Real Options for Network Design

**Live: https://kathuman.github.io/claude-projects/real-options/ · version 4.0.0 (roadmap complete: phases 0–5, with a three-level tutorial).**

What is the right to decide later worth in a supply network design? The app values five strategies on a binomial
demand lattice, each with its optimal policy, and reports the value of flexibility against the **best fixed
design**, not against a straw man:

- **Commit now:** build the full footprint today.
- **Best fixed:** build today the capacity that maximises NPV without options.
- **Wait & see:** serve demand through a 3PL and build the full site once, at the best moment inside the decision window.
- **Stage & expand:** build an initial stage now and add steps where they pay, one project at a time.
- **Lease & break:** rent capacity instead of building, with break clauses to hand it back at set dates for a fee.

Every owned site can also be sold at any time for a resale value that declines to zero over its life, or mothballed
and restarted at a one-off cost each way, so the baseline is not penalised for lacking an exit. The staged site can
sell capacity back in steps.

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 0 | Defensible numbers: decision window vs asset life, adaptive lattice step, consistent outsourcing and penalties, best fixed baseline, lead times, risk-neutral basis, tests and CI, equations, blueprint theme, About | done, 2.0.0 |
| 1 | Contract & exit: resale of owned sites (all strategies), leases with break clauses, sell and break thresholds on the decision map | done, 2.1.0 |
| 1b | Switching: mothballing and reactivation of owned sites, partial contraction of the staged site, idle and restart thresholds (hysteresis) on the decision map | done, 2.2.0 |
| 2 | Network page: two correlated regions, cross-region service, a central hub vs regional hubs, a pilot hub with a cheaper option on the second (compound option), waiting across the network; 2D decision map, correlation sweep | done, 3.0.0 |
| 3 | Calibration from demand history (both pages): paste, CSV or samples; frequency detection; season removal; 90% intervals; warnings; apply to the model or a region | done, 4.0.0 |
| 4 | Decision report (printable) and scenario comparison (saved in the browser) | done, 4.0.0 |
| 5 | Tutorial: beginner, intermediate and advanced levels with guided steps and checked questions, across both pages | done, 4.0.0 |

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
- Mothballing: an idle site sends demand to the 3PL and keeps `mothF` of its holding cost; switching costs open a
  hysteresis band. Continuation values are compared first, so there is no switch-and-back within a step. A site that
  resells well is usually better sold than idled.
- Contraction: the staged site may move down levels, receiving the resale value of the capacity sold.
- Lease: rent on top of operating cost, fit-out cost and time, break dates at the minimum term and then at fixed
  intervals, a fee in years of rent; the leased capacity maximises NPV.
- `simulate()` replays every optimal policy along seeded paths for the payoff charts.

## The network page (`network.html`, `network-app.js`, `src/network.js`)

Two regions on a correlated joint lattice (four branches per quarter; each region's growth is exact and the
correlation is the one set, or the page says what is used). A hub serves its own region first, its spare capacity
serves the other region at a transport cost, the 3PL covers the rest up to a limit. A second hub's fixed cost is
reduced by a learning share once the first exists. Five strategies:
- **Central hub:** one hub in A, sized to maximise NPV.
- **Two hubs now:** sizes chosen together.
- **Commit both:** both hubs at the planned sizes.
- **Pilot hub:** one hub now (whichever region is worth more), with the option on the other.
- **Wait & see network:** open either hub, or both, at the best moment.

The page shows:
- the value of flexibility against the best fixed network, and what the second-hub saving is worth;
- a 2D decision map for the network in place at a chosen year;
- the NPV distribution;
- an NPV-against-correlation sweep (pooling).

`charts.js`, `specs.js` (every control and preset) and `style.css` are shared by both pages.

## Calibration, report, comparison and tutorial

- **Calibration** (`src/calibrate.js`, `calib-ui.js`): reads a pasted history, a CSV file or a sample, and detects the
  frequency from the dates. It estimates volatility and growth from log changes (g = μ + σ²/2), with 90% intervals,
  and can remove the season. It warns about short histories, autocorrelation and seasonality. **Apply** snaps the
  estimates to the sliders and says when a value had to be limited.
- **Decision report** (`report.html`, `report.js`): rebuilt from the scenario link. It covers the recommendation with
  concrete triggers, every strategy's NPV, 5th percentile and P(loss) from 4,000 simulated paths, a year-by-year
  trigger table, the main sensitivities, all assumptions (changes highlighted) and the method. A print style is
  included.
- **Scenario comparison**: save up to 8 scenarios in the browser. They are compared side by side (changed inputs,
  every strategy, the value of flexibility), and each can be opened or reported.
- **Tutorial** (`tour-content.js`, `tour.js`): three levels.

  | Level | Steps | Covers |
  |---|---|---|
  | Beginner | 9 | the answer, volatility, triggers, presets, risk |
  | Intermediate | 10 | fair baseline, the 3PL bridge, the window, sensitivities, leases, resale, payoff shape, calibration, comparison, report |
  | Advanced | 11 | risk-neutral valuation, the adaptive lattice, mothballing and hysteresis, selling vs idling, and the network: pooling, correlation, compound option, the 2D map, waiting |

  Each step sets up its scenario and highlights what it explains; questions give feedback. The levels move between
  pages, and progress is remembered in the browser.


## The single-site page

`index.html` + `app.js`:
- headline value of flexibility and five scorecards;
- a decision map of demand bands with build, expansion, sell, mothball, restart and lease-break thresholds;
- payoff by outcome, and the NPV distribution;
- value against volatility, and a sensitivity tornado (computed in the background);
- the equations;
- six presets and scenario links in the address.

## Tests

`node real-options/tests/model.test.js` checks 75 things, `network.test.js` 29, `calibrate.test.js` 24 and `tutorial.test.js` 22. CI runs it on every change (`.github/workflows/real-options-ci.yml`):
- the lattice: no clamping, exact growth, convergence to Black–Scholes, and a deterministic closed form;
- the dominance relations between the strategies;
- how option value responds to volatility, the window, lead times, penalties and escalation;
- resale and break clauses: zero resale reproduces 2.0.0 exactly, neither right ever lowers a value, both are worth
  more the more uncertain demand is, fees and rent move the lease the right way, and a deterministic closed form;
- switching: with it off the results are exactly 2.1.0's; mothballing and contraction never lower a value; the right
  to mothball rises with volatility; idling always triggers below restarting (hysteresis); and with free switching the
  site is worth the expected best of running and idling at every step (closed form);
- that the simulated policies reproduce the lattice values;
- convergence as the step shrinks;
- the network:
  - the joint lattice (exact growth per region, the correlation, valid branches);
  - fixed designs valued two ways;
  - an exact reduction to the single-site engine when region B is empty;
  - separability without cross-region service;
  - dominance;
  - learning, pooling (a central hub is worth less as correlation rises), the window and volatility;
  - a Monte Carlo replay of every policy;
- calibration:
  - the formats people paste;
  - frequency detection;
  - unbiased estimates, with 90% intervals that cover the truth about 90% of the time (400 synthetic histories);
  - season removal and the warnings;
- the tutorial: every step well formed and in range, and every claim its questions make true in the engines.
