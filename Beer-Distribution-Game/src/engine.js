// Ripple's supply chain: a line of stages from the store to the plant. Each week, every stage receives the shipment
// that has reached it, receives its customer's order, ships what it can (what it cannot ship is owed as backlog), and
// orders from its supplier. Orders take `orderDelay` weeks to reach the supplier, shipments `shipDelay` weeks to
// arrive, and the plant's production takes `prodDelay` weeks. Every unit on hand costs `holding` per week and every
// unit owed costs `backlog` per week; the team's score is the total.
//
// A week runs in two halves so a person can decide in between: startWeek() moves the goods and the orders and shows
// each stage what it can see; placeOrders() takes every stage's order and closes the week. Pure functions on a plain
// object, so a game can be saved, replayed and tested.

import { demandSeries } from './scenarios.js';

export const STAGE_NAMES = ['Store', 'Regional DC', 'National DC', 'Plant', 'Supplier plant'];

// The stage names for a chain of n stages: the store, the distribution centres, the plant (and, for five, a supplier).
export function stageNames(n) {
  if (n === 2) return ['Store', 'Plant'];
  if (n === 3) return ['Store', 'Distribution centre', 'Plant'];
  if (n === 4) return ['Store', 'Regional DC', 'National DC', 'Plant'];
  return ['Store', 'Regional DC', 'National DC', 'Plant', 'Component plant'];
}

export const DEFAULTS = {
  stages: 4, orderDelay: 1, shipDelay: 2, prodDelay: 2, holding: 1, backlog: 2.5, initInv: 15, weeks: 30,
  scenario: 'step', seed: 1,
};

// Check and complete a configuration.
export function config(c = {}) {
  const cfg = { ...DEFAULTS, ...c, input: { ...(c.input ?? c) } };
  const int = (k, lo, hi) => { cfg[k] = Math.min(hi, Math.max(lo, Math.round(Number(cfg[k])))); };
  int('stages', 2, 5); int('orderDelay', 1, 3); int('shipDelay', 1, 4); int('prodDelay', 1, 4); int('weeks', 6, 60);
  int('initInv', 0, 200);
  cfg.holding = Math.max(0, Number(cfg.holding));
  cfg.backlog = Math.max(0, Number(cfg.backlog));
  cfg.names = stageNames(cfg.stages);
  cfg.demand = demandSeries(cfg.scenario, cfg.weeks, cfg.seed);
  cfg.base = cfg.demand.base;
  return cfg;
}

// A new game in steady state: every pipeline holds the base demand, every stage the initial inventory.
export function newGame(c) {
  const cfg = config(c);
  const n = cfg.stages;
  const d0 = cfg.base;
  const stages = cfg.names.map((name, i) => ({
    name,
    inv: cfg.initInv,
    backlog: 0,
    // goods on their way to this stage, the head arriving next week (the plant's: production under way)
    inbound: Array(i === n - 1 ? cfg.prodDelay : cfg.shipDelay).fill(d0),
    // orders this stage has sent to its supplier, still travelling (the plant orders from its own production)
    outbound: i === n - 1 ? [] : Array(cfg.orderDelay).fill(d0),
    cost: 0,
  }));
  return { cfg, week: 1, phase: 'move', stages, history: [], delivered: 0, produced: 0, customerBacklog: 0, over: false };
}

const sum = (a) => a.reduce((s, x) => s + x, 0);

// What a stage has ordered but not yet received: orders still travelling, what its supplier owes it, and goods on
// their way. (For the plant: production under way.)
export function supplyLine(g, i) {
  const n = g.stages.length;
  const s = g.stages[i];
  if (i === n - 1) return sum(s.inbound);
  return sum(s.outbound) + g.stages[i + 1].backlog + sum(s.inbound);
}

