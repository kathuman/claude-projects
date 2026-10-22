// From requirements to designs: enumerate every compatible combination of catalog parts, run the engineering checks
// on each, rank the feasible ones by estimated cost and by margin, price the best exactly, and return up to three
// proposals: the lowest cost, the most robust, and the quickest to arrive. When nothing is feasible, say which checks
// stopped the closest candidates and how far each requirement must move for a design to exist.

import { catalog, part, FX } from './catalog.js';
import * as P from './physics.js';
import { BOARDS, assignPins } from './pins.js';
import { allowedVendors, refPrice, priceOrder } from './pricing.js';

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
      const dev = `${driver.name} (${s === 'L' ? 'left' : 'right'})`;
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
      const dev = `${s === 'L' ? 'Left' : 'Right'} motor encoder`;
      add(`${s}_ENCA`, 'int', dev, 'A');
      add(`${s}_ENCB`, 'in', dev, 'B');
    }
  }
  if (sensors.includes('hcsr04')) {
    add('SONAR_TRIG', 'out', 'HC-SR04', 'TRIG');
    add('SONAR_ECHO', 'in', 'HC-SR04', 'ECHO');
  }
  if (sensors.includes('line-5ch')) for (let i = 1; i <= 5; i++) add(`LINE${i}`, 'in', 'Line sensor', `OUT${i}`);
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
  checks.push(le('arm-reach', 'Required reach within 90 % of the arm\'s full stretch', arm.reach, 0.9 * reach, 'm',
    { detail: `full stretch ${(reach * 1000).toFixed(0)} mm; the last 10 % is a singular, imprecise pose` }));
  checks.push(ge('arm-axes', 'Axes (not counting the gripper)', frame.joints.length, arm.axes, '', { key: false }));
  checks.push(le('arm-structure', 'Payload within the frame\'s rated load', arm.payload, frame.maxPayload, 'kg'));
  const torques = P.jointTorques(frame, servos, arm.payload, Math.max(arm.reach, 0.5 * reach));
  const hold = {};
  for (const j of ['shoulder', 'elbow', 'wrist']) {
    if (!(j in torques)) continue;
    const s = servos[j];
    const ts = P.servoTorque(s, Vs);
    checks.push(le(`arm-${j}`, `${j[0].toUpperCase() + j.slice(1)} holding torque ≤ 50 % of the ${s.name.split(' ')[0]} stall torque`,
      torques[j], 0.5 * ts, 'N·m', { detail: j === 'shoulder' ? 'payload held horizontally at the required reach (worst case)'
        : 'link horizontal with the payload (worst case)' }));
    hold[j] = s.idleCurrent + s.stallCurrent * Math.min(1, torques[j] / ts);
  }
  const gt = P.gripTorque(arm.payload, frame.finger);
  checks.push(le('arm-grip', 'Gripper torque to hold the payload by friction (μ 0.5, ×2) ≤ 50 % of stall', gt,
    0.5 * P.servoTorque(servos.gripper, Vs), 'N·m'));
  hold.gripper = servos.gripper.idleCurrent + servos.gripper.stallCurrent * Math.min(1, gt / P.servoTorque(servos.gripper, Vs));
  hold.base = servos.base.idleCurrent;
  if (servos.roll) hold.roll = servos.roll.idleCurrent;
  checks.push(info('arm-base', 'Base yaw carries no gravity load', 'the frame\'s base bearing takes the weight'));
  const all = Object.values(servos);
  for (const s of new Set(all)) {
    checks.push(le(`arm-v-${s.id}`, `Servo supply within the ${s.name.split(' ')[0]} rating`, Vs, s.vMax, 'V', { key: false }));
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
  const items = [{ id: a.frame.id, qty: 1, role: 'Arm frame' }];
  const count = {};
  for (const [joint, s] of Object.entries(a.servos)) (count[s.id] ??= []).push(joint);
  for (const [id, joints] of Object.entries(count)) items.push({ id, qty: joints.length, role: `Servo: ${joints.join(', ')}` });
  items.push({ id: 'pca9685', qty: 1, role: 'Servo driver (I²C)' });
  if (a.frame.joints.length >= 4) items.push({ id: 'servo-ext', qty: 1, role: 'Servo cable extensions' });
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

  checks.push(le('load', 'Carried load within the chassis rating', carried, chassis.maxLoad, 'kg',
    { detail: `payload ${R.payload} kg + battery, motors, wheels, electronics${arm ? ', arm' : ''}` }));
  if (terr.outdoor) {
    checks.push(flag('terrain-chassis', 'Chassis built for outdoor use', chassis.terrain === 'outdoor'));
    checks.push(flag('terrain-wheel', 'Wheels with outdoor tread', wheel.terrain === 'outdoor'));
  }
  if (terr.minWheel) checks.push(ge('terrain-diameter', `Wheel diameter for ${terr.label.toLowerCase()}`, wheel.diameter,
    terr.minWheel, 'm', { key: false }));

  const theta = (R.slope * Math.PI) / 180;
  const sys = { motor, driver, battery, wheel, nMotors: n };
  const Fc = P.tractiveForce(mass, terr.crr, theta);
  const Fp = P.tractiveForce(mass, terr.crr, theta, R.accel);
  const cont = P.driveAt(sys, Fc, battery.vMin);
  const peak = P.driveAt(sys, Fp, battery.vMin);
  const flat = P.driveAt(sys, P.tractiveForce(mass, terr.crr, 0), battery.vNom);
  const drivenShare = n === 4 ? 1 : 0.75;
  checks.push(le('traction', 'Force to climb and accelerate within tyre grip', Fp,
    terr.mu * mass * P.G * Math.cos(theta) * drivenShare, 'N',
    { detail: `grip μ ${terr.mu} on ${(drivenShare * 100).toFixed(0)} % of the weight` }));
  checks.push(le('torque-cont', 'Motor torque on the slope ≤ 30 % of stall (continuous duty)', cont.torque,
    0.3 * cont.stallTorque, 'N·m', { detail: 'at the battery\'s cut-off voltage, the worst case' }));
  checks.push(le('torque-peak', 'Motor torque accelerating up the slope ≤ 60 % of stall', peak.torque,
    0.6 * peak.stallTorque, 'N·m'));
  checks.push(ge('speed', 'Top speed on the flat', flat.speed, R.speed, 'm/s', { detail: 'nominal battery voltage' }));
  checks.push(ge('speed-slope', 'Still moves up the slope on an empty battery', cont.speed, 0.1, 'm/s'));

  const capDuty = P.pwmLimit(motor, driver, battery);
  checks.push(ge('motor-voltage', 'Motor rating vs battery: firmware PWM cap', capDuty, 0.4, '',
    { detail: capDuty < 1 ? `PWM limited to ${(capDuty * 100).toFixed(0)} % so the motor sees ≤ ${motor.vNom} V` :
      'battery never exceeds the motor rating', key: false }));
  checks.push(le('driver-vmax', 'Full battery within the driver\'s voltage range', battery.vMax, driver.vMax, 'V'));
  checks.push(ge('driver-vmin', 'Empty battery above the driver\'s minimum', battery.vMin, driver.vMin, 'V'));
  checks.push(le('driver-cont', 'Motor current per driver channel ≤ continuous rating', cont.current * perChannel,
    driver.iCont, 'A', { detail: perChannel > 1 ? `${perChannel} motors in parallel per channel` : '' }));
  const vStall = capDuty * (battery.vMax - driver.drop0);
  const iStall = motor.stallCurrent * (vStall / motor.vNom) * perChannel;
  checks.push(le('driver-peak', 'Stall current per channel ≤ driver peak rating', iStall, driver.iPeak, 'A',
    { severity: 'warn', key: false, detail: 'the firmware ramps the speed so a start never stalls; a jammed wheel still can' }));
  checks.push(flag('logic-level', `${mcu.logicV} V controller outputs drive the ${driver.name.split(' ')[0]} inputs`,
    driver.logicHigh <= 0.9 * mcu.logicV, `driver needs ≥ ${driver.logicHigh.toFixed(1)} V for a high input`));

  // the controllers run down to a 4.6 V rail (the ESP32's 3.3 V LDO and the AVR at 16 MHz both still work there)
  const regVmin = Math.max(reg.vInMin, 4.6 + reg.dropout);
  checks.push(ge('reg-vin', `Empty battery keeps the ${reg.name.split(' ')[0]} output above 4.6 V`, battery.vMin,
    regVmin, 'V'));
  checks.push(le('reg-vmax', 'Full battery within the 5 V regulator\'s input range', battery.vMax, reg.vInMax, 'V'));
  checks.push(le('reg-current', '5 V rail current ≤ regulator rating', logicCurrent, reg.iCont, 'A'));

  // arm power from the battery
  let armAvgPower = 0;
  let armPeakBatt = 0;
  if (arm) {
    const sv = Math.max(servoReg.vInMin, 6 + servoReg.dropout);
    checks.push(ge('servo-reg-vin', `Empty battery high enough for the ${servoReg.name.split(' ')[0]} to make 6 V`,
      battery.vMin, sv, 'V'));
    checks.push(le('servo-reg-vmax', 'Full battery within the servo regulator\'s input range', battery.vMax,
      servoReg.vInMax, 'V'));
    checks.push(le('servo-reg-current', 'Servo current (all holding + one stalled) ≤ regulator rating', arm.peak,
      servoReg.iCont, 'A'));
    armAvgPower = (6 * arm.holdSum * 0.5) / servoReg.eff;
    armPeakBatt = (6 * arm.peak) / (servoReg.eff * battery.vMin);
    // tipping: arm stretched out sideways with the payload, the worst direction for a narrow chassis
    const parts = P.armMasses(arm.frame, arm.servos, req.arm.payload);
    const moment = parts.reduce((s, p) => s + p.mass * p.x, 0);
    const offset = moment / mass;
    const support = Math.min(chassis.length, chassis.track) / 2;
    checks.push(le('tipping', 'Centre of mass with the arm stretched sideways stays inside ⅔ of the wheel base',
      offset, support / 1.5, 'm', { detail: `support half-width ${(support * 1000).toFixed(0)} mm` }));
  }

  const logicBatt = (5 * logicCurrent) / (0.85 * battery.vMin);
  const peakBatt = n * peak.current + logicBatt + armPeakBatt;
  checks.push(le('battery-current', 'Peak battery current ≤ battery discharge rating', peakBatt, battery.iMax, 'A'));
  const power = P.averagePower(sys, { mass, crr: terr.crr, cruise: 0.7 * flat.speed,
    movingFraction: 0.6, logicCurrent }) + armAvgPower;
  const hours = P.runtimeHours(battery, power);
  checks.push(ge('runtime', 'Runtime (moving 60 % of the time at 70 % of top speed, with starts and turns)', hours * 60,
    R.runtime, 'min'));

  const pins = pinsFor(mcu, { driver, encoders, sensors, bt });
  checks.push(flag('pins', `Enough suitable pins on the ${BOARDS[mcu.board].name}`, pins.ok,
    pins.ok ? `${pins.free} pins left free` : `missing: ${pins.missing.map((m) => `${m.device} ${m.signal} (${m.need})`).join(', ')}`));
  if (R.behaviours.includes('line') && terr.outdoor) {
    checks.push({ ...info('line-outdoor', 'Line following outdoors', 'IR line sensors need an even indoor surface'),
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
    { id: chassis.id, qty: 1, role: 'Chassis' },
    { id: motor.id, qty: n, role: 'Drive motors' },
    { id: wheel.id, qty: n, role: 'Wheels' },
    { id: driver.id, qty: ev.perf.units, role: 'Motor driver' },
    { id: battery.id, qty: 1, role: 'Battery' },
    { id: reg.id, qty: 1, role: '5 V regulator (logic)' },
    { id: mcu.id, qty: 1, role: 'Controller' },
    ...ev.sensors.map((id) => ({ id, qty: 1, role: 'Sensor' })),
  ];
  if (ev.bt) items.push({ id: 'hc05', qty: 1, role: 'Bluetooth link' });
  if (ev.peakBatt > 2) items.push({ id: 'wire-20awg', qty: 1, role: 'Power wiring' });
  if (battery.chem === 'lipo') items.push({ id: 'xt60-pigtail', qty: 1, role: 'Battery lead' });
  return items;
}

function commonBom(req, items, mcu) {
  const out = [...items];
  const needDivider = out.some((i) => i.id === 'hcsr04') && mcu.logicV < 5 || out.some((i) => i.id === 'hc05') && mcu.logicV >= 5;
  if (needDivider) out.push({ id: 'divider-res', qty: 1, role: 'Logic-level dividers' });
  out.push({ id: 'jumpers', qty: 1, role: 'Signal wiring' });
  out.push({ id: 'breadboard-mini', qty: 1, role: 'Power distribution' });
  out.push({ id: 'm3-kit', qty: 1, role: 'Mounting hardware' });
  const batt = out.find((i) => part(i.id).cat === 'battery');
  if (batt) {
    out.push({ id: 'switch-fuse', qty: 1, role: 'Power switch + fuse' });
    if (req.charger) out.push({ id: part(batt.id).charger, qty: 1, role: 'Charger' });
    if (part(batt.id).chem === 'lipo') out.push({ id: 'lipo-bag', qty: 1, role: 'LiPo safety' });
  }
  if (req.tools) {
    out.push({ id: 'tool-multimeter', qty: 1, role: 'Tool' });
    out.push({ id: 'tool-screwdrivers', qty: 1, role: 'Tool' });
  }
  if (req.solder === 'buy' && out.some((i) => part(i.id).solder)) out.push({ id: 'tool-solder', qty: 1, role: 'Tool' });
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
  checks.push(le('servo-supply', 'Servo current (all holding + one stalled) ≤ supply rating', a.peak, power.iCont, 'A'));
  const bt = req.arm.wireless && !mcu.wifi;
  const pins = pinsFor(mcu, { driver: null, encoders: false, sensors: [], bt });
  checks.push(flag('pins', `Enough suitable pins on the ${BOARDS[mcu.board].name}`, pins.ok));
  const items = [...armBom(a), { id: mcu.id, qty: 1, role: 'Controller (USB-powered)' },
    { id: power.psu.id, qty: 1, role: 'Servo power supply' }, { id: 'dc-jack-terminal', qty: 1, role: 'Supply connector' }];
  if (power.reg) items.push({ id: power.reg.id, qty: 1, role: '6 V servo regulator' });
  if (bt) items.push({ id: 'hc05', qty: 1, role: 'Bluetooth link' });
  return { checks, items, pins, bt, wireless: req.arm.wireless };
}

// ---------------------------------------------------------------- main entry

export function solve(reqIn) {
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

  if (!feasibleOnes.length) {
    return { req, ok: false, reason: 'requirements', explain: explain(req, U, candidates), count: candidates.length };
  }

  // price the best few exactly
  const byCost = [...feasibleOnes].sort((a, b) => a.refCost - b.refCost);
  const byRobust = [...feasibleOnes].sort((a, b) => b.robust - a.robust || a.refCost - b.refCost);
  const pool = [...new Set([...byCost.slice(0, 30), ...byRobust.slice(0, 15)])];
  for (const d of pool) {
    d.price = priceOrder(d.items, req.region, { fx, shopping: req.shopping });
    if (req.shopping === 'cheapest') {
      const fast = priceOrder(d.items, req.region, { fx, shopping: 'fast' });
      d.fastPrice = fast.ok ? fast : null;
    }
  }
  const priced = pool.filter((d) => d.price.ok);
  const inBudget = priced.filter((d) => req.budget == null || d.price.total <= req.budget);
  if (!inBudget.length) {
    const cheapestTotal = Math.min(...priced.map((d) => d.price.total));
    return { req, ok: false, reason: 'budget', cheapest: cheapestTotal, currency: priced[0]?.price.currency,
      count: candidates.length, feasibleCount: feasibleOnes.length };
  }

  const proposals = [];
  const add = (kind, title, why, d, price = d.price) => {
    if (!d) return;
    const existing = proposals.find((p) => p.design.key === d.key && p.price === price);
    if (existing) { existing.kinds.push(kind); return; }
    proposals.push({ kind, kinds: [kind], title, why, design: d, price });
  };
  const cheapestD = [...inBudget].sort((a, b) => a.price.total - b.price.total)[0];
  add('cheapest', 'Lowest cost', 'The cheapest design that passes every check.', cheapestD);
  const cap = req.budget ?? cheapestD.price.total * 1.6;
  const robustD = [...inBudget].filter((d) => d.price.total <= cap)
    .sort((a, b) => b.robust - a.robust || a.price.total - b.price.total)[0];
  add('robust', 'Most headroom', 'The largest safety margin on its tightest check'
    + (req.budget == null ? ', for at most 60 % more than the lowest cost.' : ', within your budget.'), robustD);
  if (req.shopping === 'cheapest') {
    const fastD = inBudget.filter((d) => d.fastPrice && (req.budget == null || d.fastPrice.total <= req.budget))
      .sort((a, b) => a.fastPrice.days - b.fastPrice.days || a.fastPrice.total - b.fastPrice.total)[0];
    if (fastD && fastD.fastPrice.days < cheapestD.price.days) {
      add('fast', 'Quickest delivery', `Every part from vendors that deliver within a week (≈ ${fastD.fastPrice.days} days).`,
        fastD, fastD.fastPrice);
    }
  }
  for (const p of proposals) p.design.specs = specs(p.design, req);
  return { req, ok: true, proposals, count: candidates.length, feasibleCount: feasibleOnes.length };
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
      yield { key, type: 'arm', arm: a, power: pw, parts: { mcu, frame: a.frame, servos: a.servos, psu: pw.psu, servoReg: pw.reg },
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
        yield { key: `arm:${a.frame.id}`, type: 'mobile', checks: a.checks, ok: false, robust: -1, items: [] };
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
    if (arm) items = [...items, ...armBom(arm), { id: servoReg.id, qty: 1, role: '6 V servo regulator' }];
    items = commonBom(req, items, c.mcu);
  }
  const key = items.map((i) => `${i.id}×${i.qty}`).sort().join(',');
  return {
    key, type: arm ? 'mobile' : 'rover', combo: c, arm, ev, items, checks,
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
        relax.push({ label, text: `${label} up to ${(lo * scale).toFixed(scale === 1 ? 2 : 0)} ${unit} (you asked for ${(cur * scale).toFixed(scale === 1 ? 2 : 0)})` });
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
  if (req.solder === 'no') hints.push('Allowing soldering opens up the breakout boards (TB6612, DRV8833, PCA9685, MPU-6050).');
  if (req.shopping !== 'cheapest') hints.push('Allowing all vendors (including AliExpress and Pololu) widens the parts range.');
  if (req.controller !== 'auto') hints.push('Letting the app choose the controller can free pins.');
  if (!req.printer && req.type !== 'rover') hints.push('A 3D printer unlocks the printed 5-axis arm (longer reach, 0.5 kg rated).');
  return { blockers, nearest: nearestFails, relax, hints };
}
