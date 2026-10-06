// Gearmotor library: datasheet numbers in, output-side model parameters out.
//
// Every entry states where its numbers come from. Published values are quoted as published;
// anything the manufacturer doesn't publish (rotor inertia, gear lash, external-gear efficiency)
// is marked as an estimate, so nobody mistakes it for a measurement.
//
// A gearmotor is described at its own output shaft, at its rated voltage vNom:
//   free-run speed (rpm) and current (A), stall torque (N*m) and stall current (A),
//   gear ratio, encoder counts per motor revolution, rotor inertia at the motor shaft.
// An optional external reduction (e.g. the Balboa 32U4's 2-gear gearboxes) multiplies torque and
// divides speed, with an efficiency.

const KGCM = 0.0980665; // N*m per kg*cm
const RPM = (2 * Math.PI) / 60;

export const MOTORS = {
  generic: {
    label: 'Generic 25 mm gearmotor, 34:1 (hobby class)',
    source: 'Representative of 25 mm brushed gearmotors on 2S LiPo; round numbers, not a specific product.',
    vNom: 7.4, freeRpm: 400, freeCurrent: 0.2, stallTorque: 0.45, stallCurrent: 3.0,
    gearRatio: 34, encoderCpr: 48, rotorInertiaMotor: 4.8e-7, backlashDeg: 1.5,
    estimated: ['all values (class-typical)'],
  },
  pololu30: {
    label: 'Pololu 30:1 Micro Metal Gearmotor HPCB 6V',
    source: 'pololu.com/category/60 (free-run 1100 rpm, extrapolated stall 0.45 kg·cm and 1.5 A at 6 V).',
    vNom: 6, freeRpm: 1100, freeCurrent: 0.15, stallTorque: 0.45 * KGCM, stallCurrent: 1.5,
    gearRatio: 30, encoderCpr: 12, rotorInertiaMotor: 1.5e-8, backlashDeg: 2,
    estimated: ['free-run current (taken from the 50:1)', 'exact gear ratio (nominal 30:1 used)', 'rotor inertia', 'gear lash'],
  },
  pololu50: {
    label: 'Pololu 50:1 Micro Metal Gearmotor HPCB 6V',
    source: 'pololu.com/product/3073 (51.45:1; free-run 650 rpm, 150 mA; extrapolated stall 0.74 kg·cm, 1.5 A at 6 V).',
    vNom: 6, freeRpm: 650, freeCurrent: 0.15, stallTorque: 0.74 * KGCM, stallCurrent: 1.5,
    gearRatio: 51.45, encoderCpr: 12, rotorInertiaMotor: 1.5e-8, backlashDeg: 2,
    estimated: ['rotor inertia', 'gear lash'],
  },
  pololu75: {
    label: 'Pololu 75:1 Micro Metal Gearmotor HPCB 6V',
    source: 'pololu.com/category/60 (free-run 430 rpm, extrapolated stall 1.1 kg·cm and 1.5 A at 6 V).',
    vNom: 6, freeRpm: 430, freeCurrent: 0.15, stallTorque: 1.1 * KGCM, stallCurrent: 1.5,
    gearRatio: 75, encoderCpr: 12, rotorInertiaMotor: 1.5e-8, backlashDeg: 2,
    estimated: ['free-run current (taken from the 50:1)', 'exact gear ratio (nominal 75:1 used)', 'rotor inertia', 'gear lash'],
  },
};

/** The Balboa 32U4's external gearbox options (Pololu Balboa user's guide: 1.64:1 to 2.88:1). */
export const BALBOA_EXTERNAL = { ratio: 2.88, efficiency: 0.95 /* estimate: one spur-gear pair */ };

/**
 * Output-side parameters for dynamics.mjs. `external` adds a further reduction after the gearmotor.
 * battery: the pack the firmware was written for (nominal) and its present voltage.
 */
export function motorParams(spec, { external = null, batteryNominal = spec.vNom, batteryVoltage = batteryNominal } = {}) {
  const r = external ? external.ratio : 1;
  const eff = external ? external.efficiency : 1;
  const totalRatio = spec.gearRatio * r;
  return {
    motorKey: Object.keys(MOTORS).find((k) => MOTORS[k] === spec) || 'custom',
    vNom: spec.vNom,
    stallTorque: spec.stallTorque * r * eff, // N*m at the wheel, at vNom
    stallCurrent: spec.stallCurrent,
    freeSpeed: (spec.freeRpm * RPM) / r, // rad/s at the wheel, at vNom
    freeCurrent: spec.freeCurrent,
    rotorInertia: spec.rotorInertiaMotor * totalRatio * totalRatio, // kg*m^2 seen at the wheel
    backlash: (spec.backlashDeg * Math.PI) / 180, // rad at the wheel
    meshHz: 150, // gear-mesh stiffness expressed as a natural frequency (stiff, well damped)
    currentLimit: 0, // A, driver limit (0 = none)
    encoderCpr: Math.round(spec.encoderCpr * totalRatio), // counts per wheel revolution
    batteryNominal,
    batteryVoltage,
    externalRatio: r,
  };
}

/** Wheel free speed (rad/s) at a battery voltage -- the robot's top speed is this times the wheel radius. */
export function freeSpeedAt(motor, Vb) {
  return (motor.freeSpeed * Vb) / motor.vNom;
}

/** Torque the firmware gets per unit PWM duty, as it assumes it (stall torque at the pack's nominal voltage). */
export function torquePerDuty(motor) {
  return (motor.stallTorque * motor.batteryNominal) / motor.vNom;
}
