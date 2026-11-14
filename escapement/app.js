// Escapement — the page: the Blender model of the clock (models/clock.glb) running live from the kinematics in
// src/clock.js, every part pickable and explained (src/parts.js), the power path lit from the mainspring to the
// pendulum, and the numbers behind it in four tabs. English text is in the page and here; i18n.js translates it.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

var VERSION = "1.1.0";
const I = window.ESi18n, T = I.T, fx = I.fx;
const C = window.ESClock, P = window.ESParts, GE = window.ESGears;
const D = C.derive(), SP = D.spec, PERIOD = SP.pendulum.period, P0 = C.pose(0, D);
const RESERVE = D.powerReserveHours * 3600;   // seconds of running from fully wound
const DICT = I.lang === "es" ? window.ESC_ES : I.lang === "da" ? window.ESC_DA : null;
const $ = (id) => document.getElementById(id);
$("ver").textContent = "v" + VERSION;

// ---------------------------------------------------------------- words in the current language
function part(k) {
  const e = P.PARTS[k], tr = DICT && DICT.P && DICT.P[k];
  return tr ? { name: tr[0], role: tr[1], text: tr[2] } : { name: e.name, role: e.role, text: e.text };
}
function groupName(id) { const tr = DICT && DICT.G && DICT.G[id]; return tr || P.GROUPS.find((g) => g.id === id).name; }
function dur(s) {
  if (s < 120) return T("{n} s", { n: fx(s, s < 10 ? 1 : 0) });
  if (s < 7200) return T("{n} min", { n: fx(s / 60, 0) });
  return T("{n} h", { n: fx(s / 3600, s < 36000 ? 1 : 0) });
}
const CW = () => T("clockwise"), ACW = () => T("anticlockwise");
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

// ---------------------------------------------------------------- state
const S = { t: 0, speed: 1, playing: true, wound: 0, stopped: false, after: 0, decay: 1, stepTo: null,
  sel: "escape", hover: null, path: false, inside: false, sound: false, view: "whole", tab: "part" };
const PATH_INDEX = {};
P.POWER_PATH.forEach((k, i) => { PATH_INDEX[k] = i; });
P.HANDS_PATH.forEach((k, i) => { if (PATH_INDEX[k] == null) PATH_INDEX[k] = PATH_INDEX.centre + i; });

// ---------------------------------------------------------------- three.js
const canvas = $("cv"), stage = $("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.35, 0.6, 0.8); scene.add(key);
const camera = new THREE.PerspectiveCamera(36, 1, 0.005, 20);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.12;
controls.minDistance = 0.06; controls.maxDistance = 2.0;

// views: camera position and target in metres (x right, y up, z towards the viewer; the centre arbor is the origin)
const VIEWS = {
  whole: { pos: [0.17, -0.03, 0.50], tgt: [0, -0.07, 0.02] },
  escapement: { pos: [0.035, 0.075, 0.16], tgt: [0, 0.047, 0.02] },
  train: { pos: [0.13, 0.05, 0.19], tgt: [0, 0.008, 0.02] },
  dial: { pos: [0, 0.0, 0.2], tgt: [0, 0.0, 0.05] }
};
let tween = null;
function flyTo(pos, tgt, ms) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...tgt), k: 0, ms: ms || 700 };
}
function setView(v, instant) {
  S.view = v; const V = VIEWS[v];
  // the chapter ring stands in front of the escape wheel: the escapement view looks in with the front taken off
  if (v === "escapement" && !S.inside) { S.autoInside = true; setInside(true); }
  else if (v !== "escapement" && S.autoInside) { S.autoInside = false; setInside(false); }
  if (instant) { camera.position.set(...V.pos); controls.target.set(...V.tgt); controls.update(); } else flyTo(V.pos, V.tgt);
  document.querySelectorAll("#segView button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v));
}

const nodes = {};        // node name (as three.js has it) → object
const moving = [];       // { obj, key, run }
const meshes = [];       // every mesh, with userData.part
const byNode = P.byNode();
const HIDE_INSIDE = ["Frame: front plate", "Dial (chapter ring)", "Dial numerals", "Hour hand", "Minute hand", "Cannon pinion", "Minute wheel", "Hour wheel"].map(P.nodeName);
const SEL_COL = new THREE.Color(0xffcf4a), HOVER_COL = new THREE.Color(0x7dd3fc), PATH_COL = new THREE.Color(0xffb020), NONE = new THREE.Color(0x000000);
const Y = new THREE.Vector3(0, 1, 0);

new GLTFLoader().load("models/clock.glb?v=" + VERSION, (gltf) => {
  const root = gltf.scene;
  scene.add(root);
  root.traverse((o) => {
    if (o.name) nodes[o.name] = o;
  });
  root.traverse((o) => {
    if (!o.isMesh) return;
    let p = o, k = null;
    while (p && !(k = byNode[p.name])) p = p.parent;
    o.material = o.material.clone();
    o.userData.part = k;
    o.userData.node = p ? p.name : null;
    meshes.push(o);
  });
  Object.keys(P.MOVES).forEach((n) => {
    const obj = nodes[P.nodeName(n)];
    if (obj) moving.push({ obj, key: P.MOVES[n].key, run: !!P.MOVES[n].run, part: byNode[P.nodeName(n)] });
    else console.warn("missing node", n);
  });
  // the crutch moves with the anchor (it is the anchor's child) and is ghosted with it
  $("loading").hidden = true;
  setView("whole", true);
}, undefined, (err) => { $("loading").textContent = T("The model could not be loaded."); console.error(err); });

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage); resize();

