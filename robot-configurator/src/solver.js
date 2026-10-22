// From requirements to designs: enumerate every compatible combination of catalog parts, run the engineering checks
// on each, rank the feasible ones by estimated cost and by margin, price the best exactly, and return up to three
// proposals: the lowest cost, the most robust, and the quickest to arrive. When nothing is feasible, say which checks
// stopped the closest candidates and how far each requirement must move for a design to exist.

import { catalog, part, FX } from './catalog.js';
import * as P from './physics.js';
import { BOARDS, assignPins } from './pins.js';
import { allowedVendors, refPrice, priceOrder } from './pricing.js';
import { t, num } from './i18n.js';

export const BEHAVIOURS = {
  remote: 'Drive it from a phone',
  obstacle: 'Avoid obstacles',
  line: 'Follow a line',
  odometry: 'Measured moves (encoders + gyro)',
};

export const DEFAULT_REQ = {
  region: 'SE',
  type: 'rover', // rover | arm | mobile
  rover: { payload: 0.3, speed: 0.4, slope: 5, terrain: 'indoor-smooth', runtime: 60, accel: 0.5,
    behaviours: ['remote', 'obstacle'] },
  arm: { reach: 0.15, payload: 0.02, axes: 3, wireless: true },
  controller: 'auto', // auto | avr | esp32
  budget: null, // in the region's currency, everything included
  solder: 'yes', // yes | buy | no
  printer: false,
  tools: false, // add multimeter + screwdrivers to the budget
  charger: true,
  shopping: 'cheapest', // cheapest | fast | local
  fx: null,
};

// ---------------------------------------------------------------- checks

const mk = (id, label, value, limit, cmp, unit, extra = {}) => {
  const ok = cmp === '≤' ? value <= limit + 1e-9 : value >= limit - 1e-9;
  const margin = limit === 0 ? (ok ? 1 : -1) : (cmp === '≤' ? (limit - value) / Math.abs(limit) : (value - limit) / Math.abs(limit));
  return { id, label, value, limit, cmp, unit, ok, margin, severity: 'fail', key: true, ...extra };
};
const le = (id, label, value, limit, unit, extra) => mk(id, label, value, limit, '≤', unit, extra);
const ge = (id, label, value, limit, unit, extra) => mk(id, label, value, limit, '≥', unit, extra);
const flag = (id, label, ok, detail, extra = {}) => ({ id, label, ok, detail, severity: 'fail', key: false,
  margin: ok ? 1 : -1, ...extra });
const info = (id, label, detail) => ({ id, label, ok: true, detail, severity: 'info', key: false, margin: 1 });

export const feasible = (checks) => checks.every((c) => c.ok || c.severity !== 'fail');
export const robustness = (checks) => Math.min(1, ...checks.filter((c) => c.key && c.severity === 'fail')
  .map((c) => c.margin));
const violation = (checks) => checks.filter((c) => !c.ok && c.severity === 'fail')
  .reduce((s, c) => s + Math.min(5, Math.abs(c.margin) + 0.05), 0);

// ---------------------------------------------------------------- the parts a request may use

function usableParts(req) {
  const vendors = allowedVendors(req.region, req.shopping);
  const ok = (p) => p.offers.some((o) => vendors.includes(o.vendor))
    && !(req.solder === 'no' && p.solder) && !(p.printer && !req.printer);
  const f = (list) => list.filter(ok);
  let mcus = f(catalog.mcus);
  if (req.controller === 'avr') mcus = mcus.filter((m) => m.arch === 'avr');
  if (req.controller === 'esp32') mcus = mcus.filter((m) => m.arch === 'esp32');
  return {
    vendors, ok,
    mcus, drivers: f(catalog.drivers), motors: f(catalog.motors), wheels: f(catalog.wheels),
    chassis: f(catalog.chassis), batteries: f(catalog.batteries), servos: f(catalog.servos),
    frames: f(catalog.frames),
    logicRegs: f(catalog.regulators.filter((r) => r.out[0] <= 5 && r.out[1] >= 5 && r.iCont <= 5)),
    servoRegs: f(catalog.regulators.filter((r) => r.out[0] <= 6 && r.out[1] >= 6 && r.iCont >= 5)),
    has: (id) => ok(part(id)),
  };
}

// ---------------------------------------------------------------- electronics: signals, pins, logic current

