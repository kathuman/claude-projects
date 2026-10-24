// Run: node --test tests/accuracy.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { addMonths, evaluate } from "../assets/accuracy.js";
import { simulate, startingPoint } from "../assets/model.js";
import { buildRecord, addRecord } from "../scripts/record_forecast.mjs";

const T = { overheated_gap: 20, underpriced_gap: -15, proven_evidence: 50 };
const rec = (period, made, techs, horizons = [3]) => ({ period, made, mode: "blend", horizons, settings: { thresholds: T }, technologies: techs });
const tech = (start, forecast, { signals = [null, null], reviewed = "2026-01-01", alt } = {}) =>
  ({ start, signals, reviewed, forecast: { base: forecast, ...(alt ? { other: alt } : {}) } });

test("months roll over the year", () => {
  assert.equal(addMonths("2026-09", 3), "2026-12");
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(addMonths("2026-09", 24), "2028-09");
});

test("nothing is scored before it comes due, and the due month is known", () => {
  const ev = evaluate({ records: [rec("2026-09", "2026-10-24", { a: tech([80, 30], [[70, 40]]) }, [3, 12])] });
  assert.equal(ev.rows.length, 0);
  assert.deepEqual(ev.pending.map((p) => p.due), ["2026-12", "2027-09"]);
});

test("error, standing still and skill against the later position", () => {
  const ledger = { records: [
    rec("2026-09", "2026-10-01", {
      a: tech([80, 30], [[70, 40]], { signals: [60, null], alt: [[80, 30]] }),  // moved the right way
      b: tech([40, 40], [[50, 40]], { signals: [30, null] }),                   // moved, nothing happened
    }),
    rec("2026-12", "2027-01-03", {
      a: tech([72, 38], [[0, 0]], { signals: [50, null], reviewed: "2026-12-20" }),
      b: tech([40, 40], [[0, 0]], { signals: [30, null] }),
    }),
  ] };
  const ev = evaluate(ledger);
  const a = ev.rows.find((r) => r.id === "a");
  const b = ev.rows.find((r) => r.id === "b");
  assert.equal(a.error, (2 + 2) / 2);
  assert.equal(a.naive, (8 + 8) / 2);
  assert.equal(b.error, 5);
  assert.equal(b.naive, 0);
  assert.equal(a.reviewed, true);
  assert.equal(b.reviewed, false);
  const h = ev.byHorizon[0];
  assert.equal(h.n, 2);
  assert.equal(h.error, 3.5);
  assert.equal(h.naive, 4);
  assert.ok(Math.abs(h.skill - (1 - 3.5 / 4)) < 1e-12);
  // a: forecast lower expectations, signals fell: right direction; b: signals flat, so not a hit
  assert.equal(a.direction.hit, true);
  assert.equal(b.direction.hit, false);
  assert.equal(h.directionN, 2);
  assert.equal(h.directionHit, 0.5);
  // quadrants: a forecast proven-ish? 70-40 = 30 gap → over; later 72-38 → over
  assert.equal(a.cls, "over");
  assert.equal(a.clsObserved, "over");
  // the other scenario is scored too, for "which future came closest"
  const other = ev.byScenario.find((s) => s.scenario === "other");
  assert.equal(other.error, (8 + 8) / 2);
  assert.equal(ev.byScenario.find((s) => s.scenario === "base").error, 3.5);
});

test("a record freezes what the board showed, and is never rewritten", () => {
  const zero = { capability: 0, capital: 0, regulation: 0, cost: 0, data: 0 };
  const set = {
    blend: { expectations_signal_weight: 0.4, evidence_signal_weight: 0.2 }, thresholds: T,
    model: { premium_impact: 0.2, premium_capital: 12, premium_capability: 10, steps_per_year: 4 },
    defaults: { correction_speed: 0.4 }, track: { horizons_months: [3, 12] },
  };
  const t = { id: "x", name: "X", base_rate: 0.3, sensitivities: { ...zero, capability: 0.5 } };
  const sig = { generated: "2026-10-24T00:00:00Z", period: "2026-09", technologies: { x: { expectations_index: 90, evidence_index: null } } };
  const r = buildRecord({ cfg: { technologies: [t] }, scen: { presets: [{ id: "base", values: zero }] }, set, sig,
    assess: [{ id: "x", expectations: "70", evidence: "30", impact: "60", reviewed: "2026-10-24" }], made: "2026-10-24" });
  assert.equal(r.period, "2026-09");
  assert.equal(r.mode, "blend");
  const sp = startingPoint({ expectations: 70, evidence: 30 }, sig.technologies.x, { mode: "blend", ...set.blend });
  assert.deepEqual(r.technologies.x.start, [Math.round(sp.h0 * 10) / 10, Math.round(sp.e0 * 10) / 10]);
  const y1 = simulate({ ...t, impact: 60, ...sp }, { drivers: zero, horizon: 1, correction_speed: 0.4 }, set.model);
  assert.deepEqual(r.technologies.x.forecast.base[1], [Math.round(y1.H * 10) / 10, Math.round(y1.E * 10) / 10]);
  assert.deepEqual(r.technologies.x.signals, [90, null]);

  const first = addRecord({ records: [] }, r);
  assert.equal(first.added, true);
  const again = addRecord(first.ledger, { ...r, made: "2026-10-30" });
  assert.equal(again.added, false);
  assert.equal(again.ledger.records[0].made, "2026-10-24");
  const forced = addRecord(first.ledger, { ...r, made: "2026-10-30" }, { replace: true });
  assert.equal(forced.ledger.records.length, 1);
  assert.equal(forced.ledger.records[0].made, "2026-10-30");
});
