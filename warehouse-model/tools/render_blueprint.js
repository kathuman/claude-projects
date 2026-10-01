// Writes web/assets/blueprint.svg — the floor plan of the baseline design
// (data/parameters.json defaults). The drawing itself lives in
// web/src/blueprint.js, which the page also uses to redraw the plan live;
// this tool just renders it once for a static copy (README, sharing).
// Run from anywhere: `node warehouse-model/tools/render_blueprint.js`.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const calc = require(path.join(ROOT, "web/src/calculations.js"));
const renderBlueprint = require(path.join(ROOT, "web/src/blueprint.js"));

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parameters.json"), "utf8"));
const p = {};
for (const k in data.parameters) p[k] = data.parameters[k].value;
const results = calc.computeAll(p, data.rack_types);

const svg = renderBlueprint(p, results, { title: "WAREHOUSE MODEL — FLOOR PLAN (BASELINE)" });
const outPath = path.join(ROOT, "web/assets/blueprint.svg");
fs.writeFileSync(outPath, svg);
console.log("Wrote", outPath, "(" + fs.statSync(outPath).size + " bytes)");
console.log("storage_capacity=" + results.capacity.storageCapacity, " rack_rows=" + results.layout.numRackRows);
