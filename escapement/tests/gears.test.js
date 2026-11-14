// Escapement gear checks — run with: node escapement/tests/gears.test.js
// The gears for the drawing and the manufacturing page match the model (the same tooth formulas as
// blender/build_clock.py), every pair meshes at its centre distance, the cutting data is consistent, the dividing
// settings really divide, and the SVG and DXF files are well formed.
const fs = require("fs"), path = require("path");
const C = require("../src/clock.js"), G = require("../src/gears.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-9);

const d = C.derive(), L = G.list(d), by = {}; L.forEach((g) => { by[g.id] = g; });
check("twelve gears: seven wheels and five pinions", L.length === 12 && L.filter((g) => g.kind === "pinion").length === 5, L.length);

// ---- the same tooth form as the Blender script
const py = fs.readFileSync(path.join(__dirname, "..", "blender", "build_clock.py"), "utf8");
const m1 = py.match(/add, ded = \(([\d.]+), ([\d.]+)\) if wheel else \(([\d.]+), ([\d.]+)\)/);
const m2 = py.match(/half = r - ded \* module, \(([\d.]+) if wheel else ([\d.]+)\) \* module \/ r/);
check("wheel and pinion addendum and dedendum are the model's", m1 && +m1[1] === G.FORM.wheel.addendum && +m1[2] === G.FORM.wheel.dedendum && +m1[3] === G.FORM.pinion.addendum && +m1[4] === G.FORM.pinion.dedendum);
check("tooth thickness at the pitch circle is the model's", m2 && near(+m2[1] * 2, G.FORM.wheel.thickness) && near(+m2[2] * 2, G.FORM.pinion.thickness));
check("the escape wheel's tip and root are the spec's", by.escape.tip === d.spec.escapeTipRadius && by.escape.root === d.spec.escapeRootRadius);
check("the ratchet is the model's (24 teeth, 9.5 to 12 mm)", /range\(24\)/.test(py) && /9\.5 \* math\.cos\(a\)/.test(py) && /12 \* math\.cos\(a \+ 0\.18\)/.test(py) && by.ratchet.tip === 12 && by.ratchet.root === 9.5);

// ---- outlines
for (const g of L) {
  const pts = G.outline(g), r = pts.map((p) => Math.hypot(p[0], p[1])), dm = G.dims(g);
  // the tip is sampled, so the outline may stop up to 0.02 mm short of the tip circle (as in the model)
  check(g.id + ": outline reaches the tip circle and the root circle", Math.max(...r) <= dm.tipD / 2 + 1e-9 && Math.max(...r) > dm.tipD / 2 - 0.02 && near(Math.min(...r), dm.rootD / 2, 1e-6), (dm.tipD / 2 - Math.max(...r)).toFixed(4));
  const per = pts.length / g.teeth;
  check(g.id + ": the same number of points for every tooth", Number.isInteger(per), per);
}

// ---- meshing: every wheel meets its pinion at the centre distance the arbors are placed at
const dist = (a, b) => Math.hypot(d.arbors[a].x - d.arbors[b].x, d.arbors[a].y - d.arbors[b].y);
for (const [w, p] of [["great", "centrePinion"], ["centre", "thirdPinion"], ["third", "escapePinion"], ["cannon", "minuteWheel"], ["minutePinion", "hourWheel"]]) {
  const a = G.dims(by[w]), b = G.dims(by[p]);
  check(w + " meshes with " + p + " at the same module", by[w].module === by[p].module);
  check(w + " and " + p + ": the pitch circles touch at the arbors' distance", near((a.pitchD + b.pitchD) / 2, dist(by[w].arbor, by[p].arbor), 1e-9), ((a.pitchD + b.pitchD) / 2).toFixed(3) + " vs " + dist(by[w].arbor, by[p].arbor).toFixed(3));
  check(w + " and " + p + ": tips clear the other's root", a.addendum < b.dedendum + 1e-9 && b.addendum < a.dedendum + 1e-9);
}

// ---- crossing-out
for (const g of L.filter((g) => g.spokes)) {
  const dm = G.dims(g), w = G.windows(g);
  check(g.id + ": " + dm.spokes + " openings", w.length === dm.spokes);
  check(g.id + ": rim, hub and bore leave metal", dm.rimWidth >= 2 && dm.hubD > dm.bore + 1 && dm.rimInD > dm.hubD + 2, "rim " + dm.rimWidth.toFixed(2) + ", hub " + dm.hubD + ", bore " + dm.bore);
  const r = [].concat(...w).map((p) => Math.hypot(p[0], p[1]));
  check(g.id + ": openings lie between the hub and the rim", Math.min(...r) >= dm.hubD / 2 - 1e-9 && Math.max(...r) <= dm.rimInD / 2 + 1e-9);
}

// ---- dividing
for (const g of L) {
  const ix = G.indexing(g.teeth);
  check(g.id + ": at least one way to divide " + g.teeth, ix.direct || ix.heads.length);
  check(g.id + ": every dividing setting gives exactly 1/" + g.teeth + " turn", ix.heads.every((h) => near((h.turns + (h.circle ? h.holes / h.circle : 0)) / h.ratio, 1 / g.teeth, 1e-12) && (!h.circle || Number.isInteger(h.holes))) &&
    (!ix.direct || ix.direct.holes === ix.direct.step * g.teeth));
}

// ---- files
const svg = G.svg(by.centre);
check("SVG is 1:1 in millimetres", /width='[\d.]+mm' height='[\d.]+mm'/.test(svg) && svg.startsWith("<svg"));
check("SVG holds the outline, the openings and the bore", (svg.match(/Z/g) || []).length === 1 + by.centre.spokes + 1);
const dxf = G.dxf(L);
const lines = dxf.trim().split("\n");
check("DXF has an even number of lines (code, value pairs)", lines.length % 2 === 0);
check("DXF starts with a header and ends with EOF", lines[1] === "SECTION" && lines[lines.length - 1] === "EOF");
const loops = L.reduce((n, g) => n + 1 + G.windows(g).length + (g.bore || g.square ? 1 : 0), 0);
check("DXF has one closed polyline per outline, opening and bore", (dxf.match(/\nPOLYLINE\n/g) || []).length === loops && (dxf.match(/\nSEQEND\n/g) || []).length === loops);
check("DXF reference circles are on their own layer", (dxf.match(/CIRCLE\n8\nREFERENCE/g) || []).length === L.filter((g) => g.module).length);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