// The signals a set of electronics needs, as pin demands.
export function pinDemands({ driver, encoders, sensors, bt }) {
  const d = [];
  const add = (id, need, device, signal) => d.push({ id, need, device, signal });
  if (driver) {
    for (const s of ['L', 'R']) {
      // a dual driver is one board serving both sides; single-channel drivers come in pairs
      const dev = driver.channels === 1 ? `${driver.name} (${s === 'L' ? t('left') : t('right')})` : driver.name;
      if (driver.scheme === 'en-in') {
        add(`${s}_EN`, 'pwm', dev, driver.id === 'l298n' ? (s === 'L' ? 'ENA' : 'ENB') : (s === 'L' ? 'PWMA' : 'PWMB'));
        add(`${s}_IN1`, 'out', dev, driver.id === 'l298n' ? (s === 'L' ? 'IN1' : 'IN3') : (s === 'L' ? 'AIN1' : 'BIN1'));
        add(`${s}_IN2`, 'out', dev, driver.id === 'l298n' ? (s === 'L' ? 'IN2' : 'IN4') : (s === 'L' ? 'AIN2' : 'BIN2'));
      } else if (driver.scheme === 'in-in') {
        add(`${s}_IN1`, 'pwm', dev, s === 'L' ? 'AIN1' : 'BIN1');
        add(`${s}_IN2`, 'pwm', dev, s === 'L' ? 'AIN2' : 'BIN2');
      } else if (driver.scheme === 'pwm-dir') {
        add(`${s}_PWM`, 'pwm', dev, s === 'L' ? 'PWM1' : 'PWM2');
        add(`${s}_DIR`, 'out', dev, s === 'L' ? 'DIR1' : 'DIR2');
      } else if (driver.scheme === 'two-pwm') {
        add(`${s}_RPWM`, 'pwm', dev, 'RPWM');
        add(`${s}_LPWM`, 'pwm', dev, 'LPWM');
      }
    }
  }
  if (encoders) {
    for (const s of ['L', 'R']) {
      const dev = s === 'L' ? t('Left motor encoder') : t('Right motor encoder');
      add(`${s}_ENCA`, 'int', dev, 'A');
      add(`${s}_ENCB`, 'in', dev, 'B');
    }
  }
  if (sensors.includes('hcsr04')) {
    add('SONAR_TRIG', 'out', 'HC-SR04', 'TRIG');
    add('SONAR_ECHO', 'in', 'HC-SR04', 'ECHO');
  }
  if (sensors.includes('line-5ch')) for (let i = 1; i <= 5; i++) add(`LINE${i}`, 'in', t('Line sensor'), `OUT${i}`);
  if (bt) {
    add('BT_RX', 'in', 'HC-05', 'TXD');
    add('BT_TX', 'out', 'HC-05', 'RXD');
  }
  return d;
}

const pinCache = new Map();
function pinsFor(mcu, spec) {
  const key = [mcu.board, spec.driver?.scheme, spec.driver?.id, !!spec.encoders, spec.sensors.join(','), !!spec.bt].join('|');
  if (!pinCache.has(key)) {
    const demands = pinDemands(spec);
    pinCache.set(key, { ...assignPins(mcu.board, demands), demands });
  }
  return pinCache.get(key);
}

// ---------------------------------------------------------------- arm

function cheapest(list, price) {
  return [...list].sort((a, b) => price(a.id) - price(b.id));
}

// Evaluate one arm (frame + a servo per joint) at servo supply Vs.
export function evalArm(frame, servos, arm, Vs = 6) {
  const checks = [];
  const reach = P.armReach(frame);
  checks.push(le('arm-reach', t('Required reach within 90 % of the arm\'s full stretch'), arm.reach, 0.9 * reach, 'm',
    { detail: t('full stretch {mm} mm; the last 10 % is a singular, imprecise pose', { mm: num(reach * 1000, 0) }) }));
  checks.push(ge('arm-axes', t('Axes (not counting the gripper)'), frame.joints.length, arm.axes, '', { key: false }));
  checks.push(le('arm-structure', t('Payload within the frame\'s rated load'), arm.payload, frame.maxPayload, 'kg'));
  const torques = P.jointTorques(frame, servos, arm.payload, Math.max(arm.reach, 0.5 * reach));
  const hold = {};
  for (const j of ['shoulder', 'elbow', 'wrist']) {
    if (!(j in torques)) continue;
    const s = servos[j];
    const ts = P.servoTorque(s, Vs);
    checks.push(le(`arm-${j}`, t({ shoulder: 'Shoulder holding torque ≤ 50 % of the {servo} stall torque',
      elbow: 'Elbow holding torque ≤ 50 % of the {servo} stall torque',
      wrist: 'Wrist holding torque ≤ 50 % of the {servo} stall torque' }[j], { servo: s.name.split(' ')[0] }),
    torques[j], 0.5 * ts, 'N·m', { detail: j === 'shoulder' ? t('payload held horizontally at the required reach (worst case)')
      : t('link horizontal with the payload (worst case)') }));
    hold[j] = s.idleCurrent + s.stallCurrent * Math.min(1, torques[j] / ts);
  }
  const gt = P.gripTorque(arm.payload, frame.finger);
  checks.push(le('arm-grip', t('Gripper torque to hold the payload by friction (μ 0.5, ×2) ≤ 50 % of stall'), gt,
    0.5 * P.servoTorque(servos.gripper, Vs), 'N·m'));
  hold.gripper = servos.gripper.idleCurrent + servos.gripper.stallCurrent * Math.min(1, gt / P.servoTorque(servos.gripper, Vs));
  hold.base = servos.base.idleCurrent;
  if (servos.roll) hold.roll = servos.roll.idleCurrent;
  checks.push(info('arm-base', t('Base yaw carries no gravity load'), t('the frame\'s base bearing takes the weight')));
  const all = Object.values(servos);
  for (const s of new Set(all)) {
    checks.push(le(`arm-v-${s.id}`, t('Servo supply within the {servo} rating', { servo: s.name.split(' ')[0] }), Vs, s.vMax, 'V', { key: false }));
  }
  const holdSum = Object.values(hold).reduce((a, b) => a + b, 0);
  const peak = holdSum + Math.max(...all.map((s) => s.stallCurrent)); // any one servo can stall while the others hold
  const mass = frame.mass + all.reduce((s, x) => s + x.mass, 0) + part('pca9685').mass;
  return { checks, torques, holdSum, peak, mass, reach };
}

// The highest payload this arm holds with every joint check passing.
function armMaxPayload(frame, servos, arm, Vs) {
  let lo = 0;
  let hi = frame.maxPayload;
  const pass = (m) => evalArm(frame, servos, { ...arm, payload: m }, Vs).checks
    .filter((c) => c.id.startsWith('arm-') && c.id !== 'arm-axes').every((c) => c.ok);
  if (!pass(0)) return 0;
  if (pass(hi)) return hi;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (pass(mid)) lo = mid; else hi = mid; }
  return lo;
}

