// Turbine Lab — the page: three.js viewer for the three Blender models, the operating panel and the three charts.
// The physics is in src/physics.js (TLphys), the machines and their parts in src/machines.js (TLmach), languages in
// i18n.js (TLi18n). Every user-visible message goes through T(english, vars).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

var VERSION = "1.0.0";
const I18 = window.TLi18n, T = I18.T, fx = I18.fx, PH = window.TLphys, MA = window.TLmach;
const $ = (id) => document.getElementById(id);
// part names and roles: translated per part key (TL_ES.P / TL_DA.P), English from src/machines.js
const PDICT = I18.lang === "es" ? (window.TL_ES || {}).P : I18.lang === "da" ? (window.TL_DA || {}).P : null;
const partName = (k) => (PDICT && PDICT[k] ? PDICT[k][0] : MA.PARTS[k][0]);
const partRole = (k) => (PDICT && PDICT[k] ? PDICT[k][1] : MA.PARTS[k][1]);
$("ver").textContent = "v" + VERSION;

// ---------------------------------------------------------------- numbers
function digitsFor(v, sig) { if (!isFinite(v) || v === 0) return 0; return Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))); }
function num(v, sig) { sig = sig || 3; return fx(v, Math.min(4, digitsFor(v, sig))); }
function group(v) { return Math.round(v).toLocaleString(I18.locale); }
function power(W) {
  const a = Math.abs(W);
  if (a < 1e3) return num(W, 3) + " W";
  if (a < 1e6) return num(W / 1e3, 3) + " kW";
  if (a < 1e9) return num(W / 1e6, 3) + " MW";
  return num(W / 1e9, 3) + " GW";
}
function pct(x, d) { return fx(x * 100, d == null ? 0 : d) + " %"; }

// ---------------------------------------------------------------- what each machine says about itself
const BLURB = {
  pelton: () => T("An impulse turbine for high heads: the water's pressure becomes a fast jet in air, and the jet hits a wheel of buckets."),
  francis: () => T("A reaction turbine for medium heads, and the most common kind in the world: water fills a spiral casing and flows inward through the runner."),
  kaplan: () => T("A propeller turbine with adjustable blades, for low heads and large flows. This model is an in-stream unit that takes power from a river's current.")
};
const KIND_NAME = { pelton: "Pelton", francis: "Francis", kaplan: "Kaplan", propeller: () => T("Propeller (Kaplan, blades locked)") };
function kindName(k) { const n = KIND_NAME[k]; return typeof n === "function" ? n() : n; }

// ---------------------------------------------------------------- state
const S = {
  machine: "pelton", medium: "water", view: "machine", xray: false, explode: false, spin: true, flow: true, tab: "eff",
  ops: {
    pelton: { H: 600, Qrated: 2.5, load: 0.85, ux: 0.47 },
    francis: { H: 25, Qrated: 12, load: 0.85 },
    francis_wind: { v: 10 },
    kaplan: { v: 2.2, blades: "adjust" },
    kaplan_wind: { v: 10, blades: "adjust" }
  },
  site: null
};
const opKey = () => S.machine + (S.medium === "wind" ? "_wind" : "");
const preset = () => MA.MACHINES[S.machine][S.medium];
const hasWind = (m) => !!MA.MACHINES[m].wind;

// ---------------------------------------------------------------- the operating point: everything the readout shows
function operate(machine, medium) {
  const m = MA.MACHINES[machine], p = m[medium], o = S.ops[machine + (medium === "wind" ? "_wind" : "")];
  const r = { machine, medium, drive: p.drive, kind: m.kind };
  if (p.drive === "head") {
    r.H = o.H; r.Qrated = o.Qrated; r.load = o.load; r.Q = o.load * o.Qrated;
    r.eta = PH.efficiency(m.kind, o.load);
    if (machine === "pelton") {
      r.ux = o.ux;
      r.eta *= PH.peltonEfficiency(o.ux) / PH.peltonEfficiency(0.5);
      r.c = PH.jetVelocity(o.H); r.u = o.ux * r.c; r.rpm = PH.rpmFromTipSpeed(r.u, p.D);
      r.jetD = PH.jetDiameter(r.Q, r.c);
    } else r.rpm = PH.francisRpm(o.H, p.D, p.ku);
    r.P = PH.hydroPower(r.Q, o.H, r.eta);
    r.Prated = PH.hydroPower(o.Qrated, o.H, PH.efficiency(m.kind, 1) * (machine === "pelton" ? PH.peltonEfficiency(o.ux) / PH.peltonEfficiency(0.5) : 1));
    r.ns = PH.specificSpeed(r.rpm, r.Prated / 1e3, o.H);
    r.nsOk = PH.nsKinds(r.ns).indexOf(m.kind) >= 0;
  } else {
    const rho = medium === "wind" ? PH.RHO_AIR : PH.RHO_WATER;
    const curve = machine === "kaplan" ? (o.blades === "locked" ? "propeller" : "kaplan") : m.kind;
    r.curve = curve; r.rho = rho; r.v = o.v; r.vRated = p.vRated; r.D = p.D; r.A = PH.discArea(p.D);
    r.load = Math.min(1, o.v / p.vRated);
    r.cp = p.cpMax * PH.efficiency(curve, r.load) / PH.peakEfficiency(curve);
    r.Pstream = PH.kineticPower(o.v, r.A, 1, rho);
    r.Prated = PH.kineticPower(p.vRated, r.A, p.cpMax * PH.efficiency(curve, 1) / PH.peakEfficiency(curve), rho);
    r.P = Math.min(r.Prated, r.Pstream * r.cp);
    r.capped = r.Pstream * r.cp > r.Prated;
    r.Q = o.v * r.A;
    r.rpm = PH.rotorRpm(Math.min(o.v, p.vRated), p.D, p.tsr);
  }
  return r;
}

