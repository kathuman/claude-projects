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
- `tests/kinematics.test.js` — unit tests for the core. Run with
  `node robotic-arm-sim/tests/kinematics.test.js` (no dependencies).
- `vendor/` — three.js r128 and cannon.js, with their licences.

## Conventions

Robot base frame is z-up, in metres and radians; the scene converts to three.js's y-up world
with one rotated group. The tool centre point sits 0.16 m out from the flange, between the
gripper fingertips.
