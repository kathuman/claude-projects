// The chain keeps its books: units are conserved, delays are exact, costs add up, and only legal orders pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, startWeek, placeOrders, view, playOut, teamCost, unitsInSystem, config, supplyLine } from '../src/engine.js';
import { demandSeries, SCENARIOS } from '../src/scenarios.js';

const constant = (q) => () => q;

test('a calm chain stays calm: constant demand and matching orders change nothing', () => {
  const g = playOut({ scenario: 'step', weeks: 5 }, Array(4).fill(constant(6)));
  // the step comes in week 6; five weeks are calm
  const g5 = newGame({ scenario: 'step', weeks: 6 });
  for (let w = 1; w <= 5; w++) { startWeek(g5); placeOrders(g5, [6, 6, 6, 6]); }
  for (const s of g5.stages) { assert.equal(s.inv, 15); assert.equal(s.backlog, 0); }
  assert.equal(teamCost(g5), 4 * 15 * 5);
  assert.ok(g.over);
});

test('units are neither created nor lost', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const stages of [2, 3, 4, 5]) {
      const c = { scenario, stages, weeks: 25, orderDelay: 2, shipDelay: 3, prodDelay: 1, seed: 4 };
      const g0 = newGame(c);
      const start = unitsInSystem(g0);
      let k = 0;
      const g = playOut(c, Array.from({ length: stages }, () => () => (k++ * 7919) % 13));
      assert.equal(unitsInSystem(g), start + g.produced - g.delivered, `${scenario} ${stages}`);
    }
  }
});

test('an order arrives exactly order delay + shipping delay weeks later, if the supplier has stock', () => {
  const g = newGame({ scenario: 'step', weeks: 20, orderDelay: 2, shipDelay: 3, initInv: 200 });
  // the store orders 40 in week 1 and the base 6 otherwise; the regional DC has plenty of stock
  const arrivals = [];
  for (let w = 1; w <= 9; w++) {
    const row = startWeek(g);
    arrivals.push(row.stages[0].arrived);
    placeOrders(g, [w === 1 ? 40 : 6, 6, 6, 6]);
  }
  // weeks 1–5 bring the calm pipeline (6 each); the 40 is seen by the DC in week 3 and arrives in week 6
  assert.deepEqual(arrivals.slice(0, 6), [6, 6, 6, 6, 6, 40]);
});

test('the plant produces with its own delay', () => {
  const g = newGame({ scenario: 'step', weeks: 10, prodDelay: 3, stages: 2, initInv: 100 });
  const done = [];
  for (let w = 1; w <= 6; w++) {
    done.push(startWeek(g).stages[1].arrived);
    placeOrders(g, [6, w === 1 ? 30 : 6]);
  }
  assert.deepEqual(done.slice(0, 5), [6, 6, 6, 30, 6]);
});

test('what cannot be shipped is owed, and the oldest debt is paid first', () => {
  const g = newGame({ scenario: 'promotion', weeks: 20, initInv: 0 });
  startWeek(g);
  const v = view(g, 0);
  // no stock: the 6 that arrived go out, the rest of the 7 ordered is owed
  assert.equal(v.arrived, 7);
  assert.equal(v.shipped, 7);
  assert.equal(v.backlog, 0);
  placeOrders(g, [0, 0, 0, 0]);
  for (let w = 2; w <= 4; w++) { startWeek(g); placeOrders(g, [0, 0, 0, 0]); }
  const h = g.history.map((r) => r.stages[0]);
  assert.ok(h.at(-1).backlog > 0, 'the store owes customers once its pipeline is empty');
  assert.equal(h.at(-1).backlog, h.at(-2).backlog + h.at(-1).incoming - h.at(-1).shipped);
});

test('costs: holding and backlog per unit per week, summed over stages and weeks', () => {
  const g = playOut({ scenario: 'random', seed: 3, weeks: 20, holding: 0.7, backlog: 3 }, Array(4).fill(constant(5)));
  const manual = g.history.reduce((s, h) => s + h.stages.reduce((a, r) => a + 0.7 * r.inv + 3 * r.backlog, 0), 0);
  assert.ok(Math.abs(teamCost(g) - manual) < 1e-9);
});

test('the supply line is everything ordered and not yet received', () => {
  const g = newGame({ scenario: 'step', weeks: 10, orderDelay: 2, shipDelay: 3 });
  startWeek(g);
  // calm: one order still travelling (2 − 1) and three shipments on the way, 6 each, nothing owed upstream
  assert.equal(supplyLine(g, 0), 6 * (1 + 3));
  assert.equal(supplyLine(g, 3), 6 * (2 - 1));
});

test('only whole, non-negative orders, and weeks in the right order', () => {
  const g = newGame({ weeks: 6 });
  assert.throws(() => placeOrders(g, [1, 1, 1, 1]), /start the week/);
  startWeek(g);
  assert.throws(() => startWeek(g), /still open/);
  assert.throws(() => placeOrders(g, [1, -1, 1, 1]), /zero or more/);
  assert.throws(() => placeOrders(g, [1, 1, 1]), /expected 4/);
  placeOrders(g, [1.4, 2, 3, 4]);
  assert.equal(g.history[0].stages[0].order, 1);
});

test('settings are kept within range, and demand is reproducible', () => {
  const c = config({ stages: 9, weeks: 2, orderDelay: 0, holding: -1 });
  assert.equal(c.stages, 5);
  assert.equal(c.weeks, 6);
  assert.equal(c.orderDelay, 1);
  assert.equal(c.holding, 0);
  assert.deepEqual(demandSeries('random', 30, 7).values, demandSeries('random', 30, 7).values);
  assert.notDeepEqual(demandSeries('random', 30, 7).values, demandSeries('random', 30, 8).values);
  for (const k of Object.keys(SCENARIOS)) {
    const d = demandSeries(k, 40, 1);
    assert.ok(d.values.slice(0, 3).every((v) => v === d.base), `${k} starts calm`);
    assert.ok(d.values.every((v) => Number.isInteger(v) && v >= 0), k);
  }
});

test('a saved game resumes exactly: the state survives JSON', () => {
  const c = { scenario: 'seasonal', weeks: 20 };
  const a = newGame(c);
  for (let w = 1; w <= 7; w++) { startWeek(a); placeOrders(a, [7, 8, 9, 10]); }
  startWeek(a);
  const b = JSON.parse(JSON.stringify(a));
  placeOrders(a, [5, 5, 5, 5]);
  placeOrders(b, [5, 5, 5, 5]);
  for (let w = 9; w <= 20; w++) { startWeek(a); startWeek(b); placeOrders(a, [6, 6, 6, 6]); placeOrders(b, [6, 6, 6, 6]); }
  assert.equal(teamCost(a), teamCost(b));
  assert.deepEqual(a.history.at(-1), b.history.at(-1));
});
