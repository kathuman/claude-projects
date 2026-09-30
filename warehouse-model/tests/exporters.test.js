// Tests for web/src/exporters.js — run with:  node warehouse-model/tests/exporters.test.js
// The IFC file is also validated by IfcOpenShell inside FreeCAD when freecadcmd is available
// (set FREECADCMD to its path; on Windows the default FreeCAD 1.1 location is tried).
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFileSync } = require("child_process");
const calc = require("../web/src/calculations.js");
const ex = require("../web/src/exporters.js");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parameters.json"), "utf8"));
const RT = data.rack_types;
const base = {};
for (const k in data.parameters) base[k] = data.parameters[k].value;
const withP = (o) => Object.assign({}, base, o);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}

// ---------------------------------------------------------------- GUIDs
const G = new Set();
let fmtOK = true;
for (let i = 0; i < 20000; i++) { const g = ex.ifcGuid(1234, i); if (!/^[0-3][0-9A-Za-z_$]{21}$/.test(g)) fmtOK = false; G.add(g); }
check("IFC GlobalIds: 22 chars of the IFC alphabet, first 0–3", fmtOK);
check("IFC GlobalIds: 20,000 unique", G.size === 20000);

// ---------------------------------------------------------------- IFC structure, several designs
const designs = [
  ["baseline", base],
  ["U-flow, double-deep, 2 mid aisles", withP({ flow_layout: "u_flow", rack_type: "double_deep", aisle_width: 3, mid_cross_aisles: 2, warehouse_length: 160 })],
  ["VNA, 8 levels", withP({ rack_type: "vna", aisle_width: 1.8, levels_per_rack: 8, rack_height: 12.6, clear_height: 15 })]
];
const fcPath = process.env.FREECADCMD || (process.platform === "win32" ? "C:/Program Files/FreeCAD 1.1/bin/freecadcmd.exe" : "freecadcmd");
const haveFC = (() => { try { return fs.existsSync(fcPath) || execFileSync(fcPath, ["--version"], { stdio: "pipe" }) !== null; } catch (e) { return false; } })();

