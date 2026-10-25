// Decision rules: how a stage decides its order. Simulated players use them to fill the stages no person holds, the
// debrief uses them as benchmarks, and the fitted version of a player's own rule explains their decisions.
//
// The anchoring-and-adjustment rule (Sterman 1989, "Modeling managerial behavior", Management Science 35(3)):
//   expected orders  L̂ₜ = θ·Lₜ + (1 − θ)·L̂ₜ₋₁          (a smoothed forecast of incoming orders)
//   order            Oₜ = max(0, L̂ₜ + α·(S′ − S − β·SL))
// where S is the effective inventory (on hand minus owed) and SL the supply line (ordered but not yet received).
// α is the share of the stock gap corrected each week, β how much of the supply line is counted, S′ the desired
// level of S + β·SL. Fitted to players of the classic game, the average player had θ ≈ 0.36, α ≈ 0.26 and
// β ≈ 0.34: they counted only about a third of what they had already ordered.
//
// The best simple rule counts the whole supply line (β = 1) and aims it at the lead time's worth of expected orders:
//   Oₜ = max(0, L̂ₜ + α·(I* − S) + α·(L̂ₜ·LT − SL))
// with θ, α and the safety stock I* tuned once per chain on a set of demand patterns (never on the game being played).

import { playOut, teamCost, config } from './engine.js';

export const TYPICAL = { theta: 0.36, alpha: 0.26, beta: 0.34 };

// Weeks between placing an order and receiving it in steady state, for stage i.
export const leadTime = (cfg, i) => (i === cfg.stages - 1 ? cfg.prodDelay : cfg.orderDelay + cfg.shipDelay);

// The supply line a stage sees at decision time when the chain is calm (what it ordered in the weeks still to arrive).
export const calmSupplyLine = (cfg, i) => cfg.base * (leadTime(cfg, i) - 1);

// The smoothed forecast of incoming orders after this week, from what the stage has seen. Worked out from the
// history each time (no hidden state), so a saved game resumes exactly.
export function forecast(v, theta, base) {
  let e = base;
  for (const p of v.past) e = theta * p.incoming + (1 - theta) * e;
  return theta * v.incoming + (1 - theta) * e;
}

// An anchoring-and-adjustment player. If S′ is not given it is set so the player keeps a calm chain calm.
export function anchoring({ theta, alpha, beta, desired }, cfg, i) {
  const target = desired ?? cfg.initInv + beta * calmSupplyLine(cfg, i);
  return (v) => {
    const expected = forecast(v, theta, cfg.base);
    const s = v.inventory - v.backlog;
    return Math.max(0, Math.round(expected + alpha * (target - s - beta * v.supplyLine)));
  };
}

// The best-simple-rule player with parameters { theta, alpha, safety }.
export function orderUpTo({ theta, alpha, safety }, cfg, i) {
  const lt = leadTime(cfg, i) - 1;
  return (v) => {
    const expected = forecast(v, theta, cfg.base);
    const s = v.inventory - v.backlog;
    return Math.max(0, Math.round(expected + alpha * (safety - s) + alpha * (expected * lt - v.supplyLine)));
  };
}

// The demand patterns the best rule is tuned on: none of them is the game being played.
const TRAINING = [['step', 1], ['seasonal', 1], ['promotion', 1], ['random', 101], ['random', 202], ['random', 303]];

const cache = new Map();
// Tune the best simple rule for a chain: the θ, α and safety stock that give the lowest total cost over the training
// patterns, every stage using the rule.
export function bestRule(c) {
  const cfg = config(c);
  const key = [cfg.stages, cfg.orderDelay, cfg.shipDelay, cfg.prodDelay, cfg.holding, cfg.backlog, cfg.initInv, cfg.initPipeline, cfg.weeks].join('|');
  if (cache.has(key)) return cache.get(key);
  let best = null;
  for (const theta of [0.1, 0.2, 0.3, 0.45, 0.6, 0.8]) {
    for (const alpha of [0.15, 0.25, 0.35, 0.5, 0.7, 1]) {
      for (const safety of [0, 2, 4, 6, 9, 12, 16]) {
        const p = { theta, alpha, safety };
        let cost = 0;
        for (const [scenario, seed] of TRAINING) {
          const g = playOut({ ...c, scenario, seed }, Array.from({ length: cfg.stages }, (_, i) => orderUpTo(p, config({ ...c, scenario, seed }), i)));
          cost += teamCost(g);
        }
        if (!best || cost < best.cost) best = { ...p, cost };
      }
    }
  }
  const out = { theta: best.theta, alpha: best.alpha, safety: best.safety };
  cache.set(key, out);
  return out;
}

// A chain where every stage follows one kind of rule, for the benchmarks.
export function benchmark(c, kind) {
  const cfg = config(c);
  const rules = cfg.names.map((_, i) => (kind === 'best' ? orderUpTo(bestRule(c), cfg, i) : anchoring(TYPICAL, cfg, i)));
  return playOut(c, rules);
}
