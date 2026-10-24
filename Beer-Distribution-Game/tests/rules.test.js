// The simulated players and the benchmarks behave as the research says they should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, playOut, teamCost, newGame, startWeek, placeOrders, view } from '../src/engine.js';
import { anchoring, orderUpTo, bestRule, benchmark, TYPICAL, forecast } from '../src/rules.js';
import { SCENARIOS } from '../src/scenarios.js';

const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

test('the typical player uses the published average parameters (Sterman 1989)', () => {
  assert.deepEqual(TYPICAL, { theta: 0.36, alpha: 0.26, beta: 0.34 });
});

test('typical players keep a calm chain calm', () => {
  const c = { scenario: 'step', weeks: 5 };
  const cfg = config(c);
  const g = playOut(c, cfg.names.map((_, i) => anchoring(TYPICAL, cfg, i)));
  for (const h of g.history.slice(0, 5)) for (const r of h.stages) assert.equal(r.order, 6);
});

test('typical players amplify a demand step up the chain: the bullwhip', () => {
  const g = benchmark({ scenario: 'step' }, 'typical');
  const peaks = g.stages.map((_, i) => Math.max(...g.history.map((h) => h.stages[i].order)));
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1], `peak at stage ${i}: ${peaks}`);
  const swings = g.stages.map((_, i) => sd(g.history.map((h) => h.stages[i].order)));
  assert.ok(swings.at(-1) > 2 * sd(g.history.map((h) => h.demand)));
});

test('the best simple rule beats typical players on every demand pattern', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const t = teamCost(benchmark({ scenario }, 'typical'));
    const b = teamCost(benchmark({ scenario }, 'best'));
    assert.ok(b < t, `${scenario}: best ${b} vs typical ${t}`);
  }
});

test('the best rule is tuned without seeing the game it plays, and counts the whole supply line', () => {
  const a = bestRule({ scenario: 'step', seed: 1 });
  const b = bestRule({ scenario: 'random', seed: 99 });
  assert.deepEqual(a, b);
  assert.ok(a.alpha > 0 && a.theta > 0);
});

test('counting more of the supply line damps the swings', () => {
  const c = { scenario: 'step' };
  const cfg = config(c);
  const run = (beta) => playOut(c, cfg.names.map((_, i) => anchoring({ ...TYPICAL, beta }, cfg, i)));
  const plantSwing = (g) => sd(g.history.map((h) => h.stages.at(-1).order));
  assert.ok(plantSwing(run(1)) < plantSwing(run(0.34)));
  assert.ok(plantSwing(run(0.34)) < plantSwing(run(0)));
});

test('rules work from what a stage can see, so a resumed game decides the same', () => {
  const c = { scenario: 'seasonal', weeks: 20 };
  const cfg = config(c);
  const rule = anchoring(TYPICAL, cfg, 1);
  const g = newGame(c);
  for (let w = 1; w <= 10; w++) { startWeek(g); placeOrders(g, g.stages.map((_, i) => anchoring(TYPICAL, cfg, i)(view(g, i)))); }
  startWeek(g);
  const v = view(g, 1);
  assert.equal(rule(v), rule(JSON.parse(JSON.stringify(v))));
  let e = cfg.base;
  for (const p of v.past) e = 0.36 * p.incoming + 0.64 * e;
  assert.ok(Math.abs(forecast(v, 0.36, cfg.base) - (0.36 * v.incoming + 0.64 * e)) < 1e-12);
  assert.ok(orderUpTo(bestRule(c), cfg, 1)(v) >= 0);
});