// ---------------------------------------------------------------- the clock's motion
// how fast each moving part turns, in turns (or, for the pendulum, swings) per second of real time at speed 1
const RATE = { pendulum: 1 / PERIOD, anchor: 1 / PERIOD, escape: 1 / D.escapeTurnSeconds, third: 1 / (D.escapeTurnSeconds / D.perEscape.third),
  centre: 1 / D.centreTurnSeconds, cannon: 1 / D.centreTurnSeconds, minuteHand: 1 / D.centreTurnSeconds, barrel: 1 / D.barrelTurnSeconds,
  mainspring: 1 / D.barrelTurnSeconds, minuteWheel: 1 / (D.centreTurnSeconds * SP.motion.minuteWheel / SP.motion.cannon),
  hourWheel: 1 / (D.centreTurnSeconds * D.hourRatio), hourHand: 1 / (D.centreTurnSeconds * D.hourRatio) };
const GHOST_RATE = 1.5;   // faster than this on screen and a part is drawn faint: it would only flicker
function ghosted(partKey, speed) {
  const k = partKey === "crutch" ? "anchor" : partKey;
  return RATE[k] != null && RATE[k] * speed > GHOST_RATE && !S.stopped;
}

function advance(dtw) {
  if (S.stepTo != null) {
    S.t = Math.min(S.t + dtw * 0.25, S.stepTo);
    if (S.t >= S.stepTo) S.stepTo = null;
    return checkSpring();
  }
  if (!S.playing) return;
  if (!S.stopped) { S.t += dtw * S.speed; checkSpring(); }
  else { S.after += dtw * Math.min(S.speed, 1); S.decay = Math.exp(-S.after / 3); }
}
function checkSpring() {
  const end = S.wound + RESERVE;
  if (S.t >= end) { S.t = end; S.stopped = true; S.after = 0; S.decay = 1; S.stepTo = null; }
}
function wind() { S.wound = S.t; S.stopped = false; S.decay = 1; S.after = 0; updateUI(true); }

let pose = C.pose(0, D);
function applyPose() {
  pose = C.pose(S.t, D);
  for (const m of moving) {
    let a = pose[m.key] - (m.run ? P0[m.key] : 0);
    if ((m.key === "pendulum" || m.key === "anchor") && S.stopped) {
      // run down: the train is still, the pendulum swings on and dies away
      a = SP.pendulum.amplitude * S.decay * Math.sin(2 * Math.PI * (S.t + S.after) / PERIOD);
    }
    m.obj.quaternion.setFromAxisAngle(Y, -a);   // the model's local Y is the arbor; clockwise from the front is −
  }
}

// ---------------------------------------------------------------- highlight, ghosting, visibility
let wall = 0;
function paint() {
  for (const m of meshes) {
    const k = m.userData.part, mat = m.material;
    let col = NONE, e = 0;
    if (k && k === S.sel) { col = SEL_COL; e = 0.16 + 0.08 * Math.sin(wall * 4); }
    else if (k && k === S.hover) { col = HOVER_COL; e = 0.12; }
    else if (S.path && k && PATH_INDEX[k] != null) {
      col = PATH_COL; e = 0.06 + 0.42 * Math.pow(Math.max(0, Math.cos(wall * 2.2 - PATH_INDEX[k] * 0.85)), 6);
    }
    if (mat.emissive) { mat.emissive.copy(col); mat.emissiveIntensity = e; }
    const g = ghosted(k, S.playing || S.stepTo != null ? S.speed : 0);
    if (g !== !!m.userData.ghost) {
      m.userData.ghost = g; mat.transparent = g; mat.opacity = g ? 0.18 : 1; mat.depthWrite = !g; mat.needsUpdate = true;
    }
  }
}
function setInside(on) {
  S.inside = on; $("chkInside").checked = on;
  HIDE_INSIDE.forEach((n) => { if (nodes[n]) nodes[n].visible = !on; });
}
function visible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(meshes.filter((m) => visible(m) && !m.userData.ghost), false)[0];
  return hit ? hit.object.userData.part : null;
}
let down = null;
canvas.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener("pointerup", (ev) => {
  if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) < 5) { const k = pick(ev); if (k) select(k, false); }
  down = null;
});
let hoverAt = 0;
canvas.addEventListener("pointermove", (ev) => {
  if (ev.pointerType !== "mouse" || ev.buttons) return;
  const now = performance.now(); if (now - hoverAt < 50) return; hoverAt = now;
  const k = pick(ev), h = $("hover");
  S.hover = k; canvas.style.cursor = k ? "pointer" : "";
  if (k) { const r = stage.getBoundingClientRect(); h.textContent = part(k).name; h.style.left = (ev.clientX - r.left) + "px"; h.style.top = (ev.clientY - r.top) + "px"; h.hidden = false; }
  else h.hidden = true;
});
canvas.addEventListener("pointerleave", () => { S.hover = null; $("hover").hidden = true; });

