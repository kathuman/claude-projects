// Customer demand at the store, week by week. Players never see this in advance; the store sees each week's orders
// as they come. Every pattern starts at its base level for a few weeks, so the chain begins in a calm steady state.
// The patterns and their numbers are Ripple's own.

// A small seeded random generator (mulberry32), so a "random" game can be replayed exactly.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SCENARIOS = {
  step: {
    label: 'Step up',
    blurb: 'Demand runs steady, then rises once and stays higher.',
    base: 6,
    at: (t) => (t < 6 ? 6 : 10),
  },
  seasonal: {
    label: 'Seasonal',
    blurb: 'Demand swings up and down over a season of about three months.',
    base: 8,
    at: (t) => (t < 4 ? 8 : Math.round(8 + 3 * Math.sin((2 * Math.PI * (t - 4)) / 13))),
  },
  promotion: {
    label: 'Promotion',
    blurb: 'A two-week promotion lifts demand, then customers who stocked up buy less for a while.',
    base: 7,
    at: (t) => (t < 8 ? 7 : t < 10 ? 14 : t < 13 ? 4 : 7),
  },
  custom: {
    label: 'Your own step',
    blurb: 'Steady demand that changes once, to the level and in the week you set.',
    custom: true,
  },
  random: {
    label: 'Unpredictable',
    blurb: 'Demand wanders around its average from week to week, with no pattern to learn.',
    base: 8,
    random: true,
  },
};

// The demand for a game: { values: [week 1 … week n], base, label }. A custom step takes { demandFrom, demandTo,
// stepWeek } from `opts`.
export function demandSeries(type, weeks, seed = 1, opts = {}) {
  const s = SCENARIOS[type] ?? SCENARIOS.step;
  let values;
  if (s.custom) {
    const from = opts.demandFrom ?? 4, to = opts.demandTo ?? 8, at = opts.stepWeek ?? 6;
    values = Array.from({ length: weeks }, (_, k) => (k + 1 < at ? from : to));
    return { type, label: s.label, blurb: `${from} a week, then ${to} a week from week ${at} on.`, base: from, values };
  }
  if (s.random) {
    const r = rng(seed * 7919 + 17);
    // a slow wander (mean-reverting) plus week-to-week noise, never below 1
    let level = s.base;
    values = Array.from({ length: weeks }, (_, k) => {
      if (k < 4) return s.base;
      level += 0.35 * (s.base - level) + (r() - 0.5) * 3;
      return Math.max(1, Math.round(level + (r() - 0.5) * 4));
    });
  } else {
    values = Array.from({ length: weeks }, (_, k) => Math.max(0, s.at(k + 1)));
  }
  return { type: SCENARIOS[type] ? type : 'step', label: s.label, blurb: s.blurb, base: s.base, values };
}