function armCandidates(req, U, price) {
  const arm = req.arm;
  const out = [];
  for (const frame of U.frames) {
    const S = U.servos.filter((s) => s.size === frame.size);
    if (!S.length) continue;
    const sorted = cheapest(S, price);
    // the gripper, base and roll servos don't load each other: take the cheapest that passes
    const gripper = sorted.find((s) => P.gripTorque(arm.payload, frame.finger) <= 0.5 * P.servoTorque(s, 6)) ?? sorted.at(-1);
    const base = sorted[0];
    const roll = frame.joints.includes('roll') ? sorted[0] : null;
    const wrists = frame.joints.includes('wrist') ? S : [null];
    for (const shoulder of S) for (const elbow of S) for (const wrist of wrists) {
      const servos = { base, shoulder, elbow, gripper };
      if (wrist) servos.wrist = wrist;
      if (roll) servos.roll = roll;
      const ev = evalArm(frame, servos, arm);
      out.push({ frame, servos, ...ev });
    }
  }
  return out;
}

// Parts of the arm itself (without power or controller).
function armBom(a) {
  const items = [{ id: a.frame.id, qty: 1, role: t('Arm frame') }];
  const count = {};
  for (const [joint, s] of Object.entries(a.servos)) (count[s.id] ??= []).push(joint);
  for (const [id, joints] of Object.entries(count)) items.push({ id, qty: joints.length, role: t('Servo: {joints}', { joints: joints.map((j) => t(j)).join(', ') }) });
  items.push({ id: 'pca9685', qty: 1, role: t('Servo driver (I²C)') });
  if (a.frame.joints.length >= 4) items.push({ id: 'servo-ext', qty: 1, role: t('Servo cable extensions') });
  return items;
}

// ---------------------------------------------------------------- rover

function roverSensors(req) {
  const b = req.rover.behaviours;
  const s = [];
  if (b.includes('obstacle')) s.push('hcsr04');
  if (b.includes('line')) s.push('line-5ch');
  if (b.includes('odometry')) s.push('mpu6050');
  return s;
}

