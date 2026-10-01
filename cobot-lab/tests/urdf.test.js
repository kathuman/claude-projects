// Unit tests for urdf.js + the generic-chain kinematics — run with:
//   node cobot-lab/tests/urdf.test.js
"use strict";
const fs = require("fs"), path = require("path");
const K = require("../kinematics.js");
const U = require("../urdf.js");
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log("  FAIL:", msg); } }
function poseErr(A, B) { let e = 0; for (let i = 0; i < 12; i++) e = Math.max(e, Math.abs(A[i] - B[i])); return e; }
let seed = 99;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
const read = f => fs.readFileSync(path.join(__dirname, "..", "urdf", f), "utf8");

console.log("UR5e as URDF == analytic UR5e");
{
  const M = U.parseURDF(read("ur5e_from_dh.urdf")), R = K.UR5E;
  ok(M.name === "ur5e_from_dh" && M.jointNames.join() === "shoulder_pan_joint,shoulder_lift_joint,elbow_joint,wrist_1_joint,wrist_2_joint,wrist_3_joint", "name and joint names");
  ok(M.toolFrameFound && M.inertiaFromFile, "tool0 frame and <inertial> data found");
  ok(M.tauMax.join() === "150,150,150,28,28,28", "efforts become rated torques");
  let worst = 0, worstTau = 0;
  for (let t = 0; t < 400; t++) {
    const q = Array.from({ length: 6 }, () => (rnd() * 2 - 1) * Math.PI);
    worst = Math.max(worst, poseErr(K.fk(q, M).tcp, K.fk(q, R).tcp), poseErr(K.fk(q, M).flange, K.fk(q, R).flange));
    const a = K.gravityTorques(q, M), b = K.gravityTorques(q, R);
    worstTau = Math.max(worstTau, ...a.map((v, i) => Math.abs(v - b[i])));
  }
  ok(worst < 1e-12, "generic chain FK matches the DH model (max diff " + worst.toExponential(1) + ")");
  ok(worstTau < 1e-9, "gravity torques match the DH model (max diff " + worstTau.toExponential(1) + " N·m)");
  const J1 = K.jacobian([0.3, -1, 1.2, -0.7, 0.9, 0.1], M), J2 = K.jacobian([0.3, -1, 1.2, -0.7, 0.9, 0.1], R);
  ok(J1.every((r, i) => r.every((v, j) => Math.abs(v - J2[i][j]) < 1e-12)), "Jacobians match");
  ok(Math.abs(M.reach - 0.85) < 0.12, "estimated reach " + M.reach.toFixed(3) + " m is near the UR5e's 0.85 m");
  ok(K.ikFlange(K.fk([0, 0, 0, 0, 0, 0], M).flange, M).length === 0, "no analytic IK is claimed for a URDF chain");
}

function ikRoundTrip(M, name, n) {
  let okN = 0, worst = 0, t0 = Date.now();
  for (let t = 0; t < n; t++) {
    const q = M.lo.map((lo, i) => lo + rnd() * (M.hi[i] - lo));
    const T = K.fk(q, M).tcp, seedQ = q.map((v, i) => Math.min(M.hi[i], Math.max(M.lo[i], v + (rnd() - 0.5) * 0.6)));
    const s = K.ik(T, seedQ, M);
    if (s) { okN++; worst = Math.max(worst, poseErr(K.fk(s, M).tcp, T)); ok(s.every((v, i) => v >= M.lo[i] - 1e-9 && v <= M.hi[i] + 1e-9), name + " IK stays inside the joint limits"); }
  }
  ok(okN >= n * 0.97, name + " numerical IK converges from a nearby seed in " + okN + "/" + n);
  ok(worst < 1e-6, name + " IK accuracy (max pose error " + worst.toExponential(1) + ")");
  let cold = 0;
  for (let t = 0; t < 40; t++) {
    const q = M.lo.map((lo, i) => lo + rnd() * (M.hi[i] - lo));
    if (K.ik(K.fk(q, M).tcp, null, M)) cold++;
  }
  ok(cold >= 34, name + " IK without a seed (restarts) solves " + cold + "/40");
  console.log("   " + name + ": " + okN + "/" + n + " seeded, " + cold + "/40 cold, " + (Date.now() - t0) + " ms");
}

