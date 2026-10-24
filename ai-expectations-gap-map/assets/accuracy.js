// Keeping score: every month the board's forecasts are frozen in data/ledger.json (scripts/record_forecast.mjs).
// When a forecast comes due, it is compared with what the board then showed, and with a forecast that assumes nothing
// moves. Pure functions, no DOM, so they can be tested in Node.

import { classify } from "./model.js";

/** "2026-09" plus n months. */
export function addMonths(period, n) {
  const [y, m] = period.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// Moves smaller than this (points on the 0–100 scale) count as "no move" in the direction check.
export const FLAT = 1;

/**
 * Compare every forecast that has come due with what followed.
 *
 * Two lenses:
 *  - position: the forecast (H, E) against the board's own position in the month it was aimed at, next to the naive
 *    forecast "it stays where it is". Skill = 1 − error / naive error: above 0 the model beat standing still.
 *  - direction: the forecast's move in expectations against the move in the measured attention index (collected
 *    signals, independent of the analyst), for technologies with signals at both dates.
 *
 * Returns { rows, pending, byHorizon, byScenario }.
 */
export function evaluate(ledger, { scenario = "base" } = {}) {
  const recs = [...(ledger?.records ?? [])].sort((a, b) => a.period.localeCompare(b.period));
  const at = Object.fromEntries(recs.map((r) => [r.period, r]));
  const rows = [];
  const pending = [];
  const scen = {};
  for (const rec of recs) {
    rec.horizons.forEach((h, hi) => {
      const due = addMonths(rec.period, h);
      const obs = at[due];
      if (!obs) { pending.push({ from: rec.period, horizon: h, due }); return; }
      const t = obs.settings?.thresholds ?? rec.settings.thresholds;
      for (const [id, f] of Object.entries(rec.technologies)) {
        const o = obs.technologies[id];
        if (!o) continue;
        const [h0, e0] = f.start;
        const [ht, et] = o.start;
        const err = (H, E) => (Math.abs(H - ht) + Math.abs(E - et)) / 2;
        for (const [sid, fc] of Object.entries(f.forecast)) {
          (scen[`${sid}|${h}`] ??= []).push(err(fc[hi][0], fc[hi][1]));
        }
        const fc = f.forecast[scenario];
        if (!fc) continue;
        const [H, E] = fc[hi];
        const row = {
          id, from: rec.period, due, horizon: h, start: [h0, e0], forecast: [H, E], observed: [ht, et],
          error: err(H, E), naive: err(h0, e0),
          cls: classify(H, E, t), clsNaive: classify(h0, e0, t), clsObserved: classify(ht, et, t),
          reviewed: o.reviewed > rec.made,
        };
        const s0 = f.signals?.[0];
        const s1 = o.signals?.[0];
        if (s0 != null && s1 != null && Math.abs(H - h0) >= FLAT) {
          row.direction = { predicted: H - h0, measured: s1 - s0, hit: sign(H - h0) === sign(s1 - s0) && Math.abs(s1 - s0) >= FLAT };
        }
        rows.push(row);
      }
    });
  }
  const horizons = [...new Set(rows.map((r) => r.horizon))].sort((a, b) => a - b);
  const byHorizon = horizons.map((h) => {
    const rs = rows.filter((r) => r.horizon === h);
    const error = mean(rs.map((r) => r.error));
    const naive = mean(rs.map((r) => r.naive));
    const dir = rs.filter((r) => r.direction);
    return {
      horizon: h, n: rs.length, forecasts: new Set(rs.map((r) => r.from)).size,
      error, naive, skill: naive > 0 ? 1 - error / naive : null,
      classHit: mean(rs.map((r) => (r.cls === r.clsObserved ? 1 : 0))),
      classHitNaive: mean(rs.map((r) => (r.clsNaive === r.clsObserved ? 1 : 0))),
      directionN: dir.length, directionHit: mean(dir.map((r) => (r.direction.hit ? 1 : 0))),
      reviewed: rs.filter((r) => r.reviewed).length,
    };
  });
  const byScenario = Object.entries(scen).map(([k, errs]) => {
    const [sid, h] = k.split("|");
    return { scenario: sid, horizon: Number(h), error: mean(errs), n: errs.length };
  });
  return { rows, pending, byHorizon, byScenario };
}
