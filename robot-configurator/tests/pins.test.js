// Pin assignment respects what each pin can do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPins, BOARDS } from '../src/pins.js';
import { pinDemands } from '../src/solver.js';
import { part } from '../src/catalog.js';

test('Uno: encoder channel A on the two interrupt pins, PWM on PWM pins', () => {
  const demands = pinDemands({ driver: part('tb6612'), encoders: true, sensors: ['hcsr04'], bt: false });
  const r = assignPins('uno', demands);
  assert.ok(r.ok);
  assert.deepEqual([r.map.L_ENCA.label, r.map.R_ENCA.label].sort(), ['D2', 'D3']);
  for (const d of demands) assert.ok(r.map[d.id].caps.has(d.need), d.id);
  assert.equal(new Set(Object.values(r.map)).size, demands.length);
});

test('Uno runs out of pins for driver + encoders + sonar + 5-way line sensor', () => {
  const r = assignPins('uno', pinDemands({ driver: part('l298n'), encoders: true, sensors: ['hcsr04', 'line-5ch'], bt: false }));
  assert.equal(r.ok, false);
  assert.ok(r.missing.length > 0);
});

test('ESP32: inputs go to the input-only pins first; outputs never do', () => {
  const demands = pinDemands({ driver: part('l298n'), encoders: true, sensors: ['hcsr04', 'line-5ch'], bt: false });
  const r = assignPins('esp32', demands);
  assert.ok(r.ok);
  for (const d of demands) {
    const pin = r.map[d.id];
    assert.ok(pin.caps.has(d.need), d.id);
    if (d.need === 'out' || d.need === 'pwm') assert.ok(pin.caps.has('out'));
  }
  const inputOnly = BOARDS.esp32.pins.filter((p) => !p.caps.has('out'));
  assert.ok(inputOnly.every((p) => Object.values(r.map).includes(p)));
});
