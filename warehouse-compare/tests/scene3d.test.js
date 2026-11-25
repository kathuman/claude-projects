// What the 3D view draws — run with:  node warehouse-compare/tests/scene3d.test.js
const path = require("path");
const fs = require("fs");
const scenario = require("../src/scenario.js");
const scene3d = require("../src/scene3d.js");
const { check, near, summary } = require("./harness.js");

const J = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
const inputs = scenario.resolve(J, JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8")));
const res = scenario.run(inputs);

["A", "B", "C"].forEach((id) => {
  const r = res[id], s = scene3d.spec(r, inputs), L = r.layout;
  check(id + ": one box per bay", s.boxes.length === L.bays.length);
  check(id + ": one marker per picking point", s.depots.length === L.depots.length);
  check(id + ": every box stands inside the building", s.boxes.every((b) => b.x >= s.size.x0 - 1e-6 && b.x <= s.size.x1 + 1e-6 && b.z >= s.size.z0 - 1e-6 && b.z <= s.size.z1 + 1e-6));
  check(id + ": every box has a size", s.boxes.every((b) => b.w > 0 && b.d > 0 && b.h > 0));
  // plan y becomes −z: a box's centre maps back to its bay's
  check(id + ": plan (x, y) → (x, −z)", s.boxes.every((b, i) => near(b.x, L.bays[i].cx) && near(b.z, -L.bays[i].cy)));
  check(id + ": the rotation is the bay's width direction", s.boxes.every((b, i) => near(Math.cos(b.rot), L.bays[i].ux, 1e-12) && near(Math.sin(b.rot), L.bays[i].uy, 1e-12)));
});
{
  const s = scene3d.spec(res.A, inputs), L = res.A.layout, A = inputs.layouts.A;
  const empty = s.boxes.filter((b) => b.empty).length, occ = res.A.run._state.slotOcc;
  const stored = Array.from(res.A.podSlot).filter((sl, p) => occ[sl] === p).length;
  check("A: empty slots = slots − pods standing in one at the end (" + empty + " = " + L.slots.length + " − " + stored + ")", empty === L.slots.length - stored);
  check("A: a slot shows the pod that is really in it", s.boxes.every((b, i) => b.empty === (occ[i] < 0)));
  check("A: pods are pod_levels × 0.45 m on a 0.3 m base", s.boxes.filter((b) => !b.empty).every((b) => near(b.h, 0.3 + A.pod_levels * 0.45)));
  const c = scene3d.spec(res.C, inputs), C = inputs.layouts.C;
  check("C: shelving to the top of the top load", c.boxes.every((b) => near(b.h, C.rack_height + C.load_height)) && c.boxes.every((b) => b.rot === 0));
  const b = scene3d.spec(res.B, inputs);
  check("B: semicircle bays point every way (rotations span > 90°)", Math.max(...b.boxes.map((x) => x.rot)) - Math.min(...b.boxes.map((x) => x.rot)) > Math.PI / 2);
}

summary("scene3d");
