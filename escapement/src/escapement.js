// Escapement — the geometry of the Graham deadbeat escapement (window.ESEscapement / module.exports): the escape
// wheel's teeth, the two pallets and the anchor that carries them. The pallets are not drawn by eye: they are traced
// from the motion in src/clock.js. Seen from the anchor (which swings with the pendulum), the tip of the tooth that is
// engaged draws, while the wheel is locked, an arc about the anchor's pivot — the locking face — and, while the wheel
// turns during the impulse, a slanting path — the impulse face. Building the pallets on those paths makes every tooth
// meet them exactly; tests/escapement.test.js checks over whole beats that nothing passes through anything.
//
// Frames: the wheel's own frame is centred on the escape arbor (x right, y up, seen from the front; at rotation 0, as
// at t = 0). The anchor's frame is centred on the pallet arbor, which stands palletDistance above the escape arbor.
// Angles are radians; clockwise (as seen from the front) is positive for the motion, as in ESClock.pose.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root.ESClock || require("./clock.js"));
  else root.ESEscapement = factory(root.ESClock);
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  var TAU = 2 * Math.PI, DEG = Math.PI / 180;

  // the tooth: a thin tip, a leading face leaning forward so only the tip touches a pallet, and a deeply undercut back
  var TOOTH = { lean: 12 * DEG, tip: 0.35, back: 0.6, backCurve: 0.8 };   // lean from radial; tip width, mm; back reaches the root at 0.62 of the pitch
  var PALLET = { overrun: 3.0 * DEG, thick: 2.8 };    // locking face beyond the deepest lock; pallet thickness (along the arbor), mm
  var ARM = { to: 26 * DEG, out: 1.0, hub: 3.6, bar: 3.0 }; // arm arc continues this far past the pallet; widened outward; hub radius; arm width

  function setup(d) {
    d = d || C.derive();
    var s = d.spec, N = s.train[3].wheel, R = s.escapeTipRadius, Rr = s.escapeRootRadius, pitch = TAU / N;
    var span = s.anchorSpan * pitch, Dp = d.palletDistance;
    // at t = 0 the pendulum is in the middle of its swing and the entry tooth is half-way across its impulse face, at
    // the point where the line from the pallet arbor touches the tip circle (135°, up and to the left)
    var phase = Math.PI / 2 + span / 2;
    var A = s.pendulum.amplitude, W = C.IMPULSE, lift = A * Math.sin(Math.PI * W);
    return { d: d, N: N, R: R, Rr: Rr, pitch: pitch, span: span, Dp: Dp, phase: phase, A: A, W: W, lift: lift, T: s.pendulum.period };
  }

  // the escape wheel's outline, counter-clockwise, in the wheel's frame at rotation 0
  function wheelOutline(g) {
    g = g || setup();
    var pts = [], R = g.R, Rr = g.Rr, p = g.pitch, tw = TOOTH.tip / R, lead = (R - Rr) * Math.tan(TOOTH.lean) / ((R + Rr) / 2), b = TOOTH.back * p;
    for (var j = 0; j < g.N; j++) {
      var f = g.phase + j * p;   // the leading corner of this tooth's tip
      pts.push([R * Math.cos(f), R * Math.sin(f)]);
      for (var k = 0; k <= 8; k++) {   // the tip, then the undercut back down to the root
        var u = k / 8, r = R - (R - Rr) * Math.pow(u, TOOTH.backCurve), a = f + tw + (b - tw) * u;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      for (var m = 1; m <= 3; m++) { var c = f + b + (p + lead - b) * m / 3; pts.push([Rr * Math.cos(c), Rr * Math.sin(c)]); }   // the root, to the next leading face
    }
    return pts;
  }

  // where the tip of the tooth whose leading corner is at angle tip0 (wheel frame, rotation 0) is at time t, seen from the anchor
  function tipInAnchor(g, tip0, t) {
    var p = C.pose(t, g.d), a = tip0 - p.escape, wx = g.R * Math.cos(a), wy = g.R * Math.sin(a) - g.Dp, th = p.anchor;
    return [wx * Math.cos(th) - wy * Math.sin(th), wx * Math.sin(th) + wy * Math.cos(th)];
  }
  var ang = function (q) { return Math.atan2(q[1], q[0]); }, rad = function (q) { return Math.hypot(q[0], q[1]); };
  function arc(r, a0, a1, n) { var out = []; for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; }

  // the two pallets and the anchor, in the anchor's frame
  function anchor(g) {
    g = g || setup();
    var T = g.T, beat = T / 2, x2t = function (x) { return x * beat; }, n = 24;
    // entry pallet: its tooth (tip at the phase angle at t = 0) is locked from x = -1 + W to -W and takes its impulse from -W to +W
    // exit pallet: the tooth seven and a half pitches on; locked from W to 1 - W, impulse from 1 - W to 1 + W
    function pallet(tip0, x0, dir) {
      var face = [];
      for (var i = 0; i <= n; i++) face.push(tipInAnchor(g, tip0, x2t(x0 - g.W + 2 * g.W * i / n)));
      var LC = face[0], IC = face[n], rLock = rad(LC), rOther = rad(IC), aLock = ang(LC), aOther = ang(IC);
      face = envelope(face, x0, dir, Math.min(rLock, rOther), Math.max(rLock, rOther));
      IC = face[face.length - 1]; aOther = ang(IC);
      // the locking face reaches beyond the deepest lock (the end of the pendulum's swing) by the overrun
      var aBack = aLock + dir * ((g.A - g.lift) + PALLET.overrun);
      var poly = face.concat(arc(rOther, aOther, aBack, 12)).concat(arc(rLock, aBack, aLock, 12).slice(1, -1));
      return { poly: poly, face: face, lockCorner: LC, impulseEnd: IC, lockRadius: rLock, otherRadius: rOther, back: aBack, dir: dir,
        rIn: Math.min(rLock, rOther), rOut: Math.max(rLock, rOther) };
    }
    // The traced face fits the leading corner of the tip, but the tip has width, and as the anchor turns the rest of
    // the tip (and of the tooth that has just left) sweeps a little further. The face is cut back to the envelope of
    // every point near the tips over two whole beats: for each distance from the arbor, the face lies just clear of
    // all of them (dir: the side of the face the pallet's body is on, in angle about the arbor).
    var tipPts = (function () {
      var o = wheelOutline(g), per = o.length / g.N, pts = [];
      for (var j = 0; j < g.N; j++) {
        var b = j * per, prevRoot = o[(b - 1 + o.length) % o.length];
        for (var k = 0; k <= 5; k++) pts.push(o[b + k]);                       // the tip and the top of the back
        for (var m = 1; m <= 4; m++) pts.push([o[b][0] + (prevRoot[0] - o[b][0]) * m / 10, o[b][1] + (prevRoot[1] - o[b][1]) * m / 10]);   // the top of the leading face
      }
      return pts;
    })();
    function envelope(face, x0, dir, rIn, rOut) {
      var BINS = 40, best = [], aRef = ang(face[0]), i, k;
      var aFace = function (r) {   // the traced face's angle at distance r (it runs monotonically in r)
        for (var q = 1; q < face.length; q++) {
          var r0 = rad(face[q - 1]), r1 = rad(face[q]);
          if ((r - r0) * (r - r1) <= 0) { var u = r1 === r0 ? 0 : (r - r0) / (r1 - r0); return ang(face[q - 1]) + (ang(face[q]) - ang(face[q - 1])) * u; }
        }
        return null;
      };
      for (i = 0; i <= BINS; i++) { var rr = rIn + (rOut - rIn) * i / BINS; best.push([rr, aFace(rr)]); }
      for (var s = 0; s <= 900; s++) {
        var t = (x0 - 1.2 + 2.4 * s / 900) * beat, p = C.pose(t, g.d), ca = Math.cos(-p.escape), sa = Math.sin(-p.escape), ct = Math.cos(p.anchor), st = Math.sin(p.anchor);
        for (k = 0; k < tipPts.length; k++) {
          var wx = tipPts[k][0] * ca - tipPts[k][1] * sa, wy = tipPts[k][0] * sa + tipPts[k][1] * ca - g.Dp;
          var qx = wx * ct - wy * st, qy = wx * st + wy * ct, r = Math.hypot(qx, qy);
          if (r <= rIn + 0.015 || r >= rOut - 0.002) continue;   // points resting on the locking arcs are on the faces, not past them
          var a = Math.atan2(qy, qx);
          if (Math.abs(a - aRef) > 8 * DEG) continue;
          var bi = Math.round((r - rIn) / (rOut - rIn) * BINS);
          for (var bb = Math.max(0, bi - 1); bb <= Math.min(BINS, bi + 1); bb++) {
            if (best[bb][1] === null) continue;
            if (dir > 0 ? a > best[bb][1] : a < best[bb][1]) best[bb][1] = a;
          }
        }
      }
      var out = best.filter(function (b) { return b[1] !== null; }).map(function (b) { return [b[0] * Math.cos(b[1]), b[0] * Math.sin(b[1])]; });
      // keep the face running from the locking corner to the other side, as the trace did
      return rad(face[0]) < rad(face[face.length - 1]) ? out : out.reverse();
    }
    var entry = pallet(g.phase, 0, -1);
    var exit = pallet(g.phase - g.span + g.pitch / 2, 1, +1);   // the pallets span 7½ teeth, so the exit tooth is 7 pitches on
    // the arms: arcs about the arbor carrying each pallet, then straight bars in to the hub
    function arm(pl) {
      var a0 = pl.back - pl.dir * 0.5 * DEG, a1 = pl.back + pl.dir * ARM.to, rI = pl.rIn, rO = pl.rOut + ARM.out;
      var band = arc(rO, a0, a1, 16).concat(arc(rI, a1, a0, 16));
      var end = [((rI + rO) / 2) * Math.cos(a1), ((rI + rO) / 2) * Math.sin(a1)];
      return { band: band, end: end };
    }
    var ea = arm(entry), xa = arm(exit);
    function bar(p0, p1, w0, w1) {
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
      return [[p0[0] + nx * w0 / 2, p0[1] + ny * w0 / 2], [p1[0] + nx * w1 / 2, p1[1] + ny * w1 / 2], [p1[0] - nx * w1 / 2, p1[1] - ny * w1 / 2], [p0[0] - nx * w0 / 2, p0[1] - ny * w0 / 2]];
    }
    var hub = arc(ARM.hub, 0, TAU, 32).slice(0, -1);
    return {
      entry: entry, exit: exit, hub: hub, hubRadius: ARM.hub,
      arms: [ea.band, xa.band, bar([0, 0], ea.end, ARM.bar * 1.4, ARM.bar), bar([0, 0], xa.end, ARM.bar * 1.4, ARM.bar)],
      palletThickness: PALLET.thick,
      lift: g.lift, drop: 0
    };
  }

  // everything the Blender script and the pages need, as plain numbers
  function geometry(d) {
    var g = setup(d), an = anchor(g);
    return { wheel: wheelOutline(g), entry: an.entry.poly, exit: an.exit.poly, arms: an.arms, hub: an.hub, hubRadius: an.hubRadius,
      palletThickness: an.palletThickness, lift: g.lift, phase: g.phase, lean: TOOTH.lean,
      lockRadius: { entry: an.entry.lockRadius, exit: an.exit.lockRadius }, impulseRadius: { entry: an.entry.otherRadius, exit: an.exit.otherRadius } };
  }

  return { TOOTH: TOOTH, PALLET: PALLET, ARM: ARM, setup: setup, wheelOutline: wheelOutline, tipInAnchor: tipInAnchor, anchor: anchor, geometry: geometry };
});
