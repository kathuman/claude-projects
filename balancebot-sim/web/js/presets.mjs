// Named configurations -- each is a config this robot could plausibly be built as, not just a
// slider demo. Gains are re-verified per preset by tests/presets.test.mjs (a lighter/taller/smaller
// robot genuinely needs different gains, the same way a real one would), and every preset carries
// the scripted push it is shown with, so the "watch it fail" ones visibly fail and the rest
// visibly recover.

import { deriveFromGeometry, mergeParams, DEFAULT_GEOMETRY, DEFAULT_MATERIAL } from './params.mjs';
import { defaultGains, defaultRealism } from './controller.mjs';
import { MOTORS, BALBOA_EXTERNAL, motorParams } from './motors.mjs';

export const PRESETS = {
  default: {
    label: 'Default',
    description: 'A small hobby-scale balancing robot on 25 mm gearmotors and a 2S LiPo.',
    expect: 'recovers',
  },
  balboa: {
    label: 'Balboa-class (Pololu parts)',
    description:
      'Built on published Pololu parts: 50:1 HPCB micro gearmotors through the Balboa 32U4\'s 2.88:1 external gears, 80 mm wheels, 12 CPR motor encoders (1778 counts per wheel turn), a 7.2 V pack and a 100 Hz loop. The body\'s size and mass are estimates (Pololu doesn\'t publish them).',
    geometry: { wheelRadius: 0.04, wheelWidth: 0.01, trackWidth: 0.11, bodyWidth: 0.09, bodyDepth: 0.045, bodyHeight: 0.13, comHeight: 0.06 },
    material: { bodyDensity: 650, wheelDensity: 1100 },
    motorSpec: 'pololu50', external: true, battery: { nominal: 7.2, voltage: 7.2 },
    gains: { angleKp: 3, angleKd: 0.1, angleKi: 15, velocityKp: 0.3, velocityKi: 0.15 },
    realism: { controlLoopHz: 100 },
    expect: 'recovers',
  },
  nimble: {
    label: 'Nimble & light',
    description: 'Small, light, quick to respond -- needs much gentler gains than a heavier build.',
    geometry: { wheelRadius: 0.03, trackWidth: 0.12, bodyHeight: 0.14, comHeight: 0.09 },
    material: { bodyDensity: 350 },
    gains: { angleKp: 4, angleKd: 0.3 },
    expect: 'recovers',
  },
  heavy: {
    label: 'Heavy & sluggish',
    description: 'Bigger wheels, denser body, stronger motors -- more inertia to fight, but also more forgiving.',
    geometry: { wheelRadius: 0.055, trackWidth: 0.2, bodyHeight: 0.3, comHeight: 0.2 },
    material: { bodyDensity: 1400 },
    motorOverride: { stallTorque: 0.9, stallCurrent: 4 },
    motor: { maxTorque: 0.6 },
    expect: 'recovers',
  },
  tippy: {
    label: 'Tall & tippy',
    description: 'A high center of mass falls faster and needs a stiffer, better-damped inner loop.',
    geometry: { wheelRadius: 0.035, trackWidth: 0.14, bodyHeight: 0.4, comHeight: 0.32 },
    gains: { angleKp: 10, angleKd: 3, angleKi: 0, velocityKp: 0.3, velocityKi: 0.15 },
    expect: 'recovers',
  },
  tinywheels: {
    label: 'Tiny wheels',
    description: 'Same body, much smaller wheels -- less ground clearance, less top speed.',
    geometry: { wheelRadius: 0.02 },
    gains: { angleKp: 8, angleKd: 1.2, angleKi: 20, velocityKp: 0.3, velocityKi: 0.15 },
    expect: 'recovers',
  },
  flatbattery: {
    label: 'Flat battery',
    description: 'Default robot, its 7.4 V pack sagged to 6.2 V: every duty cycle now gives less torque than the firmware assumes, and the top speed drops.',
    battery: { nominal: 7.4, voltage: 6.2 },
    nudge: 2.2,
    expect: 'recovers',
  },
  sloppygears: {
    label: 'Sloppy gears',
    description: 'Default robot with 8° of gearbox play: every reversal is a moment with no torque at all, so it never quite settles -- the chatter of a worn gearbox.',
    motorOverride: { backlashDeg: 8 },
    expect: 'chatters',
  },
  ice: {
    label: 'On ice',
    description: 'Default robot on a slippery floor (friction 0.05): the push makes the wheels spin against the floor. It stays up on the reaction of its motors’ spinning rotors (geared, they act like a small reaction wheel) but slides instead of rolling.',
    environment: { groundFriction: 0.05 },
    nudge: 2.0,
    expect: 'slips',
  },
  noisy: {
    label: 'Noisy sensor',
    description: 'Default hardware, a cheap/vibrating IMU read two ticks late: visible jitter and motors buzzing at their limit about half the time -- still (barely) upright.',
    realism: { sensorNoiseStdTheta: 0.003, sensorNoiseStdRate: 0.1, sensorDelaySteps: 2 },
    expect: 'jitters',
  },
  slowbrain: {
    label: 'Slow control loop',
    description: 'Default hardware, a control loop too slow to keep up (25 Hz) -- watch the push knock it over.',
    realism: { controlLoopHz: 25 },
    nudge: 1.5,
    expect: 'falls',
  },
  ideal: {
    label: 'Ideal motors (v1.0 model)',
    description: 'The default robot with perfect torque sources: no back-EMF, no top speed, no gear play -- compare with Default to see what real motors change.',
    motorModel: 'ideal',
    expect: 'recovers',
  },
};

/** Pitch-rate kick (rad/s) applied one second after a preset loads, so it shows what it is for. */
export const DEFAULT_NUDGE = 1.2;

/** Everything a preset sets: robot parameters, controller gains, realism, and its scripted push. */
export function buildPreset(key) {
  const p = PRESETS[key] || PRESETS.default;
  const geometry = { ...DEFAULT_GEOMETRY, ...(p.geometry || {}) };
  const material = { ...DEFAULT_MATERIAL, ...(p.material || {}) };
  const spec = { ...MOTORS[p.motorSpec || 'generic'], ...(p.motorOverride || {}) };
  const battery = p.battery || { nominal: spec.vNom, voltage: spec.vNom };
  const motor = {
    ...motorParams(spec, { external: p.external ? BALBOA_EXTERNAL : null, batteryNominal: battery.nominal, batteryVoltage: battery.voltage }),
    motorKey: p.motorSpec || 'generic',
    model: p.motorModel || 'dc',
    maxTorque: 0.35,
    timeConstant: 0.02,
    ...(p.motor || {}),
  };
  const params = mergeParams(deriveFromGeometry(geometry, material), { motor, environment: p.environment });
  return {
    geometry, material, params,
    gains: { ...defaultGains(), ...(p.gains || {}) },
    realism: { ...defaultRealism(), ...(p.realism || {}) },
    nudge: p.nudge != null ? p.nudge : DEFAULT_NUDGE,
  };
}
