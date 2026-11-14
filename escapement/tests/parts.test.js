// Escapement parts checks — run with: node escapement/tests/parts.test.js
// The parts catalogue (src/parts.js) and the exported model (models/clock.glb) agree: every mesh in the model belongs
// to a part, every part's nodes are in the model, every moving node is there and turns about its own local Y axis
// (Blender's local Z after the glTF Y-up export), and the page moves exactly the parts the Blender drivers move,
// with the same start convention as blender/check_motion.py.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
const P = require("../src/parts.js"), C = require("../src/clock.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

// ---- the model's nodes
const glb = fs.readFileSync(path.join(dir, "models", "clock.glb"));
check("the model is a glTF binary", glb.toString("ascii", 0, 4) === "glTF");
const gltf = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
const byName = {}; gltf.nodes.forEach((n) => { byName[n.name] = n; });
const meshNodes = gltf.nodes.filter((n) => n.mesh != null).map((n) => n.name);
const partNodes = [].concat(...Object.values(P.PARTS).map((p) => p.nodes));
check("every mesh in the model belongs to a part", meshNodes.every((n) => partNodes.includes(n)), meshNodes.filter((n) => !partNodes.includes(n)).join(", "));
check("every part's nodes are in the model", partNodes.every((n) => byName[n]), partNodes.filter((n) => !byName[n]).join(", "));
check("no node belongs to two parts", new Set(partNodes).size === partNodes.length);

// ---- names as three.js sees them
const core = fs.readFileSync(path.join(dir, "vendor", "three", "three.core.js"), "utf8");
check("three.js drops the same characters from names as parts.js expects", core.includes("const _RESERVED_CHARS_RE = '\\\\[\\\\]\\\\.:\\\\/';"));
check("names are sanitized like three.js does", P.nodeName("Frame: back plate") === "Frame_back_plate" && P.nodeName("Anchor (pallets)") === "Anchor_(pallets)");
const sanitized = gltf.nodes.map((n) => P.nodeName(n.name));
check("sanitized node names stay unique", new Set(sanitized).size === sanitized.length);

// ---- what moves
const blender = fs.readFileSync(path.join(dir, "blender", "check_motion.py"), "utf8");
const bParts = {}; for (const m of blender.match(/PARTS = \{([\s\S]*?)\}/)[1].matchAll(/"([^"]+)": "(\w+)"/g)) bParts[m[1]] = m[2];
const bRel = [...blender.match(/RELATIVE = \{([^}]*)\}/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
check("the page moves the same parts as the Blender drivers", JSON.stringify(Object.keys(P.MOVES).sort()) === JSON.stringify(Object.keys(bParts).sort()));
check("each moving part takes the same angle as in Blender", Object.keys(P.MOVES).every((n) => P.MOVES[n].key === bParts[n]));
check("the same parts are measured from t = 0 as in Blender", Object.keys(P.MOVES).every((n) => !!P.MOVES[n].run === bRel.includes(P.MOVES[n].key)));
const pose = C.pose(0);
check("every moving part has an angle in the pose", Object.values(P.MOVES).every((m) => typeof pose[m.key] === "number"));
const offAxis = Object.keys(P.MOVES).filter((n) => { const q = byName[n].rotation || [0, 0, 0, 1]; return Math.abs(q[0]) > 1e-6 || Math.abs(q[2]) > 1e-6; });
check("every moving node turns only about its local Y axis", !offAxis.length, offAxis.join(", "));
check("the crutch rides on the anchor", (byName["Anchor (pallets)"].children || []).some((i) => gltf.nodes[i].name === "Crutch"));

// ---- the power path
check("the power path runs from the mainspring to the pendulum", P.POWER_PATH[0] === "mainspring" && P.POWER_PATH[P.POWER_PATH.length - 1] === "pendulum");
check("the hands branch starts at the centre wheel", P.HANDS_PATH[0] === "centre" && P.POWER_PATH.includes("centre"));
check("every part on the paths exists", P.POWER_PATH.concat(P.HANDS_PATH).every((k) => P.PARTS[k]));
check("every part has a group, name, role and explanation", Object.values(P.PARTS).every((p) => P.GROUPS.some((g) => g.id === p.group) && p.name && p.role && p.text.length > 60));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