// Evaluate one rover combination. `arm` (optional) is a chosen arm candidate riding on top.
function evalRover(c, req, arm, servoReg) {
  const R = req.rover;
  const { chassis, motor, wheel, driver, battery, reg, mcu } = c;
  const terr = P.TERRAIN[R.terrain];
  const n = chassis.driven;
  const perChannel = n / 2;
  const units = driver.channels === 1 ? 2 : 1;
  const sensors = roverSensors(req);
  const wireless = R.behaviours.includes('remote') || (arm && req.arm.wireless);
  const bt = wireless && !mcu.wifi;
  const encoders = !!motor.cpr;
  const checks = [];

  // logic rail
  let logicCurrent = mcu.current + driver.current * units + sensors.reduce((s, id) => s + part(id).current, 0)
    + (encoders ? 0.02 : 0) + (bt ? part('hc05').current : 0) + (arm ? part('pca9685').current : 0);
  const elecMass = mcu.mass + driver.mass * units + reg.mass + sensors.reduce((s, id) => s + part(id).mass, 0) + 0.08
    + (servoReg ? servoReg.mass : 0);
  const armLoad = arm ? arm.mass + req.arm.payload : 0;
  const mass = chassis.mass + n * (motor.mass + wheel.mass) + battery.mass + elecMass + R.payload + armLoad;
  const carried = mass - chassis.mass;

  checks.push(le('load', t('Carried load within the chassis rating'), carried, chassis.maxLoad, 'kg',
    { detail: t(arm ? 'payload {kg} kg + battery, motors, wheels, electronics, arm' : 'payload {kg} kg + battery, motors, wheels, electronics',
      { kg: num(R.payload, 2) }) }));
  if (terr.outdoor) {
    checks.push(flag('terrain-chassis', t('Chassis built for outdoor use'), chassis.terrain === 'outdoor'));
    checks.push(flag('terrain-wheel', t('Wheels with outdoor tread'), wheel.terrain === 'outdoor'));
  }
  if (terr.minWheel) checks.push(ge('terrain-diameter', t('Wheel diameter for {surface}', { surface: t(terr.label).toLowerCase() }),
    wheel.diameter, terr.minWheel, 'm', { key: false }));

  const theta = (R.slope * Math.PI) / 180;
  const sys = { motor, driver, battery, wheel, nMotors: n };
  const Fc = P.tractiveForce(mass, terr.crr, theta);
  const Fp = P.tractiveForce(mass, terr.crr, theta, R.accel);
  const cont = P.driveAt(sys, Fc, battery.vMin);
  const peak = P.driveAt(sys, Fp, battery.vMin);
  const flat = P.driveAt(sys, P.tractiveForce(mass, terr.crr, 0), battery.vNom);
  const drivenShare = n === 4 ? 1 : 0.75;
  checks.push(le('traction', t('Force to climb and accelerate within tyre grip'), Fp,
    terr.mu * mass * P.G * Math.cos(theta) * drivenShare, 'N',
    { detail: t('grip μ {mu} on {pct} % of the weight', { mu: num(terr.mu, 1), pct: num(drivenShare * 100, 0) }) }));
  checks.push(le('torque-cont', t('Motor torque on the slope ≤ 30 % of stall (continuous duty)'), cont.torque,
    0.3 * cont.stallTorque, 'N·m', { detail: t('at the battery\'s cut-off voltage, the worst case') }));
  checks.push(le('torque-peak', t('Motor torque accelerating up the slope ≤ 60 % of stall'), peak.torque,
    0.6 * peak.stallTorque, 'N·m'));
  checks.push(ge('speed', t('Top speed on the flat'), flat.speed, R.speed, 'm/s', { detail: t('nominal battery voltage') }));
  checks.push(ge('speed-slope', t('Still moves up the slope on an empty battery'), cont.speed, 0.1, 'm/s'));

  const capDuty = P.pwmLimit(motor, driver, battery);
  checks.push(ge('motor-voltage', t('Motor rating vs battery: firmware PWM cap'), capDuty, 0.4, '',
    { detail: capDuty < 1 ? t('PWM limited to {pct} % so the motor sees ≤ {v} V', { pct: num(capDuty * 100, 0), v: num(motor.vNom, 1) })
      : t('battery never exceeds the motor rating'), key: false }));
  checks.push(le('driver-vmax', t('Full battery within the driver\'s voltage range'), battery.vMax, driver.vMax, 'V'));
  checks.push(ge('driver-vmin', t('Empty battery above the driver\'s minimum'), battery.vMin, driver.vMin, 'V'));
  checks.push(le('driver-cont', t('Motor current per driver channel ≤ continuous rating'), cont.current * perChannel,
    driver.iCont, 'A', { detail: perChannel > 1 ? t('{n} motors in parallel per channel', { n: perChannel }) : '' }));
  const vStall = capDuty * (battery.vMax - driver.drop0);
  const iStall = motor.stallCurrent * (vStall / motor.vNom) * perChannel;
  checks.push(le('driver-peak', t('Stall current per channel ≤ driver peak rating'), iStall, driver.iPeak, 'A',
    { severity: 'warn', key: false, detail: t('the firmware ramps the speed so a start never stalls; a jammed wheel still can') }));
  checks.push(flag('logic-level', t('{v} V controller outputs drive the {driver} inputs', { v: num(mcu.logicV, 1), driver: driver.name.split(' ')[0] }),
    driver.logicHigh <= 0.9 * mcu.logicV, t('driver needs ≥ {v} V for a high input', { v: num(driver.logicHigh, 1) })));

  // the controllers run down to a 4.6 V rail (the ESP32's 3.3 V LDO and the AVR at 16 MHz both still work there)
  const regVmin = Math.max(reg.vInMin, 4.6 + reg.dropout);
  checks.push(ge('reg-vin', t('Empty battery keeps the {reg} output above 4.6 V', { reg: reg.name.split(' ')[0] }), battery.vMin,
    regVmin, 'V'));
  checks.push(le('reg-vmax', t('Full battery within the 5 V regulator\'s input range'), battery.vMax, reg.vInMax, 'V'));
  checks.push(le('reg-current', t('5 V rail current ≤ regulator rating'), logicCurrent, reg.iCont, 'A'));

  // arm power from the battery
  let armAvgPower = 0;
  let armPeakBatt = 0;
  if (arm) {
    const sv = Math.max(servoReg.vInMin, 6 + servoReg.dropout);
    checks.push(ge('servo-reg-vin', t('Empty battery high enough for the {reg} to make 6 V', { reg: servoReg.name.split(' ')[0] }),
      battery.vMin, sv, 'V'));
    checks.push(le('servo-reg-vmax', t('Full battery within the servo regulator\'s input range'), battery.vMax,
      servoReg.vInMax, 'V'));
    checks.push(le('servo-reg-current', t('Servo current (all holding + one stalled) ≤ regulator rating'), arm.peak,
      servoReg.iCont, 'A'));
    armAvgPower = (6 * arm.holdSum * 0.5) / servoReg.eff;
    armPeakBatt = (6 * arm.peak) / (servoReg.eff * battery.vMin);
    // tipping: arm stretched out sideways with the payload, the worst direction for a narrow chassis
    const parts = P.armMasses(arm.frame, arm.servos, req.arm.payload);
    const moment = parts.reduce((s, p) => s + p.mass * p.x, 0);
    const offset = moment / mass;
    const support = Math.min(chassis.length, chassis.track) / 2;
    checks.push(le('tipping', t('Centre of mass with the arm stretched sideways stays inside ⅔ of the wheel base'),
      offset, support / 1.5, 'm', { detail: t('support half-width {mm} mm', { mm: num(support * 1000, 0) }) }));
  }

  const logicBatt = (5 * logicCurrent) / (0.85 * battery.vMin);
  const peakBatt = n * peak.current + logicBatt + armPeakBatt;
  checks.push(le('battery-current', t('Peak battery current ≤ battery discharge rating'), peakBatt, battery.iMax, 'A'));
  const power = P.averagePower(sys, { mass, crr: terr.crr, cruise: 0.7 * flat.speed,
    movingFraction: 0.6, logicCurrent }) + armAvgPower;
  const hours = P.runtimeHours(battery, power);
  checks.push(ge('runtime', t('Runtime (moving 60 % of the time at 70 % of top speed, with starts and turns)'), hours * 60,
    R.runtime, 'min'));

  const pins = pinsFor(mcu, { driver, encoders, sensors, bt });
  checks.push(flag('pins', t('Enough suitable pins on the {board}', { board: BOARDS[mcu.board].name }), pins.ok,
    pins.ok ? t('{n} pins left free', { n: pins.free })
      : t('missing: {list}', { list: pins.missing.map((m) => `${m.device} ${m.signal} (${m.need})`).join(', ') })));
  if (R.behaviours.includes('line') && terr.outdoor) {
    checks.push({ ...info('line-outdoor', t('Line following outdoors'), t('IR line sensors need an even indoor surface')),
      severity: 'warn', ok: false });
  }

  return {
    checks, mass, power, hours, peakBatt, logicCurrent, pins, sensors, bt, encoders, wireless,
    perf: { cont, peak, flat, capDuty, n, perChannel, units, fuse: P.fuseFor(peakBatt) },
  };
}

