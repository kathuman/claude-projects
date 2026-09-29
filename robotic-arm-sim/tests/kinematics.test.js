// Unit tests for kinematics.js — run with:  node robotic-arm-sim/tests/kinematics.test.js
"use strict";
const K = require("../kinematics.js");
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log("  FAIL:", msg); } }
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function poseErr(A, B) { let e = 0; for (let i = 0; i < 12; i++) e = Math.max(e, Math.abs(A[i] - B[i])); return e; }
let seed = 12345;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
const R = K.UR5E;

console.log("FK");
{
  // zero pose of a UR5e: flange at (a2+a3, -(d4+d6), d1-d5) = (-0.8172, -0.2329, 0.0628)
  const f = K.fk([0, 0, 0, 0, 0, 0]);
  const p = K.pos(f.flange);
  ok(near(p[0], -0.8172, 1e-9) && near(p[1], -0.2329, 1e-9) && near(p[2], 0.0628, 1e-9), "zero pose flange = UR5e published (-0.8172,-0.2329,0.0628), got " + p);
  // every frame is a proper rotation (orthonormal, det +1)
  const q = [0.3, -1.2, 1.1, -0.4, 0.9, 2.2];
  K.fk(q).frames.forEach((T, i) => {
    const x = K.axis(T, 0), y = K.axis(T, 1), z = K.axis(T, 2);
    const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cr = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    ok(near(d(x, x), 1, 1e-12) && near(d(x, y), 0, 1e-12) && near(d(cr, z), 1, 1e-12), "frame " + i + " orthonormal right-handed");
  });
  // tcp is tool metres along flange z
  const f2 = K.fk(q), pf = K.pos(f2.flange), pt = K.pos(f2.tcp), z6 = K.axis(f2.flange, 2);
  ok([0, 1, 2].every(k => near(pt[k] - pf[k], R.tool * z6[k], 1e-12)), "tcp offset along flange z");
}

console.log("IK round-trip (2000 random poses)");
{
  let found = 0, allValid = true, maxErr = 0, n = 2000;
  for (let t = 0; t < n; t++) {
    const q = Array.from({ length: 6 }, () => (rnd() * 2 - 1) * Math.PI);
    const T = K.fk(q).flange;
    const sols = K.ikFlange(T);
    let hit = false;
    sols.forEach(s => {
      const e = poseErr(K.fk(s).flange, T);
      maxErr = Math.max(maxErr, e);
      if (e > 1e-8) allValid = false;
      if (s.every((v, i) => near(K.wrap(v - q[i]), 0, 1e-6))) hit = true;
    });
    if (hit) found++;
  }
  ok(allValid, "every IK solution reproduces the pose (max err " + maxErr.toExponential(2) + ")");
  ok(found >= n * 0.995, "original configuration is among the solutions in " + found + "/" + n);
  console.log("   max pose error", maxErr.toExponential(2), "| original recovered", found + "/" + n);
}

console.log("IK from TCP + seed");
{
  for (let t = 0; t < 300; t++) {
    const q = Array.from({ length: 6 }, () => (rnd() * 2 - 1) * 2.8);
    const Tt = K.fk(q).tcp;
    const seed = q.map(v => v + (rnd() - 0.5) * 0.2);
    const s = K.ik(Tt, seed);
    ok(s && poseErr(K.fk(s).tcp, Tt) < 1e-8, "tcp IK reproduces pose (trial " + t + ")");
    if (!s) continue;
    // IK must return the solution nearest the seed: never farther than the configuration we
    // started from. Away from singularities that nearest solution *is* the original one; near a
    // singularity two branches almost coincide and either may legitimately be nearer.
    const dist = x => x.reduce((acc, v, i) => acc + (i < 3 ? 2 : 1) * Math.abs(v - seed[i]), 0);
    ok(dist(s) <= dist(q) + 1e-9, "seeded IK returns the nearest branch (trial " + t + ")");
    if (K.manipulability(q) > 5e-3) ok(s.every((v, i) => near(v, q[i], 1e-6)), "away from singularities it's the original branch (trial " + t + ")");
  }
  ok(K.ik(K.transl(3, 0, 0.5), [0, 0, 0, 0, 0, 0]) === null, "unreachable pose -> null");
  // regression: a seed near -165° on the base, target whose solutions sit across the ±180° wrap.
  // Blindly unwrapping toward the seed pushed every solution outside the joint limits.
  const seedFar = [-2.88, -1.32, 2.15, -2.40, -1.57, -1.66];
  const Tw = K.poseFromRPY(0.30, -0.42, 0.028, Math.PI, 0, 0);
  const qw = K.ik(Tw, seedFar);
  ok(qw && poseErr(K.fk(qw).tcp, Tw) < 1e-8 && qw.every((v, i) => v >= R.lo[i] - 1e-9 && v <= R.hi[i] + 1e-9), "limit-aware branch choice finds the reachable pose");
}

