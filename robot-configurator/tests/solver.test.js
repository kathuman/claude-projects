// What the solver proposes passes its checks, respects the user's constraints, and explains itself when it can't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, feasibleDesigns, feasible } from '../src/solver.js';
import { part } from '../src/catalog.js';
import { allowedVendors } from '../src/pricing.js';

const REQS = [
  { region: 'SE', type: 'rover' },
  { region: 'DK', type: 'rover', rover: { terrain: 'outdoor-grass', payload: 2, slope: 15, speed: 0.8, runtime: 90 } },
  { region: 'NO', type: 'rover', rover: { behaviours: ['remote', 'obstacle', 'line', 'odometry'] } },
  { region: 'SE', type: 'arm' },
  { region: 'DK', type: 'arm', arm: { reach: 0.3, payload: 0.1, axes: 4, wireless: false } },
  { region: 'NO', type: 'mobile', arm: { reach: 0.25, payload: 0.05, axes: 4 } },
  { region: 'SE', type: 'rover', solder: 'no', shopping: 'local' },
  { region: 'DK', type: 'arm', controller: 'avr', arm: { wireless: true } },
];
const results = REQS.map((r) => solve(r));

test('every request here has proposals, and every proposal passes every hard check', () => {
  results.forEach((r, i) => {
    assert.ok(r.ok, `request ${i} infeasible`);
    for (const p of r.proposals) {
      assert.ok(feasible(p.design.checks));
      assert.ok(p.price.ok);
      assert.ok(p.design.items.length > 5);
    }
  });
});

test('the lowest-cost proposal is no dearer than the others', () => {
  for (const r of results) {
    const cheapest = r.proposals.find((p) => p.kinds.includes('cheapest'));
    for (const p of r.proposals) if (p.kinds.includes('robust')) assert.ok(cheapest.price.total <= p.price.total + 1e-9);
  }
});

test('no-soldering and Nordic-only requests get neither soldered parts nor foreign vendors', () => {
  const r = results[6];
  for (const p of r.proposals) {
    for (const i of p.design.items) assert.equal(part(i.id).solder, false, i.id);
    const local = allowedVendors('SE', 'local');
    for (const c of p.price.parcels) assert.ok(local.includes(c.vendor), c.vendor);
  }
});

test('an Arduino arm controlled from a phone gets the Bluetooth module and its level divider', () => {
  const d = results[7].proposals[0].design;
  const ids = d.items.map((i) => i.id);
  assert.ok(ids.includes('hc05'));
  assert.ok(ids.includes('divider-res'));
});

test('outdoor grass needs an outdoor chassis and wheels of at least 80 mm', () => {
  for (const p of results[1].proposals) {
    assert.equal(p.design.parts.chassis.terrain, 'outdoor');
    assert.ok(p.design.parts.wheel.diameter >= 0.08);
  }
});

test('measured moves force encoder motors and the gyro', () => {
  for (const p of results[2].proposals) {
    assert.ok(p.design.parts.motor.cpr);
    assert.ok(p.design.items.some((i) => i.id === 'mpu6050'));
  }
});

test('no feasible design pairs a 3.3 V controller with a driver that needs 3.5 V inputs', () => {
  const { designs } = feasibleDesigns({ region: 'SE', type: 'rover', rover: { terrain: 'outdoor-grass', payload: 1 } });
  assert.ok(designs.length > 0);
  for (const d of designs) assert.ok(!(d.parts.mcu.arch === 'esp32' && d.parts.driver.id === 'bts7960'));
});

test('a rover with an arm runs its servos from a regulator the battery can feed and does not tip', () => {
  for (const p of results[5].proposals) {
    const d = p.design;
    assert.ok(d.parts.battery.vMin >= Math.max(d.parts.servoReg.vInMin, 6 + d.parts.servoReg.dropout));
    assert.ok(d.checks.find((c) => c.id === 'tipping').ok);
  }
});

test('the budget cap is respected, and too low a cap reports the cheapest feasible cost', () => {
  const free = solve({ region: 'SE', type: 'rover' });
  const cheapest = Math.min(...free.proposals.map((p) => p.price.total));
  const capped = solve({ region: 'SE', type: 'rover', budget: cheapest * 1.2 });
  for (const p of capped.proposals) assert.ok(p.price.total <= cheapest * 1.2);
  const tooLow = solve({ region: 'SE', type: 'rover', budget: cheapest * 0.5 });
  assert.equal(tooLow.ok, false);
  assert.equal(tooLow.reason, 'budget');
  assert.ok(Math.abs(tooLow.cheapest - cheapest) < 1e-6);
});

test('an impossible request is explained, and the relaxed values it suggests do work', () => {
  const req = { region: 'SE', type: 'rover', rover: { payload: 8, slope: 5, speed: 0.4, runtime: 60 } };
  const r = solve(req);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'requirements');
  assert.ok(r.explain.blockers.length > 0);
  assert.ok(r.explain.nearest.length > 0);
  const payload = r.explain.relax.find((x) => x.label === 'Payload');
  assert.ok(payload, 'suggests a payload');
  const value = Number(payload.text.match(/up to ([\d.]+)/)[1]);
  assert.ok(value < 8);
  assert.ok(solve({ ...req, rover: { ...req.rover, payload: value } }).ok);
});

test('an arm that is asked for too much payload fails on the shoulder and suggests what it can hold', () => {
  const r = solve({ region: 'DK', type: 'arm', arm: { reach: 0.3, payload: 0.4, axes: 4 } });
  assert.equal(r.ok, false);
  assert.ok(r.explain.nearest.some((c) => c.id.startsWith('arm-')));
  assert.ok(r.explain.relax.some((x) => x.label === 'Arm payload'));
});
