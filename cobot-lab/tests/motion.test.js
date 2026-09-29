// Unit tests for motion.js — run with:  node cobot-lab/tests/motion.test.js
"use strict";
const K = require("../kinematics.js");
const M = require("../motion.js");
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log("  FAIL:", msg); } }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
const R = K.UR5E, D = Math.PI / 180;
const HOME = [0, -90, 90, -90, -90, 0].map(d => d * D);

console.log("trapezoids");
{
  ok(near(M.trapMinTime(1, 1, 1), 2, 1e-12), "D = v²/a: exactly triangular-to-trapezoid boundary, T = 2");
  ok(near(M.trapMinTime(4, 1, 1), 5, 1e-12), "cruising: T = D/v + v/a");
  ok(near(M.trapMinTime(0.25, 1, 1), 1, 1e-12), "triangular: T = 2 sqrt(D/a)");
  for (const [Dd, T, a] of [[1, 3, 1], [0.3, 1.2, 2], [2, 2.5, 4]]) {
    const f = M.trapProfile(Dd, T, a);
    ok(near(f(0)[0], 0, 1e-12) && near(f(T)[0], Dd, 1e-12), `profile covers D=${Dd} in T=${T}`);
    let vmax = 0, mono = true, prev = -1;
    for (let t = 0; t <= T; t += T / 400) { const s = f(t); vmax = Math.max(vmax, s[1]); if (s[0] < prev - 1e-12) mono = false; prev = s[0]; }
    ok(mono, "profile monotone");
    ok(Math.abs(f(T / 2)[2]) <= a + 1e-12, "acceleration within a");
    // continuity of position at the phase boundaries
    let jump = 0; for (let t = 0; t < T; t += T / 1000) jump = Math.max(jump, Math.abs(f(t + T / 1000)[0] - f(t)[0]));
    ok(jump < Dd / 100, "position continuous");
  }
}

console.log("MoveJ");
{
  const q1 = [1.2, -1.2, 1.9, -1.0, -1.2, 2.5];
  const tr = M.planJoint(HOME, q1);
  const end = tr.sample(tr.T), start = tr.sample(0);
  ok(end.q.every((v, i) => near(v, q1[i], 1e-9)) && start.q.every((v, i) => near(v, HOME[i], 1e-9)), "starts and ends at the right poses");
  let vOk = true, aOk = true, finishTogether = true;
  for (let t = 0; t <= tr.T; t += tr.T / 500) {
    const s = tr.sample(t);
    s.qd.forEach((v, i) => { if (Math.abs(v) > R.vmax[i] + 1e-9) vOk = false; });
    s.qdd.forEach((v, i) => { if (Math.abs(v) > R.amax[i] + 1e-9) aOk = false; });
  }
  // every moving joint is still moving just before T (synchronised), none finished early
  const late = tr.sample(tr.T * 0.97);
  late.qd.forEach((v, i) => { if (Math.abs(q1[i] - HOME[i]) > 1e-6 && Math.abs(v) < 1e-6) finishTogether = false; });
  ok(vOk, "joint speeds within limits"); ok(aOk, "joint accelerations within limits"); ok(finishTogether, "all joints finish together");
  // the slowest joint (largest move relative to its limits) is the one that sets T
  const Tmin = Math.max(...q1.map((v, i) => M.trapMinTime(v - HOME[i], R.vmax[i], R.amax[i])));
  ok(near(tr.T, Tmin, 1e-9), "duration = slowest joint's minimum time (" + tr.T.toFixed(3) + " s)");
  const slow = M.planJoint(HOME, q1, R, { speed: 0.5 });
  ok(slow.T > tr.T * 1.5, "half speed takes longer");
}

