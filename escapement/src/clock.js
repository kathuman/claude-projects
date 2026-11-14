// Escapement — the mechanism of a spring-driven skeleton bracket clock with a Graham deadbeat escapement and a
// half-second pendulum (window.ESClock / module.exports). One specification for the Blender model, the web page and
// the tests: tooth counts and modules, where every arbor sits (computed from the centre distances, so meshing is exact),
// and the kinematics: the angle of every moving part at any time.
//
// Power flows: mainspring → barrel (great wheel) → centre pinion → centre wheel → third pinion → third wheel →
// escape pinion → escape wheel → pallets of the anchor → crutch → pendulum. The pendulum's swing lets the escape wheel
// advance half a tooth per beat (one beat each time the pendulum passes the middle), so the whole train turns at a rate
// set by the pendulum alone. The centre arbor turns once an hour and carries the minute hand; the motion work (cannon
// pinion → minute wheel → minute pinion → hour wheel) divides by 12 for the hour hand.
//
// Units: millimetres and seconds; angles in radians. Design coordinates: x to the right, y up, z towards the viewer
// (z = 0 is the inner face of the back plate).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESClock = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var G = 9.80665;

  var SPEC = {
    pendulum: { period: 1.0, amplitude: 3 * Math.PI / 180, bobRadius: 26, bobThickness: 12 },   // period of a full swing, s
    // the going train: each mesh is a wheel driving the next arbor's pinion
    train: [
      { id: "barrel", wheel: 96, module: 0.7, z: 8 },
      { id: "centre", pinion: 12, wheel: 80, module: 0.6, z: 30 },
      { id: "third", pinion: 8, wheel: 72, module: 0.6, z: 14 },
      { id: "escape", pinion: 6, wheel: 30, z: 24 }
    ],
    escapeTipRadius: 18,          // radius of the escape wheel's tooth tips
    escapeRootRadius: 14.5,
    anchorSpan: 7.5,              // teeth spanned by the pallets (Graham)
    // where each arbor sits: direction (degrees, 0 = up, clockwise positive) from the arbor before it
    layout: { centre: [0, 0], barrel: 180, third: 40, escape: "vertical" },   // "vertical": right above the centre arbor
    // the motion work (in front of the front plate): cannon pinion and hour wheel on the centre arbor
    motion: { cannon: 12, minuteWheel: 36, module1: 0.5, minutePinion: 8, hourWheel: 32, module2: 0.6 },
    // the mainspring: turns it can deliver, inside a barrel of this radius
    mainspring: { turns: 6, barrelRadius: 27, arborRadius: 5, coils: 9, strip: 0.45 },
    plates: { depth: 40, thickness: 3 },
    start: { h: 10, m: 8, s: 30 }   // the time shown at t = 0
  };

  // ---- derived geometry
  function pitchRadius(teeth, module) { return teeth * module / 2; }
  function derive(spec) {
    spec = spec || SPEC;
    var t = spec.train, arbors = {}, meshes = [];
    // centre distances: wheel of arbor k with pinion of arbor k+1, at that wheel's module
    for (var k = 0; k + 1 < t.length; k++) {
      var m = t[k].module;
      meshes.push({ wheel: t[k].id, pinion: t[k + 1].id, module: m, wheelTeeth: t[k].wheel, pinionTeeth: t[k + 1].pinion,
        distance: pitchRadius(t[k].wheel, m) + pitchRadius(t[k + 1].pinion, m), ratio: t[k].wheel / t[k + 1].pinion, z: t[k].z });
    }
    // escape wheel module from its tip radius (used for its pinion's mesh with the third wheel: module of the third wheel)
    arbors.centre = { x: spec.layout.centre[0], y: spec.layout.centre[1] };
    function place(from, deg, dist) { var a = deg * Math.PI / 180; return { x: from.x + dist * Math.sin(a), y: from.y + dist * Math.cos(a) }; }
    arbors.barrel = place(arbors.centre, spec.layout.barrel, meshes[0].distance);
    arbors.third = place(arbors.centre, spec.layout.third, meshes[1].distance);
    if (spec.layout.escape === "vertical") {
      var dx = arbors.centre.x - arbors.third.x;
      arbors.escape = { x: arbors.centre.x, y: arbors.third.y + Math.sqrt(meshes[2].distance * meshes[2].distance - dx * dx) };
    } else arbors.escape = place(arbors.third, spec.layout.escape, meshes[2].distance);
    // the anchor: pallets span anchorSpan teeth, symmetric about the line from the escape wheel up to the pallet arbor
    var span = spec.anchorSpan * 2 * Math.PI / t[3].wheel, half = span / 2, R = spec.escapeTipRadius;
    var palletDistance = R / Math.cos(half);
    arbors.pallet = { x: arbors.escape.x, y: arbors.escape.y + palletDistance };
    var pallets = {
      entry: { x: arbors.escape.x - R * Math.sin(half), y: arbors.escape.y + R * Math.cos(half) },
      exit: { x: arbors.escape.x + R * Math.sin(half), y: arbors.escape.y + R * Math.cos(half) },
      radius: R * Math.tan(half)   // distance from the pallet arbor to each pallet: the anchor's arm length
    };
    var mo = spec.motion, mc = pitchRadius(mo.cannon, mo.module1) + pitchRadius(mo.minuteWheel, mo.module1),
      mh = pitchRadius(mo.minutePinion, mo.module2) + pitchRadius(mo.hourWheel, mo.module2);
    arbors.minuteWheel = { x: arbors.centre.x + mc, y: arbors.centre.y };
    var L = G * Math.pow(spec.pendulum.period / (2 * Math.PI), 2) * 1000;   // simple-pendulum length, mm
    // ratios along the train (turns of each arbor per turn of the escape wheel)
    var perEscape = { escape: 1 };
    perEscape.third = perEscape.escape * t[3].pinion / t[2].wheel;
    perEscape.centre = perEscape.third * t[2].pinion / t[1].wheel;
    perEscape.barrel = perEscape.centre * t[1].pinion / t[0].wheel;
    var escapeTurnSeconds = t[3].wheel * spec.pendulum.period;   // one tooth per full swing (half a tooth per beat)
    return { spec: spec, arbors: arbors, meshes: meshes, pallets: pallets, palletDistance: palletDistance,
      motionDistances: { cannonToMinuteWheel: mc, minutePinionToHourWheel: mh },
      pendulumLength: L, perEscape: perEscape, escapeTurnSeconds: escapeTurnSeconds,
      centreTurnSeconds: escapeTurnSeconds / perEscape.centre, barrelTurnSeconds: escapeTurnSeconds / perEscape.barrel,
      hourRatio: (mo.minuteWheel / mo.cannon) * (mo.hourWheel / mo.minutePinion),
      powerReserveHours: spec.mainspring.turns * escapeTurnSeconds / perEscape.barrel / 3600 };
  }

  // ---- kinematics: the angle of every moving part at time t (seconds). Rotation sign: positive is clockwise as seen
  // from the front. The escape wheel is locked most of each beat and turns half a tooth while the pendulum passes the
  // middle (the impulse), as in a deadbeat escapement; every other wheel follows it through the gear ratios.
  var IMPULSE = 0.12;   // half-width of the impulse window, in beats
  function escapeSteps(t, period) {
    var x = 2 * t / period, n = Math.floor(x + IMPULSE), p = Math.min(1, Math.max(0, (x - n + IMPULSE) / (2 * IMPULSE)));
    return n - 1 + p;   // half-teeth advanced since t = 0 (continuous, flat while locked)
  }
  function pose(t, d) {
    d = d || derive();
    var s = d.spec, T = s.pendulum.period, half = Math.PI / s.train[3].wheel;   // half a tooth
    var theta = s.pendulum.amplitude * Math.sin(2 * Math.PI * t / T);
    // each mesh reverses the direction: centre clockwise (it carries the minute hand), so the third wheel turns
    // anticlockwise, the escape wheel clockwise and the barrel anticlockwise
    var esc = half * (escapeSteps(t, T) - escapeSteps(0, T));   // turned since t = 0
    var third = -esc * d.perEscape.third, run = esc * d.perEscape.centre, barrel = -esc * d.perEscape.barrel;
    // the hands: the centre arbor's turn since t = 0, offset to the start time
    var st = s.start, startMin = ((st.h % 12) * 60 + st.m + st.s / 60);
    var minute = 2 * Math.PI * startMin / 60 + run;
    var hour = 2 * Math.PI * startMin / 720 + run / d.hourRatio;
    var mo = s.motion, minuteWheel = -minute * mo.cannon / mo.minuteWheel;
    return { pendulum: theta, anchor: theta, escape: esc, third: third, centre: minute, barrel: barrel,
      minuteHand: minute, hourHand: hour, cannon: minute, minuteWheel: minuteWheel, hourWheel: hour,
      mainspring: barrel / 2, t: t };
  }
  // the time shown by the hands, in hours on the dial (0 to 12)
  function timeShown(p) { var h = (p.hourHand / (2 * Math.PI)) * 12; return ((h % 12) + 12) % 12; }

  return { SPEC: SPEC, G: G, IMPULSE: IMPULSE, derive: derive, pose: pose, escapeSteps: escapeSteps, timeShown: timeShown, pitchRadius: pitchRadius };
});
