// Run: node --test tests/explain.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { band, rankOf, change, composition, outlook } from "../assets/explain.js";
import { simulate, startingPoint } from "../assets/model.js";

test("scores fall in their rubric band, 100 in the top one", () => {
  assert.equal(band("evidence", 0).anchor, "Laboratory");
  assert.equal(band("evidence", 35).anchor, "Pilots");
  assert.equal(band("evidence", 40).anchor, "Early production");
  assert.equal(band("expectations", 80).anchor, "Treated as inevitable");
  assert.equal(band("expectations", 100).anchor, "Treated as inevitable");
  assert.equal(band("impact", 55).index, 2);
});

test("ranks count from the top and skip technologies without a value", () => {
  const v = { a: 10, b: 30, c: null, d: 20 };
  assert.deepEqual(rankOf("b", v), { rank: 1, of: 3, max: 30 });
  assert.equal(rankOf("a", v).rank, 3);
  assert.equal(rankOf("c", v), null);
});

test("change against the period before", () => {
  assert.ok(Math.abs(change(72452, 57547) - 0.259) < 0.001);
  assert.equal(change(5, 0), null);
  assert.equal(change(null, 3), null);
});

test("the explanation adds up to the board's own starting point", () => {
  const w = { expectations_signal_weight: 0.4, evidence_signal_weight: 0.2 };
  for (const mode of ["analyst", "blend", "signals"]) {
    const sp = startingPoint({ expectations: 82, evidence: 35 }, { expectations_index: 76.9, evidence_index: 80.1 }, { mode, ...w });
    const h = composition(82, 76.9, w.expectations_signal_weight, mode);
    const e = composition(35, 80.1, w.evidence_signal_weight, mode);
    assert.ok(Math.abs(h.total - sp.h0) < 1e-9, mode);
    assert.ok(Math.abs(e.total - sp.e0) < 1e-9, mode);
    assert.ok(Math.abs(h.parts.reduce((a, x) => a + x.contribution, 0) - h.total) < 1e-9);
  }
  const none = composition(35, null, 0.2, "blend");
  assert.equal(none.total, 35);
  assert.equal(none.missing, true);
  assert.equal(composition(35, null, 0.2, "analyst").missing, false);
});

test("the outlook explains the same path the board draws", () => {
  const model = { premium_impact: 0.2, premium_capital: 12, premium_capability: 10, steps_per_year: 4 };
  const T = { overheated_gap: 20, underpriced_gap: -15, proven_evidence: 50 };
  const keys = ["capability", "capital", "regulation", "cost", "data"];
  const item = { h0: 80, e0: 44, impact: 90, base_rate: 0.3, sensitivities: { capability: 0.5, capital: 0, regulation: -0.2, cost: 0, data: 0.4 } };
  const state = { drivers: { capability: 0.9, capital: 0.5, regulation: 0, cost: 0.5, data: 0.1 }, horizon: 2, correction_speed: 0.4 };
  const o = outlook(item, state, model, T, keys);
  assert.ok(Math.abs(o.multiplier - (1 + 0.5 * 0.9 + 0.4 * 0.1)) < 1e-12);
  assert.ok(Math.abs(o.rate - 0.3 * o.multiplier) < 1e-12);
  assert.ok(Math.abs(o.premium.total - (0.2 * 40 + 12 * 0.5 + 10 * 0.9)) < 1e-12);
  assert.equal(o.target, Math.min(100, 44 + o.premium.total));
  assert.deepEqual(o.path.map((x) => x.t), [0, 0.5, 1, 1.5, 2]);
  const end = simulate(item, state, model);
  assert.ok(Math.abs(o.path.at(-1).H - end.H) < 1e-12 && Math.abs(o.path.at(-1).E - end.E) < 1e-12);
  assert.equal(o.path[0].H, 80);
  assert.equal(outlook(item, { ...state, horizon: 1 }, model, T, keys).path.length, 5);
});
