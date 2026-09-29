# Linkage — robotic arm simulator

A browser simulator of the Universal Robots e-Series 6-axis collaborative arms (UR3e, UR5e,
UR10e, UR16e), built from their published kinematic (Denavit–Hartenberg) and dynamics
parameters. Live demo:
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

## Programs

The Program panel is a small teach pendant: waypoints (a joint pose + Move J / Move L + speed +
optional gripper open/grip), run or loop, export/import as JSON (`format: "linkage-program"`,
joint angles in degrees), or export URScript for a real UR controller — joint moves become
`movej`, linear moves `movel(get_forward_kin(q))` so the controller's own kinematics defines the
pose. **Share link** packs the robot, pose, program and obstacles into the URL (`#s=…`); the last
session is also remembered in the browser.

## Conventions

Robot base frame is z-up, in metres and radians; the scene converts to three.js's y-up world
with one rotated group. The tool centre point sits 0.16 m out from the flange, between the
gripper fingertips.
