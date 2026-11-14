// Escapement — every gear of the clock, for the gear-train drawing and the manufacturing page (window.ESGears /
// module.exports). The tooth outlines use the same formulas as blender/build_clock.py (tests/gears.test.js checks the
// constants), and the escape wheel is the one src/escapement.js traces, so a gear cut from these files is the gear in the model.
//
//   list(d)        every gear: what it is, its teeth, module, thickness, material, bore, what it meshes with
//   outline(g)     the closed tooth outline, [[x, y], …] in mm, centred on the arbor, seen from the front
//   dims(g)        cutting data: pitch, tip and root diameters, tooth depth, circular pitch, crossing-out sizes
//   windows(g)     the crossing-out (the openings between the spokes), as closed outlines
//   indexing(n)    how to divide a blank into n teeth on a dividing head or a division plate
//   svg(g), dxf(gs) files to cut from, in millimetres
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root.ESClock || require("./clock.js"), root.ESEscapement || require("./escapement.js"));
  else root.ESGears = factory(root.ESClock, root.ESEscapement);
})(typeof self !== "undefined" ? self : this, function (C, E) {
  "use strict";
  var TAU = 2 * Math.PI;

  // tooth form (the clock form used in the model: radial flanks below the pitch circle, rounded tips above it)
  var FORM = {
    wheel: { addendum: 1.35, dedendum: 1.6, thickness: 1.4 },    // in modules; thickness is the tooth's width at the pitch circle
    pinion: { addendum: 0.95, dedendum: 1.4, thickness: 1.1 }
  };

  function list(d) {
    d = d || C.derive();
    var s = d.spec, t = s.train, mo = s.motion, mk = function (o) { return o; };
    return [
      mk({ id: "great", part: "barrel", name: "Great wheel", kind: "wheel", teeth: t[0].wheel, module: t[0].module, thickness: 2.0, spokes: 6, hub: 6.0, bore: 2.4,
        material: "brass", meshes: "centrePinion", arbor: "barrel" }),
      mk({ id: "centrePinion", part: "centre", name: "Centre pinion", kind: "pinion", teeth: t[1].pinion, module: t[0].module, thickness: 3.2, material: "steel", meshes: "great", arbor: "centre" }),
      mk({ id: "centre", part: "centre", name: "Centre wheel", kind: "wheel", teeth: t[1].wheel, module: t[1].module, thickness: 1.6, spokes: 5, hub: 3.0, bore: 2.0,
        material: "brass", meshes: "thirdPinion", arbor: "centre" }),
      mk({ id: "thirdPinion", part: "third", name: "Third pinion", kind: "pinion", teeth: t[2].pinion, module: t[1].module, thickness: 3.2, material: "steel", meshes: "centre", arbor: "third" }),
      mk({ id: "third", part: "third", name: "Third wheel", kind: "wheel", teeth: t[2].wheel, module: t[2].module, thickness: 1.6, spokes: 5, hub: 3.0, bore: 2.0,
        material: "brass", meshes: "escapePinion", arbor: "third" }),
      mk({ id: "escapePinion", part: "escape", name: "Escape pinion", kind: "pinion", teeth: t[3].pinion, module: t[2].module, thickness: 3.2, material: "steel", meshes: "third", arbor: "escape" }),
      mk({ id: "escape", part: "escape", name: "Escape wheel", kind: "escape", teeth: t[3].wheel, module: null, thickness: 1.2, spokes: 4, hub: 2.6, bore: 2.0,
        tip: s.escapeTipRadius, root: s.escapeRootRadius, material: "hard brass or steel", meshes: "pallets", arbor: "escape" }),
      mk({ id: "cannon", part: "cannon", name: "Cannon pinion", kind: "pinion", teeth: mo.cannon, module: mo.module1, thickness: 1.6, bore: 2.0, material: "steel", meshes: "minuteWheel", arbor: "centre" }),
      mk({ id: "minuteWheel", part: "minuteWheel", name: "Minute wheel", kind: "wheel", teeth: mo.minuteWheel, module: mo.module1, thickness: 1.0, spokes: 4, hub: 2.2, bore: 1.8,
        material: "brass", meshes: "cannon", arbor: "minuteWheel" }),
      mk({ id: "minutePinion", part: "minuteWheel", name: "Minute pinion", kind: "pinion", teeth: mo.minutePinion, module: mo.module2, thickness: 2.0, bore: 1.8, material: "steel", meshes: "hourWheel", arbor: "minuteWheel" }),
      mk({ id: "hourWheel", part: "hourWheel", name: "Hour wheel", kind: "wheel", teeth: mo.hourWheel, module: mo.module2, thickness: 1.0, spokes: 4, hub: 3.0, bore: 4.0,
        material: "brass", meshes: "minutePinion", arbor: "centre" }),
      mk({ id: "ratchet", part: "ratchet", name: "Ratchet wheel", kind: "ratchet", teeth: 24, module: null, thickness: 2.0, tip: 12, root: 9.5, square: 3.2,
        material: "steel", meshes: "click", arbor: "barrel" })
    ];
  }

  // ---- outlines (the same point sequences as build_clock.py)
  function toothed(teeth, module, isWheel, samples) {
    var f = isWheel ? FORM.wheel : FORM.pinion, r = teeth * module / 2, rf = r - f.dedendum * module, half = (f.thickness / 2) * module / r;
    var pts = [], k, j;
    for (k = 0; k < teeth; k++) {
      var a = TAU * k / teeth;
      pts.push([rf * Math.cos(a - half), rf * Math.sin(a - half)]);
      for (j = 0; j <= samples; j++) {
        var s = -1 + 2 * j / samples, rr = r + f.addendum * module * Math.sqrt(Math.max(0, 1 - s * s));
        pts.push([rr * Math.cos(a + half * s), rr * Math.sin(a + half * s)]);
      }
      pts.push([rf * Math.cos(a + half), rf * Math.sin(a + half)]);
      var gap = TAU / teeth - 2 * half;
      for (j = 1; j <= 2; j++) { var b = a + half + gap * j / 3; pts.push([rf * Math.cos(b), rf * Math.sin(b)]); }
    }
    return pts;
  }
  function ratchetOutline(teeth, rt, rr0) {
    var pts = [];
    for (var k = 0; k < teeth; k++) {
      var a = TAU * k / teeth;
      pts.push([rr0 * Math.cos(a), rr0 * Math.sin(a)]);
      pts.push([rt * Math.cos(a + 0.18), rt * Math.sin(a + 0.18)]);
    }
    return pts;
  }
  function outline(g) {
    if (g.kind === "escape") return E.wheelOutline();   // Graham teeth, traced to suit the pallets (src/escapement.js)
    if (g.kind === "ratchet") return ratchetOutline(g.teeth, g.tip, g.root);
    return toothed(g.teeth, g.module, g.kind === "wheel", g.kind === "wheel" ? 7 : 5);
  }

  // ---- cutting data
  function dims(g) {
    var o = { teeth: g.teeth, thickness: g.thickness };
    if (g.kind === "wheel" || g.kind === "pinion") {
      var f = FORM[g.kind], m = g.module, r = g.teeth * m / 2;
      o.module = m; o.pitchD = 2 * r; o.tipD = 2 * (r + f.addendum * m); o.rootD = 2 * (r - f.dedendum * m);
      o.addendum = f.addendum * m; o.dedendum = f.dedendum * m; o.depth = (f.addendum + f.dedendum) * m;
      o.circularPitch = Math.PI * m; o.toothThickness = f.thickness * m;
    } else {
      o.tipD = 2 * g.tip; o.rootD = 2 * g.root; o.depth = g.tip - g.root; o.circularPitch = TAU * g.tip / g.teeth;
    }
    o.blankD = o.tipD + 0.2;   // turned a little over size, then trued to the tip diameter on the cutting arbor
    if (g.spokes) {
      var rf = o.rootD / 2;
      o.rimInD = g.kind === "escape" ? 2 * (g.root - 2.0) : 2 * (rf - Math.max(2.2, 0.09 * rf));
      o.rimWidth = (o.rootD - o.rimInD) / 2;
      o.spokeWidth = g.kind === "escape" ? 1.3 : Math.max(1.6, 0.07 * o.rimInD / 2);
      o.hubD = 2 * g.hub; o.spokes = g.spokes;
    }
    if (g.bore) o.bore = g.bore;
    if (g.square) o.square = g.square;
    return o;
  }
  // the openings between the spokes: bounded by the rim, the hub and the two spoke edges
  function windows(g) {
    var dm = dims(g); if (!dm.spokes) return [];
    var rIn = dm.rimInD / 2, rHub = dm.hubD / 2, w = dm.spokeWidth / 2, out = [];
    var a0 = g.kind === "escape" ? Math.PI / 4 : Math.PI / 2;
    for (var k = 0; k < dm.spokes; k++) {
      var s0 = a0 + TAU * k / dm.spokes, s1 = s0 + TAU / dm.spokes, pts = [], j, n = 24;
      var o0 = Math.asin(w / rIn), o1 = Math.asin(w / rHub);
      for (j = 0; j <= n; j++) { var a = (s0 + o0) + (s1 - o0 - s0 - o0) * j / n; pts.push([rIn * Math.cos(a), rIn * Math.sin(a)]); }
      for (j = 0; j <= 8; j++) { var b = (s1 - o1) - (s1 - o1 - s0 - o1) * j / 8; pts.push([rHub * Math.cos(b), rHub * Math.sin(b)]); }
      out.push(pts);
    }
    return out;
  }

  // ---- dividing: a dividing head of ratio R (worm turns per spindle turn) with an index plate, or a division plate
  var PLATES = [15, 16, 17, 18, 19, 20, 21, 23, 24, 27, 29, 30, 31, 33, 36, 37, 39, 41, 43, 47, 49];
  var DIRECT = [24, 30, 36, 48, 60, 72, 84, 96, 120, 144];
  function indexing(n) {
    var res = { teeth: n, direct: null, heads: [] };
    for (var i = 0; i < DIRECT.length; i++) if (DIRECT[i] % n === 0) { res.direct = { holes: DIRECT[i], step: DIRECT[i] / n }; break; }
    [40, 60, 90].forEach(function (R) {
      var whole = Math.floor(R / n), rem = R - whole * n;   // rem / n of a turn after the whole turns
      if (rem === 0) { res.heads.push({ ratio: R, turns: whole, holes: 0, circle: null }); return; }
      for (var j = 0; j < PLATES.length; j++) {
        var h = PLATES[j];
        if ((rem * h) % n === 0) { res.heads.push({ ratio: R, turns: whole, holes: rem * h / n, circle: h }); return; }
      }
    });
    return res;
  }

  // ---- files
  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }
  function pathOf(pts) { return "M" + pts.map(function (p) { return fmt(p[0]) + " " + fmt(-p[1]); }).join("L") + "Z"; }
  function holeOf(g) {
    var dm = dims(g);
    if (dm.square) { var h = dm.square / 2; return [[-h, -h], [h, -h], [h, h], [-h, h]]; }
    if (!dm.bore) return null;
    var r = dm.bore / 2, pts = [];
    for (var k = 0; k < 48; k++) pts.push([r * Math.cos(TAU * k / 48), r * Math.sin(TAU * k / 48)]);
    return pts;
  }
  // the cut outline, crossing-out and bore, 1:1 in millimetres; pitch circle and centre mark in a thin grey reference line
  function svg(g) {
    var dm = dims(g), R = dm.tipD / 2 + 2, size = fmt(2 * R), cut = [outline(g)].concat(windows(g)), h = holeOf(g);
    if (h) cut.push(h);
    var ref = (dm.pitchD ? "<circle cx='0' cy='0' r='" + fmt(dm.pitchD / 2) + "' fill='none' stroke='#999' stroke-width='0.05' stroke-dasharray='0.6 0.3'/>" : "") +
      "<path d='M-1.5 0H1.5M0 -1.5V1.5' stroke='#999' stroke-width='0.05'/>";
    return "<svg xmlns='http://www.w3.org/2000/svg' width='" + size + "mm' height='" + size + "mm' viewBox='" + fmt(-R) + " " + fmt(-R) + " " + size + " " + size + "'>" +
      "<title>" + g.name + " — " + g.teeth + " teeth</title>" + ref +
      "<path d='" + cut.map(pathOf).join("") + "' fill='none' stroke='#000' stroke-width='0.05' fill-rule='evenodd'/></svg>";
  }
  // ASCII DXF (R12): closed polylines on layer CUT, the pitch circle on layer REFERENCE (not to be cut). Several gears
  // are laid out side by side.
  function dxf(gears) {
    var out = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
      "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "2",
      "0", "LAYER", "2", "CUT", "70", "0", "62", "7", "6", "CONTINUOUS",
      "0", "LAYER", "2", "REFERENCE", "70", "0", "62", "8", "6", "CONTINUOUS", "0", "ENDTAB", "0", "ENDSEC",
      "0", "SECTION", "2", "ENTITIES"];
    var x0 = 0;
    gears.forEach(function (g) {
      var dm = dims(g), R = dm.tipD / 2, cx = x0 + R, loops = [outline(g)].concat(windows(g)), h = holeOf(g);
      if (h) loops.push(h);
      loops.forEach(function (pts) {
        out.push("0", "POLYLINE", "8", "CUT", "66", "1", "70", "1", "10", "0", "20", "0", "30", "0");
        pts.forEach(function (p) { out.push("0", "VERTEX", "8", "CUT", "10", fmt(cx + p[0]), "20", fmt(p[1]), "30", "0"); });
        out.push("0", "SEQEND", "8", "CUT");
      });
      if (dm.pitchD) out.push("0", "CIRCLE", "8", "REFERENCE", "10", fmt(cx), "20", "0", "30", "0", "40", fmt(dm.pitchD / 2));
      x0 += 2 * R + 6;
    });
    out.push("0", "ENDSEC", "0", "EOF");
    return out.join("\n") + "\n";
  }

  // closed outlines (mm, as given) on layer CUT
  function dxfLoops(loops) {
    var out = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
    loops.forEach(function (pts) {
      out.push("0", "POLYLINE", "8", "CUT", "66", "1", "70", "1", "10", "0", "20", "0", "30", "0");
      pts.forEach(function (p) { out.push("0", "VERTEX", "8", "CUT", "10", fmt(p[0]), "20", fmt(p[1]), "30", "0"); });
      out.push("0", "SEQEND", "8", "CUT");
    });
    out.push("0", "ENDSEC", "0", "EOF");
    return out.join("\n") + "\n";
  }

  return { dxfLoops: dxfLoops, FORM: FORM, list: list, outline: outline, dims: dims, windows: windows, indexing: indexing, svg: svg, dxf: dxf, PLATES: PLATES, DIRECT: DIRECT };
});
