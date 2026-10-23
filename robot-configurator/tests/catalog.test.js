// The catalog is complete and consistent: every part has what the checks need, every offer a real vendor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, VENDORS, REGIONS, FX, EU_DUTY, catalog } from '../src/catalog.js';
import { BOARDS } from '../src/pins.js';

const REQUIRED = {
  mcu: ['board', 'arch', 'logicV', 'current'],
  driver: [],
  motor: ['vNom', 'noLoadRpm', 'stallTorque', 'stallCurrent', 'noLoadCurrent', 'mount', 'shaft'],
  wheel: ['diameter', 'shaft', 'terrain'],
  chassis: ['mount', 'driven', 'maxLoad', 'length', 'track', 'terrain'],
  battery: ['vNom', 'vMax', 'vMin', 'capacity', 'iMax', 'charger', 'chem'],
  regulator: ['vInMin', 'vInMax', 'dropout', 'iCont', 'out', 'eff'],
  servo: ['size', 't48', 't60', 'stallCurrent', 'vMax'],
  frame: ['joints', 'L1', 'L2', 'tool', 'baseH', 'linkMass', 'gripperMass', 'maxPayload', 'size'],
};

test('ids are unique and every part has a name, mass, solder flag and offers', () => {
  const ids = new Set();
  for (const p of PARTS) {
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name && typeof p.mass === 'number' && typeof p.solder === 'boolean', p.id);
    // a pack you assemble is bought as its kit; tracks come with their chassis
    assert.ok(p.offers.length > 0 || p.kit?.every((k) => PARTS.some((x) => x.id === k.id))
      || PARTS.find((x) => x.id === p.partOf)?.includes?.wheel === p.id, `${p.id} has no offer`);
    for (const k of REQUIRED[p.cat] ?? []) assert.ok(p[k] !== undefined, `${p.id} lacks ${k}`);
    assert.ok(p.cat in EU_DUTY, `${p.id}: no duty rate for ${p.cat}`);
  }
});

test('offers name known vendors with positive prices', () => {
  for (const p of PARTS) for (const o of p.offers) {
    assert.ok(VENDORS[o.vendor], `${p.id}: unknown vendor ${o.vendor}`);
    assert.ok(o.price > 0, `${p.id}@${o.vendor}`);
  }
});

test('vendors ship somewhere, in a currency with a rate', () => {
  for (const [id, v] of Object.entries(VENDORS)) {
    assert.ok(Object.keys(v.ship).length, id);
    assert.ok(FX[v.currency], id);
    for (const [r, s] of Object.entries(v.ship)) {
      assert.ok(REGIONS[r], `${id} ships to unknown ${r}`);
      assert.ok(['domestic', 'eu', 'ioss', 'voec', 'ddp', 'import'].includes(s.mode));
      assert.ok(s.days[0] <= s.days[1]);
    }
  }
  for (const r of Object.values(REGIONS)) assert.ok(FX[r.currency]);
});

test('Norway is served by VOEC or import modes only, never EU distance selling', () => {
  for (const v of Object.values(VENDORS)) {
    if (v.ship.NO && v.origin !== 'NO') assert.ok(['voec', 'ddp', 'import'].includes(v.ship.NO.mode));
  }
});

test('physical sanity of the specs', () => {
  for (const m of catalog.motors) assert.ok(m.stallCurrent > m.noLoadCurrent && m.stallTorque > 0);
  for (const b of catalog.batteries) assert.ok(b.vMin < b.vNom && b.vNom < b.vMax);
  for (const r of catalog.regulators) assert.ok(r.vInMin < r.vInMax && (r.out[0] < r.out[1] || (r.fixed && r.out[0] === r.out[1])) && r.eff < 1, r.id);
  for (const s of catalog.servos) assert.ok(s.t60 >= s.t48);
  for (const m of catalog.mcus) assert.ok(BOARDS[m.board], m.id);
  for (const b of catalog.batteries) assert.ok(PARTS.some((p) => p.id === b.charger), b.id);
  // every motor fits some chassis and some wheel
  for (const m of catalog.motors) {
    assert.ok(catalog.chassis.some((c) => c.mount === m.mount), m.id);
    assert.ok(catalog.wheels.some((w) => w.shaft.includes(m.shaft)), m.id);
  }
});

test('every price check is well formed, and every offer is checked (with a link and a date) or an estimate', async () => {
  const { validateChecks } = await import('../tools/check-catalog.mjs');
  assert.deepEqual(validateChecks(), []);
  for (const p of PARTS) for (const o of p.offers) {
    assert.ok(['checked', 'estimate'].includes(o.status), `${p.id}@${o.vendor}`);
    if (o.status === 'checked') assert.ok(o.url && o.checked, `${p.id}@${o.vendor}`);
  }
  const bad = validateChecks({ tb6612: { electrokit: { price: 0, checked: '2999-01-01' }, nowhere: { gone: true, checked: 'x' } } });
  assert.ok(bad.some((e) => /future/.test(e)) && bad.some((e) => /positive/.test(e)) && bad.some((e) => /no such vendor/.test(e))
    && bad.some((e) => /YYYY-MM-DD/.test(e)) && bad.some((e) => /note/.test(e)));
});

test('every vendor can be searched, so an estimate always links somewhere', () => {
  for (const [id, v] of Object.entries(VENDORS)) assert.match(v.search ?? '', /^https:\/\/.+\{q\}/, id);
});
