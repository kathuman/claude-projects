// Unit tests for planner.js — run with:  node cobot-lab/tests/planner.test.js
"use strict";
const K = require("../kinematics.js");
const P = require("../planner.js");
let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log("  FAIL:", msg); } }
const R = K.UR5E, D = Math.PI / 180;
const LO = [-Math.PI, -Math.PI, -Math.PI * 0.95, -Math.PI, -Math.PI, -Math.PI], HI = [Math.PI, 0, Math.PI * 0.95, Math.PI, Math.PI, Math.PI];

console.log("toy 2-D world");
{
  // a wall at x in [0.4, 0.6] with a gap only above y > 0.8
  const free = q => !(q[0] > 0.4 && q[0] < 0.6 && q[1] < 0.8) && q.every(v => v >= 0 && v <= 1);
  const r = P.rrtConnect([0.1, 0.1], [0.9, 0.1], free, { lo: [0, 0], hi: [1, 1], step: 0.1, res: 0.01, seed: 3 });
  ok(r.ok, "finds a way round the wall");
  if (r.ok) {
    ok(r.path[0][0] === 0.1 && r.path[r.path.length - 1][0] === 0.9, "path runs start -> goal");
    ok(r.path.every((q, i) => i === 0 || P.edgeFree(r.path[i - 1], q, free, 0.002)), "every segment is collision-free at fine resolution");
    ok(r.path.some(q => q[1] > 0.8), "goes over the wall through the gap");
  }
  const walled = q => !(q[0] > 0.4 && q[0] < 0.6);
  ok(!P.rrtConnect([0.1, 0.1], [0.9, 0.1], walled, { lo: [0, 0], hi: [1, 1], maxIter: 800 }).ok, "reports failure when no path exists");
  ok(P.rrtConnect([0.1, 0.1], [0.3, 0.2], free, { lo: [0, 0], hi: [1, 1] }).direct, "direct connection when the straight line is free");
}

console.log("robot around a box");
{
  const HOME = [0, -90, 90, -90, -90, 0].map(d => d * D);
  // a tall box between two table positions in front of the arm
  const box = { name: "box", min: [-0.62, -0.12, 0], max: [-0.36, -0.02, 0.45] };
  const free = q => K.checkCollision(q, R, { obstacles: [box] }).ok;
  const qa = K.ik(K.poseFromRPY(-0.45, 0.22, 0.1, Math.PI, 0, 0), HOME);
  const qb = K.ik(K.poseFromRPY(-0.28, -0.45, 0.1, Math.PI, 0, 0), HOME);
  ok(qa && qb && free(qa) && free(qb), "both ends are free");
  ok(!P.edgeFree(qa, qb, free, 0.02), "the straight joint move would hit the box");
  const t0 = Date.now();
  const r = P.rrtConnect(qa, qb, free, { lo: LO, hi: HI, seed: 11 });
  const ms = Date.now() - t0;
  ok(r.ok, "planner finds a collision-free path (" + (r.ok ? r.path.length + " waypoints, " + r.iterations + " iterations, " + ms + " ms" : r.reason) + ")");
  if (r.ok) {
    let clean = true;
    for (let i = 1; i < r.path.length; i++) if (!P.edgeFree(r.path[i - 1], r.path[i], free, 0.005)) clean = false;
    ok(clean, "every segment verified free at 0.005 rad");
    ok(r.path.length <= 8, "shortcutting keeps the path short (" + r.path.length + " waypoints)");
    ok(ms < 5000, "plans in reasonable time");
  }
  const same = P.rrtConnect(qa, qb, free, { lo: LO, hi: HI, seed: 11 });
  ok(same.ok && same.path.length === r.path.length, "deterministic for a given seed");
  const inBox = K.ik(K.poseFromRPY(-0.5, -0.07, 0.2, Math.PI, 0, 0), HOME);
  ok(inBox && !P.rrtConnect(qa, inBox, free, { lo: LO, hi: HI }).ok, "goal inside the box is rejected");
}

console.log(`\n${checks - failures}/${checks} checks passed` + (failures ? ` — ${failures} FAILED` : ""));
process.exit(failures ? 1 : 0);
