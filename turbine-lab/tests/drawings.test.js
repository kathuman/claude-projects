// Turbine Lab drawing checks — run with: node turbine-lab/tests/drawings.test.js
// Every machine has its four rendered views and mapping data; the sections share one standard scale that holds the
// machine; balloons, cutting planes and dimensions refer to real parts and land inside their views; and the page's
// tables (titles, drawing numbers, the view showing the runner end-on) cover the three machines.
const fs = require("fs"), path = require("path");
const MA = require("../src/machines.js");
const dir = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const page = fs.readFileSync(path.join(dir, "drawings.js"), "utf8");
const STANDARD = [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, 125, 150, 200, 250];

for (const m of Object.keys(MA.MACHINES)) {
  const jf = path.join(dir, "drawings", m + ".json");
  check(m + ": mapping data exists", fs.existsSync(jf)); if (!fs.existsSync(jf)) continue;
  const d = JSON.parse(fs.readFileSync(jf, "utf8"));
  for (const v of ["A", "B", "C", "iso"]) {
    const f = path.join(dir, "drawings", m + "-" + v + ".png"), ok = fs.existsSync(f);
    check(m + "-" + v + ".png exists and is a PNG under 600 KB", ok && fs.readFileSync(f).slice(1, 4).toString() === "PNG" && fs.statSync(f).size < 600e3);
  }
  check(m + ": standard scale 1:" + d.scale, STANDARD.includes(d.scale));
  check(m + ": every part drawn is a known part", d.parts.every((k) => MA.PARTS[k]), d.parts.join(","));
  check(m + ": quantities are whole and positive", d.parts.every((k) => Number.isInteger(d.counts[k]) && d.counts[k] >= 1));
  check(m + ": runner diameter is plausible (1–3 m)", d.runnerD > 1 && d.runnerD < 3, d.runnerD);
  for (const v of ["A", "B", "C"]) {
    const w = d.views[v], inside = (p) => p[0] >= 0 && p[0] <= d.res && p[1] >= 0 && p[1] <= d.res;
    check(m + " " + v + ": the same scale as the others", Math.abs(w.ortho - d.scale * d.cellMm / 1000) < 1e-9);
    check(m + " " + v + ": the whole machine fits in the view", w.box[0] >= 0 && w.box[1] >= 0 && w.box[2] <= d.res && w.box[3] <= d.res, w.box.join(","));
    check(m + " " + v + ": the runner centre is in the view", inside(w.center));
    check(m + " " + v + ": cutting planes of the two other sections", Object.keys(w.cuts).sort().join("") === ["A", "B", "C"].filter((x) => x !== v).join(""));
    const n = w.normal, u = w.u, vv = w.v, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    check(m + " " + v + ": view axes are orthonormal and across the cut", Math.abs(dot(u, vv)) < 1e-6 && Math.abs(dot(u, n)) < 1e-6 && Math.abs(dot(vv, n)) < 1e-6);
    check(m + " " + v + ": balloon points are parts and inside the view", Object.entries(w.balloons).every(([k, p]) => d.parts.includes(k) && inside(p)));
  }
  check(m + ": the front section has a balloon for most parts", Object.keys(d.views.A.balloons).length >= d.parts.length - 2, Object.keys(d.views.A.balloons).length + "/" + d.parts.length);
  check(m + ": first-angle — B is seen from the left, C from above", d.views.B.normal[0] === -1 && d.views.C.normal[2] === 1);
  check(m + ": the page has a title and drawing number", new RegExp(m + ": function").test(page) && new RegExp(m + ': "TL-').test(page));
}
const cellOnSheet = Number((page.match(/CELL = (\d+)/) || [])[1]);
for (const m of Object.keys(MA.MACHINES)) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, "drawings", m + ".json"), "utf8"));
  check(m + ": views are printed at the size they were rendered for, so the stated scale holds", cellOnSheet === d.cellMm, cellOnSheet + " mm vs " + d.cellMm + " mm");
}
const cells = [...page.matchAll(/(A|B|C|iso): \[(\d+), (\d+)\]/g)].map((m) => [Number(m[2]), Number(m[3])]);
check("all four views and their labels sit inside the frame (20–410 × 10–287 mm)", cells.length === 4 && cells.every(([x, y]) => x >= 20 && x + cellOnSheet <= 410 && y >= 10 && y + cellOnSheet + 9 <= 287));
check("the page knows which view shows each runner end-on", /RUNNER_VIEW = \{ pelton: "A", francis: "C", kaplan: "B" \}/.test(page));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