console.log("numerical IK");
ikRoundTrip(U.parseURDF(read("ur5e_from_dh.urdf")), "UR5e (URDF)", 200);
const S = U.parseURDF(read("spherical_wrist_6r.urdf"));
ikRoundTrip(S, "spherical wrist", 200);

console.log("spherical-wrist sample");
{
  ok(S.jointNames.length === 6 && S.jointNames[5] === "j6_flange_roll", "gripper-finger prismatic branch ignored; 6 arm joints");
  ok(S.toolFrameFound, "tool0 found through the fixed joint");
  // the wrist axes 4, 5, 6 meet at one point (a spherical wrist)
  const f = K.fk([0.3, 0.2, -0.4, 0.8, 0.6, -0.2], S), o = f.origins;
  ok(Math.hypot(o[4][0] - o[5][0], o[4][1] - o[5][1], o[4][2] - o[5][2]) > 0.05, "sanity: wrist joints are not all at one origin in the file");
  const p = o[4], a4 = f.axes[3], a6 = f.axes[5];
  const dist = (pt, o0, ax) => { const d = [pt[0] - o0[0], pt[1] - o0[1], pt[2] - o0[2]]; const c = [d[1] * ax[2] - d[2] * ax[1], d[2] * ax[0] - d[0] * ax[2], d[0] * ax[1] - d[1] * ax[0]]; return Math.hypot(...c); };
  ok(dist(p, o[3], a4) < 1e-12 && dist(p, o[5], a6) < 1e-12, "axes 4 and 6 pass through the wrist-pitch centre");
  // tool z points along the flange roll axis
  const z = K.axis(f.flange, 2);
  ok(Math.abs(z[0] * a6[0] + z[1] * a6[1] + z[2] * a6[2] - 1) < 1e-12, "tool z = flange roll axis");
  ok(K.checkCollision([0, 0, 0, 0, Math.PI / 2, 0], S).ok, "a tool-down pose near zero is collision-free");
  // stretched out: 0.15 shoulder offset + 0.55 upper arm + 0.2 + 0.35 + 0.08 + 0.01 = 1.34 m
  ok(S.reach > 1.3 && S.reach < 1.4, "reach " + S.reach.toFixed(3) + " m (stretched-out length 1.34 m)");
  const tau = K.gravityTorques([0, 0.8, -0.6, 0, 1, 0], S), h = 1e-6;
  let fd = 0; for (let j = 0; j < 6; j++) { const a = [0, 0.8, -0.6, 0, 1, 0], b = a.slice(); a[j] += h; b[j] -= h; fd = Math.max(fd, Math.abs((K.potentialEnergy(a, S) - K.potentialEnergy(b, S)) / (2 * h) - tau[j])); }
  ok(fd < 1e-5, "gravity torques = dV/dq for the URDF masses");
}

console.log("errors are explained");
{
  const bad = (txt, re, what) => { try { U.parseURDF(txt); ok(false, what + " should fail"); } catch (e) { ok(re.test(e.message), what + ": " + e.message); } };
  const five = read("ur5e_from_dh.urdf").replace(/<joint name="wrist_3_joint"[\s\S]*?<\/joint>/, "").replace('parent link="wrist_3_link"', 'parent link="wrist_2_link"');
  bad(five, /6-joint.*5 revolute/, "5-joint arm");
  const seven = read("ur5e_from_dh.urdf").replace('<link name="tool0"/>', '<link name="tool0"/><link name="extra"/>').replace('</robot>', '<joint name="j7" type="revolute"><parent link="tool0"/><child link="extra"/><axis xyz="0 0 1"/></joint></robot>');
  bad(seven, /7 revolute/, "7-joint arm");
  bad(read("ur5e_from_dh.urdf").replace('name="elbow_joint" type="revolute"', 'name="elbow_joint" type="prismatic"'), /revolute joints|prismatic/, "prismatic joint in the arm");
  bad("<robot name='x'><link name='a'>", /never closed|malformed/, "malformed XML");
  bad("<html></html>", /no <robot>/, "not a URDF");
}

console.log(`\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ""));
process.exit(failures ? 1 : 0);
