// The validation report: the engine run on cases whose answer is known independently (a hand calculation, the
// definition of a tax rule, a brute-force search), each with the expected value, the computed one and whether they
// agree. validation.html runs these live in the browser; tests/validation.test.js runs the same cases.

import * as P from './physics.js';
import { part, PARTS, FX } from './catalog.js';
import { consignment, priceOrder, allowedVendors } from './pricing.js';
import { solve } from './solver.js';
import { t, num } from './i18n.js';

const G = 9.81;
const deg = (d) => (d * Math.PI) / 180;

// Brute force: every assignment of items to vendors that sell them, priced parcel by parcel.
function bruteForce(items, region) {
  const vendors = allowedVendors(region, 'cheapest');
  const choices = items.map((i) => part(i.id).offers.filter((o) => vendors.includes(o.vendor)).map((o) => o.vendor));
  let best = Infinity;
  const walk = (k, pick) => {
    if (k === items.length) {
      const groups = {};
      items.forEach((it, j) => { (groups[pick[j]] ??= []).push(it); });
      best = Math.min(best, Object.entries(groups).reduce((s, [v, its]) => s + consignment(v, its, region).total, 0));
      return;
    }
    for (const v of choices[k]) walk(k + 1, [...pick, v]);
  };
  walk(0, []);
  return best;
}

export function validationCases() {
  const cases = [];
  const add = (c) => cases.push({ ...c, ok: Math.abs(c.computed - c.expected) <= (c.tol ?? 1e-6) * Math.max(1, Math.abs(c.expected)) });

  const jga = part('jga25-34-enc');
  const w0 = (170 * 2 * Math.PI) / 60;
  add({ id: 'motor-line', area: t('Motor model'), title: t('A 12 V gearmotor at half voltage carrying 0.1 N·m'),
    how: t('linear torque–speed line: half the voltage halves both the no-load speed and the stall torque'),
    expected: ((w0 / 2) * (1 - 0.1 / 0.325) * 60) / (2 * Math.PI), computed: (P.motorSpeed(jga, 6, 0.1) * 60) / (2 * Math.PI), unit: 'rpm', digits: 2 });

  const th = deg(10);
  add({ id: 'slope', area: t('Drive model'), title: t('Force to push 2 kg up a 10° slope while accelerating at 0.5 m/s²'),
    how: t('m g (rolling resistance × cos θ + sin θ) + m a'),
    expected: 2 * G * (0.03 * Math.cos(th) + Math.sin(th)) + 2 * 0.5, computed: P.tractiveForce(2, 0.03, th, 0.5), unit: 'N', digits: 3 });

  add({ id: 'pwm-cap', area: t('Drive model'), title: t('PWM cap for a 6 V motor on a full 2S pack through a DRV8833'),
    how: t('motor rating ÷ full battery voltage (this driver has no fixed drop)'),
    expected: (6 / 8.4) * 100, computed: P.pwmLimit(part('tt-dc'), part('drv8833'), part('batt-2s-18650')) * 100, unit: '%', digits: 1 });

  add({ id: 'runtime', area: t('Battery model'), title: t('Runtime of a 3 Ah 7.4 V pack at 8.88 W'),
    how: t('80 % of the pack\'s energy ÷ power'),
    expected: (3 * 7.4 * 0.8) / 8.88, computed: P.runtimeHours(part('batt-2s-18650'), 8.88), unit: 'h', digits: 3 });

  const f = part('arm-alu-4axis');
  const mg = part('mg996r');
  const L1 = f.L1; const L2 = f.L2; const T = f.tool;
  const ms = [[f.linkMass[0], L1 / 2], [mg.mass, L1], [f.linkMass[1], L1 + L2 / 2], [mg.mass, L1 + L2], [f.gripperMass + mg.mass, L1 + L2 + T / 2], [0.1, L1 + L2 + T]];
  add({ id: 'shoulder', area: t('Arm model'), title: t('Shoulder holding torque, 4-axis aluminium arm stretched out with 100 g'),
    how: t('sum of every mass × its distance from the shoulder × g'),
    expected: G * ms.reduce((s, [m, x]) => s + m * x, 0),
    computed: P.jointTorques(f, { base: mg, shoulder: mg, elbow: mg, wrist: mg, gripper: mg }, 0.1).shoulder, unit: 'N·m', digits: 4 });

  add({ id: 'grip', area: t('Arm model'), title: t('Gripper torque to hold 100 g by friction, 30 mm fingers'),
    how: t('m g × safety 2 ÷ (2 fingers × μ 0.5) × finger length'),
    expected: ((0.1 * G * 2) / (2 * 0.5)) * 0.03, computed: P.gripTorque(0.1, 0.03), unit: 'N·m', digits: 4 });

  const ali = part('esp32-devkit').offers.find((o) => o.vendor === 'ali').price;
  const ioss = consignment('ali', [{ id: 'esp32-devkit', qty: 2 }], 'DK');
  add({ id: 'ioss', area: t('Taxes and shipping'), title: t('Two boards from AliExpress to Denmark (IOSS, under €150)'),
    how: t('(goods + shipping below the free-shipping line) × DKK rate × 25 % VAT; no duty, no fee'),
    expected: (2 * ali + (2 * ali < 10 ? 2 : 0)) * FX.DKK * 1.25, computed: ioss.total, unit: 'DKK', digits: 2 });

  const voec = consignment('ali', [{ id: 'esp32-devkit', qty: 2 }], 'NO');
  add({ id: 'voec', area: t('Taxes and shipping'), title: t('The same parcel to Norway (VOEC): duty and carrier fee'),
    how: t('VOEC shops collect VAT at checkout, so the parcel clears with no duty and no fee'),
    expected: 0, computed: voec.duty + voec.fees, unit: 'NOK', digits: 2 });

  const items = ['tb6612', 'sg90', 'hcsr04', 'jumpers', 'mpu6050'].map((id) => ({ id, qty: 1 }));
  add({ id: 'optimiser', area: t('Vendor choice'), title: t('Cheapest way to buy five parts in Sweden'),
    how: t('brute force over every assignment of the parts to the shops that sell them'),
    expected: bruteForce(items, 'SE'), computed: priceOrder(items, 'SE').total, unit: 'SEK', digits: 2 });

  const r = solve({ region: 'SE', type: 'rover', rover: { payload: 30 } });
  const relax = r.explain?.relax.find((x) => x.label === 'Payload');
  const suggested = relax ? Number(relax.text.match(/([\d.,]+)/g).map((s) => s.replace(',', '.')).find((s) => Number(s) > 0)) : NaN;
  const after = Number.isFinite(suggested) ? solve({ region: 'SE', type: 'rover', rover: { payload: suggested } }) : { ok: false };
  add({ id: 'relax', area: t('Explanations'), title: t('An impossible payload: the relaxed value it suggests really works'),
    how: t('ask for 30 kg, take the suggested payload, and search again'),
    expected: 1, computed: after.ok ? 1 : 0, unit: '', digits: 0, yesno: true });

  return cases;
}

// How much of the catalog has been checked at the shops.
export function catalogCoverage() {
  const offers = PARTS.flatMap((p) => p.offers);
  return { offers: offers.length, checked: offers.filter((o) => o.status === 'checked').length,
    dropped: PARTS.reduce((s, p) => s + p.dropped.length, 0) };
}

export const fmtCase = (c, v) => (c.yesno ? (v ? t('yes') : t('no')) : `${num(v, c.digits)}${c.unit ? ` ${c.unit}` : ''}`);
