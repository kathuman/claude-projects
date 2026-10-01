// Named configurations -- each is a config this robot could plausibly be
// built as, not just a slider demo. Gains are re-verified per preset
// (tests/dynamics.test.mjs and the exploration behind it live in this
// repo's history -- a lighter/taller/smaller robot genuinely needs
// different gains, the same way a real one would) rather than assuming
// the default gains survive every physical configuration.

export const PRESETS = {
  default: {
    label: 'Default',
    description: 'A small hobby-scale balancing robot.',
  },
  nimble: {
    label: 'Nimble & light',
    description: 'Small, light, quick to respond -- needs much gentler gains than a heavier build.',
    geometry: { wheelRadius: 0.03, trackWidth: 0.12, bodyHeight: 0.14, comHeight: 0.09 },
    material: { bodyDensity: 350 },
    gains: { angleKp: 4, angleKd: 0.3 },
  },
  heavy: {
    label: 'Heavy & sluggish',
    description: 'Bigger wheels, denser body -- more inertia to fight, but also more forgiving.',
    geometry: { wheelRadius: 0.055, trackWidth: 0.2, bodyHeight: 0.3, comHeight: 0.2 },
    material: { bodyDensity: 1400 },
    motor: { maxTorque: 0.6 },
  },
  tippy: {
    label: 'Tall & tippy',
    description: 'A high center of mass falls faster and needs a stiffer, better-damped inner loop.',
    geometry: { wheelRadius: 0.035, trackWidth: 0.14, bodyHeight: 0.4, comHeight: 0.32 },
    gains: { angleKp: 8, angleKd: 2.2 },
  },
  tinywheels: {
    label: 'Tiny wheels',
    description: 'Same body, much smaller wheels -- less ground clearance, less torque arm.',
    geometry: { wheelRadius: 0.02 },
    gains: { angleKp: 4, angleKd: 0.5 },
  },
  noisy: {
    label: 'Noisy sensor',
    description: 'Default hardware, a cheap/vibrating IMU: visible jitter, still (barely) upright.',
    realism: { sensorNoiseStdTheta: 0.02, sensorNoiseStdRate: 0.15, sensorDelaySteps: 3 },
  },
  slowbrain: {
    label: 'Slow control loop',
    description: 'Default hardware, a control loop too slow to keep up (25 Hz) -- watch it fail.',
    realism: { controlLoopHz: 25 },
  },
};
