// Writes the mechanism (specification, derived geometry and the kinematic constants) as JSON for the Blender build
// script: node escapement/tools/spec_json.js > escapement/blender/spec.json
const C = require("../src/clock.js"), E = require("../src/escapement.js");
const d = C.derive();
process.stdout.write(JSON.stringify({ spec: d.spec, arbors: d.arbors, meshes: d.meshes, pallets: d.pallets, palletDistance: d.palletDistance,
  pendulumLength: d.pendulumLength, perEscape: d.perEscape, hourRatio: d.hourRatio, impulse: C.IMPULSE,
  pitch: Object.fromEntries(d.spec.train.map((s) => [s.id, { wheel: s.wheel ? C.pitchRadius(s.wheel, s.module || 0) : null }])),
  // the escape wheel's teeth and the anchor, traced from the motion (src/escapement.js), in mm, rounded to 1 µm
  escapement: (function () {
    const G = E.geometry(d), r = (pts) => pts.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
    return { wheel: r(G.wheel), entry: r(G.entry), exit: r(G.exit), arms: G.arms.map(r), hubRadius: G.hubRadius, palletThickness: G.palletThickness };
  })() }, null, 1) + "\n");