// Steepest slope the rover can hold continuously and still grip.
function roverMaxSlope(c, req, arm, servoReg) {
  const ok = (deg) => {
    const ev = evalRover(c, { ...req, rover: { ...req.rover, slope: deg } }, arm, servoReg);
    return ev.checks.filter((x) => ['traction', 'torque-cont', 'speed-slope'].includes(x.id)).every((x) => x.ok);
  };
  if (!ok(0)) return 0;
  let lo = 0;
  let hi = 45;
  if (ok(hi)) return hi;
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}

function roverBom(c, ev, req) {
  const { chassis, motor, wheel, driver, battery, reg, mcu } = c;
  const n = chassis.driven;
  const items = [
    { id: chassis.id, qty: 1, role: t('Chassis') },
    { id: motor.id, qty: n, role: t('Drive motors') },
    { id: wheel.id, qty: n, role: t('Wheels') },
    { id: driver.id, qty: ev.perf.units, role: t('Motor driver') },
    { id: battery.id, qty: 1, role: t('Battery') },
    { id: reg.id, qty: 1, role: t('5 V regulator (logic)') },
    { id: mcu.id, qty: 1, role: t('Controller') },
    ...ev.sensors.map((id) => ({ id, qty: 1, role: t('Sensor') })),
  ];
  if (ev.bt) items.push({ id: 'hc05', qty: 1, role: t('Bluetooth link') });
  if (ev.peakBatt > 2) items.push({ id: 'wire-20awg', qty: 1, role: t('Power wiring') });
  if (battery.chem === 'lipo') items.push({ id: 'xt60-pigtail', qty: 1, role: t('Battery lead') });
  return items;
}

function commonBom(req, items, mcu) {
  const out = [...items];
  const needDivider = out.some((i) => i.id === 'hcsr04') && mcu.logicV < 5 || out.some((i) => i.id === 'hc05') && mcu.logicV >= 5;
  if (needDivider) out.push({ id: 'divider-res', qty: 1, role: t('Logic-level dividers') });
  out.push({ id: 'jumpers', qty: 1, role: t('Signal wiring') });
  out.push({ id: 'breadboard-mini', qty: 1, role: t('Power distribution') });
  out.push({ id: 'm3-kit', qty: 1, role: t('Mounting hardware') });
  const batt = out.find((i) => part(i.id).cat === 'battery');
  if (batt) {
    out.push({ id: 'switch-fuse', qty: 1, role: t('Power switch + fuse') });
    if (req.charger) out.push({ id: part(batt.id).charger, qty: 1, role: t('Charger') });
    if (part(batt.id).chem === 'lipo') out.push({ id: 'lipo-bag', qty: 1, role: t('LiPo safety') });
  }
  if (req.tools) {
    out.push({ id: 'tool-multimeter', qty: 1, role: t('Tool') });
    out.push({ id: 'tool-screwdrivers', qty: 1, role: t('Tool') });
  }
  if (req.solder === 'buy' && out.some((i) => part(i.id).solder)) out.push({ id: 'tool-solder', qty: 1, role: t('Tool') });
  return out;
}

// ---------------------------------------------------------------- enumeration

function* roverCombos(U, req) {
  const needEnc = req.rover.behaviours.includes('odometry');
  for (const chassis of U.chassis) for (const motor of U.motors) {
    if (motor.mount !== chassis.mount || (needEnc && !motor.cpr)) continue;
    for (const wheel of U.wheels) {
      if (!wheel.shaft.includes(motor.shaft)) continue;
      for (const driver of U.drivers) for (const battery of U.batteries) for (const reg of U.logicRegs) {
        for (const mcu of U.mcus) yield { chassis, motor, wheel, driver, battery, reg, mcu };
      }
    }
  }
}

function stationaryArmPower(U) {
  const opts = [];
  if (U.has('psu-6v-5a') && U.has('dc-jack-terminal')) opts.push({ psu: part('psu-6v-5a'), reg: null, iCont: 5 });
  if (U.has('psu-12v-5a') && U.has('dc-jack-terminal')) {
    for (const reg of U.servoRegs) {
      if (reg.vInMin > 12 || reg.vInMax < 12 || 12 < 6 + reg.dropout) continue;
      opts.push({ psu: part('psu-12v-5a'), reg, iCont: Math.min(reg.iCont, (12 * 5 * reg.eff) / 6) });
    }
  }
  return opts;
}

function buildArmDesign(a, power, mcu, req) {
  const checks = [...a.checks];
  checks.push(le('servo-supply', t('Servo current (all holding + one stalled) ≤ supply rating'), a.peak, power.iCont, 'A'));
  const bt = req.arm.wireless && !mcu.wifi;
  const pins = pinsFor(mcu, { driver: null, encoders: false, sensors: [], bt });
  checks.push(flag('pins', t('Enough suitable pins on the {board}', { board: BOARDS[mcu.board].name }), pins.ok));
  const items = [...armBom(a), { id: mcu.id, qty: 1, role: t('Controller (USB-powered)') },
    { id: power.psu.id, qty: 1, role: t('Servo power supply') }, { id: 'dc-jack-terminal', qty: 1, role: t('Supply connector') }];
  if (power.reg) items.push({ id: power.reg.id, qty: 1, role: t('6 V servo regulator') });
  if (bt) items.push({ id: 'hc05', qty: 1, role: t('Bluetooth link') });
  return { checks, items, pins, bt, wireless: req.arm.wireless };
}

