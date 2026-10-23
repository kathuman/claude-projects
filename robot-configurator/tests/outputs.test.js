// The generated artefacts agree with the design: firmware pins and constants, the wiring table, the build guide,
// and the zip writer. (Compiling the firmware is done by tools/compile-fixtures.js in CI.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve } from '../src/solver.js';
import { generateFirmware } from '../src/firmware.js';
import { wiring, signalDiagram, powerDiagram } from '../src/wiring.js';
import { buildGuide } from '../src/guide.js';
import { crc32, zip } from '../src/zip.js';

const cases = [
  solve({ region: 'SE', type: 'rover', rover: { behaviours: ['remote', 'obstacle', 'line', 'odometry'] } }),
  solve({ region: 'SE', type: 'rover', controller: 'avr', rover: { behaviours: ['remote', 'obstacle'] } }),
  solve({ region: 'DK', type: 'arm', arm: { axes: 4, reach: 0.25, payload: 0.05 } }),
  solve({ region: 'NO', type: 'mobile', arm: { axes: 4, reach: 0.25, payload: 0.05 } }),
];
const designs = cases.flatMap((r) => r.proposals.map((p) => ({ d: p.design, req: r.req })));

test('firmware defines every pin the design uses, with the assigned number', () => {
  for (const { d, req } of designs) {
    const fw = generateFirmware(d, req);
    const robot = fw.files.find((f) => f.path === 'robot/robot.ino').content;
    for (const [id, pin] of Object.entries(d.pins.map)) {
      assert.match(robot, new RegExp(`const uint8_t PIN_${id} = ${pin.code};`), id);
    }
    // every PIN_ used is defined
    const used = new Set(robot.match(/PIN_[A-Z0-9_]+/g));
    for (const u of used) assert.match(robot, new RegExp(`const uint8_t ${u} =`), u);
    for (const f of fw.files) assert.doesNotMatch(f.content, /undefined|NaN|\[object Object\]/, f.path);
  }
});

test('firmware carries the PWM cap, geometry and link the design calls for', () => {
  for (const { d, req } of designs) {
    const robot = generateFirmware(d, req).files[1].content;
    if (d.type !== 'arm') {
      assert.match(robot, new RegExp(`const int PWM_LIMIT = ${Math.round(255 * d.ev.perf.capDuty)};`));
      assert.match(robot, new RegExp(`WHEEL_DIAMETER = ${d.parts.wheel.diameter.toFixed(3)}f`));
      assert.equal(robot.includes('attachInterrupt'), !!d.parts.motor.cpr);
    }
    if (d.arm) {
      assert.match(robot, new RegExp(`L1 = ${Math.round(d.arm.frame.L1 * 1000)}, L2 = ${Math.round(d.arm.frame.L2 * 1000)}`));
      assert.equal((robot.match(/\{"(base|shoulder|elbow|wrist|roll|gripper)", /g) ?? []).length, d.arm.frame.joints.length + 1);
    }
    assert.equal(robot.includes('#include <WiFi.h>'), d.wireless && d.board === 'esp32');
    assert.equal(robot.includes('SoftwareSerial'), d.bt);
  }
});

test('the IK in the firmware is the inverse of the forward kinematics', () => {
  // the same equations as moveTo(), run in JS on a grid of points
  const L1 = 105, L2 = 98, T = 150, H = 100;
  for (const [x, y, z, pitch] of [[200, 0, 120, -45], [150, 80, 60, -90], [250, -50, 200, 0]]) {
    const yaw = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    const phi = (pitch * Math.PI) / 180;
    const wr = r - T * Math.cos(phi);
    const wz = z - H - T * Math.sin(phi);
    const D = (wr * wr + wz * wz - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    const q2 = -Math.acos(D);
    const q1 = Math.atan2(wz, wr) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2));
    const q3 = phi - q1 - q2;
    const fr = L1 * Math.cos(q1) + L2 * Math.cos(q1 + q2) + T * Math.cos(q1 + q2 + q3);
    const fz = H + L1 * Math.sin(q1) + L2 * Math.sin(q1 + q2) + T * Math.sin(q1 + q2 + q3);
    assert.ok(Math.abs(fr * Math.cos(yaw) - x) < 1e-9 && Math.abs(fr * Math.sin(yaw) - y) < 1e-9 && Math.abs(fz - z) < 1e-9);
    assert.ok(Math.sin(q1 + q2 / 2) * 0 === 0 && q2 < 0, 'elbow-up solution');
  }
});

test('the wiring table covers every assigned pin and the dividers the levels need', () => {
  for (const { d } of designs) {
    const w = wiring(d);
    for (const pin of Object.values(d.pins.map)) {
      assert.ok(w.rows.some((r) => r.group === 'Signals' && (r.from.endsWith(pin.label) || r.to.endsWith(pin.label))), pin.label);
    }
    const echoDivider = d.board === 'esp32' && d.ev?.sensors.includes('hcsr04');
    assert.equal(w.dividers.includes('HC-SR04 ECHO'), !!echoDivider);
    assert.equal(w.dividers.length > 0, d.items.some((i) => i.id === 'divider-res'));
    assert.match(powerDiagram(d), /^<svg/);
    assert.match(signalDiagram(d), /^<svg/);
  }
});

test('the build guide sets any adjustable regulator before anything is connected, and adds up its time', () => {
  for (const { d, req } of designs) {
    const g = buildGuide(d, req);
    const titles = g.steps.map((s) => s.title);
    const setReg = titles.findIndex((t) => t.startsWith('Set the regulator'));
    const firstWiring = titles.findIndex((t) => t.startsWith('Wire'));
    const adjustable = [d.parts.reg, d.parts.servoReg].some((r) => r && !r.fixed);
    if (adjustable) assert.ok(setReg >= 0 && setReg < firstWiring, titles.join(' | '));
    else assert.equal(setReg, -1, 'a fixed regulator has nothing to set');
    assert.equal(g.total, g.steps.reduce((s, x) => s + x.minutes, 0));
    for (const s of g.steps) assert.ok(s.minutes > 0 && s.body.length > 0, s.title);
  }
});

test('zip: CRC-32 check value and archive structure', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const z = zip([{ path: 'a.txt', content: 'hi' }]);
  const v = new DataView(z.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(z.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(z.length - 22 + 10, true), 1);
});