designs.forEach(([name, q]) => {
  const r = calc.computeAll(q, RT), L = r.layout;
  const txt = ex.toIFC(q, r, { version: "7.0.0", timestamp: "2026-09-29T12:00:00" });
  const lines = txt.trim().split("\n");
  check(name + ": ISO 10303-21 envelope and IFC4 schema", lines[0] === "ISO-10303-21;" && txt.includes("FILE_SCHEMA(('IFC4'));") && lines[lines.length - 1] === "END-ISO-10303-21;");
  const ids = new Set(), refs = [];
  let dataOK = true;
  lines.slice(lines.indexOf("DATA;") + 1, lines.indexOf("ENDSEC;", lines.indexOf("DATA;"))).forEach((l) => {
    const m = l.match(/^#(\d+)=([A-Z0-9]+)\((.*)\);$/);
    if (!m) { dataOK = false; return; }
    ids.add(m[1]);
    (m[3].replace(/'(?:[^']|'')*'/g, "").match(/#\d+/g) || []).forEach((x) => refs.push(x.slice(1)));
  });
  check(name + ": every data line is #n=ENTITY(...);", dataOK);
  check(name + ": every #reference points at a defined entity", refs.every((x) => ids.has(x)), refs.filter((x) => !ids.has(x)).slice(0, 3));
  const count = (t) => (txt.match(new RegExp("=" + t + "\\(", "g")) || []).length;
  const segs = L.segments.filter((s) => s.bays > 0).length;
  const D = calc.doorSets(q);
  check(name + ": one rack element per row per segment", count("IFCFURNITURE") === L.numRackRows * segs, count("IFCFURNITURE") + " vs " + L.numRackRows * segs);
  check(name + ": all dock doors", count("IFCDOOR") === D.inY.length + D.outY.length);
  check(name + ": 4 walls, floor + roof slabs, spaces incl. mid cross-aisles", count("IFCWALL") === 4 && count("IFCSLAB") === 2 && count("IFCSPACE") === 2 + L.segments.length - 1);
  const gids = txt.match(/\((\'[0-3][0-9A-Za-z_$]{21}\')/g) || [];
  check(name + ": GlobalIds unique within the file", new Set(gids).size === gids.length && gids.length > 10);

  // independent validation with IfcOpenShell (FreeCAD's Python)
  if (haveFC) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wh-ifc-"));
    const f = path.join(tmp, "design.ifc"), e = path.join(tmp, "expected.json");
    fs.writeFileSync(f, txt); fs.writeFileSync(e, JSON.stringify({}));
    let res = null;
    try {
      const outp = execFileSync(fcPath, [path.join(__dirname, "ifc_check.py"), f, e], { stdio: "pipe", timeout: 180000 }).toString();
      const line = outp.split(/\r?\n/).find((l) => l.startsWith("IFCCHECK "));
      res = line ? JSON.parse(line.slice(9)) : { ok: false, error: "no output" };
    } catch (err) { res = { ok: false, error: String(err).slice(0, 200) }; }
    check(name + ": IfcOpenShell opens it", res.ok, res.error);
    if (res.ok) {
      check(name + ": IfcOpenShell schema validation — no issues", res.n_issues === 0, JSON.stringify(res.validation_issues));
      check(name + ": spatial structure (1 project, 1 storey, everything contained)", res.projects === 1 && res.storeys === 1 && res.contained === 6 + res.racks + res.doors);
      check(name + ": every product's geometry builds", res.built === 6 + res.racks + res.doors + res.spaces, res.built);
      const WT = q.wall_thickness / 1000;
      check(name + ": walls enclose the building (outer size, height)", Math.abs(res.outer[0] - (q.warehouse_length + 2 * WT)) < 1e-3 && Math.abs(res.outer[1] - (q.warehouse_width + 2 * WT)) < 1e-3 && Math.abs(res.outer[2] - q.clear_height) < 1e-3, JSON.stringify(res.outer));
      const rackArea = L.rows.length * L.segments.filter((s) => s.bays > 0).reduce((a, s) => a + s.length, 0) * L.rowDepth;
      check(name + ": rack footprint in the IFC = the model's", Math.abs(res.rack_area - rackArea) < 0.05, res.rack_area + " vs " + rackArea.toFixed(2));
      check(name + ": property sets carry the capacity (building + per rack)", res.positions === r.capacity.storageCapacity && res.rack_positions_sum === r.capacity.storageCapacity);
    }
  }
});
if (!haveFC) console.log("(FreeCAD not found — IfcOpenShell validation skipped)");

// ---------------------------------------------------------------- DXF
{
  const q = withP({ mid_cross_aisles: 1, warehouse_length: 140 }), r = calc.computeAll(q, RT), L = r.layout;
  const dxf = ex.toDXF(q, r), t = dxf.split("\r\n"); t.pop();
  check("DXF: even number of lines (group code / value pairs)", t.length % 2 === 0);
  let codesOK = true; for (let i = 0; i < t.length; i += 2) if (!/^\s*-?\d+$/.test(t[i])) codesOK = false;
  check("DXF: every group code is an integer", codesOK);
  const pairs = []; for (let i = 0; i < t.length; i += 2) pairs.push([+t[i], t[i + 1]]);
  const sections = pairs.filter((pp) => pp[0] === 2 && ["HEADER", "TABLES", "ENTITIES"].includes(pp[1])).map((pp) => pp[1]);
  check("DXF: HEADER, TABLES, ENTITIES sections and EOF", sections.join() === "HEADER,TABLES,ENTITIES" && pairs[pairs.length - 1][1] === "EOF");
  check("DXF: R12 (AC1009)", pairs.some((pp) => pp[1] === "AC1009"));
  const layers = []; for (let i = 0; i < pairs.length - 1; i++) if (pairs[i][0] === 0 && pairs[i][1] === "LINE") { const lay = pairs[i + 1]; layers.push(lay[1]); }
  const segs = L.segments.filter((s) => s.bays > 0);
  const rackLines = L.rows.length * segs.reduce((a, s) => a + 4 + (s.bays - 1), 0);
  check("DXF: rack outlines + bay divisions on A-RACK", layers.filter((l) => l === "A-RACK").length === rackLines, layers.filter((l) => l === "A-RACK").length + " vs " + rackLines);
  const xs = pairs.filter((pp) => pp[0] === 10 || pp[0] === 11).map((pp) => +pp[1]);
  const WT = q.wall_thickness / 1000;
  check("DXF: drawing spans the building (outer wall)", Math.abs(Math.min(...xs.filter((x) => x > -WT - 1)) + WT) < 1e-3 || xs.includes(-WT));
  if (haveFC) {
    // FreeCAD's own DXF importer must read it back, at the right size
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wh-dxf-")), f = path.join(tmp, "plan.dxf");
    fs.writeFileSync(f, dxf);
    let line = "";
    try { line = execFileSync(fcPath, [path.join(__dirname, "dxf_check.py"), f], { stdio: "pipe", timeout: 300000 }).toString().split(/\r?\n/).find((l) => /DXFCHECK/.test(l)) || ""; } catch (e) { line = String(e).slice(0, 200); }
    const m = line.match(/DXFCHECK (\d+) ([\d.]+) ([\d.]+)/);
    check("DXF: FreeCAD imports it", !!m && +m[1] > rackLines, line.slice(-120));
    if (m) check("DXF: imported drawing is the outer building size", Math.abs(+m[2] - (q.warehouse_length + 2 * WT)) < 1e-3 && Math.abs(+m[3] - (q.warehouse_width + 2 * WT)) < 1e-3, m[2] + " × " + m[3]);
  }
}

// ---------------------------------------------------------------- FreeCAD command
{
  const cmd = ex.freecadCommand(withP({ rack_type: "vna", aisle_width: 1.8 }), base);
  check("FreeCAD command lists only changed parameters", cmd === "freecadcmd freecad/create_model.py --set rack_type=vna --set aisle_width=1.8", cmd);
  check("FreeCAD command for the defaults has no --set", ex.freecadCommand(base, base) === "freecadcmd freecad/create_model.py");
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