// ---------------------------------------------------------------- main entry

// The parts a proposal can swap one at a time, by robot type, and what each slot is called on the page.
export const SWAP_SLOTS = {
  rover: ['chassis', 'motor', 'wheel', 'driver', 'battery', 'reg', 'mcu'],
  mobile: ['chassis', 'motor', 'wheel', 'driver', 'battery', 'reg', 'mcu', 'servoReg'],
  arm: ['shoulder', 'elbow', 'wrist', 'mcu', 'power'],
};
export const SLOT_LABEL = {
  chassis: 'Chassis', motor: 'Drive motors', wheel: 'Wheels', driver: 'Motor driver', battery: 'Battery',
  reg: '5 V regulator (logic)', mcu: 'Controller', servoReg: '6 V servo regulator', shoulder: 'Shoulder servo',
  elbow: 'Elbow servo', wrist: 'Wrist servo', power: 'Servo power supply',
}; // shown through t()

// Solve a request and keep what it found, so the page can ask for more without searching again: any design on the
// cost–headroom chart (pickDesign) and the alternatives for one part of a design (swapOptions).
export function solveSession(reqIn) {
  const req = withDefaults(reqIn);
  const fx = req.fx ?? FX;
  const U = usableParts(req);
  const priceCache = new Map();
  const price = (id) => {
    if (!priceCache.has(id)) priceCache.set(id, refPrice(id, req.region, U.vendors, fx));
    return priceCache.get(id);
  };
  const refCost = (items) => items.reduce((s, i) => s + i.qty * price(i.id), 0);

  const candidates = enumerate(req, U);
  const feasibleOnes = candidates.filter((d) => d.ok);
  for (const d of candidates) d.refCost = refCost(d.items);
  feasibleOnes.forEach((d, i) => { d.idx = i; });
  const ctx = { req, fx, U, candidates, feasibleOnes };

  if (!feasibleOnes.length) {
    return { ctx, result: { req, ok: false, reason: 'requirements', explain: explain(req, U, candidates), count: candidates.length } };
  }

  // The cost–headroom frontier: walking up in estimated cost, every design with more headroom than all cheaper ones.
  // Headroom is the margin on a design's tightest check, so a point on the frontier is the cheapest way to that margin.
  const byRef = [...feasibleOnes].sort((a, b) => a.refCost - b.refCost || b.robust - a.robust);
  const frontier = [];
  for (const d of byRef) if (!frontier.length || d.robust > frontier.at(-1).robust + 1e-9) frontier.push(d);

  // price the best few exactly: the cheapest by estimate, the most robust, and the frontier
  const byRobust = [...feasibleOnes].sort((a, b) => b.robust - a.robust || a.refCost - b.refCost);
  const pool = [...new Set([...byRef.slice(0, 30), ...byRobust.slice(0, 15), ...frontier.slice(-40)])];
  for (const d of pool) priceDesign(ctx, d);
  const priced = pool.filter((d) => d.price.ok);
  const inBudget = priced.filter((d) => req.budget == null || d.price.total <= req.budget);
  if (!inBudget.length) {
    const cheapestTotal = Math.min(...priced.map((d) => d.price.total));
    return { ctx, result: { req, ok: false, reason: 'budget', cheapest: cheapestTotal, currency: priced[0]?.price.currency,
      count: candidates.length, feasibleCount: feasibleOnes.length } };
  }

  const proposals = [];
  const add = (kind, d, price = d?.price) => {
    if (!d) return;
    const existing = proposals.find((p) => p.design.key === d.key && p.price === price);
    if (existing) { existing.kinds.push(kind); return; }
    proposals.push({ kind, kinds: [kind], design: d, price, idx: d.idx });
  };
  const cheapestD = [...inBudget].sort((a, b) => a.price.total - b.price.total)[0];
  add('cheapest', cheapestD);
  // most headroom: the frontier design with the largest margin that costs at most twice the lowest (or fits the
  // budget). It must add real margin, or it would be the lowest-cost design again under another name.
  const cap = req.budget ?? cheapestD.price.total * 2;
  const robustD = frontier.filter((d) => d.price?.ok && d.price.total <= cap && d.robust > cheapestD.robust + 0.02)
    .sort((a, b) => b.robust - a.robust || a.price.total - b.price.total)[0];
  add('robust', robustD);
  if (req.shopping === 'cheapest') {
    const fastD = inBudget.filter((d) => d.fastPrice && (req.budget == null || d.fastPrice.total <= req.budget))
      .sort((a, b) => a.fastPrice.days - b.fastPrice.days || a.fastPrice.total - b.fastPrice.total)[0];
    if (fastD && fastD.fastPrice.days < cheapestD.price.days) add('fast', fastD, fastD.fastPrice);
  }
  for (const p of proposals) p.design.specs ??= specs(p.design, req);

  // the chart: every feasible design (a sample when there are very many) with the frontier marked
  const onFront = new Set(frontier);
  const stride = Math.max(1, Math.ceil(feasibleOnes.length / 700));
  const shown = feasibleOnes.filter((d, i) => i % stride === 0 || onFront.has(d));
  const chart = { points: shown.map((d) => ({ x: d.refCost, y: d.robust, i: d.idx, f: onFront.has(d) ? 1 : 0 })),
    sampled: stride > 1, currency: cheapestD.price.currency };

  return { ctx, result: { req, ok: true, proposals, chart, robustSame: !robustD, count: candidates.length,
    feasibleCount: feasibleOnes.length } };
}

