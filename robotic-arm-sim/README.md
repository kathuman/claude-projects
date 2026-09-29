# Linkage — robotic arm simulator

A browser simulator of a 6-axis collaborative robot arm with the published kinematic
parameters (Denavit–Hartenberg) of a Universal Robots UR5e. Live demo:
https://kathuman.github.io/claude-projects/robotic-arm-sim/

## Files

- `index.html` — the app: three.js scene, UI, camera, collision guard, physics bench.
- `kinematics.js` — the robotics core as pure functions (no DOM, no three.js): forward
  kinematics, analytic inverse kinematics (all 8 solutions), geometric Jacobian and
  manipulability, capsule collision model (table, self, box obstacles). The scene draws the
  arm straight from these results, so what you see is exactly what is checked.
- `motion.js` — trajectories on top of the kinematics: MoveJ (synchronised trapezoidal joint
  profiles inside each joint's speed/acceleration limits), MoveL (straight tool line, IK every
  step, automatically slowed if a joint would exceed its limit, rejected if unreachable,
  colliding or flipping through a singularity) and MoveC (arcs through a via point).
- `planner.js` — collision-free path planning in joint space: RRT-Connect with random
  shortcutting, every edge checked at fine resolution. Move J and pick & place use it whenever
  the direct joint move would hit an obstacle.
- `kinematics.js` also holds the statics (holding torque per joint from the published UR5e
  link masses and centres of mass, checked against the derivative of potential energy) and
  the tool-velocity ("dexterity") ellipsoid.
- `tests/` — unit tests for the three cores, no dependencies:
  `node robotic-arm-sim/tests/kinematics.test.js`, `motion.test.js`, `planner.test.js`.
- `vendor/` — three.js r128 and Rapier 0.21 (compat build, WebAssembly inlined; loaded on
  demand as an ES module), with their licences. In the Rapier world the arm's link capsules and
  the two fingers are kinematic bodies that follow the kinematics, so the arm pushes things.

## Conventions

Robot base frame is z-up, in metres and radians; the scene converts to three.js's y-up world
with one rotated group. The tool centre point sits 0.16 m out from the flange, between the
gripper fingertips.