// ---------------------------------------------------------------- the operating panel
function logSlider(id, label, value, lo, hi, fmt) {
  const t = Math.round(1000 * Math.log(value / lo) / Math.log(hi / lo));
  return `<div class="ctl"><div class="row"><label for="${id}">${label}</label><output id="${id}O">${fmt(value)}</output></div>
    <input type="range" id="${id}" min="0" max="1000" value="${t}" data-log="${lo},${hi}"></div>`;
}
function linSlider(id, label, value, lo, hi, step, fmt, hint) {
  return `<div class="ctl"><div class="row"><label for="${id}">${label}</label><output id="${id}O">${fmt(value)}</output></div>
    <input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${value}">${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
}
function readSlider(el) { if (el.dataset.log) { const [lo, hi] = el.dataset.log.split(",").map(Number); return lo * Math.pow(hi / lo, el.value / 1000); } return Number(el.value); }
const fmtH = (v) => num(v, 3) + " m", fmtQ = (v) => num(v, 3) + " m³/s", fmtV = (v) => fx(v, 1) + " m/s";

function buildOps() {
  const p = preset(), o = S.ops[opKey()], box = $("ops");
  let h = "";
  if (p.drive === "head") {
    h += logSlider("opH", T("Head (height the water falls)"), o.H, p.Hmin, p.Hmax, fmtH);
    h += logSlider("opQ", T("Rated flow"), o.Qrated, S.machine === "pelton" ? 0.05 : 0.5, S.machine === "pelton" ? 40 : 300, fmtQ);
    h += linSlider("opLoad", S.machine === "pelton" ? T("Needle opening (share of rated flow)") : T("Wicket-gate opening (share of rated flow)"), o.load, 0.05, 1, 0.01, (v) => pct(v));
    if (S.machine === "pelton") h += linSlider("opUx", T("Bucket speed ÷ jet speed"), o.ux, 0.1, 0.9, 0.01, (v) => fx(v, 2), T("Best near 0.5: see the Efficiency tab."));
  } else {
    const wind = S.medium === "wind";
    h += linSlider("opV", wind ? T("Wind speed") : T("River current"), o.v, wind ? 2 : 0.3, wind ? 25 : 4, 0.1, fmtV,
      T("Rated at {v}; above that the machine sheds the extra power.", { v: fmtV(p.vRated) }));
    if (S.machine === "kaplan") {
      h += `<div class="ctl"><div class="row"><span>${T("Blades")}</span></div><div class="seg" id="segBlades">
        <button data-v="adjust">${T("Adjust to the flow")}</button><button data-v="locked">${T("Locked")}</button></div>
        <p class="hint">${T("A Kaplan pitches its blades as the flow changes; with them locked it is a plain propeller turbine.")}</p></div>`;
    }
  }
  box.innerHTML = h;
  box.querySelectorAll("input[type=range]").forEach((el) => el.addEventListener("input", () => {
    const v = readSlider(el), o2 = S.ops[opKey()];
    if (el.id === "opH") o2.H = v; else if (el.id === "opQ") o2.Qrated = v; else if (el.id === "opLoad") o2.load = v;
    else if (el.id === "opUx") o2.ux = v; else if (el.id === "opV") o2.v = v;
    const out = $(el.id + "O");
    out.textContent = el.id === "opH" ? fmtH(v) : el.id === "opQ" ? fmtQ(v) : el.id === "opLoad" ? pct(v) : el.id === "opUx" ? fx(v, 2) : fmtV(v);
    update();
  }));
  const sb = $("segBlades");
  if (sb) {
    pressSeg(sb, o.blades);
    sb.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.ops[opKey()].blades = b.dataset.v; pressSeg(sb, b.dataset.v); update(); });
  }
}
function pressSeg(seg, v) { seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); }

function renderReadout(r) {
  const rows = [];
  const add = (k, v, cls) => rows.push(`<span class="k">${k}</span><span class="v${cls ? " " + cls : ""}">${v}</span>`);
  let h = `<div class="big">${power(r.P)}</div>`;
  if (r.drive === "head") {
    add(T("Efficiency"), pct(r.eta, 1));
    add(T("Head"), fmtH(r.H)); add(T("Flow"), fmtQ(r.Q));
    if (r.machine === "pelton") { add(T("Jet speed"), fx(r.c, 0) + " m/s"); add(T("Jet diameter"), group(r.jetD * 1000) + " mm"); }
    add(T("Runner speed"), group(r.rpm) + " rpm");
    add(T("Specific speed Ns"), group(r.ns) + (r.nsOk ? " ✓" : " ⚠"), r.nsOk ? "ok" : "no");
  } else {
    add(T("Power in the stream"), power(r.Pstream));
    add(T("Power coefficient Cp"), fx(r.cp, 2) + (r.capped ? " · " + T("limited to rating") : ""));
    add(T("Flow through the rotor"), fmtQ(r.Q));
    add(T("Runner speed"), group(r.rpm) + " rpm");
  }
  $("readout").innerHTML = h + rows.join("");
}

// ---------------------------------------------------------------- 3D
const canvas = $("view3d");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x2b3a2a, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 60, 25); scene.add(sun);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true;

const loader = new GLTFLoader();
const cache = {};          // machine → { root, objs, ... }
let cur = null;            // the loaded model for S.machine
const clock = new THREE.Clock();
const flowUniforms = { uTime: { value: 0 }, uFlow: { value: 1 } };

// colours for materials that only had procedural textures in Blender, and the look of water and air
const MAT_FIX = {
  Mountain_Rock: { color: 0x6c645a, roughness: 0.95 }, Mountain_Rock_Section: { color: 0x8a7f70, roughness: 0.95 },
  Dam_Concrete: { color: 0x9a978f, roughness: 0.9 }, Riverbed_Soil: { color: 0x5b4a36, roughness: 1 },
  Water_Flow: { color: 0x7cc4f0, opacity: 0.55, flow: 0.5 }, Water_Jet_Flow: { color: 0xbfe8ff, opacity: 0.8, flow: 0.6 },
  Water_Pipe_Flow: { color: 0x5fb2ec, opacity: 0.6, flow: 0.5 }, Air_Pipe_Flow: { color: 0xe6f6ff, opacity: 0.22, flow: 0.35 },
  River_Water_Flow: { color: 0x2e7cad, opacity: 0.42, flow: 0.08 }, Water_Still: { color: 0x1f5f8c, opacity: 0.7 }
};
function patchFlow(mat, k) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = flowUniforms.uTime; sh.uniforms.uFlow = flowUniforms.uFlow;
    sh.vertexShader = "varying vec3 vTLpos;\n" + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n vTLpos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = "uniform float uTime; uniform float uFlow; varying vec3 vTLpos;\n" + sh.fragmentShader.replace("#include <opaque_fragment>",
      "float tlb = pow(0.5 + 0.5 * sin(dot(vTLpos, vec3(0.8, 0.45, 0.6)) * 5.0 - uTime * 7.0), 10.0);\n outgoingLight += vec3(0.75, 0.92, 1.0) * tlb * uFlow * " + k.toFixed(2) + ";\n#include <opaque_fragment>");
  };
  mat.customProgramCacheKey = () => "tlflow" + k;
}

// how each model moves: the runner node, its spin axis in its own frame, and the parts that follow the controls
const RIG = {
  pelton: { water: { runner: "Runner", axis: [0, 0, -1], cam: "Cam_Turbine_Closeup", prefix: "" } },
  francis: {
    water: { runner: "River_Francis_Runner", axis: [0, -1, 0], cam: "Cam_River_Closeup", prefix: "River_", gates: /^River_Francis_Wicket_Gate_/ },
    wind: { runner: "Wind_Francis_Runner", axis: [0, -1, 0], cam: "Cam_Wind", prefix: "Wind_", gates: /^Wind_Francis_Wicket_Gate_/ }
  },
  kaplan: {
    water: { runner: "River_Kaplan_Runner", axis: [1, 0, 0], cam: "Cam_River_Closeup", prefix: "River_", pivots: /^River_Kaplan_Blade_Pivot_/ },
    wind: { runner: "Wind_Kaplan_Runner", axis: [1, 0, 0], cam: "Cam_Wind", prefix: "Wind_", pivots: /^Wind_Kaplan_Blade_Pivot_/ }
  }
};
// exploded view: how far (m, before the twin's scale) each part moves away from the runner
const EXPLODE = {
  pelton: { bucket: 0.45, hub: 0, bearing: 0.9, generator: 1.6, nozzle: 0.8, needle: 0.8, jet: 0.8, shaft: 0.6 },
  francis: { generator: 2.4, runner_f: 1.2, gates: 0.6, stayvanes: 1.1, drafttube: 1.8, spiral: 1.6, flowpath: 1.6, airpath: 1.6 },
  kaplan: { duct: 3.2, guidevanes: 0.9, blades: 0.7, trunnion: 0, bulb: 1.8, hubk: 0 }
};
const RADIAL = { bucket: 1, gates: 1, stayvanes: 1, blades: 1, guidevanes: 1 };
const SHELLS = { pelton: ["rock", "powerhouse"], francis: ["spiral", "drafttube", "powerhouse"], kaplan: ["duct", "bulb"] };
const WATERY = { river: 1, reservoir: 1, headwater: 1, tailwater: 1, tailrace: 1, flowpath: 1, airpath: 1, ground: 1, riverbed: 1 };

function partKey(o) { for (let n = o; n; n = n.parent) { const k = MA.partOf(n.name); if (k) return { key: k, node: n }; } return null; }
function mediumOf(o) { for (let n = o; n; n = n.parent) { if (/^Wind_/.test(n.name) || /^Yaw_Slewing/.test(n.name)) return "wind"; if (/^River_/.test(n.name)) return "water"; } return "both"; }

function load(machine) {
  if (cache[machine]) return Promise.resolve(cache[machine]);
  return new Promise((res, rej) => loader.load(MA.MACHINES[machine].file + "?v=" + VERSION, (g) => res(prepare(machine, g)), undefined, rej));
}
function prepare(machine, gltf) {
  const root = gltf.scene, M = { machine, root, meshes: [], parts: {}, rigs: {}, cams: {} };
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o.isCamera) { const holder = o.parent && o.parent.name && /^Cam_/.test(o.parent.name) && !/^Cam_/.test(o.name) ? o.parent : o; M.cams[holder.name || o.name] = o; }
    if (!o.isMesh) return;
    if (/Emitter/.test(o.name) || (o.parent && /Emitter/.test(o.parent.name))) { o.visible = false; return; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const fixed = mats.map((m0) => {
      const m = m0.clone(), fix = MAT_FIX[m0.name];
      if (fix) {
        if (fix.color != null) m.color = new THREE.Color(fix.color);
        if (fix.roughness != null) m.roughness = fix.roughness;
        if (fix.opacity != null) { m.transparent = true; m.opacity = fix.opacity; m.depthWrite = false; }
        if (fix.flow) patchFlow(m, fix.flow);
      }
      m.side = THREE.DoubleSide;
      m.userData.base = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, emissive: m.emissive ? m.emissive.clone() : null };
      return m;
    });
    o.material = Array.isArray(o.material) ? fixed : fixed[0];
    const pk = partKey(o); o.userData.part = pk ? pk.key : null; o.userData.medium = mediumOf(o);
    M.meshes.push(o);
    if (pk) (M.parts[pk.key] = M.parts[pk.key] || []).push(o);
  });
  // the rigs: runner base orientation, the gates and the blade pivots
  for (const medium of Object.keys(RIG[machine])) {
    const rg = RIG[machine][medium], runner = root.getObjectByName(rg.runner);
    const R = { runner, base: runner.quaternion.clone(), axis: new THREE.Vector3().fromArray(rg.axis), angle: 0, gates: [], pivots: [], medium };
    R.center = runner.getWorldPosition(new THREE.Vector3());
    if (rg.gates) root.traverse((o) => { if (rg.gates.test(o.name) && !(o.parent && rg.gates.test(o.parent.name))) R.gates.push({ o, base: o.quaternion.clone() }); });
    if (rg.pivots) root.traverse((o) => {
      if (!rg.pivots.test(o.name)) return;
      // pitch axis: from the runner axis out to the blade, in the runner's frame
      const blade = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const local = runner.worldToLocal(blade.clone()); local.addScaledVector(R.axis, -local.dot(R.axis)); local.normalize();
      const inParent = local.clone().applyQuaternion(R.base).normalize();   // pivot's parent is the runner: express in it
      R.pivots.push({ o, base: o.quaternion.clone(), axis: local, inParent });
    });
    M.rigs[medium] = R;
  }
  prepareExplode(M);
  return (cache[machine] = M);
}
function prepareExplode(M) {
  const table = EXPLODE[M.machine];
  for (const medium of Object.keys(M.rigs)) {
    const R = M.rigs[medium], scale = (MA.MACHINES[M.machine][medium] || {}).scale || 1;
    for (const key of Object.keys(table)) {
      const amount = table[key] * scale; if (!amount) continue;
      // the top-most objects of this part in this medium (children move with their parents)
      const tops = new Set();
      (M.parts[key] || []).filter((o) => o.userData.medium === medium || o.userData.medium === "both").forEach((o) => {
        let t = o; while (t.parent && partKey(t.parent) && partKey(t.parent).key === key && t.parent !== M.root) t = t.parent; tops.add(t);
      });
      if (!tops.size) continue;
      const box = new THREE.Box3(); tops.forEach((t) => box.expandByObject(t));
      const groupDir = box.getCenter(new THREE.Vector3()).sub(R.center);
      if (groupDir.length() < 0.05 * scale) groupDir.set(0, 1, 0);
      groupDir.normalize();
      tops.forEach((t) => {
        let dir = groupDir;
        if (RADIAL[key]) {
          const c = new THREE.Box3().setFromObject(t).getCenter(new THREE.Vector3()).sub(R.center);
          const ax = R.axis.clone().applyQuaternion(R.runner.getWorldQuaternion(new THREE.Quaternion())).normalize();
          c.addScaledVector(ax, -c.dot(ax)); if (c.length() > 1e-3) dir = c.normalize();
        }
        const wp = t.getWorldPosition(new THREE.Vector3()).addScaledVector(dir, amount);
        const lp = t.parent.worldToLocal(wp);
        t.userData.explode = lp.sub(t.position); t.userData.home = t.position.clone();
        M.exploders = M.exploders || []; M.exploders.push(t);
      });
    }
  }
}

let explodeT = 0, xrayOn = false, fly = null;
function setCamera(viewName) {
  if (!cur) return;
  const rg = RIG[S.machine][S.medium];
  const name = viewName === "site" ? "Cam_Overview" : rg.cam;
  const cam = cur.cams[name]; if (!cam) return;
  cam.updateMatrixWorld(true);
  const pos = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
  const center = cur.rigs[S.medium].center;
  const t = Math.max(1, center.clone().sub(pos).dot(dir));
  const target = pos.clone().addScaledVector(dir, t);
  camera.fov = cam.fov || 40; camera.updateProjectionMatrix();
  flyTo(pos, target);
}
function flyTo(pos, target, ms) { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, s: performance.now(), d: ms || 900 }; }
function focusPart(key) {
  if (!cur || !cur.parts[key]) return;
  const objs = cur.parts[key].filter((o) => o.visible && (o.userData.medium === S.medium || o.userData.medium === "both"));
  if (!objs.length) return;
  const box = new THREE.Box3(); objs.forEach((o) => box.expandByObject(o));
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.4, box.getSize(new THREE.Vector3()).length() / 2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  flyTo(c.clone().addScaledVector(dir, r * 2.6 + 0.6), c);
}

// ---------------------------------------------------------------- hover, highlight and the part card
let hoverKey = null, pinnedKey = null, pointerDirty = false;
const pointer = new THREE.Vector2(), ray = new THREE.Raycaster();
canvas.addEventListener("pointermove", (e) => { const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); pointerDirty = true; });
canvas.addEventListener("pointerleave", () => { pointer.set(9, 9); pointerDirty = true; });
let downAt = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = canvas.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  pinnedKey = pick(); showCard(); markList();
});
function pick() {
  if (!cur || pointer.x > 2) return null;
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(cur.meshes.filter((o) => o.visible), false);
  let fallback = null;
  for (const h of hits) {
    const k = h.object.userData.part; if (!k) continue;
    if (xrayOn && SHELLS[S.machine].indexOf(k) >= 0) continue;
    if (WATERY[k]) { fallback = fallback || k; continue; }
    return k;
  }
  return fallback;
}
function setHighlight(key) {
  if (!cur) return;
  cur.meshes.forEach((o) => {
    const on = key && o.userData.part === key;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (!m.emissive) return;
      if (on) m.emissive.setRGB(0.45, 0.33, 0.04); else m.emissive.copy(m.userData.base.emissive);
    });
  });
}
function showCard() {
  const key = pinnedKey || hoverKey;
  setHighlight(key);
  const card = $("card");
  if (!key || !MA.PARTS[key]) { card.hidden = true; return; }
  $("cardName").textContent = partName(key); $("cardRole").textContent = partRole(key);
  card.hidden = false;
}
function buildParts() {
  const list = MA.LISTS[S.machine + (S.medium === "wind" ? "_wind" : "")];
  $("partsList").innerHTML = list.map((k) => `<li><button data-k="${k}">${partName(k)}</button></li>`).join("");
  markList();
}
function markList() { $("partsList").querySelectorAll("button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.k === pinnedKey))); }
$("partsList").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  pinnedKey = pinnedKey === b.dataset.k ? null : b.dataset.k; showCard(); markList();
  if (pinnedKey) focusPart(pinnedKey);
});

// ---------------------------------------------------------------- see-through
function applyXray() {
  if (!cur) return;
  xrayOn = S.xray;
  const shells = SHELLS[S.machine];
  cur.meshes.forEach((o) => {
    const on = xrayOn && shells.indexOf(o.userData.part) >= 0;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      const b = m.userData.base;
      if (on) { m.transparent = true; m.opacity = Math.min(b.opacity, 0.16); m.depthWrite = false; }
      else { m.transparent = b.transparent; m.opacity = b.opacity; m.depthWrite = b.depthWrite; }
      m.needsUpdate = true;
    });
  });
}

// ---------------------------------------------------------------- the loop
let rOp = null;
function slowFactor(rpm) { const steps = [1, 2, 5, 10, 20, 50, 100]; for (const s of steps) if (rpm / s <= 40) return s; return 200; }
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
}
const qTmp = new THREE.Quaternion();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  resize();
  if (fly) {
    const t = Math.min(1, (performance.now() - fly.s) / fly.d), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
    if (t >= 1) fly = null;
  }
  controls.update();
  if (cur) {
    flowUniforms.uTime.value += dt * (S.flow ? 1 : 0);
    flowUniforms.uFlow.value = S.flow ? 1 : 0;
    // spin every runner at its own speed, slowed down so the eye can follow it
    for (const medium of Object.keys(cur.rigs)) {
      const R = cur.rigs[medium], op = operate(S.machine, medium);
      const rpm = op.P > 0 ? op.rpm : 0, shown = rpm / slowFactor(rpm);
      if (S.spin) R.angle += shown / 60 * 2 * Math.PI * dt;
      R.runner.quaternion.copy(R.base).multiply(qTmp.setFromAxisAngle(R.axis, R.angle));
      // wicket gates follow the opening; Kaplan blades follow the flow when they are free to pitch
      const open = op.drive === "head" ? op.load : Math.min(1, op.load);
      R.gates.forEach((g) => g.o.quaternion.copy(qTmp.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (open - 0.6) * 0.7)).multiply(g.base));
      const pitch = op.curve === "kaplan" ? (op.load - 1) * 0.45 : 0;
      R.pivots.forEach((pv) => pv.o.quaternion.copy(pv.base).premultiply(qTmp.setFromAxisAngle(pv.inParent, pitch)));
    }
    // Pelton: needle and jet
    if (S.machine === "pelton") {
      const o = S.ops.pelton, needle = cur.root.getObjectByName("Spear_Needle"), jet = cur.root.getObjectByName("Water_Jet");
      if (needle) { needle.userData.home = needle.userData.home || needle.position.clone(); needle.position.copy(needle.userData.home); needle.position.x -= (1 - o.load) * 0.07; }
      if (jet) { const s = Math.sqrt(Math.max(0.02, o.load)); jet.userData.s0 = jet.userData.s0 || jet.scale.clone(); jet.scale.set(jet.userData.s0.x * s, jet.userData.s0.y, jet.userData.s0.z * s); }
    }
    // exploded view
    const goal = S.explode ? 1 : 0;
    if (explodeT !== goal) {
      explodeT += Math.sign(goal - explodeT) * dt * 1.6; explodeT = Math.max(0, Math.min(1, explodeT));
      const e = explodeT * explodeT * (3 - 2 * explodeT);
      (cur.exploders || []).forEach((t) => t.position.copy(t.userData.home).addScaledVector(t.userData.explode, e));
    }
    if (pointerDirty) { pointerDirty = false; const k = pick(); if (k !== hoverKey) { hoverKey = k; showCard(); } }
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- switching machine, medium and view
async function showMachine() {
  $("loading").hidden = false;
  let M;
  try { M = await load(S.machine); } catch (err) { $("loading").textContent = T("The model could not be loaded."); console.error(err); return; }
  if (cur && cur !== M) scene.remove(cur.root);
  if (cur !== M) { scene.add(M.root); cur = M; explodeT = 0; (M.exploders || []).forEach((t) => t.position.copy(t.userData.home)); }
  $("loading").hidden = true;
  hoverKey = null; pinnedKey = null; showCard();
  applyXray(); setCamera(S.view);
}
function syncControls() {
  pressSeg($("segMachine"), S.machine); pressSeg($("segMedium"), S.medium); pressSeg($("segView"), S.view);
  const wb = $("segMedium").querySelector('[data-v="wind"]');
  wb.disabled = !hasWind(S.machine);
  $("machineBlurb").textContent = BLURB[S.machine]();
  $("mediumHint").textContent = !hasWind(S.machine) ? T("A Pelton wheel needs a jet of water, so it has no wind twin.")
    : S.medium === "wind" ? T("The same machine scaled up and fed by air instead of water. Does it still make sense? See the Water vs wind tab.")
    : T("Try the wind twin: the same machine fed by air.");
}
$("segMachine").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.v === S.machine) return;
  S.machine = b.dataset.v; if (!hasWind(S.machine)) S.medium = "water";
  syncControls(); buildOps(); buildParts(); update(); showMachine();
});
$("segMedium").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.disabled || b.dataset.v === S.medium) return;
  S.medium = b.dataset.v; syncControls(); buildOps(); buildParts(); update(); hoverKey = pinnedKey = null; showCard(); setCamera(S.view);
});
$("segView").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.view = b.dataset.v; syncControls(); setCamera(S.view); });
$("chkXray").addEventListener("change", (e) => { S.xray = e.target.checked; applyXray(); });
$("chkExplode").addEventListener("change", (e) => { S.explode = e.target.checked; });
$("chkSpin").addEventListener("change", (e) => { S.spin = e.target.checked; update(); });
$("chkFlow").addEventListener("change", (e) => { S.flow = e.target.checked; });

function update() {
  rOp = operate(S.machine, S.medium);
  renderReadout(rOp);
  const slow = slowFactor(rOp.rpm);
  $("stageNote").textContent = S.spin ? (slow > 1 ? T("Spin shown {n}× slower than real", { n: slow }) : T("Spin shown at real speed")) : "";
  drawCharts();
}

// ---------------------------------------------------------------- charts
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = { pelton: "--s-pelton", francis: "--s-francis", kaplan: "--s-kaplan", propeller: "--s-propeller" };
function setup(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = Number(cv.getAttribute("height"));
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); }
  cv.height = Math.round(h * dpr); cv.style.height = h + "px";
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.font = "12px Barlow, sans-serif"; return { ctx, w, h };
}
function axes(ctx, box, xt, yt, xl, yl) {
  ctx.strokeStyle = css("--grid"); ctx.lineWidth = 1; ctx.fillStyle = css("--ink-faint"); ctx.font = "11.5px 'IBM Plex Mono', monospace";
  yt.forEach(([v, lab]) => { const y = box.y(v); ctx.beginPath(); ctx.moveTo(box.l, y + 0.5); ctx.lineTo(box.r, y + 0.5); ctx.stroke(); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(lab, box.l - 6, y); });
  xt.forEach(([v, lab]) => { const x = box.x(v); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(lab, x, box.b + 6); });
  ctx.strokeStyle = css("--axis"); ctx.beginPath(); ctx.moveTo(box.l, box.b + 0.5); ctx.lineTo(box.r, box.b + 0.5); ctx.stroke();
  ctx.font = "12px Barlow, sans-serif"; ctx.fillStyle = css("--ink-dim");
  ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(xl, (box.l + box.r) / 2, box.h - 2);
  ctx.save(); ctx.translate(13, (box.t + box.b) / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "middle"; ctx.fillText(yl, 0, 0); ctx.restore();
}
function linBox(w, h, x0, x1, y0, y1, pad) {
  const p = Object.assign({ l: 56, r: 16, t: 14, b: 44 }, pad || {});
  const b = { l: p.l, r: w - p.r, t: p.t, b: h - p.b, w, h };
  b.x = (v) => b.l + (v - x0) / (x1 - x0) * (b.r - b.l); b.y = (v) => b.b - (v - y0) / (y1 - y0) * (b.b - b.t);
  b.ix = (px) => x0 + (px - b.l) / (b.r - b.l) * (x1 - x0); b.iy = (py) => y0 + (b.b - py) / (b.b - b.t) * (y1 - y0);
  return b;
}
function logBox(w, h, x0, x1, y0, y1, pad) {
  const L = Math.log10, b = linBox(w, h, L(x0), L(x1), L(y0), L(y1), pad), bx = b.x, by = b.y, ix = b.ix, iy = b.iy;
  b.x = (v) => bx(L(v)); b.y = (v) => by(L(v)); b.ix = (px) => Math.pow(10, ix(px)); b.iy = (py) => Math.pow(10, iy(py));
  return b;
}
function line(ctx, pts, color, width, dash) {
  ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.setLineDash([]);
}
function dot(ctx, x, y, color, r) { ctx.beginPath(); ctx.arc(x, y, (r || 5) + 2, 0, 7); ctx.fillStyle = css("--panel-2"); ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r || 5, 0, 7); ctx.fillStyle = color; ctx.fill(); }
function label(ctx, text, x, y, align, color) { ctx.font = "600 12px Barlow, sans-serif"; ctx.fillStyle = color || css("--ink"); ctx.textAlign = align || "left"; ctx.textBaseline = "middle"; ctx.fillText(text, x, y); }
function sw(color) { return `<i class="sw" style="background:${color}"></i>`; }
function tipAt(tip, cv, x, y, html) {
  if (html == null) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, W = cv.clientWidth;
  tip.style.left = Math.min(W - w - 4, Math.max(4, x + 14)) + "px"; tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + "px";
}
function hookHover(cv, tip, fn) {
  cv.addEventListener("pointermove", (e) => { const r = cv.getBoundingClientRect(); fn(e.clientX - r.left, e.clientY - r.top); });
  cv.addEventListener("pointerleave", () => { fn(null, null); });
}

// --- efficiency against load
const effHover = { x: null };
function drawEff() {
  const cv = $("chartEff"); if (!cv.clientWidth) return;
  const { ctx, w, h } = setup(cv), b = linBox(w, h, 0, 1, 0, 1, { r: 120 });
  axes(ctx, b, [0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => [v, pct(v)]), [0, 0.25, 0.5, 0.75, 1].map((v) => [v, pct(v)]),
    T("Load (share of rated flow, or of rated current speed)"), T("Efficiency"));
  const curK = rOp.drive === "head" ? rOp.kind : rOp.curve;
  const kinds = ["pelton", "francis", "kaplan", "propeller"], ends = [];
  kinds.forEach((k) => {
    const pts = []; for (let i = 0; i <= 100; i++) { const q = i / 100; pts.push([b.x(q), b.y(PH.efficiency(k, q))]); }
    ctx.globalAlpha = k === curK ? 1 : 0.55; line(ctx, pts, css(SERIES[k]), k === curK ? 2.5 : 2); ctx.globalAlpha = 1;
    ends.push({ k, y: b.y(PH.efficiency(k, 1)) });
  });
  // direct labels at the right end, nudged apart
  ends.sort((a, c) => a.y - c.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
  ends.forEach((e) => label(ctx, e.k === "propeller" ? T("Propeller") : kindName(e.k), b.r + 8, e.y));
  // the machine being run
  const q = rOp.load, eta = rOp.drive === "head" ? PH.efficiency(rOp.kind, q) : PH.efficiency(rOp.curve, q);
  dot(ctx, b.x(q), b.y(eta), css(SERIES[curK]), 6);
  if (effHover.x != null && effHover.x >= b.l && effHover.x <= b.r) {
    const qx = Math.max(0, Math.min(1, b.ix(effHover.x)));
    ctx.strokeStyle = css("--ink-faint"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.x(qx) + 0.5, b.t); ctx.lineTo(b.x(qx) + 0.5, b.b); ctx.stroke();
    tipAt($("tipEff"), cv, b.x(qx), effHover.y, `<b>${T("Load")} ${pct(qx)}</b><br>` + kinds.map((k) => `${sw(css(SERIES[k]))}${k === "propeller" ? T("Propeller") : kindName(k)}: ${pct(PH.efficiency(k, qx), 1)}`).join("<br>"));
  } else tipAt($("tipEff"), cv, 0, 0, null);
  $("legendEff").innerHTML = kinds.map((k) => `<span><i style="background:${css(SERIES[k])}"></i>${kindName(k)}</span>`).join("");
}
hookHover($("chartEff"), $("tipEff"), (x, y) => { effHover.x = x; effHover.y = y; drawEff(); });

// --- Pelton bucket speed
const uxHover = { x: null };
function drawUx() {
  const show = S.machine === "pelton"; $("peltonBox").hidden = !show; if (!show) return;
  const cv = $("chartUx"); if (!cv.clientWidth) return;
  const { ctx, w, h } = setup(cv), b = linBox(w, h, 0, 1, 0, 1, { r: 24 });
  axes(ctx, b, [0, 0.25, 0.5, 0.75, 1].map((v) => [v, fx(v, 2)]), [0, 0.5, 1].map((v) => [v, pct(v)]), T("Bucket speed ÷ jet speed"), T("Hydraulic efficiency"));
  const pts = []; for (let i = 0; i <= 100; i++) pts.push([b.x(i / 100), b.y(PH.peltonEfficiency(i / 100))]);
  line(ctx, pts, css("--s-pelton"), 2.5);
  ctx.strokeStyle = css("--ink-faint"); ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(b.x(0.5) + 0.5, b.t); ctx.lineTo(b.x(0.5) + 0.5, b.b); ctx.stroke(); ctx.setLineDash([]);
  label(ctx, T("half the jet speed"), b.x(0.5) + 6, b.t + 8, "left", css("--ink-dim"));
  const x = S.ops.pelton.ux; dot(ctx, b.x(x), b.y(PH.peltonEfficiency(x)), css("--s-pelton"), 6);
  if (uxHover.x != null && uxHover.x >= b.l && uxHover.x <= b.r) {
    const v = Math.max(0, Math.min(1, b.ix(uxHover.x)));
    tipAt($("tipUx"), cv, b.x(v), uxHover.y, `u/c = ${fx(v, 2)}<br>${T("Hydraulic efficiency")}: ${pct(PH.peltonEfficiency(v), 1)}`);
  } else tipAt($("tipUx"), cv, 0, 0, null);
}
hookHover($("chartUx"), $("tipUx"), (x, y) => { uxHover.x = x; uxHover.y = y; drawUx(); });

// --- which turbine for a site
const pickHover = { x: null };
const PICK = { Q0: 0.01, Q1: 1000, H0: 1, H1: 2000 };
function drawPick() {
  const cv = $("chartPick"); if (!cv.clientWidth) return;
  const { ctx, w, h } = setup(cv), b = logBox(w, h, PICK.Q0, PICK.Q1, PICK.H0, PICK.H1, { l: 60 });
  axes(ctx, b, [0.01, 0.1, 1, 10, 100, 1000].map((v) => [v, num(v, 1)]), [1, 10, 100, 1000].map((v) => [v, group(v)]), T("Flow (m³/s), log scale"), T("Head (m), log scale"));
  ctx.save(); ctx.beginPath(); ctx.rect(b.l, b.t, b.r - b.l, b.b - b.t); ctx.clip();
  // power lines at 90 % efficiency
  [[1e4, "10 kW"], [1e5, "100 kW"], [1e6, "1 MW"], [1e7, "10 MW"], [1e8, "100 MW"], [1e9, "1 GW"]].forEach(([Pw, lab]) => {
    const k = Pw / (PH.RHO_WATER * PH.G * 0.9), pts = [];
    for (let i = 0; i <= 40; i++) { const Q = PICK.Q0 * Math.pow(PICK.Q1 / PICK.Q0, i / 40); pts.push([b.x(Q), b.y(k / Q)]); }
    line(ctx, pts, css("--ink-faint"), 1, [3, 4]);
    const Qa = k / (PICK.H1 / 3); if (Qa > PICK.Q0 * 1.2 && Qa < PICK.Q1 / 4) { ctx.font = "11px 'IBM Plex Mono', monospace"; ctx.fillStyle = css("--ink-faint"); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(lab, b.x(Qa) + 5, b.y(k / Qa)); }
  });
  // zones
  ["kaplan", "francis", "pelton"].forEach((k) => {
    const poly = PH.ZONES[k]; ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(b.x(p[0]), b.y(p[1])) : ctx.moveTo(b.x(p[0]), b.y(p[1])))); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = css(SERIES[k]); ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = css(SERIES[k]); ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.restore();
  label(ctx, "Pelton", b.x(0.08), b.y(700), "center"); label(ctx, "Francis", b.x(8), b.y(110), "center"); label(ctx, "Kaplan", b.x(60), b.y(5), "center");
  // the model being run (head-driven machines), and the visitor's site
  if (rOp.drive === "head") { const x = b.x(rOp.Qrated), y = b.y(rOp.H); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); label(ctx, T("model shown"), x + 11, y, "left", css("--ink-dim")); }
  if (S.site) { const x = b.x(S.site.Q), y = b.y(S.site.H); dot(ctx, x, y, css("--warn"), 6); label(ctx, T("your site"), x + 11, y, "left", css("--warn")); }
  if (pickHover.x != null && pickHover.x >= b.l && pickHover.x <= b.r && pickHover.y >= b.t && pickHover.y <= b.b) {
    const Q = b.ix(pickHover.x), H = b.iy(pickHover.y), fit = PH.selectTurbine(Q, H);
    tipAt($("tipPick"), cv, pickHover.x, pickHover.y, `${T("Flow")}: ${fmtQ(Q)}<br>${T("Head")}: ${fmtH(H)}<br>${T("Power")}: ${power(PH.hydroPower(Q, H, 0.9))}<br>${fit.length ? fit.map((f) => kindName(f.kind)).join(", ") : T("no conventional turbine")}<br><i>${T("click to place your site")}</i>`);
  } else tipAt($("tipPick"), cv, 0, 0, null);
  $("legendPick").innerHTML = ["pelton", "francis", "kaplan"].map((k) => `<span><i style="background:${css(SERIES[k])}"></i>${kindName(k)}</span>`).join("") + `<span><i class="dash"></i>${T("power at 90% efficiency")}</span>`;
}
hookHover($("chartPick"), $("tipPick"), (x, y) => { pickHover.x = x; pickHover.y = y; drawPick(); });
$("chartPick").addEventListener("click", (e) => {
  const cv = $("chartPick"), r = cv.getBoundingClientRect(), b = logBox(cv.clientWidth, Number(cv.getAttribute("height")), PICK.Q0, PICK.Q1, PICK.H0, PICK.H1, { l: 60 });
  const x = e.clientX - r.left, y = e.clientY - r.top; if (x < b.l || x > b.r || y < b.t || y > b.b) return;
  S.site = { Q: b.ix(x), H: b.iy(y) }; renderPickResult(); drawPick();
});
function renderPickResult() {
  const el = $("pickResult");
  if (!S.site) { el.innerHTML = T("No site placed yet."); return; }
  const { Q, H } = S.site, fit = PH.selectTurbine(Q, H), Pw = PH.hydroPower(Q, H, 0.9);
  let h = T("Your site: {Q} falling {H} — about {P} of electricity.", { Q: fmtQ(Q), H: fmtH(H), P: "<b>" + power(Pw) + "</b>" }) + " ";
  if (!fit.length) h += H < 3 ? T("Too little head for a conventional turbine: an in-stream unit, like the Kaplan model here, takes power from the current instead.")
    : T("Outside the usual zones: at this head the flow is too big or too small for one machine — split it between several units, or look at other designs.");
  else {
    h += T("Best fit: {k}.", { k: "<b>" + kindName(fit[0].kind) + "</b>" });
    if (fit.length > 1) h += " " + T("Also possible: {k}.", { k: fit.slice(1).map((f) => kindName(f.kind)).join(", ") });
    h += ` <button class="btn primary" id="useSite">${T("Show this turbine")}</button>`;
  }
  el.innerHTML = h;
  const btn = $("useSite");
  if (btn) btn.addEventListener("click", () => {
    const k = fit[0].kind; S.machine = k; S.medium = "water";
    if (k !== "kaplan") { const p = MA.MACHINES[k].water, o = S.ops[k]; o.H = Math.max(p.Hmin, Math.min(p.Hmax, H)); o.Qrated = Q; o.load = 0.85; }
    syncControls(); buildOps(); buildParts(); update(); showMachine();
    $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// --- water against wind
const windHover = { x: null };
function drawWind() {
  const body = $("windBody"), cv = $("chartWind"), m = S.machine;
  const ratio = PH.RHO_WATER / PH.RHO_AIR, k = PH.matchingAirSpeed(1);
  let h = `<ul class="facts">
    <li>${T("Air is {r}× lighter than water (1.225 against 1000 kg/m³).", { r: "<b>" + group(ratio) + "</b>" })}</li>
    <li>${T("The power in a moving stream is ½·ρ·A·v³ — it grows with the cube of the speed. To carry as much power through the same area, air must move {k}× faster than water: the cube root of {r}.", { k: "<b>" + fx(k, 1) + "</b>", r: group(ratio) })}</li>
    <li>${T("No open rotor can take more than 16/27 ≈ 59% of that power (the Betz limit): the air or water must keep moving to get out of the way.")}</li></ul>`;
  if (m === "pelton") {
    h += `<p class="lede">${T("A Pelton wheel needs a jet of water, so it has no wind twin. Switch to Francis or Kaplan to compare.")}</p>`;
    body.innerHTML = h; cv.parentNode.hidden = true; $("legendWind").innerHTML = ""; return;
  }
  cv.parentNode.hidden = false;
  if (m === "kaplan") {
    const w = operate("kaplan", "water"), a = operate("kaplan", "wind"), pw = MA.MACHINES.kaplan;
    const same = { D: pw.water.D, A: PH.discArea(pw.water.D), v: a.v };
    same.Pst = PH.kineticPower(same.v, same.A, 1, PH.RHO_AIR); same.P = same.Pst * a.cp;
    const row = (k, x, y, z) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td><td>${z}</td></tr>`;
    h += `<table class="cmp"><thead><tr><th></th><th>${T("River unit in water")}</th><th>${T("Same unit in air")}</th><th>${T("Wind twin (5× larger)")}</th></tr></thead><tbody>
      ${row(T("Density"), "1000 kg/m³", "1.225 kg/m³", "1.225 kg/m³")}
      ${row(T("Rotor diameter"), fx(w.D, 1) + " m", fx(same.D, 1) + " m", fx(a.D, 1) + " m")}
      ${row(T("Speed"), fmtV(w.v), fmtV(same.v), fmtV(a.v))}
      ${row(T("Power in the stream"), power(w.Pstream), power(same.Pst), power(a.Pstream))}
      ${row(T("Shaft power"), power(w.P), power(same.P), power(a.P))}</tbody></table>`;
    h += `<p class="lede">${T("Set the speeds with the River current and Wind speed sliders (switch Fed by to change which one you see).")}</p>`;
    body.innerHTML = h;
    const { ctx, w: W, h: Hh } = setup(cv), b = { ...logBox(W, Hh, 0.3, 30, 1, 1e8, { r: 130 }) };
    axes(ctx, b, [0.3, 1, 3, 10, 30].map((v) => [v, num(v, 1)]), [1, 1e2, 1e4, 1e6, 1e8].map((v) => [v, power(v)]), T("Speed of the water or air (m/s), log scale"), T("Shaft power (log scale)"));
    const cp = pw.water.cpMax, series = [
      { name: T("River unit in water"), color: css("--s-pelton"), D: pw.water.D, rho: PH.RHO_WATER, v1: 5, at: w.v },
      { name: T("Same unit in air"), color: css("--s-propeller"), D: pw.water.D, rho: PH.RHO_AIR, v1: 30 },
      { name: T("Wind twin (5× larger)"), color: css("--s-francis"), D: pw.wind.D, rho: PH.RHO_AIR, v1: 30, at: a.v }
    ];
    series.forEach((s) => {
      const pts = []; for (let i = 0; i <= 60; i++) { const v = 0.3 * Math.pow(s.v1 / 0.3, i / 60); const P = PH.kineticPower(v, PH.discArea(s.D), cp, s.rho); if (P >= 1) pts.push([b.x(v), b.y(Math.min(1e8, P))]); }
      line(ctx, pts, s.color, 2); const e = pts[pts.length - 1]; if (e) label(ctx, s.name, Math.min(e[0] + 6, b.r + 6), e[1], "left");
      if (s.at) dot(ctx, b.x(s.at), b.y(PH.kineticPower(s.at, PH.discArea(s.D), cp, s.rho)), s.color, 5);
    });
    if (windHover.x != null && windHover.x >= b.l && windHover.x <= b.r) {
      const v = b.ix(windHover.x);
      tipAt($("tipWind"), cv, windHover.x, windHover.y, `<b>${fmtV(v)}</b><br>` + series.map((s) => `${sw(s.color)}${s.name}: ${v <= s.v1 ? power(PH.kineticPower(v, PH.discArea(s.D), cp, s.rho)) : "—"}`).join("<br>"));
    } else tipAt($("tipWind"), cv, 0, 0, null);
    $("legendWind").innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("") + `<span>${T("at Cp = {c}", { c: fx(cp, 2) })}</span>`;
  } else {
    const w = operate("francis", "water"), a = operate("francis", "wind");
    const pa = 0.5 * PH.RHO_AIR * a.v * a.v, mm = PH.equivalentHead(a.v, PH.RHO_AIR) * 1000, need = PH.RHO_WATER * PH.G * w.H;
    h += `<p class="lede">${T("A Francis runner turns <b>pressure</b> into torque. Wind at {v} presses with only {pa} Pa — the pressure of {mm} mm of water. This runner is designed for {H} of head: about {x}× more pressure.",
      { v: fmtV(a.v), pa: num(pa, 3), mm: num(mm, 2), H: fmtH(w.H), x: group(need / pa) })}</p>`;
    const row = (k, x, y) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td></tr>`;
    h += `<table class="cmp"><thead><tr><th></th><th>${T("River unit in water")}</th><th>${T("Wind twin (2.5× larger)")}</th></tr></thead><tbody>
      ${row(T("Driving pressure"), num(need / 1000, 3) + " kPa", num(pa / 1000, 2) + " kPa")}
      ${row(T("Equivalent head"), fmtH(w.H), num(mm, 2) + " mm")}
      ${row(T("Flow through the machine"), fmtQ(w.Q), fmtQ(a.Q))}
      ${row(T("Shaft power"), power(w.P), power(a.P))}</tbody></table>`;
    body.innerHTML = h;
    const { ctx, w: W, h: Hh } = setup(cv), b = logBox(W, Hh, 1, 40, 1e-4, 1000, { r: 150, l: 64 });
    axes(ctx, b, [1, 3, 10, 30].map((v) => [v, group(v)]), [1e-4, 1e-2, 1, 100].map((v) => [v, v >= 1 ? group(v) + " m" : fx(v * 1000, v < 1e-3 ? 1 : 0) + " mm"]), T("Wind speed (m/s), log scale"), T("Pressure as metres of water (log)"));
    const pts = []; for (let i = 0; i <= 50; i++) { const v = Math.pow(40, i / 50); pts.push([b.x(v), b.y(PH.equivalentHead(v, PH.RHO_AIR))]); }
    line(ctx, pts, css("--s-francis"), 2.5); label(ctx, T("pressure of the wind"), b.r + 6, b.y(PH.equivalentHead(40, PH.RHO_AIR)), "left");
    line(ctx, [[b.l, b.y(w.H)], [b.r, b.y(w.H)]], css("--ink-faint"), 1.5, [5, 4]); label(ctx, T("design head {H}", { H: fmtH(w.H) }), b.r + 6, b.y(w.H), "left", css("--ink-dim"));
    dot(ctx, b.x(a.v), b.y(PH.equivalentHead(a.v, PH.RHO_AIR)), css("--s-francis"), 5);
    if (windHover.x != null && windHover.x >= b.l && windHover.x <= b.r) {
      const v = b.ix(windHover.x), eh = PH.equivalentHead(v, PH.RHO_AIR);
      tipAt($("tipWind"), cv, windHover.x, windHover.y, `<b>${fmtV(v)}</b><br>${num(0.5 * PH.RHO_AIR * v * v, 3)} Pa = ${num(eh * 1000, 2)} mm`);
    } else tipAt($("tipWind"), cv, 0, 0, null);
    $("legendWind").innerHTML = `<span><i style="background:${css("--s-francis")}"></i>${T("pressure of the wind")}</span><span><i class="dash"></i>${T("design head of the water machine")}</span>`;
  }
}
hookHover($("chartWind"), $("tipWind"), (x, y) => { windHover.x = x; windHover.y = y; drawWind(); });

function drawCharts() {
  if (!rOp) return;
  if (S.tab === "eff") { drawEff(); drawUx(); } else if (S.tab === "pick") drawPick(); else drawWind();
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return; S.tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === S.tab)));
  document.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.dataset.pane !== S.tab));
  drawCharts();
});
window.addEventListener("resize", () => drawCharts());

// ---------------------------------------------------------------- start
document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x.dataset.tab === S.tab)));
syncControls(); buildOps(); buildParts(); renderPickResult(); update();
requestAnimationFrame(frame);
showMachine();
window.__tl = { S, get cur() { return cur; }, camera, controls, operate };
