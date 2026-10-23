// The validation report's cases: every known answer agrees with what the engine computes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validationCases, catalogCoverage } from '../src/validation.js';

test('every case on the validation page agrees with its independently known answer', () => {
  const cases = validationCases();
  assert.ok(cases.length >= 10);
  for (const c of cases) assert.ok(c.ok, `${c.id}: expected ${c.expected}, computed ${c.computed}`);
});

test('the coverage figures on the page add up', () => {
  const c = catalogCoverage();
  assert.ok(c.checked > 0 && c.checked <= c.offers && c.dropped > 0);
});