export const solve = (reqIn) => solveSession(reqIn).result;

function priceDesign(ctx, d) {
  if (d.price) return d.price;
  const { req, fx } = ctx;
  d.price = priceOrder(d.items, req.region, { fx, shopping: req.shopping });
  if (req.shopping === 'cheapest') {
    const fast = priceOrder(d.items, req.region, { fx, shopping: 'fast' });
    d.fastPrice = fast.ok ? fast : null;
  }
  return d.price;
}

// Any feasible design as a proposal of its own (a point picked on the chart, or a swapped part).
export function pickDesign(ctx, idx) {
  const d = ctx.feasibleOnes[idx];
  if (!d) return null;
  priceDesign(ctx, d);
  if (!d.price.ok) return null;
  d.specs ??= specs(d, ctx.req);
  return { kind: 'pick', kinds: ['pick'], design: d, price: d.price, idx };
}

// The other parts that could fill one slot of a design, everything else unchanged: what each would cost, and for
// those that fail, which check stops them.
export function swapOptions(ctx, idx, slot) {
  const base = ctx.feasibleOnes[idx];
  if (!base) return [];
  const keys = Object.keys(base.slots);
  const seen = new Set();
  const out = [];
  for (const c of ctx.candidates) {
    const v = c.slots?.[slot];
    if (v == null || v === base.slots[slot] || seen.has(v)) continue;
    if (!keys.every((k) => k === slot || c.slots[k] === base.slots[k])) continue;
    seen.add(v);
    const alt = { value: v, name: slotName(slot, v), ok: c.ok };
    if (c.ok) {
      const pr = priceDesign(ctx, c);
      Object.assign(alt, { idx: c.idx, total: pr.ok ? pr.total : null, days: pr.ok ? pr.days : null, robust: c.robust });
    } else {
      alt.fails = c.checks.filter((x) => !x.ok && x.severity === 'fail').sort((a, b) => a.margin - b.margin)
        .slice(0, 2).map((x) => x.label);
    }
    out.push(alt);
  }
  priceDesign(ctx, base);
  return out.sort((a, b) => (b.ok - a.ok) || ((a.total ?? Infinity) - (b.total ?? Infinity)) || a.name.localeCompare(b.name))
    .map((a) => ({ ...a, delta: a.total != null && base.price.ok ? a.total - base.price.total : null }));
}

function slotName(slot, v) {
  if (slot === 'power') {
    const [psu, reg] = v.split('+');
    return reg ? `${part(psu).name} + ${part(reg).name}` : part(psu).name;
  }
  return part(v).name;
}

const enumerate = (req, U) => [...designs(req, U)];

const withDefaults = (reqIn) => ({ ...DEFAULT_REQ, ...reqIn, rover: { ...DEFAULT_REQ.rover, ...reqIn.rover },
  arm: { ...DEFAULT_REQ.arm, ...reqIn.arm } });

// Every feasible design for a request, with its specs (used by the firmware build matrix and the tests).
export function feasibleDesigns(reqIn) {
  const req = withDefaults(reqIn);
  const out = [];
  for (const d of designs(req, usableParts(req))) {
    if (!d.ok) continue;
    d.specs = specs(d, req);
    out.push(d);
  }
  return { req, designs: out };
}

function* designs(req, U) {
  if (req.type === 'rover') {
    for (const c of roverCombos(U, req)) yield roverDesign(c, req, null, null);
  } else if (req.type === 'arm') {
    const arms = armCandidates(req, U, (id) => refPrice(id, req.region, U.vendors, req.fx ?? FX));
    const powers = stationaryArmPower(U);
    const mcus = U.mcus.filter((m) => !req.arm.wireless || m.wifi || U.has('hc05'));
    for (const a of arms) for (const pw of powers) for (const mcu of mcus) {
      const built = buildArmDesign(a, pw, mcu, req);
      const items = commonBom(req, built.items, mcu);
      const key = items.map((i) => `${i.id}×${i.qty}`).sort().join(',');
      const slots = { frame: a.frame.id, mcu: mcu.id, power: `${pw.psu.id}+${pw.reg?.id ?? ''}`.replace(/\+$/, '') };
      for (const [j, sv] of Object.entries(a.servos)) slots[j] = sv.id;
      yield { key, slots, type: 'arm', arm: a, power: pw, parts: { mcu, frame: a.frame, servos: a.servos, psu: pw.psu, servoReg: pw.reg },
        checks: built.checks, ok: feasible(built.checks), robust: robustness(built.checks), items, pins: built.pins,
        pinDemands: built.pins.demands,
        bt: built.bt, wireless: built.wireless, board: mcu.board };
    }
  } else {
    // mobile manipulator: the arm sub-designs that pass on their own, cheapest and strongest few, on every rover
    const priceFn = (id) => refPrice(id, req.region, U.vendors, req.fx ?? FX);
    const arms = armCandidates(req, U, priceFn).filter((a) => feasible(a.checks));
    const armCost = (a) => armBom(a).reduce((s, i) => s + i.qty * priceFn(i.id), 0);
    const pick = [...new Set([
      ...[...arms].sort((a, b) => armCost(a) - armCost(b)).slice(0, 2),
      ...[...arms].sort((a, b) => robustness(b.checks) - robustness(a.checks)).slice(0, 1),
    ])];
    if (!pick.length) {
      // keep the arm failures visible in the explanation
      for (const a of armCandidates(req, U, priceFn).slice(0, 50)) {
        yield { key: `arm:${a.frame.id}`, slots: {}, type: 'mobile', checks: a.checks, ok: false, robust: -1, items: [] };
      }
      return;
    }
    for (const a of pick) for (const servoReg of U.servoRegs) for (const c of roverCombos(U, req)) {
      yield roverDesign(c, req, a, servoReg);
    }
  }
}

