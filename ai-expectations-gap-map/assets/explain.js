// Plain-language explanations of where a technology sits and why: the rubric band a score falls in, how the board's
// number is built from the analyst score and the collected signals, how a technology ranks on each signal, and what
// the projection model does to it. Pure functions, no DOM, so they can be tested in Node.

import { clamp, simulate, classify } from "./model.js";

// The scoring rubric (methodology page, section 3): [from, to, anchor, typical signs].
export const RUBRIC = {
  expectations: [
    [0, 20, "Niche", "Discussed mainly in research papers or specialist forums. No dedicated vendor category."],
    [20, 40, "Specialist interest", "Early-stage startups, conference tracks, occasional trade-press coverage."],
    [40, 60, "Mainstream business topic", "Large vendors market it, analyst firms cover it, it appears in business press regularly."],
    [60, 80, "Board-level priority", "Large funding rounds and capex commitments, CEO statements, valuations that assume success."],
    [80, 100, "Treated as inevitable", "Capital and public policy committed ahead of results. Sceptics are a small minority in public debate."],
  ],
  evidence: [
    [0, 20, "Laboratory", "Research results and demonstrations. No paying production use."],
    [20, 40, "Pilots", "Pilots and a few production deployments. No independent measurement of financial impact. High pilot cancellation."],
    [40, 60, "Early production", "Early adopters in production with quantified case studies. Results vary widely between organisations."],
    [60, 80, "Repeatable value", "Widespread production use, repeatable returns, mature vendors and established practices."],
    [80, 100, "Infrastructure", "Standard practice or commodity. Value is assumed and competition is on price."],
  ],
  impact: [
    [0, 20, "Marginal", "A marginal efficiency gain in one activity."],
    [20, 40, "Functional", "A material improvement within one function."],
    [40, 60, "Cross-functional", "A material improvement across several functions, or a meaningful cost line."],
    [60, 80, "Industry-changing", "Changes the operating model of an industry."],
    [80, 100, "General-purpose", "A general-purpose technology with economy-wide effects."],
  ],
};

/** The rubric band a 0–100 score falls in (100 belongs to the top band). */
export function band(axis, v) {
  const rows = RUBRIC[axis];
  const i = Math.min(rows.length - 1, Math.max(0, Math.floor(clamp(v, 0, 100) / 20)));
  const [lo, hi, anchor, signs] = rows[i];
  return { index: i, lo, hi, anchor, signs };
}

/** Rank of one technology on a measure, 1 = highest, among those that have a value; null without a value. */
export function rankOf(id, values) {
  const v = values[id];
  if (v == null || !Number.isFinite(v)) return null;
  const all = Object.values(values).filter((x) => x != null && Number.isFinite(x));
  return { rank: 1 + all.filter((x) => x > v).length, of: all.length, max: Math.max(...all) };
}

/** Relative change from prev to cur, or null. */
export const change = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : cur / prev - 1);

/**
 * How the board's starting value on one axis is built. mode: analyst | blend | signals; weight: the signal's weight in
 * a blend. Returns the parts (each with its value, weight and contribution), the total, and why a signal was left out.
 */
export function composition(analyst, index, weight, mode) {
  const has = index != null && Number.isFinite(index);
  if (mode === "analyst" || !has) {
    return { parts: [{ source: "analyst", value: analyst, weight: 1, contribution: analyst }], total: analyst,
      missing: mode !== "analyst" && !has };
  }
  if (mode === "signals") {
    return { parts: [{ source: "signal", value: index, weight: 1, contribution: index }], total: clamp(index, 0, 100), missing: false };
  }
  const parts = [
    { source: "analyst", value: analyst, weight: 1 - weight, contribution: (1 - weight) * analyst },
    { source: "signal", value: index, weight, contribution: weight * index },
  ];
  return { parts, total: clamp(parts[0].contribution + parts[1].contribution, 0, 100), missing: false };
}

/**
 * What the projection model does to one technology under a scenario: the evidence growth rate and what each driver
 * adds to it, the premium that keeps expectations above evidence, and the path to the horizon.
 * item: { h0, e0, impact, base_rate, sensitivities }; state: { drivers, horizon (years), correction_speed }.
 */
export function outlook(item, state, model, thresholds, driverKeys) {
  const drivers = driverKeys.map((k) => {
    const s = item.sensitivities[k] || 0;
    const d = state.drivers[k] || 0;
    return { key: k, sensitivity: s, setting: d, effect: s * d };
  });
  const mult = 1 + drivers.reduce((a, x) => a + x.effect, 0);
  const rate = Math.max(0, item.base_rate * mult);
  const premium = {
    impact: model.premium_impact * (item.impact - 50),
    capital: model.premium_capital * (state.drivers.capital || 0),
    capability: model.premium_capability * (state.drivers.capability || 0),
  };
  premium.total = premium.impact + premium.capital + premium.capability;
  const H = state.horizon;
  const step = H <= 1 ? 0.25 : H <= 2.5 ? 0.5 : 1;
  const times = [];
  for (let t = 0; t < H - 1e-9; t += step) times.push(+t.toFixed(2));
  times.push(H);
  const path = times.map((t) => {
    const r = simulate(item, { ...state, horizon: t }, model);
    return { t, H: r.H, E: r.E, gap: r.H - r.E, cls: classify(r.H, r.E, thresholds) };
  });
  return { baseRate: item.base_rate, drivers, multiplier: mult, rate, premium, target: clamp(item.e0 + premium.total, 0, 100),
    speed: state.correction_speed, path };
}
