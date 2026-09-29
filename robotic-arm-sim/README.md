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
- `urdf.js` — a dependency-free URDF reader: walks the kinematic tree along the branch with the
  most revolute joints (so gripper fingers don't count), folds fixed joints in, finds the tool
  frame (`tool0` / `flange` / `ee_link` …), reads limits and `<inertial>` masses. Imported arms
  use a generic joint chain in `kinematics.js`, numerical IK (damped least squares with
  restarts) and capsule collisions/drawing. Limits: 6 revolute joints; meshes aren't loaded.
- `urdf/` — two sample URDFs written for Linkage: a spherical-wrist 6R arm, and the UR5e written
  straight from its DH table (used to check the URDF path reproduces the analytic model exactly;
  note the published centres of mass had to be moved from DH to URDF link frames).
- `planner.js` — collision-free path planning in joint space: RRT-Connect with random
  shortcutting, every edge checked at fine resolution. Move J and pick & place use it whenever
  the direct joint move would hit an obstacle.
- `kinematics.js` also holds the statics (holding torque per joint from the published UR5e
  link masses and centres of mass, checked against the derivative of potential energy) and
  the tool-velocity ("dexterity") ellipsoid.
- `tests/` — unit tests for the three cores, no dependencies:
  `node robotic-arm-sim/tests/kinematics.test.js`, `motion.test.js`, `planner.test.js`,
  `urdf.test.js`.
- `vendor/` — three.js r186 (ES modules, resolved by the import map in `index.html`, plus the
  few add-ons used: studio environment, effect composer, ground-truth ambient occlusion, output
  pass) and Rapier 0.21 (compat build, WebAssembly inlined; loaded on demand), with licences. In the Rapier world the arm's link capsules and
  the two fingers are kinematic bodies that follow the kinematics, so the arm pushes things.

## Programs

The Program panel is a small teach pendant: waypoints (a joint pose + Move J / Move L + speed +
optional gripper open/grip), run or loop, export/import as JSON (`format: "linkage-program"`,
joint angles in degrees), or export URScript for a real UR controller — joint moves become
`movej`, linear moves `movel(get_forward_kin(q))` so the controller's own kinematics defines the
pose. **Share link** packs the robot, pose, program and obstacles into the URL (`#s=…`); the last
session is also remembered in the browser.

## ROS bridge

Connect to a `rosbridge_server` (ROS 1 or ROS 2, default `ws://localhost:9090`). Linkage speaks
the rosbridge v2 JSON protocol directly: it publishes `sensor_msgs/JointState` on
`/joint_states` (UR joint names; effort = holding torques) and `geometry_msgs/PoseStamped` on
`/linkage/tcp_pose` at 20 Hz, and with "Follow joint commands" on it subscribes to
`/linkage/joint_command` (`sensor_msgs/JointState`, radians) and servos the arm there through
the collision guard. From the https demo, a remote bridge needs `wss://`; `ws://localhost` works.

## Rendering

Image-based lighting from a prefiltered studio environment, Khronos PBR Neutral tone mapping,
filtered PCF shadows and GTAO ambient occlusion (switched off automatically if it makes frames
slow on a device; off by default on phones). Physics advances by the elapsed time in 1/60 s steps, split
into more, smaller steps when the arm moved far in a frame (≤ 4 mm of travel per step), with the
arm's kinematic bodies interpolated across them — so it pushes objects instead of tunnelling
through them even on very slow frames.

## Conventions

Robot base frame is z-up, in metres and radians; the scene converts to three.js's y-up world
with one rotated group. The tool centre point sits 0.16 m out from the flange, between the
gripper fingertips.
