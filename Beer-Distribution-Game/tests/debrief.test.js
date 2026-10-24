// The debrief reads decision rules back from orders, and its numbers add up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, playOut, teamCost } from '../src/engine.js';
import { anchoring, TYPICAL, benchmark } from '../src/rules.js';
import { fitRule, stageRows } from '../src/fit.js';
import { summary, fits, causes, benchmarks } from '../src/debrief.js';

// β (the share of the supply line counted) is what the debrief leans on and is recovered well; α and θ trade off
// against each other (several pairs reproduce the same orders), so α is held to a looser tolerance.
test('fitting recovers the rule that produced the orders', () => {
  const c = { scenario: 'random', seed: 11, weeks: 40 };
  const cfg = config(c);
  const truth = [{ theta: 0.3, alpha: 0.4, beta: 0.2 }, { theta: 0.5, alpha: 0.3, beta: 0.8 }, TYPICAL, { theta: 0.2, alpha: 0.6, beta: 1 }];
  const g = playOut(c, truth.map((p, i) => anchoring(p, cfg, i)));
  fits(g).forEach((f, i) => {
    assert.ok(Math.abs(f.alpha - truth[i].alpha) < 0.3, `stage ${i} alpha ${f.alpha}`);
    assert.ok(Math.abs(f.beta - truth[i].beta) < 0.21, `stage ${i} beta ${f.beta}`);
    assert.ok(f.r2 > 0.9, `stage ${i} r2 ${f.r2}`);
  });
});

test('too few weeks give no rule; constant orders explain nothing', () => {
  const g = playOut({ weeks: 6 }, Array(4).fill(() => 6));
  assert.equal(fitRule(stageRows(g, 0), 6), null);
  const f = fitRule(Array.from({ length: 10 }, (_, k) => ({ incoming: 6, inv: 15, backlog: 0, supplyLine: 12, order: 6 })), 6);
  assert.equal(f.r2, null);
});

test('the summary adds up: costs split into holding and backlog, amplification of the demand swing', () => {
  const g = benchmark({ scenario: 'step' }, 'typical');
  const s = summary(g, [0, 3]);
  assert.ok(Math.abs(s.teamCost - s.stages.reduce((a, x) => a + x.cost, 0)) < 1e-9);
  for (const st of s.stages) assert.ok(Math.abs(st.cost - st.holdingCost - st.backlogCost) < 1e-9);
  assert.deepEqual(s.stages.map((x) => x.person), [true, false, false, true]);
  assert.ok(s.stages.at(-1).amplification > s.stages[0].amplification);
  assert.equal(s.demandPeak, 10);
});

test('the supply-line curve replays the fitted rules, and full counting helps a step', () => {
  const g = benchmark({ scenario: 'step' }, 'typical');
  const cz = causes(g);
  assert.equal(cz.curve.length, 11);
  assert.ok(Math.abs(cz.teamBeta - 0.34) < 0.15);
  assert.ok(Math.abs(cz.model - teamCost(g)) / teamCost(g) < 0.1, 'the fitted rules reproduce the cost');
  assert.ok(cz.supplyLineSaving > 0.2 * cz.model, `saving ${cz.supplyLineSaving}`);
  assert.ok(cz.curve[0].cost > cz.curve.at(-1).cost);
});

test('benchmarks play the same chain and demand', () => {
  const g = playOut({ scenario: 'promotion', weeks: 30 }, Array(4).fill(() => 7));
  const b = benchmarks(g);
  assert.deepEqual(b.typical.history.map((h) => h.demand), g.history.map((h) => h.demand));
  assert.deepEqual(b.best.history.map((h) => h.demand), g.history.map((h) => h.demand));
});
