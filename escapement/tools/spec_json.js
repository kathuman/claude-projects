// Writes the mechanism (specification, derived geometry and the kinematic constants) as JSON for the Blender build
// script: node escapement/tools/spec_json.js > escapement/blender/spec.json
const C = require("../src/clock.js");
const d = C.derive();
process.stdout.write(JSON.stringify({ spec: d.spec, arbors: d.arbors, meshes: d.meshes, pallets: d.pallets, palletDistance: d.palletDistance,
  pendulumLength: d.pendulumLength, perEscape: d.perEscape, hourRatio: d.hourRatio, impulse: C.IMPULSE,
  pitch: Object.fromEntries(d.spec.train.map((s) => [s.id, { wheel: s.wheel ? C.pitchRadius(s.wheel, s.module || 0) : null }])) }, null, 1) + "\n");