// First half of a week: goods arrive, orders arrive, every stage ships what it can. Returns what each stage sees.
export function startWeek(g) {
  if (g.over) throw new Error('the game is over');
  if (g.phase !== 'move') throw new Error('orders for this week are still open');
  const n = g.stages.length;
  const t = g.week;
  const row = { week: t, demand: g.cfg.demand.values[t - 1], stages: [] };
  // goods arrive
  const arrived = g.stages.map((s) => s.inbound.shift());
  g.stages.forEach((s, i) => { s.inv += arrived[i]; });
  // orders arrive: the store's from its customers, every other stage's from the stage below it
  const incoming = g.stages.map((s, i) => (i === 0 ? row.demand : g.stages[i - 1].outbound.shift()));
  // ship what can be shipped, oldest debt first; the rest is owed
  const shipped = g.stages.map((s, i) => {
    const owed = s.backlog + incoming[i];
    const ship = Math.min(s.inv, owed);
    s.inv -= ship;
    s.backlog = owed - ship;
    if (i > 0) g.stages[i - 1].inbound.push(ship);
    return ship;
  });
  g.delivered += shipped[0];
  g.stages.forEach((s, i) => {
    row.stages.push({ arrived: arrived[i], incoming: incoming[i], shipped: shipped[i], inv: s.inv, backlog: s.backlog,
      supplyLine: supplyLine(g, i) });
  });
  g.pending = row;
  g.phase = 'decide';
  return row;
}

// What one stage can see while it decides: its own numbers only.
export function view(g, i) {
  const r = g.pending.stages[i];
  const s = g.stages[i];
  const past = g.history.map((h) => h.stages[i]);
  return {
    week: g.week, weeks: g.cfg.weeks, stage: i, name: s.name, isPlant: i === g.stages.length - 1, isStore: i === 0,
    inventory: r.inv, backlog: r.backlog, arrived: r.arrived, incoming: r.incoming, shipped: r.shipped,
    supplyLine: r.supplyLine, cost: s.cost, weekCost: g.cfg.holding * r.inv + g.cfg.backlog * r.backlog,
    past: past.map((p, k) => ({ week: k + 1, order: p.order, incoming: p.incoming, arrived: p.arrived, inv: p.inv, backlog: p.backlog })),
  };
}

// Second half of a week: every stage's order goes out, the week's costs are counted, and the next week begins.
// orders[i] is a whole number of units ≥ 0; seconds[i] (optional) the time stage i took to decide.
export function placeOrders(g, orders, seconds = []) {
  if (g.phase !== 'decide') throw new Error('start the week first');
  const n = g.stages.length;
  if (orders.length !== n) throw new Error(`expected ${n} orders`);
  const q = orders.map((o) => {
    const v = Math.round(Number(o));
    if (!Number.isFinite(v) || v < 0) throw new Error('an order is a whole number of units, zero or more');
    return v;
  });
  const row = g.pending;
  g.stages.forEach((s, i) => {
    if (i === n - 1) { s.inbound.push(q[i]); g.produced += q[i]; } else s.outbound.push(q[i]);
    const c = g.cfg.holding * s.inv + g.cfg.backlog * s.backlog;
    s.cost += c;
    Object.assign(row.stages[i], { order: q[i], cost: c, seconds: seconds[i] ?? null });
  });
  g.history.push(row);
  delete g.pending;
  g.phase = 'move';
  g.week += 1;
  if (g.week > g.cfg.weeks) g.over = true;
  return row;
}

export const teamCost = (g) => sum(g.stages.map((s) => s.cost));

// Units are neither created nor lost: what is on hand and on the way equals the start plus production minus what
// customers received. (Used by the tests.)
export function unitsInSystem(g) {
  return sum(g.stages.map((s) => s.inv + sum(s.inbound)));
}

// Play a whole game with a decision rule per stage: rules[i](view, game) → order.
export function playOut(c, rules) {
  const g = newGame(c);
  while (!g.over) {
    startWeek(g);
    placeOrders(g, g.stages.map((_, i) => rules[i](view(g, i), g)));
  }
  return g;
}