console.log("wrist singularity (θ5 = 0)");
{
  const q = [0.4, -1.0, 1.2, -0.6, 0, 0.7];
  const T = K.fk(q).flange, sols = K.ikFlange(T);
  ok(sols.length > 0 && sols.every(s => poseErr(K.fk(s).flange, T) < 1e-8), "singular pose still solved exactly (" + sols.length + " sols)");
  ok(K.manipulability(q) < 1e-9, "manipulability ~0 at wrist singularity");
  ok(K.manipulability([0.4, -1.0, 1.2, -0.6, 1.0, 0.7]) > 1e-3, "manipulability > 0 away from it");
}

console.log("Jacobian vs finite differences");
{
  const q = [0.2, -0.9, 1.3, -1.1, 0.8, -0.4], J = K.jacobian(q), h = 1e-6;
  const p0 = K.pos(K.fk(q).tcp);
  for (let i = 0; i < 6; i++) {
    const q2 = q.slice(); q2[i] += h;
    const p1 = K.pos(K.fk(q2).tcp);
    ok([0, 1, 2].every(k => near((p1[k] - p0[k]) / h, J[k][i], 1e-5)), "linear velocity column " + i);
  }
}

console.log("collision model");
{
  // a comfortable upright pose is free
  ok(K.checkCollision([0, -Math.PI / 2, 0, -Math.PI / 2, 0, 0]).ok, "upright pose is collision-free");
  // folding the elbow fully back drives the forearm into the upper arm/base
  const fold = K.checkCollision([0, -Math.PI / 2, Math.PI * 0.97, 0, 0, 0]);
  ok(!fold.ok, "fully folded elbow is flagged (" + fold.hits.map(h => h.text).join("; ") + ")");
  // shoulder pointing the arm down through the table
  const down = K.checkCollision([0, Math.PI / 2 * 0.6, 0, 0, 0, 0]);
  ok(!down.ok && down.hits.some(h => h.kind === "floor"), "arm below the table is flagged as floor hit");
  // segment distance sanity
  ok(near(K.segDist([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]), 1, 1e-12), "parallel segments 1 m apart");
  ok(near(K.segDist([0, 0, 0], [1, 0, 0], [0.5, -1, 1], [0.5, 1, 1]), 1, 1e-12), "crossing segments 1 m apart");
  // obstacle
  const box = { name: "box", min: [-0.5, -0.4, 0], max: [-0.3, 0.4, 0.3] };
  const q = [0, -Math.PI / 2, 0, -Math.PI / 2, 0, 0];
  ok(K.checkCollision(q, K.UR5E, { obstacles: [box] }).ok, "upright arm clears a box beside it");
  const reach = K.ik(K.poseFromRPY(-0.4, 0, 0.15, Math.PI, 0, 0), q);
  ok(reach && !K.checkCollision(reach, K.UR5E, { obstacles: [box] }).ok, "reaching into the box is flagged");
}

console.log("RPY helpers");
{
  for (let t = 0; t < 200; t++) {
    const r = (rnd() * 2 - 1) * 3, p = (rnd() * 2 - 1) * 1.5, y = (rnd() * 2 - 1) * 3;
    const T = K.poseFromRPY(0.1, 0.2, 0.3, r, p, y), back = K.rpyFromPose(T);
    ok(poseErr(K.poseFromRPY(0.1, 0.2, 0.3, back[0], back[1], back[2]), T) < 1e-9, "rpy round-trip " + t);
  }
}

console.log(`\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ""));
process.exit(failures ? 1 : 0);
