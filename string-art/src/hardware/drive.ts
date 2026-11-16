// The machine's drive, worked out from the parameters: belt geometry, controller steps, motor speeds and step rates,
// and whether the turntable motor has the torque to turn a loaded board at the planned acceleration.

import P from "./params.json";
import { DEFAULT_MACHINE, xSpeedLimit, type MachineConfig } from "../machine/config";

export type Params = typeof P;
export const PARAMS: Params = P;

/** Pitch diameter of a toothed pulley, mm. */
export const pitchDiameter = (teeth: number, pitch: number) => (teeth * pitch) / Math.PI;

/** Length of a closed belt round two pulleys of pitch diameters D and d with centre distance C (mm). */
export function beltLength(C: number, D: number, d: number): number {
  return 2 * C + (Math.PI * (D + d)) / 2 + ((D - d) ** 2) / (4 * C);
}

/** The centre distance that makes a closed belt of length L fit pulleys D and d (bisection; length grows with C). */
export function centreDistance(L: number, D: number, d: number): number {
  let lo = (D + d) / 2, hi = L / 2;
  if (beltLength(lo, D, d) > L) return NaN;          // the belt is too short to go round both pulleys
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (beltLength(mid, D, d) < L) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Teeth of the small pulley in mesh with the belt (wrap angle × teeth / 360°). */
export function teethInMesh(C: number, D: number, d: number, teeth: number): number {
  const wrap = Math.PI - 2 * Math.asin((D - d) / (2 * C));
  return (wrap / (2 * Math.PI)) * teeth;
}

export interface Drive {
  ratio: number;
  bigPD: number; smallPD: number;
  centre: number;            // motor axis to turntable axis, mm
  meshTeeth: number;         // teeth of the motor pulley engaged (6 or more is the usual minimum)
  xSteps: number; ySteps: number; zSteps: number;
  xRpm: number; yRpm: number; zRpm: number;   // motor speeds at the machine's top speeds
  xRate: number; yRate: number; zRate: number; // step pulses per second at those speeds
  massKg: number;            // platter + board
  inertia: number;           // kg·m² about the turntable axis
  torqueNeeded: number;      // N·m at the motor shaft for the planned acceleration, with friction
  torqueAvail: number;       // N·m the motor gives at working speed
  safety: number;
  resolutionMm: number;      // how far a nail moves for one microstep, mm
}

const discMass = (dMm: number, tMm: number, rho: number) => Math.PI * (dMm / 2000) ** 2 * (tMm / 1000) * rho;

/** Friction torque of the bearing and belt, referred to the motor shaft: a measured-order-of-magnitude allowance. */
export const FRICTION_NM = 0.02;

export function drive(p: Params = PARAMS, m: MachineConfig = DEFAULT_MACHINE): Drive {
  const d = p.drive, steps = d.motorStepsPerRev * d.microsteps;
  const ratio = d.turntableTeeth / d.motorTeeth;
  const bigPD = pitchDiameter(d.turntableTeeth, d.beltPitch), smallPD = pitchDiameter(d.motorTeeth, d.beltPitch);
  const centre = centreDistance(d.beltLength, bigPD, smallPD);
  const xSteps = (steps * ratio) / 360;
  const ySteps = steps / (p.tower.yTeeth * d.beltPitch);
  const zSteps = steps / p.tower.zLead;
  const vx = xSpeedLimit(m);
  const xRpm = (vx * ratio * 60) / 360;
  const yRpm = (m.ySpeed / (p.tower.yTeeth * d.beltPitch)) * 60;
  const zRpm = (m.zSpeed / p.tower.zLead) * 60;
  const rho = p.materials.plywoodDensity;
  const mPlatter = discMass(p.platter.diameter, p.platter.thickness, rho), mBoard = discMass(p.board.diameter, p.board.thickness, rho);
  const inertia = 0.5 * mPlatter * (p.platter.diameter / 2000) ** 2 + 0.5 * mBoard * (p.board.diameter / 2000) ** 2;
  const alpha = m.xAccel * (Math.PI / 180);
  const torqueNeeded = (inertia * alpha) / ratio + FRICTION_NM;
  return {
    ratio, bigPD, smallPD, centre, meshTeeth: teethInMesh(centre, bigPD, smallPD, d.motorTeeth),
    xSteps, ySteps, zSteps, xRpm, yRpm, zRpm,
    xRate: vx * xSteps, yRate: m.ySpeed * ySteps, zRate: m.zSpeed * zSteps,
    massKg: mPlatter + mBoard, inertia, torqueNeeded, torqueAvail: p.motor.torqueAtSpeed,
    safety: p.motor.torqueAtSpeed / torqueNeeded,
    resolutionMm: (Math.PI * p.board.nailCircle) / (360 * xSteps)
  };
}

/** GRBL's step pulse limit on an Arduino Uno (about 30 kHz); stay well under it. */
export const GRBL_MAX_RATE = 30000;

/**
 * The GRBL settings for a machine configuration, as `$n=value` with an English comment each (the build page shows them
 * translated). The steps come from the configuration, which the tests check against the drive above.
 */
export function grblSettings(m: MachineConfig = DEFAULT_MACHINE): [string, string][] {
  const f = (v: number) => String(Math.round(v * 1000) / 1000);
  return [
    ["$0=10", "step pulse, µs"],
    ["$1=255", "keep the motors powered when idle, so the board cannot drift"],
    ["$5=0", "limit switches: normally open"],
    ["$10=2", "status shows the work position and buffer use"],
    ["$20=0", "no soft limits: the board turns many times"],
    ["$21=0", "no hard limits"],
    ["$22=1", "homing on"],
    ["$23=1", "home X towards −, Y towards +, Z towards +"],
    ["$24=50", "homing feed, °/min or mm/min"],
    ["$25=1500", "homing seek, °/min or mm/min"],
    ["$27=2", "pull-off after homing, mm"],
    [`$100=${f(m.xSteps)}`, "X steps per degree of board turn"],
    [`$101=${f(m.ySteps)}`, "Y steps per mm"],
    [`$102=${f(m.zSteps)}`, "Z steps per mm"],
    [`$110=${Math.round(xSpeedLimit(m) * 60)}`, "X top speed, °/min"],
    [`$111=${Math.round(m.ySpeed * 60)}`, "Y top speed, mm/min"],
    [`$112=${Math.round(m.zSpeed * 60)}`, "Z top speed, mm/min"],
    [`$120=${m.xAccel}`, "X acceleration, °/s²"],
    [`$121=${m.yAccel}`, "Y acceleration, mm/s²"],
    [`$122=${m.zAccel}`, "Z acceleration, mm/s²"]
  ];
}
