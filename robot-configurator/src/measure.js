// Your robot against the model: what the self-test measured (pasted from the serial monitor) or what you measured by
// hand, set beside what the configurator predicted, with what a difference usually means. Measurements can be sent
// in as a pre-filled GitHub issue, so the models can be calibrated against real builds.

import { t, num } from './i18n.js';

// What can be measured, for which robots, and how far from the model still counts as "as modelled".
export const MEASURES = [
  { key: 'speed_air', unit: 'm/s', digits: 2, for: (d) => d.type !== 'arm' && d.ev?.encoders, model: (s) => s.airSpeed, tol: 0.2,
    label: 'Wheel speed in the air (self-test)', how: 'from the self-test, with the wheels off the ground' },
  { key: 'speed_floor', unit: 'm/s', digits: 2, for: (d) => d.type !== 'arm', model: (s) => s.topSpeed, tol: 0.2,
    label: 'Top speed on the floor', how: 'time a straight run at full speed: metres ÷ seconds' },
  { key: 'runtime', unit: 'min', digits: 0, for: (d) => d.type !== 'arm', model: (s) => s.runtime, tol: 0.3,
    label: 'Runtime on one charge', how: 'drive around normally until it slows down or stops' },
  { key: 'slope', unit: '°', digits: 0, for: (d) => d.type !== 'arm', model: (s) => s.maxSlope, tol: 0.25,
    label: 'Steepest slope it climbs', how: 'the steepest ramp it still climbs steadily' },
  { key: 'arm_payload', unit: 'g', digits: 0, for: (d) => !!d.arm, model: (s) => s.armPayload * 1000, tol: 0.25,
    label: 'Heaviest payload held at your reach', how: 'the heaviest object the arm holds still, stretched to your reach' },
];

// Read the self-test's RESULT line (and the plain line older programs print).
export function parseSelfTest(text) {
  const out = {};
  const m = String(text).match(/RESULT\s+speed_air_left=([\d.]+)\s+speed_air_right=([\d.]+)/);
  const old = String(text).match(/wheel speed m\/s, left ([\d.]+), right ([\d.]+)/);
  const pair = m ?? old;
  if (pair) {
    const l = Number(pair[1]);
    const r = Number(pair[2]);
    out.speed_air = Math.min(l, r); // the slower wheel limits straight driving
    out.speed_air_left = l;
    out.speed_air_right = r;
  }
  return out;
}

// One row per measured quantity: the model, your number, the difference and what it usually means.
export function compare(design, measured) {
  const rows = [];
  for (const q of MEASURES) {
    if (!q.for(design)) continue;
    const model = q.model(design.specs);
    const value = measured[q.key];
    const row = { key: q.key, label: t(q.label), how: t(q.how), unit: q.unit, digits: q.digits, model, value: value ?? null };
    if (Number.isFinite(value) && value > 0 && Number.isFinite(model) && model > 0) {
      row.ratio = value / model;
      row.verdict = row.ratio < 1 - q.tol ? 'below' : row.ratio > 1 + q.tol ? 'above' : 'as';
      row.hint = hint(q.key, row.verdict, design);
    }
    rows.push(row);
  }
  return rows;
}

function hint(key, verdict, design) {
  if (verdict === 'as') return t('Within the model\'s range.');
  const below = {
    speed_air: t('Slower than the model: a battery that is not fully charged, a stiff gearbox, or PWM_LIMIT set lower. The slope and acceleration margins shrink by about the same share.'),
    speed_floor: t('Slower than the model: check the wheel speed in the air first; if that matches, the floor or the load costs more than modelled.'),
    runtime: t('Shorter than the model: cells below their label, more starts and turns than assumed, or a heavier load.'),
    slope: t('Less than the model: the tyres slip (grip) or the motors stall (torque); watch which happens. Softer tyres or a lower gear help.'),
    arm_payload: t('Less than the model: the servos are weaker than their rating, or the supply sags under load; measure the servo voltage while it holds.'),
  };
  const above = {
    speed_air: t('Faster than the model: a full battery reads high, which is fine.'),
    speed_floor: t('Faster than the model: fine, but check MAX_WHEEL_SPEED so the speed control has room.'),
    runtime: t('Longer than the model: good cells or gentle driving; the model is on the safe side.'),
    slope: t('Steeper than the model: the model is on the safe side.'),
    arm_payload: t('More than the model: the model is on the safe side; keep fast moves gentle with heavy loads.'),
  };
  return (verdict === 'below' ? below : above)[key];
}

// A GitHub issue with the design and the numbers, for the person to send if they choose to.
export function issueUrl(design, rows, req, describeText) {
  const lines = rows.filter((r) => r.value != null).map((r) =>
    `| ${r.key} | ${num(r.model, r.digits)} ${r.unit} | ${num(r.value, r.digits)} ${r.unit} | ${r.ratio ? `${Math.round(r.ratio * 100)} %` : '–'} |`);
  const body = [
    `Design: ${describeText}`,
    `Market: ${req.region} · type: ${req.type}`,
    `Parts key: ${design.key}`,
    '',
    '| Quantity | Model | Measured | Measured ÷ model |',
    '|---|---|---|---|',
    ...lines,
    '',
    'Anything that differed from the build guide (parts swapped, battery charge, surface):',
    '',
  ].join('\n');
  const q = new URLSearchParams({ title: `Measured build: ${describeText}`.slice(0, 120), body, labels: 'robot-configurator,measurement' });
  return `https://github.com/kathuman/claude-projects/issues/new?${q}`;
}
