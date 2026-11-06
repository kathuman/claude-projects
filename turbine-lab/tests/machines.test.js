// Turbine Lab model checks — run with: node turbine-lab/tests/machines.test.js
// Reads the exported models (models/*.glb) and checks that the page will find everything it drives: every mesh has a
// part (or is a hidden particle emitter), every part in the lists has a name and a role and appears in its model, and
// the runners, gates, blade pivots, needle, jet and cameras named in app.js exist.
const fs = require("fs"), path = require("path");
const MA = require("../src/machines.js");
const dir = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

function gltf(file) {
  const b = fs.readFileSync(path.join(dir, file));
  check(file + " is a glTF binary", b.readUInt32LE(0) === 0x46546c67 && b.readUInt32LE(4) === 2);
  return JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString("utf8"));
}
// three.js renames nodes the same way (PropertyBinding.sanitizeNodeName): spaces → _, and . : / [ ] removed
const clean = (n) => String(n).replace(/\s/g, "_").replace(/[\[\]\.:\/]/g, "");

const app = fs.readFileSync(path.join(dir, "app.js"), "utf8");
const needed = { pelton: ["Runner", "Spear_Needle", "Water_Jet", "Cam_Overview", "Cam_Turbine_Closeup"],
  francis: ["River_Francis_Runner", "Wind_Francis_Runner", "Cam_Overview", "Cam_River_Closeup", "Cam_Wind"],
  kaplan: ["River_Kaplan_Runner", "Wind_Kaplan_Runner", "Cam_Overview", "Cam_River_Closeup", "Cam_Wind"] };

for (const [id, m] of Object.entries(MA.MACHINES)) {
  const g = gltf(m.file), names = g.nodes.map((n) => clean(n.name));
  const meshes = g.nodes.filter((n) => n.mesh !== undefined).map((n) => clean(n.name));
  const unlabelled = meshes.filter((n) => !MA.partOf(n) && !/Emitter/.test(n));
  check(id + ": every mesh is a labelled part", !unlabelled.length, unlabelled.join(", "));
  for (const n of needed[id]) {
    check(id + ": has " + n, names.includes(n));
    check(id + ": app.js drives " + n, app.includes('"' + n + '"'));
  }
  const used = new Set(meshes.map(MA.partOf).filter(Boolean));
  for (const list of [id, id + "_wind"]) {
    if (!MA.LISTS[list]) continue;
    const missing = MA.LISTS[list].filter((k) => !used.has(k));
    check(list + ": every listed part is in the model", !missing.length, missing.join(", "));
  }
  check(id + ": no light or default cube left in the export", !names.includes("Cube") && !(g.extensionsUsed || []).includes("KHR_lights_punctual"));
  if (id === "francis") check("francis: 20 wicket gates in each twin", names.filter((n) => /^River_Francis_Wicket_Gate_\d+$/.test(n)).length === 20 && names.filter((n) => /^Wind_Francis_Wicket_Gate_\d+$/.test(n)).length === 20);
  if (id === "kaplan") check("kaplan: 5 blade pivots in each twin", names.filter((n) => /^River_Kaplan_Blade_Pivot_\d$/.test(n)).length === 5 && names.filter((n) => /^Wind_Kaplan_Blade_Pivot_\d$/.test(n)).length === 5);
  check(id + ": the model is under 5 MB", fs.statSync(path.join(dir, m.file)).size < 5e6);
}

// parts table
const listed = new Set(Object.values(MA.LISTS).flat());
check("every listed part has a name and a role", [...listed].every((k) => MA.PARTS[k] && MA.PARTS[k][0] && MA.PARTS[k][1].length > 5));
check("no part is defined but never listed", Object.keys(MA.PARTS).every((k) => listed.has(k)), Object.keys(MA.PARTS).filter((k) => !listed.has(k)).join(", "));
check("name patterns: a few spot checks",
  MA.partOf("Bucket_07") === "bucket" && MA.partOf("Bucket_Arm_07") === "runner_p" && MA.partOf("River_Francis_Wicket_Gate_03") === "gates" &&
  MA.partOf("Wind_Kaplan_Blade_2") === "blades" && MA.partOf("Tower_Door") === "tower" && MA.partOf("Tower_2_Insulator_1") === "lines" &&
  MA.partOf("Nozzle_Tip") === "nozzle" && MA.partOf("Water_Jet") === "jet" && MA.partOf("Jet_Spray_Emitter") === null);

// operating figures
for (const [id, m] of Object.entries(MA.MACHINES)) for (const med of ["water", "wind"]) {
  const p = m[med]; if (!p) continue;
  if (p.drive === "head") check(id + " " + med + ": head range holds the default", p.Hmin < p.H && p.H < p.Hmax && p.Qrated > 0 && p.D > 0);
  else check(id + " " + med + ": in-stream figures are sane", p.vRated > 0 && p.cpMax > 0 && p.cpMax < 16 / 27 && p.D > 0);
}
check("Pelton has no wind twin", !MA.MACHINES.pelton.wind);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