console.log("MoveL");
{
  const T0 = K.fk(HOME).tcp, p0 = K.pos(T0);
  const goal = T0.slice(); goal[3] += 0.25; goal[7] -= 0.15; goal[11] += 0.1;   // move 0.31 m, same orientation
  const tr = M.planLinear(HOME, goal);
  ok(tr.ok, "straight move planned " + JSON.stringify(tr.error || ""));
  if (tr.ok) {
    const p1 = K.pos(goal), dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...dir);
    let maxDev = 0, maxRate = 0, oriErr = 0;
    tr.samples.forEach(s => {
      const T = K.fk(s.q).tcp, p = K.pos(T), d = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
      const along = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / L;
      const perp = Math.hypot(d[0] - dir[0] * along / L, d[1] - dir[1] * along / L, d[2] - dir[2] * along / L);
      maxDev = Math.max(maxDev, perp);
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) oriErr = Math.max(oriErr, Math.abs(T[k * 4 + j] - T0[k * 4 + j]));
    });
    for (let i = 1; i < tr.samples.length; i++) {
      const a = tr.samples[i - 1], b = tr.samples[i];
      b.q.forEach((v, j) => { maxRate = Math.max(maxRate, Math.abs(v - a.q[j]) / (b.t - a.t) / R.vmax[j]); });
    }
    ok(maxDev < 1e-6, "tool stays on the line (max deviation " + maxDev.toExponential(1) + " m)");
    ok(oriErr < 1e-6, "orientation held");
    ok(maxRate <= 1.0001, "joint speeds within limits (peak " + (maxRate * 100).toFixed(0) + "% of limit)");
    const endT = K.fk(tr.sample(tr.T).q).tcp;
    ok([3, 7, 11].every(k => near(endT[k], goal[k], 1e-9)), "ends at the goal");
    ok(tr.T >= L / 0.25, "respects the 0.25 m/s tool speed (" + tr.T.toFixed(2) + " s for " + L.toFixed(3) + " m)");
  }
  const far = T0.slice(); far[3] = 2.0;
  const bad = M.planLinear(HOME, far);
  ok(!bad.ok && bad.error.reason === "unreachable", "target out of reach is rejected (" + (bad.error && bad.error.reason) + ")");
  // with orientation change: rotate tool 60° about vertical while moving
  const rot = K.mul(goal, [Math.cos(1), -Math.sin(1), 0, 0, Math.sin(1), Math.cos(1), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const tr2 = M.planLinear(HOME, rot);
  ok(tr2.ok, "move with a 57° wrist rotation planned");
  // collision callback aborts
  const blocked = M.planLinear(HOME, goal, R, { collide: q => (K.pos(K.fk(q).tcp)[0] > p0[0] + 0.1 ? "wall" : null) });
  ok(!blocked.ok && blocked.error.reason === "collision", "collision along the path aborts the plan");
}

console.log("MoveC");
{
  const T0 = K.fk(HOME).tcp, p0 = K.pos(T0);
  const via = [p0[0] + 0.1, p0[1] + 0.1, p0[2]], end = T0.slice(); end[3] = p0[0] + 0.2;
  const tr = M.planCircular(HOME, via, end);
  ok(tr.ok, "arc planned " + JSON.stringify(tr.error || ""));
  if (tr.ok) {
    const c = tr.arc;
    ok(near(c.radius, 0.1, 1e-9), "radius 0.1 m");
    let dev = 0;
    tr.samples.forEach(s => { const p = K.pos(K.fk(s.q).tcp); dev = Math.max(dev, Math.abs(Math.hypot(p[0] - c.center[0], p[1] - c.center[1], p[2] - c.center[2]) - c.radius)); });
    ok(dev < 1e-6, "tool stays on the circle (max deviation " + dev.toExponential(1) + " m)");
    const pv = c.at(0.5);
    ok(Math.hypot(pv[0] - via[0], pv[1] - via[1], pv[2] - via[2]) < 1e-9, "passes through the via point halfway (half-circle)");
  }
  ok(!M.planCircular(HOME, K.pos(T0), T0).ok, "degenerate (collinear) arc rejected");
}

console.log("quaternions");
{
  const T = K.poseFromRPY(0, 0, 0, 0.3, -0.7, 2.1), q = M.matToQuat(T), Rm = M.quatToRot(q);
  ok([0, 1, 2, 4, 5, 6, 8, 9, 10].every((k, i) => near(Rm[i], T[k], 1e-12)), "matrix -> quaternion -> matrix");
  const a = M.matToQuat(K.I4()), b = M.matToQuat(K.poseFromRPY(0, 0, 0, 0, 0, 1));
  ok(near(M.quatAngle(a, b), 1, 1e-12), "angle between orientations");
  ok(near(M.quatAngle(a, M.slerp(a, b, 0.25)), 0.25, 1e-12), "slerp moves proportionally");
}

console.log(`\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ""));
process.exit(failures ? 1 : 0);
