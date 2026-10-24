// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { simulate, classify, startingPoint, parseCSV } from "../assets/model.js";

const model = { premium_impact: 0.2, premium_capital: 12, premium_capability: 10, steps_per_year: 4 };
const zero = { capability: 0, capital: 0, regulation: 0, cost: 0, data: 0 };
const item = { h0: 80, e0: 30, impact: 50, base_rate: 0.3, sensitivities: { ...zero, capability: 0.5 } };

test("horizon 0 returns the starting point", () => {
  const r = simulate(item, { drivers: zero, horizon: 0, correction_speed: 0.4 }, model);
  assert.equal(r.H, 80); assert.equal(r.E, 30);
});
test("hype converges toward evidence over time", () => {
  const r = simulate(item, { drivers: zero, horizon: 5, correction_speed: 0.6 }, model);
  assert.ok(r.E > 30);
  assert.ok(Math.abs(r.H - r.E) < 50);
});
test("positive capability driver raises evidence for a sensitive item", () => {
  const a = simulate(item, { drivers: zero, horizon: 3, correction_speed: 0.4 }, model);
  const b = simulate(item, { drivers: { ...zero, capability: 1 }, horizon: 3, correction_speed: 0.4 }, model);
  assert.ok(b.E > a.E);
});
test("values stay inside 0..100", () => {
  const r = simulate({ ...item, base_rate: 1 }, { drivers: { ...zero, capability: 1, capital: 1 }, horizon: 5, correction_speed: 1 }, model);
  assert.ok(r.E <= 100 && r.H <= 100 && r.H >= 0);
});
test("classification thresholds", () => {
  const t = { overheated_gap: 20, underpriced_gap: -15, proven_evidence: 50 };
  assert.equal(classify(80, 30, t), "over");
  assert.equal(classify(40, 70, t), "under");
  assert.equal(classify(60, 60, t), "proven");
  assert.equal(classify(30, 20, t), "emerg");
});
test("blend modes", () => {
  const a = { expectations: 50, evidence: 50 }, s = { expectations_index: 90, evidence_index: 10 };
  const w = { expectations_signal_weight: 0.5, evidence_signal_weight: 0.5 };
  assert.deepEqual(startingPoint(a, s, { mode: "analyst", ...w }), { h0: 50, e0: 50 });
  assert.deepEqual(startingPoint(a, s, { mode: "blend", ...w }), { h0: 70, e0: 30 });
  assert.deepEqual(startingPoint(a, s, { mode: "signals", ...w }), { h0: 90, e0: 10 });
  assert.deepEqual(startingPoint(a, null, { mode: "signals", ...w }), { h0: 50, e0: 50 });
});
test("CSV with quoted commas", () => {
  const rows = parseCSV('id,notes\r\na,"x, ""y"""\nb,plain\n');
  assert.deepEqual(rows, [{ id: "a", notes: 'x, "y"' }, { id: "b", notes: "plain" }]);
});
