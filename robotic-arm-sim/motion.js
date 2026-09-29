/* Cobot Lab — motion planning core (trajectories).
 *
 * Pure functions on top of kinematics.js; no DOM. Produces time-parameterised trajectories:
 *   planJoint    — MoveJ: all joints move together and finish together, each with a
 *                  trapezoidal velocity profile inside its own speed/acceleration limits.
 *   planLinear   — MoveL: the tool centre point moves in a straight line (orientation slerped),
 *                  solved by IK at every step; retimed if any joint would exceed its limits,
 *                  rejected if the path is unreachable, collides, or flips through a singularity.
 *   planCircular — MoveC: an arc through a via point to an end point, same machinery.
 * Browser global window.CobotLabMotion, or CommonJS.
 */
(function (root) {
  "use strict";
  var K = (typeof module !== "undefined" && module.exports) ? require("./kinematics.js") : root.CobotLabKin;

  // ---------------------------------------------------------------- trapezoidal profiles
  // Minimum time to cover distance D starting and ending at rest.
  function trapMinTime(D, v, a) {
    D = Math.abs(D);
    if (D < 1e-12) return 0;
    if (D >= v * v / a) return D / v + v / a;          // reaches cruise speed
    return 2 * Math.sqrt(D / a);                        // triangular
  }
  // Profile that covers D in exactly time T (T ≥ trapMinTime) with acceleration a:
  // cruise speed v solves D = v (T − v/a). Returns f(t) -> [s, sdot, sddot], s in [0, D].
  function trapProfile(D, T, a) {
    D = Math.abs(D);
    if (D < 1e-12 || T <= 0) return function () { return [0, 0, 0]; };
    var disc = a * a * T * T - 4 * a * D;
    var v = disc > 0 ? (a * T - Math.sqrt(disc)) / 2 : a * T / 2;
    var Ta = v / a;
    return function (t) {
      if (t <= 0) return [0, 0, 0];
      if (t >= T) return [D, 0, 0];
      if (t < Ta) return [0.5 * a * t * t, a * t, a];
      if (t <= T - Ta) return [0.5 * a * Ta * Ta + v * (t - Ta), v, 0];
      var r = T - t;
      return [D - 0.5 * a * r * r, a * r, -a];
    };
  }

  // ---------------------------------------------------------------- MoveJ
  function planJoint(q0, q1, robot, opts) {
    robot = robot || K.UR5E; opts = opts || {};
    var sp = opts.speed || 1, T = 0, d = [];
    for (var i = 0; i < 6; i++) {
      d[i] = q1[i] - q0[i];
      T = Math.max(T, trapMinTime(d[i], robot.vmax[i] * sp, robot.amax[i] * sp));
    }
    T = Math.max(T, 0.05);
    // every joint uses the same duration T (set by the slowest joint): each keeps its own
    // acceleration limit and gets the cruise speed that makes it arrive exactly at T — which
    // is never above its speed limit, since T is at least its own minimum time
    var prof = d.map(function (di, i) { return trapProfile(di, T, robot.amax[i] * sp); });
    return {
      kind: "joint", T: T,
      sample: function (t) {
        var q = [], qd = [], qdd = [];
        for (var i = 0; i < 6; i++) {
          var s = prof[i](t), sg = d[i] < 0 ? -1 : 1;
          q[i] = q0[i] + sg * s[0]; qd[i] = sg * s[1]; qdd[i] = sg * s[2];
        }
        return { q: q, qd: qd, qdd: qdd };
      }
    };
  }

  // ---------------------------------------------------------------- quaternions (for slerp)
  function matToQuat(T) {
    var m00 = T[0], m01 = T[1], m02 = T[2], m10 = T[4], m11 = T[5], m12 = T[6], m20 = T[8], m21 = T[9], m22 = T[10];
    var tr = m00 + m11 + m22, w, x, y, z, S;
    if (tr > 0) { S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (m21 - m12) / S; y = (m02 - m20) / S; z = (m10 - m01) / S; }
    else if (m00 > m11 && m00 > m22) { S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / S; x = 0.25 * S; y = (m01 + m10) / S; z = (m02 + m20) / S; }
    else if (m11 > m22) { S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / S; x = (m01 + m10) / S; y = 0.25 * S; z = (m12 + m21) / S; }
    else { S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / S; x = (m02 + m20) / S; y = (m12 + m21) / S; z = 0.25 * S; }
    return [w, x, y, z];
  }
  function quatToRot(q) {
    var w = q[0], x = q[1], y = q[2], z = q[3];
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
            2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
            2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }
  function slerp(a, b, t) {
    var d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(function (v) { return -v; }); d = -d; }
    if (d > 0.9995) {
      var r = a.map(function (v, i) { return v + (b[i] - v) * t; }), n = Math.hypot(r[0], r[1], r[2], r[3]);
      return r.map(function (v) { return v / n; });
    }
    var th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map(function (v, i) { return v * wa + b[i] * wb; });
  }
  function quatAngle(a, b) {
    var d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    return 2 * Math.acos(Math.min(1, d));
  }
  function poseOf(p, R) { return [R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1]; }

  // ---------------------------------------------------------------- Cartesian paths
  // Generic: path(s) -> TCP pose for s in [0,1]; L = path length (m), A = rotation (rad).
  // Samples every dt, solves IK seeded by the previous step, and checks joint continuity,
  // joint speed limits, joint limits and (optionally) collisions. If speeds are exceeded the
  // move is slowed down and re-planned.
  function planPath(q0, path, L, A, robot, opts) {
    robot = robot || K.UR5E; opts = opts || {};
    var sp = opts.speed || 1;
    var v = (opts.vlin || 0.25) * sp, a = (opts.alin || 1.2) * sp, w = (opts.vrot || 1.2) * sp, al = (opts.arot || 4) * sp;
    var dt = opts.dt || 1 / 100;
    // time law on the normalised path parameter: the slower of the linear and rotational needs
    var T = Math.max(trapMinTime(L, v, a), trapMinTime(A, w, al), 0.05);
    for (var attempt = 0; attempt < 6; attempt++) {
      var aNorm = 4 / (T * T) * 1.5;   // acceleration on s (distance 1) giving a comfortable trapezoid in T
      if (trapMinTime(1, 1e9, aNorm) > T) aNorm = 4 / (T * T);
      var sOf = trapProfile(1, T, aNorm);
      var samples = [], q = q0.slice(), worst = 0, fail = null;
      var n = Math.max(2, Math.ceil(T / dt));
      for (var k = 0; k <= n; k++) {
        var t = T * k / n, s = sOf(t)[0];
        var qn = K.ik(path(s), q, robot);
        if (!qn) { fail = { reason: "unreachable", at: s }; break; }
        if (k > 0) {
          var h = T / n;
          for (var j = 0; j < 6; j++) {
            var rate = Math.abs(qn[j] - q[j]) / h;
            // a jump far beyond any joint's speed means IK switched branch (singularity)
            if (Math.abs(qn[j] - q[j]) > 0.5) { fail = { reason: "singularity", at: s, joint: j }; break; }
            worst = Math.max(worst, rate / robot.vmax[j]);
          }
          if (fail) break;
        }
        if (opts.collide) { var c = opts.collide(qn); if (c) { fail = { reason: "collision", at: s, text: c }; break; } }
        samples.push({ t: t, q: qn });
        q = qn;
      }
      if (fail) return { ok: false, error: fail };
      if (worst <= 1.0001) return makeSampled(samples, T, opts.kind || "linear");
      T *= Math.min(3, worst * 1.05);   // too fast for some joint: slow the whole move down
    }
    return { ok: false, error: { reason: "too fast", at: 0 } };
  }
  function makeSampled(samples, T, kind) {
    // velocities/accelerations by finite differences (for plotting)
    var n = samples.length;
    for (var i = 0; i < n; i++) {
      var a = samples[Math.max(0, i - 1)], b = samples[Math.min(n - 1, i + 1)], dtt = b.t - a.t || 1;
      samples[i].qd = b.q.map(function (v, j) { return (v - a.q[j]) / dtt; });
    }
    for (var i2 = 0; i2 < n; i2++) {
      var a2 = samples[Math.max(0, i2 - 1)], b2 = samples[Math.min(n - 1, i2 + 1)], dt2 = b2.t - a2.t || 1;
      samples[i2].qdd = b2.qd.map(function (v, j) { return (v - a2.qd[j]) / dt2; });
    }
    return {
      ok: true, kind: kind, T: T, samples: samples,
      sample: function (t) {
        if (t <= 0) return samples[0];
        if (t >= T) return samples[n - 1];
        var f = t / T * (n - 1), i = Math.floor(f), u = f - i, A = samples[i], B = samples[Math.min(n - 1, i + 1)];
        return {
          q: A.q.map(function (v, j) { return v + (B.q[j] - v) * u; }),
          qd: A.qd.map(function (v, j) { return v + (B.qd[j] - v) * u; }),
          qdd: A.qdd.map(function (v, j) { return v + (B.qdd[j] - v) * u; })
        };
      }
    };
  }

  function planLinear(q0, Tgoal, robot, opts) {
    robot = robot || K.UR5E; opts = opts || {};
    // report an unreachable goal as such (heading for it, the arm would straighten out and
    // hit the full-extension singularity first, which is a less helpful message)
    if (!K.ik(Tgoal, null, robot)) return { ok: false, error: { reason: "unreachable", at: 1 } };
    var T0 = K.fk(q0, robot).tcp, p0 = K.pos(T0), p1 = K.pos(Tgoal);
    var qa = matToQuat(T0), qb = matToQuat(Tgoal);
    var L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), A = quatAngle(qa, qb);
    var path = function (s) {
      return poseOf([p0[0] + (p1[0] - p0[0]) * s, p0[1] + (p1[1] - p0[1]) * s, p0[2] + (p1[2] - p0[2]) * s], quatToRot(slerp(qa, qb, s)));
    };
    var r = planPath(q0, path, L, A, robot, Object.assign({ kind: "linear" }, opts));
    if (r.ok) { r.length = L; r.path = path; }
    return r;
  }

  // Circle through p0 (current TCP), via, p1. Orientation slerps start -> end.
  function planCircular(q0, pVia, Tgoal, robot, opts) {
    robot = robot || K.UR5E; opts = opts || {};
    if (!K.ik(Tgoal, null, robot)) return { ok: false, error: { reason: "unreachable", at: 1 } };
    var T0 = K.fk(q0, robot).tcp, p0 = K.pos(T0), p1 = K.pos(Tgoal);
    var arc = circleThrough(p0, pVia, p1);
    if (!arc) return { ok: false, error: { reason: "collinear", at: 0 } };
    var qa = matToQuat(T0), qb = matToQuat(Tgoal);
    var path = function (s) { return poseOf(arc.at(s), quatToRot(slerp(qa, qb, s))); };
    var r = planPath(q0, path, arc.length, quatAngle(qa, qb), robot, Object.assign({ kind: "circular" }, opts));
    if (r.ok) { r.length = arc.length; r.path = path; r.arc = arc; }
    return r;
  }
  // Circle through three points: centre, radius, and a parameterisation from a to c via b.
  // With full=true (a == c), a full circle through a and b with b diametrically opposite.
  function circleThrough(a, b, c) {
    var ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), nn = dot(n, n);
    if (nn < 1e-12) return null;
    // circumcentre
    var t1 = scale(cross(n, ab), dot(ac, ac)), t2 = scale(cross(ac, n), dot(ab, ab));
    var ctr = add(a, scale(add(t1, t2), 1 / (2 * nn)));
    var r = norm(sub(a, ctr)), nz = scale(n, 1 / Math.sqrt(nn));
    var u = scale(sub(a, ctr), 1 / r), v = cross(nz, u);
    function ang(p) { var d = sub(p, ctr); return Math.atan2(dot(d, v), dot(d, u)); }
    var angB = ang(b), angC = ang(c);
    if (angB < 0) angB += 2 * Math.PI;
    if (angC < 0) angC += 2 * Math.PI;
    if (angC < angB) angC += 2 * Math.PI;         // go through b on the way to c
    var sweep = angC;
    return {
      center: ctr, radius: r, normal: nz, sweep: sweep, length: r * sweep,
      at: function (s) { var th = sweep * s; return add(ctr, add(scale(u, r * Math.cos(th)), scale(v, r * Math.sin(th)))); }
    };
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { return Math.sqrt(dot(a, a)); }

  var api = {
    trapMinTime: trapMinTime, trapProfile: trapProfile,
    planJoint: planJoint, planLinear: planLinear, planCircular: planCircular, planPath: planPath,
    circleThrough: circleThrough, matToQuat: matToQuat, quatToRot: quatToRot, slerp: slerp, quatAngle: quatAngle, poseOf: poseOf
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CobotLabMotion = api;
})(typeof window !== "undefined" ? window : this);