function select(k, fly, stay) {
  S.sel = k;
  const p = part(k);
  $("card").hidden = false; $("cardName").textContent = p.name; $("cardRole").textContent = p.role;
  document.querySelectorAll("#partsList button").forEach((b) => b.setAttribute("aria-current", b.dataset.k === k));
  renderPart();
  if (fly) {
    // parts behind the chapter ring are shown with the front taken off; picking a front part puts it back
    const behind = ["power", "train"].includes(P.PARTS[k].group) || k === "anchor" || k === "crutch";
    if (behind && !S.inside) { S.autoInside = true; setInside(true); }
    else if (!behind && S.autoInside && P.PARTS[k].group === "motion") { S.autoInside = false; setInside(false); }
    // look at the part's middle from where the camera is, a little closer
    const box = new THREE.Box3();
    P.PARTS[k].nodes.forEach((n) => { const o = nodes[P.nodeName(n)]; if (o) box.expandByObject(o); });
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      const dir = camera.position.clone().sub(controls.target).normalize();
      const dist = Math.min(0.7, Math.max(0.12, size * 1.6));
      flyTo(c.clone().add(dir.multiplyScalar(dist)).toArray(), c.toArray());
    }
  }
  if (S.tab !== "part" && !stay) showTab("part");
  markTrain();
}

// ---------------------------------------------------------------- the rail
function buildParts() {
  $("partsList").innerHTML = P.GROUPS.map((g) => "<div class='group-h'>" + esc(groupName(g.id)) + "</div><ul class='parts'>" +
    Object.keys(P.PARTS).filter((k) => P.PARTS[k].group === g.id).map((k) =>
      "<li><button data-k='" + k + "'" + (PATH_INDEX[k] != null ? " class='on-path'" : "") + "><span class='dot'></span>" + esc(part(k).name) + "</button></li>").join("") +
    "</ul>").join("");
  $("partsList").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => select(b.dataset.k, true)));
  $("pathList").innerHTML = P.POWER_PATH.map((k) => "<li data-k='" + k + "'>" + esc(part(k).name) + "</li>").join("") +
    "<li class='branch'>" + esc(T("…and from the centre arbor to the hands:")) + "</li>" +
    P.HANDS_PATH.slice(1).map((k) => "<li class='sub' data-k='" + k + "'>" + esc(part(k).name) + "</li>").join("");
}
function setSpeed(v) {
  S.speed = v;
  document.querySelectorAll("#segSpeed button").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.v) === v));
  const hints = {
    0.25: T("Slow motion: watch a tooth lock on a pallet, then slip across it as the pendulum passes the middle."),
    1: T("Real time: two beats a second; the escape wheel turns once every 30 seconds."),
    60: T("A minute a second: the minute hand moves like a second hand. The pendulum and escape wheel would beat too fast to see, so they are drawn faint."),
    3600: T("An hour a second: the minute hand turns once a second and the spring runs down in 48 seconds. Fast parts are drawn faint.")
  };
  $("speedHint").textContent = hints[v];
}
function setPlaying(on) { S.playing = on; $("btnPlay").textContent = on ? T("Pause") : T("Play"); $("btnPlay").classList.toggle("primary", on); }

$("btnPlay").addEventListener("click", () => setPlaying(!S.playing));
$("btnBeat").addEventListener("click", () => {
  // run in slow motion to just after the next impulse, then stop
  setPlaying(false);
  if (S.stopped) return;
  const half = PERIOD / 2, w = C.IMPULSE * half;
  S.stepTo = (Math.floor((S.t + w) / half) + 1) * half + w + 0.02;
});
$("btnNow").addEventListener("click", () => {
  const n = new Date(), st = SP.start;
  const secs = (n.getHours() % 12) * 3600 + n.getMinutes() * 60 + n.getSeconds() + n.getMilliseconds() / 1000;
  const start = (st.h % 12) * 3600 + st.m * 60 + st.s;
  const tNew = (((secs - start) % 43200) + 43200) % 43200;
  S.wound = tNew - (S.t - S.wound); S.t = tNew; S.stepTo = null;
  setSpeed(1); setPlaying(true);
});
$("btnWind").addEventListener("click", wind);
document.querySelectorAll("#segSpeed button").forEach((b) => b.addEventListener("click", () => { setSpeed(Number(b.dataset.v)); if (!S.playing) setPlaying(true); }));
document.querySelectorAll("#segView button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.v)));
$("chkPath").addEventListener("change", (e) => { S.path = e.target.checked; $("pathList").hidden = !S.path; });
$("chkInside").addEventListener("change", (e) => { S.autoInside = false; setInside(e.target.checked); });
$("chkSound").addEventListener("change", (e) => { S.sound = e.target.checked; if (S.sound) audio(); });

// ---------------------------------------------------------------- the tick
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } } if (actx && actx.state === "suspended") actx.resume(); return actx; }
function tick(tock) {
  const a = audio(); if (!a) return;
  const len = Math.floor(a.sampleRate * 0.03), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 7));
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = tock ? 2300 : 3100; f.Q.value = 6;
  const g = a.createGain(); g.gain.value = 0.9;
  src.connect(f); f.connect(g); g.connect(a.destination); src.start();
}

