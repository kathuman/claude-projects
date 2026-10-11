# Lag Lab — capacity that lags demand

**Status: phase 1 of 6 (the model and its tests). There is no app page yet.**

After a demand step, planning sees the overshoot and calls it forecast error. Lag Lab will show that this attribution
is usually wrong, and by how much. It splits the overshoot into three layers, each with its own remedy:

1. **Necessary correction.** After a step up, production must exceed the new demand for a while to refill a larger
   inventory target and a longer pipeline. This is arithmetic, not error. Only shorter delays or lower targets
   reduce it.
2. **Policy-induced overshoot.** This comes from underweighting the supply line, aggressive adjustment times, and
   hiring on the inventory gap instead of the capacity gap. Changing the decision rules fixes it.
3. **Forecast-attributable overshoot.** This comes from the lag in expected demand. Only this layer is a
   forecasting problem.

## Plan

| Phase | Content | Version |
|---|---|---|
| **1** | **Model core and validation** (this) | 0.1.0 |
| 2 | Step and policy panel, time-series charts, About page, AI Projects entry | 1.0 |
| 3 | Decomposition view: runs (a), (b) and (c), the necessary refill, the three-layer share | 1.1 |
| 4 | Planner's lens: forecast error measured as planning measures it | 1.2 |
| 5 | Policy map: overshoot, settling time and cost over two parameters | 1.3 |
| 6 | Stress test (ramps, pulses, pink noise, repeated steps) and polish | 1.4 |

## The model (`src/model.js`)

The model is a production and workforce chain in the style of Sterman, *Business Dynamics*, ch. 17–19, written as
pure functions so the same code runs in the page and in the tests. Time is in weeks. It uses Euler integration with
a step of 1/16 week, and refuses a step too large for the shortest time constant.

**Stocks:**
- backlog *B*;
- finished inventory *I*;
- the supply line *SL*, a third-order delay of production starts held in three stages;
- experienced workforce *W*;
- trainees *T*, recruits ramping up at a relative productivity ρ;
- vacancies *V*;
- expected demand *D̂*, from exponential smoothing, or equal to demand in "perfect forecast" runs.

**Decision rules (anchor and adjust):**

```text
desired starts     DS = max(0, D̂ + (I* − I)/TAI + w_SL·(SL* − SL)/TASL)      I* = coverage·D̂,  SL* = lead time·D̂
desired hiring     Hd = attrition + (E* − E)/TAW                             E = W + ρ·T  (effective workforce)
vacancy creation   VC = max(0, Hd + w_V·(V* − V)/TAV)                        V* = max(0, Hd)·hiring delay
```

If *Hd* < 0, open vacancies are cancelled and people are laid off beyond attrition.

**Physical constraints:**
- capacity = productivity · *E*;
- production starts = capacity · *u*, where utilisation *u* = clamp(DS/capacity, u_min, u_max). It works like a
  flexible workweek: output follows the workforce, within a band;
- shipments = min(*B*/target delivery delay, *I*/minimum processing time), with unfilled orders waiting in the
  backlog.

`capacity: 'unconstrained'` gives starts = DS, the pure stock-management structure of ch. 17, which is used to
check the textbook results.

**Hiring driver (the policy choice):**
- **capacity:** E* = DS / productivity. Hire for the capacity the production plan needs.
- **inventory:** E* = (D̂ + (I* − I)/TAI) / productivity. Hire on the shelf gap, blind to the work already in the
  production pipeline. With w_SL = 0 the two coincide, since they differ only by the supply line.

**API:**
- `LagLab.simulate(params)` returns weekly columns of every stock and flow (25 series), plus running totals and the
  initial and final states.
- `LagLab.analyze(series, t, tStep)` gives the final value, peak, overshoot, settling time and oscillation
  crossings.
- `LagLab.defaults()` and `LagLab.validate(params)`.

## Tests

`node lag-lab/tests/model.test.js` runs 45 checks, and GitHub runs them on every change:
- **Building blocks:**
  - the third-order delay matches its analytic step response, 1 − e⁻ˣ(1 + x + x²/2), and returns an impulse whole
    after a mean delay τ;
  - expected demand follows the exponential-smoothing solution.
- **Equilibrium:** constant demand leaves every stock unchanged in all 24 policy combinations.
- **Exact conservation:**
  - ∫(starts − demand) = ΔSL + ΔI − ΔB;
  - ΔB = ∫demand − ∫shipments;
  - Δ(W + T) = ∫hires − ∫attrition − ∫layoffs.
- **New equilibrium:** after a +20% step every stock settles at its new level.
- **Textbook stock management (ch. 17):**
  - w_SL = 1 with TASL = TAI approaches the target with no overshoot;
  - w_SL = 0 overshoots by 90% and oscillates;
  - overshoot falls steadily as w_SL rises (90% → 47% → 21% → 5% → 0%);
  - a faster TAI overshoots more.
- **Workforce (ch. 19):**
  - hiring on the inventory gap overshoots more than hiring on the capacity gap;
  - longer hiring delays take longer to settle. The size of the overshoot levels off beyond a moderate delay;
  - a step down brings layoffs.
- **Physical limits:**
  - shipments never exceed what inventory allows;
  - a large step builds backlog;
  - utilisation stays in its band;
  - no stock goes negative.
- **Scale and convergence:** tripling demand triples every stock, and halving the time step changes inventory by
  under 1% of the refill.

## Settled in phase 1, for the decomposition (phase 3)

- **The necessary refill is ΔI* + ΔSL* − ΔB*, not ΔI* + ΔSL*.** The backlog also grows to its new normal level,
  which is that much less to produce. By conservation, net extra production always equals this refill once the
  system settles. So overshoot must count only the positive part of production above demand, or the layers would
  net out to zero.
- **The forecast layer can be negative.** A smoothed forecast's lag sometimes damps the reaction: with a perfect
  forecast, inventory overshoot rose from 28% to 49% in the default case. The share display must show "forecasting
  reduced the overshoot" when that happens.
- **Run (c) should also use the capacity hiring driver**, not only w_SL = w_V = 1. The proposal lists hiring on the
  inventory gap as a policy cause, so it belongs in the policy layer.
