// Robot parameter schema shared with cad/parametric_robot.py.
//
// Two ways to get a params object, both producing the same shape:
//  1. deriveFromGeometry(geometry-ish overrides) -- fast, closed-form
//     (box + solid-cylinder inertia formulas), for live slider tweaking
//     in the browser.
//  2. Load web/cad/robot_params.json, as exported by the FreeCAD macro
//     from real solid geometry + material density ("source": "freecad").
//     This is authoritative when present: FreeCAD computes exact mass,
//     center of mass and inertia from the actual modeled solids instead
//     of approximating the body as a uniform box.

import { MOTORS, motorParams } from './motors.mjs';

export const SCHEMA_VERSION = 2;

/** Baseline geometry + material inputs for the closed-form derivation. */
export const DEFAULT_GEOMETRY = {
  wheelRadius: 0.04, // m
  wheelWidth: 0.026, // m
  trackWidth: 0.16, // m, distance between wheel centers
  bodyWidth: 0.09, // m, lateral (along the axle direction)
  bodyDepth: 0.05, // m, fore-aft
  bodyHeight: 0.2, // m, vertical
  comHeight: 0.14, // m, axle to body-CoM distance
};

export const DEFAULT_MATERIAL = {
  wheelDensity: 1200, // kg/m^3 (approx. rigid ABS/rubber-tired wheel)
  bodyDensity: 600, // kg/m^3 (lumped effective density: frame + electronics + battery)
};

/**
 * Motor/actuator settings. model 'dc' (default) is a brushed DC gearmotor built from datasheet
 * numbers (see motors.mjs); 'ideal' is the v1.0 torque source (maxTorque, first-order lag).
 */
export const DEFAULT_MOTOR = {
  model: 'dc',
  ...motorParams(MOTORS.generic),
  maxTorque: 0.35, // N*m per wheel ('ideal' model)
  timeConstant: 0.02, // s, first-order actuator lag ('ideal' model)
};

export const DEFAULT_ENVIRONMENT = {
  gravity: 9.81,
  rollingResistance: 0.02, // damping on forward speed (N*m*s/m, lumped)
  pitchDamping: 0.0008, // damping at the pitch pivot
  yawDamping: 0.01, // damping on yaw rate
  groundFriction: 0.9, // tyre-floor friction coefficient (rubber on a hard floor)
  slipVelocity: 0.02, // m/s, width of the friction law's stick-to-slide transition (numerical creep)
  bodyFriction: 0.5, // body-floor friction coefficient once it has fallen
  contactHz: 40, // natural frequency of the body-floor contact spring (stiff, well damped)
};

/**
 * Closed-form mass/inertia from simple shapes: wheels as solid cylinders,
 * body as a uniform box. This is the "no CAD required" path -- good
 * enough to explore configurations instantly; swap in a FreeCAD-exported
 * robot_params.json for geometry-accurate numbers.
 */
export function deriveFromGeometry(geometry, material) {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  const m = { ...DEFAULT_MATERIAL, ...material };

  const wheelVolume = Math.PI * g.wheelRadius * g.wheelRadius * g.wheelWidth;
  const wheelMass = wheelVolume * m.wheelDensity;
  // Solid cylinder about its own axle (central) axis.
  const wheelInertia = 0.5 * wheelMass * g.wheelRadius * g.wheelRadius;

  const bodyVolume = g.bodyWidth * g.bodyDepth * g.bodyHeight;
  const bodyMass = bodyVolume * m.bodyDensity;
  // Uniform box, axis through centroid parallel to the axle (lateral)
  // direction -- the pitch axis. Perpendicular-plane dimensions are
  // depth (fore-aft) and height (vertical).
  const bodyPitchInertia = (bodyMass * (g.bodyDepth * g.bodyDepth + g.bodyHeight * g.bodyHeight)) / 12;

  // Yaw axis is vertical, through the whole assembly's CoM. The body's
  // own centroid already lies on that axis (laterally centered), so its
  // contribution is just its own box inertia about the vertical axis
  // (perpendicular plane: width x depth). Each wheel contributes its own
  // (small) spin-axis-perpendicular inertia plus a parallel-axis term for
  // sitting trackWidth/2 off the yaw axis; the wheel's own contribution is
  // dominated by the parallel-axis term for any realistic geometry.
  const bodyYawInertia = (bodyMass * (g.bodyWidth * g.bodyWidth + g.bodyDepth * g.bodyDepth)) / 12;
  const wheelOwnYawInertia = (wheelMass * (3 * g.wheelRadius * g.wheelRadius + g.wheelWidth * g.wheelWidth)) / 12;
  const halfTrack = g.trackWidth / 2;
  const yawInertia = bodyYawInertia + 2 * (wheelOwnYawInertia + wheelMass * halfTrack * halfTrack);

  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'analytic-default',
    geometry: { ...g },
    mass: { wheelMass, bodyMass },
    inertia: { wheelInertia, bodyPitchInertia, yawInertia },
    motor: { ...DEFAULT_MOTOR },
    environment: { ...DEFAULT_ENVIRONMENT },
  };
}

export function defaultParams() {
  return deriveFromGeometry(DEFAULT_GEOMETRY, DEFAULT_MATERIAL);
}

/** Deep-merge a partial params object onto a base one (one level of nested objects, which is all this schema has). */
export function mergeParams(base, partial) {
  if (!partial) return base;
  const out = { ...base };
  for (const key of ['geometry', 'mass', 'inertia', 'motor', 'environment']) {
    if (partial[key]) out[key] = { ...base[key], ...partial[key] };
  }
  if (partial.source) out.source = partial.source;
  return out;
}
