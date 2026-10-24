// After the game: what happened, what it cost, and why. Everything is computed from the finished game, so the page
// only draws it.
//
//   summary()     costs by stage (holding and backlog), order peaks, amplification, time used
//   benchmarks()  the same chain and demand played by typical players and by the best simple rule
//   fits()        each stage's decision rule, read from its orders (fit.js)
//   causes()      the supply-line lesson for this team: replay the chain with every stage's fitted rule, then with
//                 every stage counting 0 %, 10 % … 100 % of what it had already ordered, all else as it decided. The
//                 curve shows what counting the supply line was worth. (Fixing habits one at a time misleads: faster
//                 correction alone, with the supply line still ignored, makes the chain far worse.)

import { config, playOut, teamCost } from './engine.js';
import { anchoring, benchmark, calmSupplyLine, TYPICAL } from './rules.js';
import { fitRule, stageRows } from './fit.js';

const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)) : 0; };
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

// people: which stages a person played (the others were simulated)
export function summary(game, people = []) {
  const { cfg } = game;
  const demand = game.history.map((h) => h.demand);
  const sdD = sd(demand);
  const stages = game.stages.map((s, i) => {
    const rows = game.history.map((h) => h.stages[i]);
    const orders = rows.map((r) => r.order);
    const secs = rows.map((r) => r.seconds).filter((x) => x != null);
    return {
      name: s.name, person: people.includes(i), cost: s.cost,
      holdingCost: sum(rows.map((r) => cfg.holding * r.inv)), backlogCost: sum(rows.map((r) => cfg.backlog * r.backlog)),
      peakOrder: Math.max(...orders), peakBacklog: Math.max(...rows.map((r) => r.backlog)),
      amplification: sdD > 1e-9 ? sd(orders) / sdD : null,
      seconds: { total: sum(secs), median: median(secs), longest: secs.length ? Math.max(...secs) : null, n: secs.length },
      // orders placed for the player: nothing entered, or time ran out
      autoEmpty: rows.filter((r) => r.auto === 'empty').length, autoTimeout: rows.filter((r) => r.auto === 'timeout').length,
    };
  });
  const allSecs = game.history.flatMap((h) => h.stages.map((r) => r.seconds)).filter((x) => x != null);
  return {
    teamCost: teamCost(game), stages, weeks: game.history.length, demand, demandPeak: Math.max(...demand),
    timeTotal: sum(allSecs), timeMedian: median(allSecs),
  };
}

export function benchmarks(game) {
  const c = game.cfg.input;
  return { typical: benchmark(c, 'typical'), best: benchmark(c, 'best') };
}

export function fits(game) {
  return game.stages.map((_, i) => fitRule(stageRows(game, i), game.cfg.base));
}

// Replay the chain with one anchoring rule per stage (params per stage).
function replay(c, params) {
  const cfg = config(c);
  return teamCost(playOut(c, params.map((p, i) => anchoring(p, cfg, i))));
}

// A fitted rule with β changed, keeping the desired effective inventory it implies in a calm chain.
function withBeta(p, beta, cfg, i) {
  const calmSL = calmSupplyLine(cfg, i);
  const desiredS = (p.desired ?? cfg.initInv + p.beta * calmSL) - p.beta * calmSL;
  return { ...p, beta, desired: desiredS + beta * calmSL };
}

export function causes(game, fitted = fits(game)) {
  const c = game.cfg.input;
  const cfg = config(c);
  if (fitted.some((f) => !f)) return null;
  const actual = teamCost(game);
  const model = replay(c, fitted);
  // every stage counting a share β of what it had already ordered, everything else as each stage decided
  const curve = [];
  for (let k = 0; k <= 10; k++) {
    const beta = k / 10;
    curve.push({ beta, cost: replay(c, fitted.map((p, i) => withBeta(p, beta, cfg, i))) });
  }
  const teamBeta = mean(fitted.map((p) => p.beta));
  const full = curve.at(-1).cost;
  return { actual, model, fitGap: actual - model, curve, teamBeta, supplyLineSaving: model - full };
}

export { TYPICAL };
