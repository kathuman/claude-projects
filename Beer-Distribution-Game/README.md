# Ripple — Supply Chain Distribution Game

A supply chain ordering game for classes. A team runs a chain of companies, from a store to a plant, on one device.
Every stage orders from the one above it, and orders and shipments take time to travel, so small changes in what
customers buy become large swings further up the chain: the bullwhip effect. The debrief shows each team, with its own
numbers, why it happened.

**Live:** https://kathuman.github.io/claude-projects/Beer-Distribution-Game/ · version 1.0.1 · method and references
in [about.html](about.html)

Ripple is an original game in the tradition of the supply chain games used in management teaching (Forrester 1958;
Sterman 1989). Its chain, numbers, demand patterns and debrief are its own; it is not a copy of any existing game.

## What it does

- **The chain's structure on every screen**: every stage, orders travelling up and goods travelling down with one box
  per week in transit, the plant's production line and the costs; structure only, never a stage's numbers.
- **Time to answer each round** (15 seconds unless set otherwise), with a countdown; when time runs out the order is
  placed for the player (what they typed, or the default). An empty answer orders 4 units (adjustable). The debrief
  counts the orders placed by default, and the CSV marks each one.
- **One team, one device.** Turn by turn (the default), each stage decides in turn and sees only its own numbers,
  behind a hand-over screen; or an open table, with every stage on one screen. Simulated players run any stage
  without a person, behaving like typical players or like the best simple rule.
- **A configurable chain.** 2 to 5 stages; order, shipping and production delays; holding and backlog costs; starting
  stock; game length; four demand patterns (step up, seasonal, promotion, unpredictable), with "Surprise" picking one
  at random and revealing it only in the debrief.
- **The debrief.**
  - the orders each stage placed against customer demand, and stock (+) or owed (−) by stage, each chart with a
    legend, line labels, a hover read-out per week and a table view;
  - the team's cost against the same chain and demand played by **typical players** and by the **best simple rule**;
  - **each stage's decision rule read from its orders**: how much of what was already on order it counted, how fast
    it corrected stock gaps, how it forecast, and how much of its orders the rule explains;
  - **the supply-line curve**: the team's game replayed with every stage counting 0 % … 100 % of what it had already
    ordered, everything else as it decided;
  - time used: to finish and per decision, shown beside cost, not combined into one score;
  - a CSV of every week and stage, and a printable page.
- **Saved after every decision.** A reload or a closed tab resumes where the team was; nothing leaves the device.

## Method

Typical players use the anchoring-and-adjustment rule with the average parameters found for players of the classic
game (θ 0.36, α 0.26, β 0.34; Sterman 1989). The best simple rule counts the whole supply line; its θ, α and safety
stock are tuned per chain setting on six demand patterns, never on the game being judged. A player's rule is fitted
by least squares (θ and β on a grid, α and S′ by a straight-line fit). β is recovered well; α and θ can trade off.
Details in [about.html](about.html).

## Layout

```
index.html, styles.css, app.js   the page: set-up, briefing, play (hand-over screen, stage view, open table), debrief
about.html                       how to run it with a class, how the chain works, the method, references
src/engine.js                    the chain: weeks, delays, shipping, backlog, costs (pure, saved as JSON)
src/scenarios.js                 customer demand patterns, seeded
src/rules.js                     decision rules: typical players, the best simple rule and its tuning, benchmarks
src/fit.js                       reading a stage's decision rule from its orders
src/debrief.js                   summary, benchmarks, fitted rules, the supply-line curve
src/charts.js                    the debrief's SVG charts (legend, line labels, hover, table view)
src/diagram.js                   the structure diagram shown on every screen
tests/                           node --test suites
tools/browser-check.cjs          plays the game in a real browser
```

## Tests

```bash
npm test
```

22 checks: units are conserved in every chain length and pattern; orders and shipments arrive exactly after their
delays; the plant's production delay; backlog and oldest-debt-first shipping; costs add up; the supply line is
everything ordered and not received; only whole, non-negative orders, weeks in order; settings within range and
reproducible demand; a saved game resumes exactly; typical players use the published parameters, keep a calm chain
calm and amplify a step up the chain; the best rule beats typical play on every pattern and is tuned without seeing
the game; counting more of the supply line damps the swings; rules decide from what a stage can see; fitting
recovers known rules; the summary, the supply-line curve and the benchmarks add up.

A browser check plays the game (62 checks: the diagram on every screen and following the settings, set-up,
briefing, the hand-over screen hiding every number, a reload mid-week, an empty answer, an answer left unsent and no
answer when time runs out, an open table that times out, the debrief's charts, hover, table and CSV, an open-table game, the theme and phone width):

```bash
python -m http.server 8766          # from the repository root
PW=<path to playwright or playwright-core> CHROME=<chrome.exe> node Beer-Distribution-Game/tools/browser-check.cjs
```

## Roadmap

1.1 classroom (instructor console, teams join by code, live board, end comparison including cost against time used,
CSV) · 1.2 classroom experiments (different conditions per team) · 1.3 Spanish and Danish, accessibility, printable
handout · 2.0 research exports and validation against published findings.
