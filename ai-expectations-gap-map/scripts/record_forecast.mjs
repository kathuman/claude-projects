#!/usr/bin/env node
// Freezes this month's board in data/ledger.json, so its forecasts can be checked when they come due (track.html).
//
// One record per signal period, never rewritten: the analyst scores and signals as they stood, the starting position
// the board showed, and the model's forecast for every preset scenario at each horizon in settings.track. A second run
// for the same period keeps the first record (pass --replace to overwrite it, for instance after a failed refresh).
//
//   node scripts/record_forecast.mjs [--made YYYY-MM-DD] [--replace] [--summary refresh-summary.md]
//
// It uses the board's own model (assets/model.js), so the frozen numbers are what the board showed that month.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startingPoint, simulate, classify, parseCSV } from "../assets/model.js";
import { evaluate } from "../assets/accuracy.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const r1 = (x) => Math.round(x * 10) / 10;

/** One ledger record from the data files' contents. */
export function buildRecord({ cfg, scen, set, sig, assess, made }) {
  const hasSignals = !!(sig?.generated && Object.keys(sig.technologies ?? {}).length);
  const mode = hasSignals ? "blend" : "analyst";
  const horizons = set.track.horizons_months;
  const A = Object.fromEntries(assess.map((a) => [a.id, a]));
  const technologies = {};
  for (const t of cfg.technologies) {
    const a = A[t.id];
    if (!a) continue;
    const s = hasSignals ? sig.technologies[t.id] : null;
    const { h0, e0 } = startingPoint({ expectations: +a.expectations, evidence: +a.evidence }, s, { mode, ...set.blend });
    const item = { ...t, impact: +a.impact, h0, e0 };
    const forecast = {};
    for (const p of scen.presets) {
      forecast[p.id] = horizons.map((m) => {
        const r = simulate(item, { drivers: p.values, horizon: m / 12, correction_speed: set.defaults.correction_speed }, set.model);
        return [r1(r.H), r1(r.E)];
      });
    }
    technologies[t.id] = {
      analyst: [+a.expectations, +a.evidence, +a.impact],
      reviewed: a.reviewed,
      signals: [s?.expectations_index ?? null, s?.evidence_index ?? null],
      start: [r1(h0), r1(e0)],
      cls: classify(h0, e0, set.thresholds),
      forecast,
    };
  }
  return {
    period: hasSignals ? sig.period : made.slice(0, 7),
    made,
    mode,
    horizons,
    settings: { blend: set.blend, thresholds: set.thresholds, model: set.model, correction_speed: set.defaults.correction_speed },
    scenarios: Object.fromEntries(scen.presets.map((p) => [p.id, p.values])),
    technologies,
  };
}

/** Add a record to the ledger; an existing record for the period is kept unless replace is set. */
export function addRecord(ledger, rec, { replace = false } = {}) {
  const records = ledger.records ?? [];
  const i = records.findIndex((r) => r.period === rec.period);
  if (i >= 0 && !replace) return { ledger, added: false };
  const next = i >= 0 ? records.map((r, j) => (j === i ? rec : r)) : [...records, rec];
  next.sort((a, b) => a.period.localeCompare(b.period));
  return { ledger: { ...ledger, records: next }, added: true };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const json = (f, fallback) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), "utf8")) : fallback);
  const made = opt("--made") ?? new Date().toISOString().slice(0, 10);
  const rec = buildRecord({
    cfg: json("technologies.json"), scen: json("scenarios.json"), set: json("settings.json"),
    sig: json("signals.json", {}), assess: parseCSV(readFileSync(join(DATA, "assessments.csv"), "utf8")), made,
  });
  const before = json("ledger.json", { records: [] });
  const { ledger, added } = addRecord(before, rec, { replace: args.includes("--replace") });
  if (added) writeFileSync(join(DATA, "ledger.json"), JSON.stringify(ledger) + "\n");
  const ev = evaluate(ledger);
  const due = ev.byHorizon.map((h) => `${h.horizon} months: error ${h.error.toFixed(1)} vs ${h.naive.toFixed(1)} standing still, ${h.n} comparisons`);
  const next = ev.pending.map((p) => p.due).sort()[0];
  const lines = [
    "",
    "### Track record",
    "",
    added ? `Forecasts frozen for ${rec.period} (${Object.keys(rec.technologies).length} technologies, ${rec.horizons.join(", ")} months ahead).`
      : `A record for ${rec.period} already exists and was kept as it was.`,
    due.length ? `Forecasts that have come due, base case: ${due.join("; ")}.` : `No forecast has come due yet${next ? `; the first falls due in ${next}` : ""}.`,
    "",
  ];
  const summary = opt("--summary");
  if (summary) appendFileSync(summary, lines.join("\n"));
  console.log(lines.filter(Boolean).join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
