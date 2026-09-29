/* Linkage — kinematics core.
 *
 * Pure functions, no DOM and no three.js: the page draws whatever this computes, and
 * tests/kinematics.test.js checks it under Node. Works as a browser global
 * (window.LinkageKin) and as a CommonJS module.
 *
 * Robot: a 6-joint arm with the published Denavit–Hartenberg parameters of the
 * Universal Robots UR5e (standard DH, metres/radians). Base frame is z-up.
 * Matrices are 4x4, row-major, as flat arrays of 16 numbers.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- robot model
  var UR5E = {
    name: "UR5e-class 6-axis arm",
    d: [0.1625, 0, 0, 0.1333, 0.0997, 0.0996],
    a: [0, -0.425, -0.3922, 0, 0, 0],
    alpha: [Math.PI / 2, 0, 0, Math.PI / 2, -Math.PI / 2, 0],
    // joint limits (rad): the real UR5e allows ±360°, we keep one turn so sliders stay readable
    lo: [-Math.PI, -Math.PI, -Math.PI, -Math.PI, -Math.PI, -Math.PI],
    hi: [Math.PI, Math.PI, Math.PI, Math.PI, Math.PI, Math.PI],
    // UR5e datasheet: 180°/s on every joint (π rad/s); acceleration is our choice
    vmax: [Math.PI, Math.PI, Math.PI, Math.PI, Math.PI, Math.PI],
    amax: [4, 4, 4, 6, 6, 6],
    tool: 0.16,     // flange -> tool centre point (between the gripper fingertips), along flange z
    // link masses (kg) and centres of mass (m, in each link's own DH frame): Universal Robots'
    // published UR5e dynamics parameters
    mass: [3.761, 8.058, 2.846, 1.37, 1.3, 0.365],
    com: [[0, -0.02561, 0.00193], [0.2125, 0, 0.11336], [0.15, 0, 0.0265], [0, -0.0018, 0.01634], [0, 0.0018, 0.01634], [0, 0, -0.001159]],
    // rated joint torques (N·m): size-3 joints for base/shoulder/elbow, size-1 for the wrists
    tauMax: [150, 150, 150, 28, 28, 28],
    gripperMass: 0.9    // the two-finger gripper on the flange (kg), centre of mass 0.06 m out
  };

  // ---------------------------------------------------------------- 4x4 helpers
  function I4() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function mul(A, B) {
    var C = new Array(16);
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      C[r * 4 + c] = A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + A[r * 4 + 3] * B[12 + c];
    }
    return C;
  }
  // inverse of a rigid transform
  function inv(T) {
    var R = [T[0], T[1], T[2], T[4], T[5], T[6], T[8], T[9], T[10]], p = [T[3], T[7], T[11]];
    return [
      R[0], R[3], R[6], -(R[0] * p[0] + R[3] * p[1] + R[6] * p[2]),
      R[1], R[4], R[7], -(R[1] * p[0] + R[4] * p[1] + R[7] * p[2]),
      R[2], R[5], R[8], -(R[2] * p[0] + R[5] * p[1] + R[8] * p[2]),
      0, 0, 0, 1
    ];
  }
  function pos(T) { return [T[3], T[7], T[11]]; }
  function axis(T, k) { return [T[k], T[4 + k], T[8 + k]]; }   // column k: 0 = x, 1 = y, 2 = z
  function transl(x, y, z) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]; }

  // one DH link: Rz(theta) · Tz(d) · Tx(a) · Rx(alpha)
  function dh(theta, d, a, alpha) {
    var ct = Math.cos(theta), st = Math.sin(theta), ca = Math.cos(alpha), sa = Math.sin(alpha);
    return [
      ct, -st * ca, st * sa, a * ct,
      st, ct * ca, -ct * sa, a * st,
      0, sa, ca, d,
      0, 0, 0, 1
    ];
  }

  // Rotation from roll/pitch/yaw (fixed axes X, then Y, then Z) + position.
  function poseFromRPY(x, y, z, roll, pitch, yaw) {
    var cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    return [
      cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x,
      sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y,
      -sp, cp * sr, cp * cr, z,
      0, 0, 0, 1
    ];
  }
  function rpyFromPose(T) {
    var pitch = Math.atan2(-T[8], Math.hypot(T[0], T[4]));
    var roll = Math.atan2(T[9], T[10]);
    var yaw = Math.atan2(T[4], T[0]);
    return [roll, pitch, yaw];
  }

  // ---------------------------------------------------------------- forward kinematics
  // Returns frames[0..6] (frames[0] = base, frames[6] = flange) and tcp.
  function fk(q, robot) {
    robot = robot || UR5E;
    var frames = [I4()], T = I4();
    for (var i = 0; i < 6; i++) {
      T = mul(T, dh(q[i], robot.d[i], robot.a[i], robot.alpha[i]));
      frames.push(T);
    }
    return { frames: frames, flange: T, tcp: mul(T, transl(0, 0, robot.tool)) };
  }

  function wrap(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }

  // ---------------------------------------------------------------- analytic inverse kinematics
  // For a flange pose T, all (up to 8) joint solutions: shoulder left/right × wrist up/down ×
  // elbow up/down. Derivation: the wrist centre fixes θ1; the flange's offset along
  // base-y fixes θ5; the remaining rotation is a Z-Y-Z Euler chain giving θ6 and θ2+θ3+θ4;
  // θ2, θ3 then solve a planar two-link problem.
  function ikFlange(T, robot) {
    robot = robot || UR5E;
    var d1 = robot.d[0], a2 = robot.a[1], a3 = robot.a[2], d4 = robot.d[3], d5 = robot.d[4], d6 = robot.d[5];
    var sols = [];
    var p05 = [T[3] - d6 * T[2], T[7] - d6 * T[6], T[11] - d6 * T[10]];
    var r = Math.hypot(p05[0], p05[1]);
    if (r < Math.abs(d4) - 1e-12) return sols;                  // wrist centre inside the d4 cylinder
    var psi = Math.atan2(p05[1], p05[0]);
    var phi = Math.acos(clamp(d4 / r, -1, 1));
    [psi + phi + Math.PI / 2, psi - phi + Math.PI / 2].forEach(function (t1) {
      var s1 = Math.sin(t1), c1 = Math.cos(t1);
      var c5 = (T[3] * s1 - T[7] * c1 - d4) / d6;
      if (Math.abs(c5) > 1 + 1e-9) return;
      var t5a = Math.acos(clamp(c5, -1, 1));
      [t5a, -t5a].forEach(function (t5) {
        var A1 = dh(t1, d1, 0, robot.alpha[0]);
        var T16 = mul(inv(A1), T);
        // R16 = Rz(θ234) · Ry(-θ5) · Rz(θ6)  (Z-Y-Z Euler with b = -θ5)
        var sb = -Math.sin(t5), t6, t234;
        if (Math.abs(sb) < 1e-9) {
          // wrist singularity (θ5 = 0 or π): θ234 and θ6 are coupled; pick θ6 = 0
          t6 = 0;
          t234 = Math.cos(t5) > 0 ? Math.atan2(T16[4], T16[0]) : Math.atan2(-T16[4], -T16[0]);
        } else {
          t234 = Math.atan2(T16[6] / sb, T16[2] / sb);
          t6 = Math.atan2(T16[9] / sb, -T16[8] / sb);
        }
        var A6 = dh(t6, d6, 0, robot.alpha[5]), A5 = dh(t5, d5, 0, robot.alpha[4]);
        var T14 = mul(mul(T16, inv(A6)), inv(A5));
        var px = T14[3], py = T14[7];
        var c3 = (px * px + py * py - a2 * a2 - a3 * a3) / (2 * a2 * a3);
        if (Math.abs(c3) > 1 + 1e-9) return;                    // out of reach
        var t3a = Math.acos(clamp(c3, -1, 1));
        [t3a, -t3a].forEach(function (t3) {
          var t2 = Math.atan2(py, px) - Math.atan2(a3 * Math.sin(t3), a2 + a3 * Math.cos(t3));
          var t4 = t234 - t2 - t3;
          sols.push([wrap(t1), wrap(t2), wrap(t3), wrap(t4), wrap(t5), wrap(t6)]);
        });
      });
    });
    return sols;
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // IK for a tool-centre-point pose; returns the solution nearest `seed` that is inside the
  // joint limits (angles unwrapped to the branch nearest the seed), or null.
  function ik(Ttcp, seed, robot) {
    robot = robot || UR5E;
    var T = mul(Ttcp, transl(0, 0, -robot.tool));
    var sols = ikFlange(T, robot), best = null, bestD = Infinity;
    sols.forEach(function (s) {
      // per joint: of the equivalent angles v, v ± 2π, the one nearest the seed that is
      // inside the joint's limits (a blind "nearest branch" could land outside them)
      var q = [];
      for (var i = 0; i < 6; i++) {
        var best1 = null;
        [s[i], s[i] - 2 * Math.PI, s[i] + 2 * Math.PI].forEach(function (v) {
          if (v < robot.lo[i] - 1e-9 || v > robot.hi[i] + 1e-9) return;
          if (best1 === null || (seed && Math.abs(v - seed[i]) < Math.abs(best1 - seed[i]))) best1 = v;
        });
        if (best1 === null) return;
        q.push(best1);
      }
      var dsum = 0;
      if (seed) for (var j = 0; j < 6; j++) dsum += (j < 3 ? 2 : 1) * Math.abs(q[j] - seed[j]);  // prefer keeping the big joints still
      if (dsum < bestD) { bestD = dsum; best = q; }
    });
    return best;
  }
  function nearestBranch(v, ref) {
    while (v - ref > Math.PI) v -= 2 * Math.PI;
    while (ref - v > Math.PI) v += 2 * Math.PI;
    return v;
  }

  // ---------------------------------------------------------------- Jacobian & manipulability
  // Geometric Jacobian (6×6) of the TCP: rows vx vy vz wx wy wz.
  function jacobian(q, robot) {
    robot = robot || UR5E;
    var f = fk(q, robot), pe = pos(f.tcp), J = [[], [], [], [], [], []];
    for (var i = 0; i < 6; i++) {
      var z = axis(f.frames[i], 2), o = pos(f.frames[i]);
      var d = [pe[0] - o[0], pe[1] - o[1], pe[2] - o[2]];
      var v = [z[1] * d[2] - z[2] * d[1], z[2] * d[0] - z[0] * d[2], z[0] * d[1] - z[1] * d[0]];
      J[0][i] = v[0]; J[1][i] = v[1]; J[2][i] = v[2]; J[3][i] = z[0]; J[4][i] = z[1]; J[5][i] = z[2];
    }
    return J;
  }
  // Yoshikawa manipulability sqrt(det(J Jᵀ)) — for a square J that is |det J|; 0 at a singularity.
  function manipulability(q, robot) {
    return Math.abs(det6(jacobian(q, robot)));
  }
  function det6(M) {   // Gaussian elimination with partial pivoting
    var A = M.map(function (r) { return r.slice(); }), n = 6, det = 1;
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-14) return 0;
      if (p !== c) { var t = A[p]; A[p] = A[c]; A[c] = t; det = -det; }
      det *= A[c][c];
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = A[r2][c] / A[c][c];
        for (var k = c; k < n; k++) A[r2][k] -= f * A[c][k];
      }
    }
    return det;
  }

  // ---------------------------------------------------------------- collision model
  // The arm as capsules (segment + radius) in base coordinates. Offsets along the joint
  // axes reproduce the UR's real shape: the upper arm runs 0.138 m out along the shoulder
  // axis, the forearm 0.007 m (0.138 − 0.131), and d4 carries the wrist back in line.
  var SHOULDER_OFF = 0.138, ELBOW_OFF = 0.007;
  function add(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }
  function capsules(q, robot, fkr) {
    robot = robot || UR5E;
    var f = fkr || fk(q, robot), F = f.frames;
    var o0 = pos(F[0]), o1 = pos(F[1]), o2 = pos(F[2]), o3 = pos(F[3]), o4 = pos(F[4]), o5 = pos(F[5]), o6 = pos(F[6]);
    var z1 = axis(F[1], 2), z2 = axis(F[2], 2), z6 = axis(F[6], 2);
    return [
      { name: "base", a: o0, b: [0, 0, robot.d[0]], r: 0.075 },
      { name: "shoulder", a: o1, b: add(o1, z1, SHOULDER_OFF), r: 0.07 },
      { name: "upper arm", a: add(o1, z1, SHOULDER_OFF), b: add(o2, z1, SHOULDER_OFF), r: 0.058 },
      { name: "elbow", a: add(o2, z2, SHOULDER_OFF), b: add(o2, z2, ELBOW_OFF), r: 0.058 },
      { name: "forearm", a: add(o2, z2, ELBOW_OFF), b: add(o3, z2, ELBOW_OFF), r: 0.045 },
      { name: "wrist 1", a: o3, b: o4, r: 0.045 },
      { name: "wrist 2", a: o4, b: o5, r: 0.045 },
      { name: "wrist 3", a: o5, b: o6, r: 0.045 },
      // the gripper: a chunky body on the flange, then two slim fingers out to the TCP
      { name: "gripper", a: o6, b: add(o6, z6, 0.07), r: 0.045 },
      { name: "fingers", a: add(o6, z6, 0.07), b: pos(f.tcp), r: 0.018 }
    ];
  }
  // pairs far enough apart in the chain that touching means a real collision
  var SELF_PAIRS = [[0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [2, 6], [2, 7], [2, 8], [2, 9], [4, 8], [4, 9]];

  function segDist(p1, q1, p2, q2) {   // closest distance between two segments
    var d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    var a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), s, t;
    if (a < 1e-12 && e < 1e-12) return norm(r);
    if (a < 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
    else {
      var c = dot(d1, r);
      if (e < 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
      else {
        var b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    return norm(sub(add(p1, d1, s), add(p2, d2, t)));
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }

  // Collision report for a configuration: floor (z = 0 plane, the table the arm is bolted to)
  // and self-collision. Returns { ok, hits: [{kind, links:[i,j], text}] }.
  function checkCollision(q, robot, opts) {
    robot = robot || UR5E;
    opts = opts || {};
    var caps = capsules(q, robot), hits = [], margin = opts.margin || 0;
    for (var i = 3; i < caps.length; i++) {   // links from the elbow out can reach the table
      var zmin = Math.min(caps[i].a[2], caps[i].b[2]) - caps[i].r;
      if (zmin < margin - 0.0005) hits.push({ kind: "floor", links: [i], text: caps[i].name + " would hit the table" });
    }
    SELF_PAIRS.forEach(function (pr) {
      var A = caps[pr[0]], B = caps[pr[1]];
      if (segDist(A.a, A.b, B.a, B.b) < A.r + B.r + margin) hits.push({ kind: "self", links: pr, text: A.name + " would hit the " + B.name });
    });
    if (opts.obstacles) opts.obstacles.forEach(function (ob) {
      for (var k = 2; k < caps.length; k++) if (capsuleBoxHit(caps[k], ob, margin)) {
        hits.push({ kind: "obstacle", links: [k], text: caps[k].name + " would hit " + (ob.name || "an obstacle") });
      }
    });
    return { ok: hits.length === 0, hits: hits, capsules: caps };
  }
  // capsule vs axis-aligned box {min:[x,y,z], max:[x,y,z]} — sampled along the segment
  function capsuleBoxHit(c, box, margin) {
    for (var s = 0; s <= 10; s++) {
      var p = add(c.a, sub(c.b, c.a), s / 10), d2 = 0;
      for (var k = 0; k < 3; k++) {
        var v = Math.max(box.min[k] - p[k], 0, p[k] - box.max[k]);
        d2 += v * v;
      }
      if (Math.sqrt(d2) < c.r + (margin || 0)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- statics
  // Torque each joint motor must supply to hold the arm still against gravity (N·m), for the
  // links, the gripper and an optional payload (kg) at the TCP: τ_j = ∂V/∂q_j with
  // V = Σ m g z_com, using ∂c/∂q_j = z_j × (c − o_j) for every mass beyond joint j.
  var G = 9.81;
  function comPositions(q, robot, payload, fkr) {
    robot = robot || UR5E;
    var f = fkr || fk(q, robot), out = [];
    for (var k = 0; k < 6; k++) {
      var c = robot.com[k], F = f.frames[k + 1];
      out.push({ m: robot.mass[k], p: [F[0] * c[0] + F[1] * c[1] + F[2] * c[2] + F[3], F[4] * c[0] + F[5] * c[1] + F[6] * c[2] + F[7], F[8] * c[0] + F[9] * c[1] + F[10] * c[2] + F[11]], link: k });
    }
    out.push({ m: robot.gripperMass, p: pos(mul(f.flange, transl(0, 0, 0.06))), link: 5 });
    if (payload) out.push({ m: payload, p: pos(f.tcp), link: 5 });
    return out;
  }
  function gravityTorques(q, robot, payload) {
    robot = robot || UR5E;
    var f = fk(q, robot), masses = comPositions(q, robot, payload, f), tau = [0, 0, 0, 0, 0, 0];
    for (var j = 0; j < 6; j++) {
      var z = axis(f.frames[j], 2), o = pos(f.frames[j]);
      masses.forEach(function (ms) {
        if (ms.link < j) return;                          // masses before joint j don't move with it
        var r = sub(ms.p, o);
        var dzdq = z[0] * r[1] - z[1] * r[0];            // z-component of z × r
        tau[j] += ms.m * G * dzdq;
      });
    }
    return tau;
  }
  function potentialEnergy(q, robot, payload) {
    return comPositions(q, robot, payload).reduce(function (s, ms) { return s + ms.m * G * ms.p[2]; }, 0);
  }

  // Tool-velocity ellipsoid: principal axes (unit vectors) and lengths (sqrt of eigenvalues
  // of Jv·Jvᵀ) — how far the tool moves per unit joint speed in each direction.
  function velocityEllipsoid(q, robot) {
    var J = jacobian(q, robot), A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) for (var k = 0; k < 6; k++) A[r][c] += J[r][k] * J[c][k];
    var e = eig3(A);
    return { axes: e.vectors, radii: e.values.map(function (v) { return Math.sqrt(Math.max(0, v)); }) };
  }
  // symmetric 3×3 eigen-decomposition (Jacobi rotations)
  function eig3(A) {
    var a = A.map(function (r) { return r.slice(); }), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (var sweep = 0; sweep < 50; sweep++) {
      var off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
      if (off < 1e-14) break;
      for (var p = 0; p < 2; p++) for (var qq = p + 1; qq < 3; qq++) {
        if (Math.abs(a[p][qq]) < 1e-18) continue;
        var th = (a[qq][qq] - a[p][p]) / (2 * a[p][qq]);
        var t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (var k = 0; k < 3; k++) { var akp = a[k][p], akq = a[k][qq]; a[k][p] = c * akp - s * akq; a[k][qq] = s * akp + c * akq; }
        for (var k2 = 0; k2 < 3; k2++) { var apk = a[p][k2], aqk = a[qq][k2]; a[p][k2] = c * apk - s * aqk; a[qq][k2] = s * apk + c * aqk; }
        for (var k3 = 0; k3 < 3; k3++) { var vkp = V[k3][p], vkq = V[k3][qq]; V[k3][p] = c * vkp - s * vkq; V[k3][qq] = s * vkp + c * vkq; }
      }
    }
    return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map(function (i) { return [V[0][i], V[1][i], V[2][i]]; }) };
  }

  var api = {
    gravityTorques: gravityTorques, potentialEnergy: potentialEnergy, comPositions: comPositions, velocityEllipsoid: velocityEllipsoid, eig3: eig3,
    UR5E: UR5E, fk: fk, ik: ik, ikFlange: ikFlange, jacobian: jacobian, manipulability: manipulability,
    capsules: capsules, checkCollision: checkCollision, segDist: segDist,
    mul: mul, inv: inv, pos: pos, axis: axis, transl: transl, dh: dh, wrap: wrap, nearestBranch: nearestBranch,
    poseFromRPY: poseFromRPY, rpyFromPose: rpyFromPose, I4: I4
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LinkageKin = api;
})(typeof window !== "undefined" ? window : this);