// ---------------------------------------------------------------- tabs
function showTab(t) {
  S.tab = t;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== t; });
  updateUI(true);
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

function table(head, rows) {
  return "<table class='cmp'><thead><tr>" + head.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + r.map((c, i) => "<td" + (typeof c === "object" && c && c.live ? " class='live' data-live='" + c.live + "'" : "") + ">" + esc(typeof c === "object" && c ? c.text : c) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
}
function factsFor(k) {
  const tr = SP.train, mo = SP.motion, deg = (r) => fx(r * 180 / Math.PI, 1) + "°";
  switch (k) {
    case "mainspring": return [[T("Turns from fully wound to run down"), fx(SP.mainspring.turns, 0)], [T("Runs for"), dur(RESERVE)], [T("Barrel radius"), fx(SP.mainspring.barrelRadius, 0) + " mm"]];
    case "barrel": return [[T("Teeth"), tr[0].wheel], [T("Module"), fx(tr[0].module, 1) + " mm"], [T("One turn every"), dur(D.barrelTurnSeconds)], [T("Turns"), ACW()]];
    case "centre": return [[T("Pinion leaves"), tr[1].pinion], [T("Teeth"), tr[1].wheel], [T("One turn every"), dur(D.centreTurnSeconds)], [T("Turns"), CW()]];
    case "third": return [[T("Pinion leaves"), tr[2].pinion], [T("Teeth"), tr[2].wheel], [T("One turn every"), dur(D.escapeTurnSeconds / D.perEscape.third)], [T("Turns"), ACW()]];
    case "escape": return [[T("Pinion leaves"), tr[3].pinion], [T("Teeth"), tr[3].wheel], [T("One turn every"), dur(D.escapeTurnSeconds)], [T("Turns"), CW()], [T("Each beat it turns"), deg(Math.PI / tr[3].wheel)]];
    case "anchor": return [[T("Teeth spanned by the pallets"), fx(SP.anchorSpan, 1)], [T("Pivot above the escape arbor"), fx(D.palletDistance, 1) + " mm"], [T("Swings"), "± " + deg(SP.pendulum.amplitude)]];
    case "pendulum": return [[T("Length"), fx(D.pendulumLength, 1) + " mm"], [T("One full swing"), dur(PERIOD)], [T("Beats an hour"), (7200 / PERIOD).toLocaleString(I.locale)], [T("Swings"), "± " + deg(SP.pendulum.amplitude)]];
    case "cannon": return [[T("Pinion leaves"), mo.cannon], [T("One turn every"), dur(D.centreTurnSeconds)], [T("Turns"), CW()]];
    case "minuteWheel": return [[T("Teeth"), mo.minuteWheel], [T("Pinion leaves"), mo.minutePinion], [T("One turn every"), dur(D.centreTurnSeconds * mo.minuteWheel / mo.cannon)], [T("Turns"), ACW()]];
    case "hourWheel": case "hourHand": return [[T("Teeth"), mo.hourWheel], [T("One turn every"), dur(D.centreTurnSeconds * D.hourRatio)], [T("Turns"), CW()]].slice(k === "hourHand" ? 1 : 0);
    case "minuteHand": return [[T("One turn every"), dur(D.centreTurnSeconds)], [T("Turns"), CW()]];
    default: return [];
  }
}
function renderPart() {
  const k = S.sel, p = part(k), f = factsFor(k), i = P.POWER_PATH.indexOf(k);
  let where = "";
  if (i >= 0) where = T("Step {i} of {n} on the way from the spring to the pendulum.", { i: i + 1, n: P.POWER_PATH.length });
  else if (P.HANDS_PATH.indexOf(k) > 0) where = T("Driven from the centre arbor, on the way to the hands.");
  $("partBody").innerHTML = "<div class='part-group'>" + esc(groupName(P.PARTS[k].group)) + "</div><div class='part-h'>" + esc(p.name) + "</div>" +
    "<p class='part-role'>" + esc(p.role) + "</p><p class='lede'>" + esc(p.text) + "</p>" + (where ? "<p class='fine'>" + esc(where) + "</p>" : "") +
    (f.length ? table([T("Fact"), T("Value")], f) : "");
}
// ---------------------------------------------------------------- the gear-train drawing
const ESC_GEO = window.ESEscapement.geometry(D);   // the anchor and pallets, traced from the motion
const GEARS = GE.list(D), GBY = {}; GEARS.forEach((g) => { GBY[g.id] = g; });
function gearName(id) { const tr = DICT && DICT.N && DICT.N[id]; return tr || GBY[id].name; }
// how long each arbor takes for one turn, and which way it turns (1 clockwise, -1 anticlockwise)
const TURN = { barrel: [D.barrelTurnSeconds, -1], centre: [D.centreTurnSeconds, 1], third: [D.escapeTurnSeconds / D.perEscape.third, -1],
  escape: [D.escapeTurnSeconds, 1], minuteWheel: [D.centreTurnSeconds * SP.motion.minuteWheel / SP.motion.cannon, -1], hourWheel: [D.centreTurnSeconds * D.hourRatio, 1] };
function turnOf(g) { return TURN[g.id === "hourWheel" ? "hourWheel" : g.arbor]; }
// the pose angle that turns each gear, as on the model ([key, measured from t = 0])
const GEAR_ANGLE = { great: ["barrel"], centrePinion: ["centre", 1], centre: ["centre", 1], thirdPinion: ["third"], third: ["third"], escapePinion: ["escape"], escape: ["escape"],
  cannon: ["cannon", 1], minuteWheel: ["minuteWheel", 1], minutePinion: ["minuteWheel", 1], hourWheel: ["hourWheel"] };
const TRAIN_SETS = {
  going: { gears: ["great", "centrePinion", "third", "escapePinion", "escape", "centre", "thirdPinion"], box: [-68, -84, 152, 162], anchor: true },
  motion: { gears: ["hourWheel", "cannon", "minuteWheel", "minutePinion"], box: [-16, -21, 44, 42], hands: true }
};
S.trainSet = "going"; S.mesh = null;
// drawn back to front, as the wheels sit between the plates
const ZORDER = { great: 8, centrePinion: 8.1, third: 14, escapePinion: 14.1, escape: 24, centre: 30, thirdPinion: 30.1, cannon: 1, minuteWheel: 2, minutePinion: 3, hourWheel: 4 };
function ptsPath(pts) { return "M" + pts.map((p) => p[0].toFixed(2) + " " + (-p[1]).toFixed(2)).join("L") + "Z"; }
function drawTrain() {
  const set = TRAIN_SETS[S.trainSet], [bx, by, bw, bh] = set.box, A = D.arbors;
  const ids = set.gears.slice().sort((a, b) => ZORDER[a] - ZORDER[b]);
  let h = "";
  ids.forEach((id) => {
    const g = GBY[id], a = A[g.arbor], dm = GE.dims(g), cls = g.kind === "pinion" ? "pin" : g.kind === "escape" ? "esc" : "whl";
    const shape = ptsPath(GE.outline(g)) + GE.windows(g).map(ptsPath).join("");
    h += "<g class='gear " + cls + "' data-g='" + id + "' transform='translate(" + a.x.toFixed(2) + " " + (-a.y).toFixed(2) + ")'>" +
      "<g class='rot'><path d='" + shape + "' fill-rule='evenodd'/></g>" +
      (dm.pitchD ? "<circle class='pitch' r='" + (dm.pitchD / 2).toFixed(2) + "'/>" : "") + "<circle class='arb' r='0.9'/></g>";
  });
  if (set.anchor) {
    const pa = A.pallet, EG = ESC_GEO;
    h += "<g class='gear anc' data-g='anchor' transform='translate(" + pa.x.toFixed(2) + " " + (-pa.y).toFixed(2) + ")'><g class='rot'>" +
      "<path d='" + EG.arms.map(ptsPath).join("") + "'/><circle class='hubc' r='" + EG.hubRadius + "'/>" +
      "<path class='pal' d='" + ptsPath(EG.entry) + ptsPath(EG.exit) + "'/></g><circle class='arb' r='0.9'/></g>";
  }
  if (set.hands) h += "<g class='hand' data-h='hourHand'><path d='M0 1.5L0 -7'/></g><g class='hand' data-h='minuteHand'><path d='M0 2L0 -11.5'/></g>";
  // labels: name, teeth and how fast (and which way) the arbor turns
  const LAB = S.trainSet === "going"
    ? { great: [0, -76, "middle"], centre: [-27, 4, "end"], third: [41, 24, "start"], escape: [21, 50, "start"], anchor: [0, 71, "middle"] }
    : { hourWheel: [-15, 15.5, "start"], cannon: [-15, -14, "start"], minuteWheel: [27, 15.5, "end"] };
  Object.keys(LAB).forEach((id) => {
    const [x, y, an] = LAB[id];
    let l1, l2 = "";
    if (id === "anchor") l1 = part("anchor").name;
    else { const g = GBY[id], tn = turnOf(g); l1 = gearName(id); l2 = T("{n} teeth", { n: g.teeth }) + " · " + (tn[1] > 0 ? "↻ " : "↺ ") + dur(tn[0]); }
    h += "<text x='" + x + "' y='" + (-y) + "' text-anchor='" + an + "'><tspan class='n'>" + esc(l1) + "</tspan>" +
      (l2 ? "<tspan x='" + x + "' dy='1.2em'>" + esc(l2) + "</tspan>" : "") + "</text>";
  });
  const svg = $("trainSvg");
  svg.setAttribute("viewBox", bx + " " + (-(by + bh)) + " " + bw + " " + bh);
  svg.style.setProperty("--u", (bw / 150).toFixed(4));   // line widths and text scale with the view
  svg.innerHTML = h;
  svg.querySelectorAll(".gear").forEach((el) => {
    el.addEventListener("click", () => { const id = el.dataset.g; select(id === "anchor" ? "anchor" : GBY[id].part, false, true); });
  });
  document.querySelectorAll("#segTrain button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.trainSet));
  renderSteps(); spinTrain(); markTrain();
}
function spinTrain() {
  const svg = $("trainSvg"); if (!svg) return;
  svg.querySelectorAll(".gear").forEach((el) => {
    const id = el.dataset.g;
    let a;
    if (id === "anchor") a = pose.anchor;
    else { const ga = GEAR_ANGLE[id]; a = pose[ga[0]] - (ga[1] ? P0[ga[0]] : 0); }
    el.firstChild.setAttribute("transform", "rotate(" + (a * 180 / Math.PI).toFixed(3) + ")");
  });
  svg.querySelectorAll(".hand").forEach((el) => { el.setAttribute("transform", "rotate(" + (pose[el.dataset.h] * 180 / Math.PI).toFixed(3) + ")"); });
}
function markTrain() {
  const svg = $("trainSvg"); if (!svg) return;
  const lit = S.mesh ? S.mesh.split(",") : [];
  svg.querySelectorAll(".gear").forEach((el) => {
    const id = el.dataset.g, k = id === "anchor" ? "anchor" : GBY[id].part;
    el.classList.toggle("lit", lit.indexOf(id) >= 0);
    el.classList.toggle("sel", k === S.sel && !lit.length);
  });
  document.querySelectorAll("#meshSteps li").forEach((li) => li.classList.toggle("now", li.dataset.m === S.mesh));
}
function stepLi(m, title, body, res) {
  return "<li data-m='" + m + "'><b>" + esc(title) + "</b> " + esc(body) + (res ? "<span class='res'>" + esc(res) + "</span>" : "") + "</li>";
}
function renderSteps() {
  const centres = (a, b) => T("Their centres are {c} mm apart: ({w} + {p}) × {m} mm ÷ 2.", { c: fx((a.teeth + b.teeth) * a.module / 2, 2), w: a.teeth, p: b.teeth, m: fx(a.module, 1) });
  const up = (w, p) => {
    const a = GBY[w], b = GBY[p], r = a.teeth / b.teeth;
    return stepLi(w + "," + p, T("{a} drives {b}", { a: gearName(w), b: gearName(p) }),
      T("{w} teeth push {p} leaves round, so every turn of the first gives {r} turns of the second, the other way round.", { w: a.teeth, p: b.teeth, r: fx(r, r % 1 ? 2 : 0) }) + " " + centres(a, b),
      dur(turnOf(a)[0]) + " → " + dur(turnOf(b)[0]));
  };
  const down = (w, p) => {
    const a = GBY[w], b = GBY[p];
    return stepLi(w + "," + p, T("{a} drives {b}", { a: gearName(w), b: gearName(p) }),
      T("Here the small gear drives the big one, so the motion slows down: {p} leaves ÷ {w} teeth = 1/{r}.", { p: a.teeth, w: b.teeth, r: fx(b.teeth / a.teeth, 0) }) + " " + centres(a, b),
      dur(turnOf(a)[0]) + " → " + dur(turnOf(b)[0]));
  };
  let h;
  if (S.trainSet === "going") {
    h = up("great", "centrePinion") + up("centre", "thirdPinion") + up("third", "escapePinion") +
      stepLi("escape,anchor", T("The escape wheel and the pallets"),
        T("Its {z} teeth pass the pallets one per full swing of the pendulum ({s}), so the escape wheel turns once in {e}. This is where the time is set; each ratio above only multiplies it.", { z: GBY.escape.teeth, s: dur(PERIOD), e: dur(D.escapeTurnSeconds) }),
        dur(D.escapeTurnSeconds) + " × 12 × 10 = " + dur(D.centreTurnSeconds));
  } else {
    h = down("cannon", "minuteWheel") + down("minutePinion", "hourWheel") +
      stepLi("cannon,hourWheel", T("Both hands on one arbor"),
        T("The cannon pinion carries the minute hand and the hour wheel rides on it carrying the hour hand. The motion goes out through two meshes and comes back, so both hands turn clockwise."),
        dur(D.centreTurnSeconds) + " × 3 × 4 = " + dur(D.centreTurnSeconds * D.hourRatio));
  }
  $("meshSteps").innerHTML = h;
  $("meshSteps").querySelectorAll("li").forEach((li) => {
    li.tabIndex = 0;
    const on = () => { S.mesh = li.dataset.m; markTrain(); }, off = () => { S.mesh = null; markTrain(); };
    li.addEventListener("mouseenter", on); li.addEventListener("focus", on);
    li.addEventListener("mouseleave", off); li.addEventListener("blur", off);
  });
}
document.querySelectorAll("#segTrain button").forEach((b) => b.addEventListener("click", () => { S.trainSet = b.dataset.v; S.mesh = null; drawTrain(); }));

function renderTrain() {
  const tr = SP.train, mo = SP.motion, rows = [
    ["barrel", "—", tr[0].wheel, D.barrelTurnSeconds, ACW()],
    ["centre", tr[1].pinion, tr[1].wheel, D.centreTurnSeconds, CW()],
    ["third", tr[2].pinion, tr[2].wheel, D.escapeTurnSeconds / D.perEscape.third, ACW()],
    ["escape", tr[3].pinion, tr[3].wheel, D.escapeTurnSeconds, CW()],
    ["cannon", mo.cannon, "—", D.centreTurnSeconds, CW()],
    ["minuteWheel", mo.minutePinion, mo.minuteWheel, D.centreTurnSeconds * mo.minuteWheel / mo.cannon, ACW()],
    ["hourWheel", "—", mo.hourWheel, D.centreTurnSeconds * D.hourRatio, CW()]
  ];
  const r1 = tr[0].wheel / tr[1].pinion, r2 = tr[1].wheel / tr[2].pinion, r3 = tr[2].wheel / tr[3].pinion;
  $("trainBody").innerHTML = table([T("Arbor"), T("Pinion leaves"), T("Teeth"), T("One turn every"), T("Turns"), T("Turns so far")],
    rows.map((r) => [part(r[0]).name, r[1], r[2], dur(r[3]), r[4], { live: r[0], text: "" }])) +
    "<ul class='facts'><li>" + esc(T("Escape-wheel turns per barrel turn: {a} × {b} × {c} = {r}", {
      a: tr[0].wheel + "/" + tr[1].pinion, b: tr[1].wheel + "/" + tr[2].pinion, c: tr[2].wheel + "/" + tr[3].pinion, r: fx(r1 * r2 * r3, 0) })) + "</li>" +
    "<li>" + esc(T("The escape wheel moves one tooth per full swing: {z} teeth × {s} = one turn in {e}.", { z: tr[3].wheel, s: dur(PERIOD), e: dur(D.escapeTurnSeconds) })) + "</li>" +
    "<li>" + esc(T("So the centre arbor turns once in {e} × {r} = {c}: the minute hand.", { e: dur(D.escapeTurnSeconds), r: fx(1 / D.perEscape.centre, 0), c: dur(D.centreTurnSeconds) })) + "</li>" +
    "<li>" + esc(T("Motion work: {a} × {b} = {r}, so the hour hand turns once in 12 hours.", { a: mo.minuteWheel + "/" + mo.cannon, b: mo.hourWheel + "/" + mo.minutePinion, r: fx(D.hourRatio, 0) })) + "</li></ul>";
}
function renderTime() {
  const L = Number($("rngLen").value), Tn = 2 * Math.PI * Math.sqrt(L / 1000 / C.G), err = (1 - PERIOD / Tn) * 86400;
  $("outLen").textContent = fx(L, 1) + " mm";
  const sens = 86400 * 0.5 / D.pendulumLength;   // seconds a day lost per mm longer
  const verdict = Math.abs(L - D.pendulumLength) < 0.05 ? T("keeps time") : err > 0 ? T("loses {d} a day", { d: dur(Math.abs(err)) }) : T("gains {d} a day", { d: dur(Math.abs(err)) });
  $("timeBody").innerHTML = table([T("Fact"), T("Value")], [
    [T("One full swing (T)"), fx(Tn, 3) + " s"], [T("Beats a minute"), fx(120 / Tn, 1)],
    [T("This clock would"), verdict],
    [T("The model's pendulum"), fx(D.pendulumLength, 1) + " mm → " + fx(PERIOD, 3) + " s"],
    [T("1 mm longer makes it lose"), T("{s} a day", { s: dur(sens) })]
  ]) + "<p class='fine'>" + esc(T("That is why a pendulum bob has a nut underneath: turning it moves the bob a fraction of a millimetre to regulate the clock.")) + "</p>";
}
function renderEsc() {
  const half = Math.PI / SP.train[3].wheel;
  $("escBody").innerHTML = table([T("Fact"), T("Value")], [
    [T("Beats a second"), fx(2 / PERIOD, 0)], [T("The escape wheel turns each beat"), fx(half * 180 / Math.PI, 1) + "° (" + T("half a tooth") + ")"],
    [T("Share of each beat spent locked"), fx(100 * (1 - 2 * C.IMPULSE), 0) + " %"], [T("Pallets span"), T("{n} teeth", { n: fx(SP.anchorSpan, 1) })],
    [T("Right now"), { live: "escState", text: "" }]
  ]);
}
function renderPower() {
  $("powerBody").innerHTML = table([T("Fact"), T("Value")], [
    [T("Mainspring turns"), fx(SP.mainspring.turns, 0)], [T("One barrel turn lasts"), dur(D.barrelTurnSeconds)],
    [T("Fully wound, it runs for"), fx(SP.mainspring.turns, 0) + " × " + dur(D.barrelTurnSeconds) + " = " + dur(RESERVE)],
    [T("Speed-up from barrel to escape wheel"), "× " + fx(1 / D.perEscape.barrel, 0)],
    [T("Left in the spring"), { live: "spring", text: "" }]
  ]) + "<div class='bar' id='springBar'><i></i></div>" +
    "<p class='fine'>" + esc(T("The train trades force for speed: the escape wheel turns 960 times faster than the barrel, so the force on its teeth is 960 times smaller, less the friction lost along the way. The pendulum needs only that tiny push.")) + "</p>";
}

// ---------------------------------------------------------------- live readouts
function hms(p) {
  const h = C.timeShown(p), H = Math.floor(h), mAll = (h - H) * 60, M = Math.floor(mAll), Ss = Math.floor((mAll - M) * 60 + 1e-6);
  return (H === 0 ? 12 : H) + ":" + String(M).padStart(2, "0") + ":" + String(Math.min(59, Ss)).padStart(2, "0");
}
function escState() {
  const x = 2 * S.t / PERIOD, w = C.IMPULSE, n = Math.floor(x + w), f = x - n + w;   // f: 0 … 1 through a beat, impulse first
  if (S.stopped) return { ph: "lock", text: T("Locked: the spring has run down") };
  if (f < 2 * w) return { ph: "impulse", text: T("Impulse: the wheel is turning") };
  if (f < 2 * w + 0.1) return { ph: "drop", text: T("Dropped and locked again") };
  return { ph: "lock", text: (n % 2 ? T("Locked on the exit pallet") : T("Locked on the entry pallet")) };
}
let lastUI = 0;
function updateUI(force) {
  const now = performance.now(); if (!force && now - lastUI < 120) return; lastUI = now;
  const e = escState(), left = Math.max(0, RESERVE - (S.t - S.wound));
  const fast = Object.keys(P.PARTS).filter((k) => ghosted(k, S.playing ? S.speed : 0));
  $("readout").innerHTML = "<div class='big'>" + hms(pose) + "</div>" +
    "<span class='k'>" + esc(T("Escapement")) + "</span><span class='v" + (e.ph === "impulse" ? " ok" : "") + "'>" + esc(fast.indexOf("escape") >= 0 ? T("too fast to see") : e.ph === "impulse" ? T("impulse") : T("locked")) + "</span>" +
    "<span class='k'>" + esc(T("Beats")) + "</span><span class='v'>" + Math.max(0, Math.floor(2 * (S.t - S.wound) / PERIOD + C.IMPULSE)).toLocaleString(I.locale) + "</span>" +
    "<span class='k'>" + esc(T("Spring")) + "</span><span class='v" + (S.stopped ? " no" : "") + "'>" + esc(S.stopped ? T("run down") : dur(left)) + "</span>" +
    (fast.length ? "<span class='ghost'>" + esc(T("Too fast to follow, drawn faint: {list}", { list: fast.map((k) => part(k).name).join(", ") })) + "</span>" : "") +
    (S.stopped ? "<span class='ghost'>" + esc(T("The clock has stopped. Wind it in the Power tab.")) + "</span>" : "");
  document.querySelectorAll("#phases li").forEach((li) => li.classList.toggle("now", li.dataset.ph === e.ph));
  document.querySelectorAll("[data-live]").forEach((td) => {
    const k = td.dataset.live;
    if (k === "escState") td.textContent = e.text;
    else if (k === "spring") td.textContent = S.stopped ? T("run down") : dur(left) + " (" + fx(100 * left / RESERVE, 0) + " %)";
    else td.textContent = fx(Math.abs(pose[k] - P0[k]) / (2 * Math.PI), 2);
  });
  const bar = $("springBar");
  if (bar) { bar.firstChild.style.width = (100 * left / RESERVE) + "%"; bar.classList.toggle("low", left < RESERVE * 0.15); bar.classList.toggle("empty", left <= 0); }
  if (S.path) {
    const i = Math.floor((wall * 2.2 / 0.85) % (P.POWER_PATH.length + 2));
    document.querySelectorAll("#pathList li[data-k]").forEach((li) => li.classList.toggle("now", PATH_INDEX[li.dataset.k] === i && (li.classList.contains("sub") || P.POWER_PATH.indexOf(li.dataset.k) >= 0)));
  }
}

// ---------------------------------------------------------------- the loop
let last = performance.now(), lastBeat = Math.floor(2 * S.t / PERIOD + C.IMPULSE);
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; wall += dt;
  advance(dt);
  const beat = Math.floor(2 * S.t / PERIOD + C.IMPULSE);
  if (beat !== lastBeat) { if (S.sound && S.speed <= 1 && beat - lastBeat === 1) tick(beat % 2); lastBeat = beat; }
  applyPose();
  if (tween) {
    tween.k = Math.min(1, tween.k + dt * 1000 / tween.ms);
    const s = tween.k * tween.k * (3 - 2 * tween.k);
    camera.position.lerpVectors(tween.p0, tween.p1, s); controls.target.lerpVectors(tween.t0, tween.t1, s);
    if (tween.k >= 1) tween = null;
  }
  controls.update();
  paint();
  updateUI(false);
  if (S.tab === "train") spinTrain();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
controls.addEventListener("start", () => { tween = null; });

// ---------------------------------------------------------------- start
buildParts();
setSpeed(1); setPlaying(true);
renderTrain(); drawTrain(); renderTime(); renderEsc(); renderPower();
$("rngLen").value = D.pendulumLength;
$("rngLen").addEventListener("input", renderTime);
select(S.sel, false);
showTab("part");
document.querySelectorAll("#segView button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.view));
// test hooks for the page checks
window.__esc = { S, D, pose: () => pose, nodes, moving, meshes, setSpeed, select, wind, camera, controls, VERSION };
requestAnimationFrame(loop);