function roverDesign(c, req, arm, servoReg) {
  const ev = evalRover(c, req, arm, servoReg);
  const checks = arm ? [...arm.checks.filter((x) => x.id !== 'arm-base'), ...ev.checks] : ev.checks;
  const ok = feasible(checks);
  // only feasible designs are costed and shown, so only they need a parts list
  let items = [];
  if (ok) {
    items = roverBom(c, ev, req);
    if (arm) items = [...items, ...armBom(arm), { id: servoReg.id, qty: 1, role: t('6 V servo regulator') }];
    items = commonBom(req, items, c.mcu);
  }
  const key = items.map((i) => `${i.id}×${i.qty}`).sort().join(',');
  const slots = { chassis: c.chassis.id, motor: c.motor.id, wheel: c.wheel.id, driver: c.driver.id, battery: c.battery.id,
    reg: c.reg.id, mcu: c.mcu.id };
  if (arm) Object.assign(slots, { servoReg: servoReg.id, arm: [arm.frame.id, ...Object.values(arm.servos).map((x) => x.id)].join('/') });
  return {
    key, slots, type: arm ? 'mobile' : 'rover', combo: c, arm, ev, items, checks,
    parts: { ...c, servoReg, frame: arm?.frame, servos: arm?.servos },
    ok, robust: robustness(checks), pins: ev.pins, pinDemands: ev.pins.demands, bt: ev.bt, wireless: ev.wireless,
    board: c.mcu.board,
  };
}

// ---------------------------------------------------------------- specs and explanations

function specs(d, req) {
  const s = {};
  if (d.type !== 'arm') {
    const { ev, combo } = d;
    s.mass = ev.mass;
    s.topSpeed = ev.perf.flat.speed;
    s.maxSlope = roverMaxSlope(combo, req, d.arm, d.parts.servoReg);
    s.runtime = ev.hours * 60;
    s.loadHeadroom = combo.chassis.maxLoad - (ev.mass - combo.chassis.mass);
    s.peakCurrent = ev.peakBatt;
    s.fuse = ev.perf.fuse;
    s.pwmLimit = ev.perf.capDuty;
  }
  if (d.arm) {
    s.reach = d.arm.reach;
    s.axes = d.arm.frame.joints.length;
    s.armPayload = armMaxPayload(d.arm.frame, d.arm.servos, req.arm, 6);
    s.servoPeak = d.arm.peak;
  }
  return s;
}

// What blocks the closest candidates, and how far each requirement would have to move.
function explain(req, U, candidates) {
  const counts = {};
  for (const d of candidates) for (const c of d.checks) if (!c.ok && c.severity === 'fail') counts[c.label] = (counts[c.label] ?? 0) + 1;
  const blockers = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, n]) => ({ label, share: n / Math.max(1, candidates.length) }));
  const nearest = [...candidates].sort((a, b) => violation(a.checks) - violation(b.checks))[0];
  const nearestFails = nearest ? nearest.checks.filter((c) => !c.ok && c.severity === 'fail') : [];

  const relax = [];
  const anyFeasible = (r) => {
    for (const d of designs(r, U)) if (d.ok) return true;
    return false;
  };
  const search = (path, label, unit, hi, scale = 1) => {
    const get = (r) => path.reduce((o, k) => o[k], r);
    const set = (r, v) => {
      const copy = structuredClone(r);
      path.slice(0, -1).reduce((o, k) => o[k], copy)[path.at(-1)] = v;
      return copy;
    };
    const cur = get(req);
    if (anyFeasible(set(req, hi === 'down' ? 0 : cur))) {
      if (hi === 'down') {
        let lo = 0;
        let up = cur;
        for (let i = 0; i < 8; i++) { const mid = (lo + up) / 2; if (anyFeasible(set(req, mid))) lo = mid; else up = mid; }
        const d = scale === 1 ? 2 : 0;
        relax.push({ label, text: t('{what} up to {value} {unit} (you asked for {asked})',
          { what: t(label), value: num(lo * scale, d), unit, asked: num(cur * scale, d) }) });
      }
    }
  };
  if (req.type !== 'arm') {
    search(['rover', 'payload'], 'Payload', 'kg', 'down');
    search(['rover', 'speed'], 'Top speed', 'm/s', 'down');
    search(['rover', 'slope'], 'Slope', '°', 'down');
    search(['rover', 'runtime'], 'Runtime', 'min', 'down');
  }
  if (req.type !== 'rover') {
    search(['arm', 'payload'], 'Arm payload', 'g', 'down', 1000);
    search(['arm', 'reach'], 'Arm reach', 'mm', 'down', 1000);
  }
  const hints = [];
  if (req.solder === 'no') hints.push(t('Allowing soldering opens up the breakout boards (TB6612, DRV8833, PCA9685, MPU-6050).'));
  if (req.shopping !== 'cheapest') hints.push(t('Allowing all vendors (including AliExpress and Pololu) widens the parts range.'));
  if (req.controller !== 'auto') hints.push(t('Letting the app choose the controller can free pins.'));
  if (!req.printer && req.type !== 'rover') hints.push(t('A 3D printer unlocks the printed 5-axis arm (longer reach, 0.5 kg rated).'));
  return { blockers, nearest: nearestFails, relax, hints };
}
