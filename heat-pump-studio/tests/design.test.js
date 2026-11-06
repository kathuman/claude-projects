// Heat Pump Studio 1.2 checks — run with: node heat-pump-studio/tests/design.test.js
// Heat exchanger selection (plates, channel velocity, air coil) and the installation diagram for every combination
// of source, emitter, installation and hot water.
const SY = require("../src/system.js"), DG = require("../src/diagram.js");
let pass = 0, fail = 0;
function check(n, c, d) { if (c) pass++; else fail++; if (!c || process.env.VERBOSE) console.log((c ? "ok   " : "FAIL ") + n + (d !== undefined ? "  → " + d : "")); }

// ---- plate heat exchangers
const cases = [[0.53, 0.282], [1.2, 0.39], [5, 2.4], [40, 20], [300, 150]];
for (const [a, f] of cases) {
  const p = SY.plateHX(a, f);
  check(`${a} m², ${f} L/s: velocity in the 0.1–0.8 m/s band`, p.ok, p.velocity.toFixed(2));
  check(`${a} m², ${f} L/s: enough plate area`, p.units * (p.plates - 2) * SY.PLATES.find((x) => x.name === p.size).area >= a * 0.999 || p.plates === 10);
  check(`${a} m², ${f} L/s: at most 200 plates per unit`, p.plates <= 200);
  check(`${a} m², ${f} L/s: velocity = flow / (channels · width · gap)`, Math.abs(p.velocity - f / 1000 / (p.channels * p.width * 0.002)) < 1e-12);
}
check("bigger duties pick bigger plates", SY.PLATES.findIndex((x) => x.name === SY.plateHX(300, 150).size) > SY.PLATES.findIndex((x) => x.name === SY.plateHX(0.53, 0.282).size));
check("no area or no flow: no selection", SY.plateHX(0, 1) === null && SY.plateHX(1, 0) === null);
const coil = SY.airCoil(21.3, 0.818);
check("air coil: face area at 2.5 m/s", Math.abs(coil.face - 0.818 / 2.5) < 1e-12);
check("air coil: rows cover the area", coil.rows * coil.face * (2 / 0.0025 * 0.022) >= 21.3 && (coil.rows - 1) * coil.face * (2 / 0.0025 * 0.022) < 21.3, coil.rows);

// ---- the diagram
const C = { bg: "#000", panel: "#111", ink: "#fff", dim: "#999", line: "#555", hot: "#f00", cold: "#00f", liquid: "#fa0", mixed: "#0af", source: "#0f0", sourceOut: "#888", ground: "#640" };
const labels = { title: "t", compressor: "Compressor", valve: "Valve", evap: "Evaporator", cond: "Condenser", fan: "Fan", srcPump: "Pump", circPump: "Circ", backup: "Heater",
  emitter: "Emitters", tank: "Tank", boundary: "Box", groundLine: "2 boreholes" };
const values = { comp1: "3 kW", comp2: "100 cm3", srcHead: "Air", src1: "in", src2: "flow", sinkHead: "flow 45", sink1: "L/s", sink2: "heat", dhw1: "dhw", dhw2: "55",
  s1: "S1VAL", s2: "S2VAL", s3: "S3VAL", s4: "S4VAL", evapQ: "EQ", condQ: "CQ" };
let n = 0;
for (const source of ["air", "ground", "water", "waste"]) for (const sink of ["floor", "radiator"]) for (const install of ["outdoor", "indoor", "plant"]) for (const dhw of [true, false]) {
  const s = DG.svg({ source, sink, install, dhw, labels, values, colors: C, T: (x) => x }); n++;
  const tag = `${source}/${sink}/${install}/${dhw ? "dhw" : "no dhw"}`;
  const opens = (s.match(/<text\b/g) || []).length, closes = (s.match(/<\/text>/g) || []).length;
  check(tag + ": well-formed text elements", opens === closes && s.startsWith("<svg") && s.endsWith("</svg>"));
  check(tag + ": shows all four state values", ["S1VAL", "S2VAL", "S3VAL", "S4VAL"].every((v) => s.includes(v)));
  check(tag + ": no undefined or NaN", !/undefined|NaN/.test(s));
  check(tag + ": tank only with hot water", s.includes(">Tank<") === dhw);
  check(tag + ": fan only for air, pump otherwise", s.includes(">Fan<") === (source === "air") && s.includes(">Pump<") === (source !== "air"));
  check(tag + ": ground line only for ground and water", s.includes("2 boreholes") === (source === "ground" || source === "water"));
}
check("48 diagram variants drawn", n === 48);
console.log(pass + " passed, " + fail + " failed"); process.exit(fail ? 1 : 0);
