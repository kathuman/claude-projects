// The FreeCAD model (freecad/create_model.py) and the web app (web/src/calculations.js)
// must derive the same layout. This runs both on the same random designs and compares.
// Needs a system Python 3 (not FreeCAD):  node warehouse-model/tests/parity.test.js
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const calc = require("../web/src/calculations.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parameters.json"), "utf8"));
const designs = [];
for (let n = 0; n < 400; n++) {
  const q = {};
  for (const k in data.parameters) {
    const d = data.parameters[k];
    if (d.type === "choice") q[k] = n === 0 ? d.value : d.options[Math.floor(Math.random() * d.options.length)];
    else if (n === 0) q[k] = d.value;
    else if (d.unit === "count") q[k] = Math.round(d.minimum + Math.random() * (d.maximum - d.minimum));
    else q[k] = +(d.minimum + Math.random() * (d.maximum - d.minimum)).toFixed(2);
  }
  designs.push(q);
}
const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const out = JSON.parse(execFileSync(py, [path.join(__dirname, "parity_layout.py")], { input: JSON.stringify(designs), maxBuffer: 64 << 20 }).toString());

let pass = 0, fail = 0;
const near = (a, b) => Math.abs(a - b) < 1e-9;
designs.forEach((q, i) => {
  const js = calc.computeAll(q, data.rack_types), f = out[i];
  const pairs = [
    ["bays_per_row", js.layout.baysPerRow], ["rack_row_length", js.layout.rackRowLength], ["row_depth", js.layout.rowDepth],
    ["num_aisle_units", js.layout.numAisleUnits], ["num_rack_rows", js.layout.numRackRows], ["racking_width_used", js.layout.rackingWidthUsed],
    ["level_pitch", js.layout.levelPitch], ["positions_per_bay", js.capacity.positionsPerBay], ["storage_capacity", js.capacity.storageCapacity]
  ];
  let ok = pairs.every(([k, v]) => near(f[k], v));
  ok = ok && f.rows.length === js.layout.rows.length && f.rows.every((r, j) => near(r.y, js.layout.rows[j].y) && near(r.depth, js.layout.rows[j].depth) && r.faces === js.layout.rows[j].faces);
  if (ok) pass++; else { fail++; if (fail < 4) console.log("MISMATCH", JSON.stringify(q), JSON.stringify(pairs.filter(([k, v]) => !near(f[k], v)).map(([k, v]) => [k, f[k], v]))); }
});
console.log("baseline (FreeCAD script): capacity " + out[0].storage_capacity + ", " + out[0].num_rack_rows + " rows");
console.log(pass + "/" + (pass + fail) + " designs identical in FreeCAD script and web app");
process.exit(fail ? 1 : 0);
