/*
 * visualization.js — the 3D view (three.js r186, ES module).
 *
 * "Live" view: procedural geometry built from the same parameters and the
 * same calculations.js layout (row positions, level heights, per-slot cycle
 * times) as the KPIs and the floor plan — rebuilt on every change. Racks are
 * drawn the way they're built: uprights at every frame line and lane, beams
 * at every level, and pallets in their positions (instanced, so tens of
 * thousands stay fast). Two colourings: "Stock" shows the current inventory
 * (a fixed random pattern), "Travel time" shows every position coloured by
 * its own average lift-truck cycle time, and "ABC class" (with class-based
 * storage) shows which positions hold the fast, medium and slow movers.
 *
 * "Reference" view: the real FreeCAD export (web/models/warehouse_baseline.glb)
 * at its baseline values — static on purpose, a baked mesh can't resize.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const COLOR = {
  bg: 0x0a2f52,
  structure: 0x2a4258,
  outline: 0x5b86ad,
  slab: 0x33475c,
  apron: 0x16263a,
  upright: 0x2f6fd0,
  beam: 0xf07a1a,
  wood: 0xa7804d,
  dock: 0x199e70,
  trailer: 0xdfe6ee,
  zone: 0xc98500,
  marking: 0xf2c230,
  routeIn: 0x7be0c4,
  routeOut: 0xffb27a,
  select: 0x7dd3fc
};
// stretch-wrapped / cardboard loads, so the stock doesn't read as one solid block
const LOADS = [0xc9a46a, 0xd9cbb1, 0xb58b52, 0xa9bfd0, 0xcfb58a, 0xe2dccf];
const MAX_WITH_BASES = 120000;   // above this many pallets, draw loads only (no pallet bases)
const MAX_SHADOW_CASTERS = 40000; // bigger instanced sets don't cast shadows (the shadow pass would double their cost)

// engineering coords (x = length, y = width, z = up) → scene (X, Y up, Z)
function S(x, y, z) { return new THREE.Vector3(x, z, y); }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CLASS_COLORS = [0xf2a33a, 0x33bf9e, 0x2e6bd9];   // A, B, C
// blue → teal → amber → red, for the travel-time heat map
const HEAT = [[0.18, 0.42, 0.85], [0.2, 0.75, 0.62], [0.96, 0.72, 0.2], [0.89, 0.29, 0.28]];
function heatColor(u, c) {
  u = Math.max(0, Math.min(1, u)) * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(u)), f = u - i, a = HEAT[i], b = HEAT[i + 1];
  return c.setRGB(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, THREE.SRGBColorSpace);
}

function disposeGroup(group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const obj = group.children[i];
    group.remove(obj);
    if (obj.children && obj.children.length) disposeGroup(obj);
    if (obj.geometry && obj.geometry !== unitBox) obj.geometry.dispose();
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    if (obj.isInstancedMesh) obj.dispose();
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
function std(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.7, metalness: 0.05 }, opts || {})); }
// an axis-aligned box in engineering coords: origin corner (x, y, z), size (w along x, d along y, h up)
function box(w, d, h, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.copy(S(x + w / 2, y + d / 2, z + h / 2));
  return mesh;
}

export function Visualization(stageEl) {
  this.stageEl = stageEl;
  const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  stageEl.appendChild(r.domElement);

  this.scene = new THREE.Scene();
  this.scene.background = new THREE.Color(COLOR.bg);
  this.scene.fog = new THREE.Fog(COLOR.bg, 250, 900);
  const pmrem = new THREE.PMREMGenerator(r);
  this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  this.scene.environmentIntensity = 0.55;

  this.camera = new THREE.PerspectiveCamera(42, 1, 0.3, 3000);
  this.controls = new OrbitControls(this.camera, r.domElement);
  this.controls.enableDamping = true;
  this.controls.dampingFactor = 0.08;
  this.controls.maxPolarAngle = 1.52;
  this.controls.minDistance = 5;
  this.controls.maxDistance = 900;
  this.controls.screenSpacePanning = false;

  this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a2a3a, 0.55));
  const sun = this.sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  this.scene.add(sun, sun.target);

  this.liveGroup = new THREE.Group();
  this.scene.add(this.liveGroup);
  this.routeGroup = new THREE.Group();
  this.scene.add(this.routeGroup);
  this.referenceGroup = new THREE.Group();
  this.referenceGroup.visible = false;
  this.scene.add(this.referenceGroup);
  this.referenceLoaded = false;
  this.referenceLoadFailed = false;

  this.selectable = [];
  this.colorMode = "stock";
  this.showWalls = true;
  this.mode = "live";
  this.stats = {};
  this.heat = null;
  this._pending = null;
  this._onSelect = null;
  this._home = null;
  this._dirty = true;            // render on demand: only when something changed
  this._lastFrame = 0;
  this._slow = 0;                // consecutive slow frames (adaptive quality)
  this.quality = "high";
  this.controls.addEventListener("change", () => { this._dirty = true; });
  this._setupInput();
}

Visualization.prototype._setupInput = function () {
  const dom = this.renderer.domElement;
  dom.style.touchAction = "none";
  let down = null;
  dom.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  dom.addEventListener("pointerup", (e) => {
    if (down && Math.abs(e.clientX - down.x) < 4 && Math.abs(e.clientY - down.y) < 4) this._handleClick(e);
    down = null;
  });
};

Visualization.prototype._handleClick = function (e) {
  const rect = this.renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, this.camera);
  const hits = this.mode === "live" ? ray.intersectObjects(this.selectable, false) : [];
  this.clearSelection();
  if (!hits.length) { if (this._onSelect) this._onSelect(null); return; }
  const hit = hits[0], obj = hit.object;
  if (obj.userData.row !== undefined) this.selectSlot(obj.userData.row, hit.point);
  else {
    obj.material.emissive.setHex(0x0e4a66); this._dirty = true;
    this._selectedMesh = obj;
    if (this._onSelect) this._onSelect(obj.userData.info);
  }
};

Visualization.prototype.clearSelection = function () {
  disposeGroup(this.routeGroup);
  this._dirty = true;
  if (this._selectedMesh) { this._selectedMesh.material.emissive.setHex(0x000000); this._selectedMesh = null; }
  this.selectedSlot = null;
};

// Select the bay/level of a rack row under a scene-space point (or explicit
// indices), draw the inbound and outbound routes to it, report its numbers.
Visualization.prototype.selectSlot = function (rowIndex, point, bay, level) {
  const p = this._p, res = this._r, L = res.layout, calc = window.WH.calc;
  if (bay === undefined) {                       // the bay under the point (nearest one if it's in a mid cross-aisle)
    bay = 0;
    L.bayX.forEach((x, b) => { if (Math.abs(point.x - (x + p.bay_width / 2)) < Math.abs(point.x - (L.bayX[bay] + p.bay_width / 2))) bay = b; });
  }
  if (level === undefined) {
    level = 0;
    L.levelHeights.forEach((h, k) => { if (point.y >= h - 0.05) level = k; });
  }
  bay = Math.max(0, Math.min(L.baysPerRow - 1, bay));
  level = Math.max(0, Math.min(L.levelHeights.length - 1, level));
  const row = L.rows[rowIndex], st = calc.slotTimes(p, L, rowIndex, bay, level);
  this.clearSelection();
  this._dirty = true;
  this.selectedSlot = { row: rowIndex, bay: bay, level: level, times: st };

  // highlight the bay at that level
  const levelTop = level + 1 < L.levelHeights.length ? L.levelHeights[level + 1] : st.z + p.load_height + 0.2;
  const hl = box(p.bay_width, row.depth, Math.max(0.3, levelTop - st.z), L.bayX[bay], row.y, st.z,
    new THREE.MeshBasicMaterial({ color: COLOR.select, transparent: true, opacity: 0.28, depthWrite: false }));
  this.routeGroup.add(hl);

  // routes: nearest receiving door → staging → aisle → bay, and on to the nearest shipping door
  const D = calc.doorSets(p);
  const nearest = (ds) => ds.reduce((b, d) => (Math.abs(d - st.aisleY) < Math.abs(b - st.aisleY) ? d : b), ds[0]);
  const yin = nearest(D.inY), yout = nearest(D.outY), sx = p.cross_aisle_width / 2, ex = D.u ? sx : p.warehouse_length - p.cross_aisle_width / 2;
  const seg = (a, b, color) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    // drawn over everything (no depth test), or the racks would hide most of the route
    const m = new THREE.Mesh(new THREE.BoxGeometry(dx ? len + 0.5 : 0.5, 0.06, dy ? len + 0.5 : 0.5), new THREE.MeshBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: 0.9 }));
    m.position.copy(S((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.08));
    m.renderOrder = 10;
    this.routeGroup.add(m);
  };
  [[[0, yin], [sx, yin]], [[sx, yin], [sx, st.aisleY]], [[sx, st.aisleY], [st.x, st.aisleY]]].forEach((s) => seg(s[0], s[1], COLOR.routeIn));
  [[[st.x, st.aisleY], [ex, st.aisleY]], [[ex, st.aisleY], [ex, yout]], [[ex, yout], [D.outX, yout]]].forEach((s) => seg(s[0], s[1], COLOR.routeOut));
  if (st.z > 0) {
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.18, st.z, 0.18), new THREE.MeshBasicMaterial({ color: COLOR.select, depthTest: false, transparent: true, opacity: 0.9 }));
    mast.position.copy(S(st.x, st.aisleY, st.z / 2));
    mast.renderOrder = 10;
    this.routeGroup.add(mast);
  }

  const W = res.slots && res.slots.weights, ci = (rowIndex * L.baysPerRow + bay) * L.levelHeights.length + level;
  if (this._onSelect) this._onSelect({
    type: "Storage slot · " + L.rackType.label,
    ...(W && W.abc ? { "ABC class": "ABC"[W.cls[ci]] + " (" + Math.round(W.shares[W.cls[ci]] * 100) + "% of moves)" } : {}),
    name: "Row " + row.index + " · bay " + (bay + 1) + " · level " + (level + 1),
    "beam height": st.z.toFixed(2) + " m",
    "putaway cycle": Math.round(st.tIn) + " s (in)",
    "retrieval cycle": Math.round(st.tOut) + " s (out)",
    "vs. average": (st.t >= res.travel.cycleTime ? "+" : "−") + Math.abs(Math.round(st.t - res.travel.cycleTime)) + " s",
    "route shown": "from/to the nearest doors",
    "positions here": p.positions_per_level_per_bay * L.rackType.deep,
    "served by": L.rackType.truck
  });
};

Visualization.prototype.onSelect = function (cb) { this._onSelect = cb; };

Visualization.prototype.resize = function () {
  const w = this.stageEl.clientWidth, h = this.stageEl.clientHeight;
  if (w === 0 || h === 0) return;
  this.renderer.setSize(w, h);
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
  this._dirty = true;
};

// Called every animation frame; draws only when the scene or the camera changed.
// If frames keep coming slowly while drawing (a weak GPU, a huge design), shadows
// are switched off to keep orbiting responsive.
Visualization.prototype.render = function () {
  if (this._pending && this.mode === "live") { const q = this._pending; this._pending = null; this._build(q.p, q.results); this._dirty = true; }
  this.controls.update();
  if (this.anim) { this._animFrame(); this._dirty = true; }
  const now = performance.now();
  if (!this._dirty) { this._lastFrame = 0; return; }
  this._dirty = false;
  this.renderer.render(this.scene, this.camera);
  if (this._lastFrame) {
    this._slow = now - this._lastFrame > 60 ? this._slow + 1 : 0;
    if (this._slow >= 12 && this.quality === "high") this.setQuality("low");
  }
  this._lastFrame = now;
};
Visualization.prototype.setQuality = function (q) {
  this.quality = q;
  this.renderer.shadowMap.enabled = q === "high";
  this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  this._dirty = true;
  if (this._onQuality) this._onQuality(q);
};
Visualization.prototype.invalidate = function () { this._dirty = true; };

Visualization.prototype.resetView = function () {
  if (!this._home) return;
  this.camera.position.copy(this._home.pos);
  this.controls.target.copy(this._home.target);
  this.controls.update();
  this._dirty = true;
};

Visualization.prototype.setColorMode = function (mode) { this.colorMode = mode; if (this._p) this.rebuildLive(this._p, this._r); };
Visualization.prototype.setWalls = function (on) { this.showWalls = on; this.liveGroup.traverse((o) => { if (o.userData.wall) o.visible = on; }); this._dirty = true; };

// Rebuilds are coalesced to one per frame, so dragging a slider stays smooth.
Visualization.prototype.rebuildLive = function (p, results) {
  this._p = p; this._r = results;
  this._pending = { p: p, results: results };
};

Visualization.prototype._build = function (p, results) {
  const sel = this.selectedSlot, hadSelection = !!(sel || this._selectedMesh);
  this.clearSelection();
  disposeGroup(this.liveGroup);
  this.selectable.length = 0;
  const L = results.layout, rt = L.rackType;
  const WL = p.warehouse_length, WW = p.warehouse_width, WT = p.wall_thickness / 1000, CH = p.clear_height;
  const G = this.liveGroup;
  const dummy = new THREE.Object3D();
  const place = (im, i, x, y, z, sx, sy, sz) => {      // centre (x, y, z) in engineering coords, size along x, y, up
    dummy.position.set(x, z, y); dummy.scale.set(sx, sz, sy); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
  };
  const instanced = (mat, count, shadow) => {
    const im = new THREE.InstancedMesh(unitBox, mat, Math.max(1, count));
    im.count = count; im.castShadow = !!shadow && count <= MAX_SHADOW_CASTERS; im.receiveShadow = true; im.frustumCulled = false;
    G.add(im); return im;
  };

  // ground, apron and floor slab
  const apron = box(WL + 2 * WT + 70, WW + 2 * WT + 40, 0.05, -WT - 35, -WT - 20, -0.25, std(COLOR.apron, { roughness: 0.95 }));
  apron.receiveShadow = true; G.add(apron);
  const slab = box(WL + 2 * WT, WW + 2 * WT, 0.2, -WT, -WT, -0.2, std(COLOR.slab, { roughness: 0.85 }));
  slab.receiveShadow = true; G.add(slab);

  // staging zones and aisle edge markings
  const zoneMat = new THREE.MeshBasicMaterial({ color: COLOR.zone, transparent: true, opacity: 0.18, depthWrite: false });
  G.add(box(p.cross_aisle_width, WW, 0.02, 0, 0, 0.005, zoneMat));
  G.add(box(p.cross_aisle_width, WW, 0.02, WL - p.cross_aisle_width, 0, 0.005, zoneMat.clone()));
  const segs = L.segments.filter((sg) => sg.bays > 0);
  if (L.baysPerRow > 0 && L.aisles.length) {
    const marks = instanced(new THREE.MeshBasicMaterial({ color: COLOR.marking }), L.aisles.length * 2 * segs.length);
    let im = 0;
    segs.forEach((sg) => L.aisles.forEach((a) => [-1, 1].forEach((s) => place(marks, im++, sg.x0 + sg.length / 2, a.y + s * (a.width / 2 - 0.15), 0.012, sg.length, 0.08, 0.01))));
    marks.receiveShadow = false;
  }
  for (let k = 0; k + 1 < L.segments.length; k++) {           // mid cross-aisles
    const x = L.segments[k].x0 + L.segmentLength;
    G.add(box(p.mid_cross_aisle_width, WW, 0.02, x, 0, 0.005, new THREE.MeshBasicMaterial({ color: COLOR.routeIn, transparent: true, opacity: 0.1, depthWrite: false })));
  }

  // walls (translucent), and the building outline up to the clear height
  const wallMat = std(COLOR.structure, { transparent: true, opacity: 0.18, depthWrite: false, roughness: 0.9 });
  [[WT, WW, -WT, 0], [WT, WW, WL, 0], [WL + 2 * WT, WT, -WT, -WT], [WL + 2 * WT, WT, -WT, WW]].forEach((w) => {
    const m = box(w[0], w[1], CH, w[2], w[3], 0, wallMat); m.userData.wall = true; m.visible = this.showWalls; G.add(m);
  });
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(WL + 2 * WT, CH, WW + 2 * WT)), new THREE.LineBasicMaterial({ color: COLOR.outline, transparent: true, opacity: 0.6 }));
  outline.position.copy(S(WL / 2, WW / 2, CH / 2)); G.add(outline);

  // racks: uprights at every frame line and lane boundary, beams at every level above the floor
  const nb = L.baysPerRow, nl = L.levelHeights.length, deep = rt.deep, side = p.positions_per_level_per_bay;
  const x0 = p.cross_aisle_width, upH = Math.min(p.rack_height + 0.35, CH);
  let nPallets = 0;
  this.heat = null;
  if (nb > 0 && L.rows.length) {
    const ups = instanced(std(COLOR.upright, { metalness: 0.35, roughness: 0.45 }), L.rows.length * (nb + segs.length) * (deep + 1), true);
    const beams = instanced(std(COLOR.beam, { metalness: 0.3, roughness: 0.45 }), L.rows.length * nb * (nl - 1) * (deep + 1), true);
    let iu = 0, ib = 0;
    L.rows.forEach((row) => {
      segs.forEach((sg) => {
        for (let b = 0; b <= sg.bays; b++) for (let d = 0; d <= deep; d++) {
          place(ups, iu++, sg.x0 + b * p.bay_width, row.y + Math.min(row.depth - 0.04, Math.max(0.04, d * p.rack_depth)), upH / 2, 0.09, 0.09, upH);
        }
      });
      for (let b = 0; b < nb; b++) for (let k = 1; k < nl; k++) for (let d = 0; d <= deep; d++) {
        place(beams, ib++, L.bayX[b] + 0.5 * p.bay_width, row.y + Math.min(row.depth - 0.03, Math.max(0.03, d * p.rack_depth)), L.levelHeights[k] - 0.07, p.bay_width - 0.09, 0.05, 0.13);
      }
    });

    // pallets: "stock" = the current inventory in a fixed random pattern; "heat" = every position by travel time
    const W = results.slots.weights, mode = this.colorMode === "class" && !W.abc ? "stock" : this.colorMode;
    const cap = results.capacity.storageCapacity, heat = mode !== "stock";
    const grid = results.slots.grid;
    this.heat = mode === "heat" ? { min: grid.min, max: grid.max } : null;
    const show = heat ? cap : Math.min(cap, Math.round(p.current_inventory_pallets));
    let occupied = null;
    if (!heat) {                                    // choose `show` of the `cap` positions, same pattern each time
      const idx = new Uint32Array(cap);
      for (let i = 0; i < cap; i++) idx[i] = i;
      const rnd = mulberry32(12345);
      for (let i = 0; i < show; i++) { const j = i + Math.floor(rnd() * (cap - i)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      occupied = new Uint8Array(cap);
      for (let i = 0; i < show; i++) occupied[idx[i]] = 1;
    }
    const withBases = show <= MAX_WITH_BASES;
    const loads = instanced(std(0xffffff, { roughness: 0.8 }), show, true);
    const bases = withBases ? instanced(std(COLOR.wood, { roughness: 0.9 }), show, true) : null;
    const slotW = p.bay_width / side, pw = Math.max(0.3, slotW - 0.14), pd = Math.max(0.3, p.rack_depth - 0.12);
    const loadH = Math.max(0.2, p.load_height - 0.15), c = new THREE.Color(), rndC = mulberry32(777);
    let pos = 0;
    L.rows.forEach((row, ri) => {
      for (let b = 0; b < nb; b++) for (let k = 0; k < nl; k++) {
        const z = L.levelHeights[k] + (k > 0 ? 0.005 : 0);
        const ci = (ri * nb + b) * nl + k;
        const col = mode === "heat" ? heatColor((grid.t[ci] - grid.min) / Math.max(1e-6, grid.max - grid.min), c)
          : mode === "class" ? c.setHex(CLASS_COLORS[W.cls[ci]]) : null;
        for (let j = 0; j < side; j++) for (let d = 0; d < deep; d++, pos++) {
          if (occupied && !occupied[pos]) continue;
          const x = L.bayX[b] + (j + 0.5) * slotW, y = row.y + (d + 0.5) * p.rack_depth;
          if (bases) place(bases, nPallets, x, y, z + 0.075, pw, pd, 0.15);
          place(loads, nPallets, x, y, z + 0.15 + loadH / 2, pw - 0.04, pd - 0.04, loadH * (heat ? 1 : 0.9 + rndC() * 0.1));
          loads.setColorAt(nPallets, heat ? col : c.setHex(LOADS[Math.floor(rndC() * LOADS.length)]));
          nPallets++;
        }
      }
    });
    loads.count = nPallets; if (bases) bases.count = nPallets;
    if (loads.instanceColor) loads.instanceColor.needsUpdate = true;

    // invisible per-row blocks for picking a bay and level
    const pickMat = new THREE.MeshBasicMaterial({ visible: false });
    L.rows.forEach((row, ri) => segs.forEach((sg) => {
      const m = box(sg.length, row.depth, p.rack_height + p.load_height, sg.x0, row.y, 0, pickMat);
      m.userData.row = ri;
      G.add(m); this.selectable.push(m);
    }));
  }

  // dock doors, and trailers at as many doors as are busy on an average hour
  const util = results.throughput;
  const D = window.WH.calc.doorSets(p);
  const doorsFor = (centres, xWall, outward, role, utilPct) => {
    const count = centres.length, busy = Math.min(count, Math.round(count * Math.min(1, utilPct / 100 / p.peak_hour_factor)));
    for (let i = 0; i < count; i++) {
      const y = centres[i] - p.dock_bay_width / 2;
      const door = box(0.25, p.dock_bay_width - 0.7, 3.0, xWall - 0.125, y + 0.35, 0, std(COLOR.dock, { roughness: 0.5 }));
      door.userData.info = { type: "Dock door", name: role + " Dock " + (i + 1), dimensions: p.dock_bay_width.toFixed(1) + " m bay", role: role === "Receiving" ? "Inbound" : "Outbound", "truck turn": p.truck_turn_time + " min" };
      G.add(door); this.selectable.push(door);
      if (i < busy) {
        const tx = outward < 0 ? xWall - WT - 13.8 : xWall + WT + 0.2;
        const tr = box(13.6, 2.5, 2.7, tx, y + (p.dock_bay_width - 2.5) / 2, 1.1, std(COLOR.trailer, { roughness: 0.6 }));
        tr.castShadow = true; tr.userData.staticTrailer = true; tr.visible = !this.anim; G.add(tr);
      }
    }
  };
  doorsFor(D.inY, -WT / 2, -1, "Receiving", util.inbound.utilizationPct);
  if (D.u) doorsFor(D.outY, -WT / 2, -1, "Shipping", util.outbound.utilizationPct);
  else doorsFor(D.outY, WL + WT / 2, 1, "Shipping", util.outbound.utilizationPct);

  // sun and shadow camera sized to the building
  const span = Math.max(WL, WW) / 2 + 20, cx = WL / 2, cz = WW / 2;
  this.sun.position.set(cx + span * 0.6, span * 1.4, cz + span * 0.9);
  this.sun.target.position.set(cx, 0, cz);
  const sc = this.sun.shadow.camera;
  sc.left = -span * 1.2; sc.right = span * 1.2; sc.top = span * 1.2; sc.bottom = -span * 1.2; sc.near = 1; sc.far = span * 5;
  sc.updateProjectionMatrix();

  // camera: frame the building when the footprint changes a lot, otherwise leave the user's view alone
  const diag = Math.hypot(WL, WW), target = new THREE.Vector3(cx, 0, cz);
  if (this._lastFitDiag === undefined || Math.abs(diag - this._lastFitDiag) / this._lastFitDiag > 0.15) {
    const dist = Math.max(30, diag * 1.0);
    const pos = new THREE.Vector3(cx + dist * 0.5, dist * 0.62, cz + dist * 0.72);
    this.camera.position.copy(pos); this.controls.target.copy(target);
    this._home = { pos: pos.clone(), target: target.clone() };
    this._lastFitDiag = diag;
  }
  this.stats = { pallets: nPallets, rows: L.rows.length, withBases: nPallets <= MAX_WITH_BASES };

  // keep a selected slot selected across rebuilds while it still exists
  if (sel && sel.row < L.rows.length && sel.bay < L.baysPerRow && sel.level < L.levelHeights.length) this.selectSlot(sel.row, null, sel.bay, sel.level);
  else if (hadSelection && this._onSelect) this._onSelect(null);
};

// ---------------------------------------------------------------------------
// Reference model — the real FreeCAD GLB export, loaded once
// ---------------------------------------------------------------------------
Visualization.prototype.loadReferenceModel = function (url, onDone) {
  if (this.referenceLoaded || this.referenceLoadFailed) { if (this.referenceLoaded) this._frameReference(); onDone(this.referenceLoaded); return; }
  new GLTFLoader().load(url, (gltf) => {
    // FreeCAD's exporter already converts mm → m and Z-up → Y-up (glTF convention); only the
    // width axis comes out negative, so shift it to start at 0 like the live view.
    const bb = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.z -= bb.min.z;
    gltf.scene.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const n = node.name;
      node.material = node.material.clone();
      node.castShadow = true; node.receiveShadow = true;
      if (n.indexOf("Roof") === 0 || n.indexOf("Wall") >= 0) {
        Object.assign(node.material, { transparent: true, opacity: n.indexOf("Roof") === 0 ? 0.08 : 0.16, depthWrite: false });
        node.material.color.setHex(COLOR.structure); node.castShadow = false;
      } else if (n.indexOf("Rack_Row") === 0 || n.indexOf("RackRow") === 0) node.material.color.setHex(COLOR.beam);
      else if (n.indexOf("Dock") >= 0) node.material.color.setHex(COLOR.dock);
      else if (n.indexOf("Zone") >= 0) { Object.assign(node.material, { transparent: true, opacity: 0.25 }); node.material.color.setHex(COLOR.zone); }
      else if (n.indexOf("Floor") === 0) node.material.color.setHex(COLOR.slab);
    });
    this.referenceGroup.add(gltf.scene);
    this.referenceLoaded = true;
    this._refBox = new THREE.Box3().setFromObject(gltf.scene);
    this._frameReference();
    onDone(true);
  }, undefined, (err) => {
    console.error("Reference GLB failed to load:", err);
    this.referenceLoadFailed = true;
    onDone(false);
  });
};
Visualization.prototype._frameReference = function () {
  const size = new THREE.Vector3(), c = new THREE.Vector3();
  this._refBox.getSize(size); this._refBox.getCenter(c);
  const dist = Math.max(30, Math.hypot(size.x, size.z));
  this.controls.target.set(c.x, 0, c.z);
  this.camera.position.set(c.x + dist * 0.5, dist * 0.62, c.z + dist * 0.72);
  this._dirty = true;
};

// ---------------------------------------------------------------------------
// Day playback — replays one simulated day (simulation.js event log):
// trailers queue in the yard and dock at their doors, lift trucks drive each
// task's route (door → staging → aisle → bay, and for dual-command trips on to
// the retrieval bay and the shipping door) in proportion to its duration.
// ---------------------------------------------------------------------------
const LIFT_COLOR = 0xffd23f;
Visualization.prototype.playDay = function (day, p, results, secondsPerDay) {
  this.stopDay();
  if (!day || !day.log) return;
  const log = day.log, L = results.layout, grid = results.slots.grid, D = window.WH.calc.doorSets(p);
  const WT = p.wall_thickness / 1000, WL = p.warehouse_length;
  const g = this.animGroup = new THREE.Group();
  this.scene.add(g);
  // lift trucks: drawn larger than life and through the racks (like the routes), or they'd vanish in the aisles
  const lifts = new THREE.InstancedMesh(unitBox, new THREE.MeshBasicMaterial({ color: LIFT_COLOR, depthTest: false, transparent: true, opacity: 0.95 }), log.lifts);
  lifts.renderOrder = 11; lifts.frustumCulled = false; g.add(lifts);
  const trailers = new THREE.InstancedMesh(unitBox, std(COLOR.trailer, { roughness: 0.6 }), Math.max(1, log.trucks.length));
  trailers.castShadow = true; trailers.frustumCulled = false; g.add(trailers);
  let end = log.close;
  log.tasks.forEach((t) => { if (t.t1 > end) end = t.t1; });
  log.trucks.forEach((t) => { if ((t.left || 0) > end) end = t.left; });
  const tasksByLift = [];
  for (let i = 0; i < log.lifts; i++) tasksByLift.push([]);
  log.tasks.forEach((t) => tasksByLift[t.lift].push(t));
  tasksByLift.forEach((a) => a.sort((x, y) => x.t0 - y.t0));
  this.anim = { day, p, L, grid, D, WT, WL, lifts, trailers, tasksByLift, ptr: new Array(log.lifts).fill(0), end,
    rate: end / (secondsPerDay || 60), start: performance.now(), paused: false, pausedAt: 0 };
  this.liveGroup.traverse((o) => { if (o.userData.staticTrailer) o.visible = false; });
  this.clearSelection();
  // pull back a little so the yard queue outside the doors is in the frame
  if (this._home) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.x -= 12;
    this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(1.15));
  }
  this._dirty = true;
};
Visualization.prototype.stopDay = function () {
  if (!this.anim) return;
  if (this.animGroup) { disposeGroup(this.animGroup); this.scene.remove(this.animGroup); this.animGroup = null; }
  this.anim = null;
  this.liveGroup.traverse((o) => { if (o.userData.staticTrailer) o.visible = true; });
  this._dirty = true;
  if (this._onTick) this._onTick(null);
};
Visualization.prototype.setDaySpeed = function (secondsPerDay) {
  const a = this.anim; if (!a) return;
  const t = this._animTime();
  a.rate = a.end / secondsPerDay; a.start = performance.now() - t / a.rate * 1000;
};
Visualization.prototype._animTime = function () {
  const a = this.anim;
  return Math.min(a.end, (performance.now() - a.start) / 1000 * a.rate);
};
// the route of one task as a polyline in engineering (x, y) coordinates
Visualization.prototype._taskPath = function (task) {
  const a = this.anim, p = a.p, L = a.L, G = a.grid, D = a.D, nbl = G.nb * G.nl;
  const cell = (c) => ({ x: G.bayCx[Math.floor(c / G.nl) % G.nb], y: G.rowAisleY[Math.floor(c / nbl)], aisle: L.rows[Math.floor(c / nbl)].aisle });
  const near = (ds, y) => ds.reduce((b, d) => (Math.abs(d - y) < Math.abs(b - y) ? d : b), ds[0]);
  const sx = p.cross_aisle_width / 2, ex = D.u ? sx : p.warehouse_length - p.cross_aisle_width / 2;
  const outDoorY = (y) => (task.door !== null && task.door !== undefined && D.outY[task.door] !== undefined ? D.outY[task.door] : near(D.outY, y));
  let pts;
  if (task.a === undefined && task.b === undefined) pts = [[0, D.inY[0] || 0], [sx, D.inY[0] || 0]];
  else if (task.kind === "P") { const A = cell(task.a), yin = near(D.inY, A.y); pts = [[0, yin], [sx, yin], [sx, A.y], [A.x, A.y]]; pts = pts.concat(pts.slice(0, -1).reverse()); }
  else if (task.kind === "R") { const B = cell(task.b), yo = outDoorY(B.y); pts = [[D.outX, yo], [ex, yo], [ex, B.y], [B.x, B.y]]; pts = pts.concat(pts.slice(0, -1).reverse()); }
  else {
    const A = cell(task.a), B = cell(task.b), yin = near(D.inY, A.y), yo = outDoorY(B.y);
    pts = [[0, yin], [sx, yin], [sx, A.y], [A.x, A.y]];
    if (A.aisle === B.aisle) pts.push([B.x, B.y]);
    else {
      const c = L.crossAisleX.reduce((best, x) => (Math.abs(A.x - x) + Math.abs(B.x - x) < Math.abs(A.x - best) + Math.abs(B.x - best) ? x : best), L.crossAisleX[0]);
      pts.push([c, A.y], [c, B.y], [B.x, B.y]);
    }
    pts.push([ex, B.y], [ex, yo], [D.outX, yo]);
    if (D.u) pts.push([0, yin]);
    else { const ay = L.aisles.length ? L.aisles[0].y : yin; pts.push([ex, ay], [sx, ay], [sx, yin], [0, yin]); }
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]));
  return { pts, cum };
};
Visualization.prototype._animFrame = function () {
  const a = this.anim, t = this._animTime(), p = a.p, dummy = new THREE.Object3D(), log = a.day.log;
  const set = (im, i, x, y, z, sx, sy, sz) => { dummy.position.set(x, z, y); dummy.scale.set(sx, sz, sy); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); };
  // lift trucks
  let busy = 0;
  for (let i = 0; i < log.lifts; i++) {
    const list = a.tasksByLift[i];
    while (a.ptr[i] < list.length && list[a.ptr[i]].t1 <= t) a.ptr[i]++;
    const task = list[a.ptr[i]];
    let x = p.cross_aisle_width * 0.3, y = 2 + i * 2.2 % Math.max(4, p.warehouse_width - 4);      // parked in the staging zone
    if (task && task.t0 <= t) {
      busy++;
      if (!task.path) task.path = this._taskPath(task);
      const P = task.path, total = P.cum[P.cum.length - 1], d = total * Math.min(1, (t - task.t0) / Math.max(1e-6, task.t1 - task.t0));
      let k = 1; while (k < P.cum.length - 1 && P.cum[k] < d) k++;
      const seg = Math.max(1e-9, P.cum[k] - P.cum[k - 1]), u = Math.min(1, (d - P.cum[k - 1]) / seg);
      x = P.pts[k - 1][0] + (P.pts[k][0] - P.pts[k - 1][0]) * u;
      y = P.pts[k - 1][1] + (P.pts[k][1] - P.pts[k - 1][1]) * u;
    }
    set(a.lifts, i, x, y, 1.4, 2.2, 2.2, 2.8);
  }
  a.lifts.instanceMatrix.needsUpdate = true;
  // trailers: in the yard (queued in arrival order), at their door, or gone
  const yard = { in: [], out: [] };
  let n = 0;
  log.trucks.forEach((tr) => {
    let shown = false;
    if (tr.arrived <= t && (tr.docked === undefined || t < tr.docked)) { yard[tr.side].push(tr); }
    else if (tr.docked !== undefined && tr.docked <= t && (tr.left === undefined || t < tr.left)) {
      const ys = tr.side === "in" ? a.D.inY : a.D.outY, west = tr.side === "in" || a.D.u;
      const y = ys[tr.door];
      if (y !== undefined) { set(a.trailers, n++, west ? -a.WT - 6.9 : a.WL + a.WT + 6.9, y, 2.45, 13.6, 2.5, 2.7); shown = true; }
    }
    return shown;
  });
  ["in", "out"].forEach((side) => {
    const west = side === "in" || a.D.u, x0 = west ? -a.WT - 22 - (side === "out" ? 32 : 0) : a.WL + a.WT + 22;
    yard[side].forEach((tr, k) => {
      const col = Math.floor(k / 12), row = k % 12;
      set(a.trailers, n++, x0 + (west ? -1 : 1) * col * 16, 1.5 + row * 3.4, 2.45, 13.6, 2.5, 2.7);
    });
  });
  a.trailers.count = n;
  a.trailers.instanceMatrix.needsUpdate = true;
  if (this._onTick) this._onTick({ t: t, end: a.end, close: log.close, yard: yard.in.length + yard.out.length, busy: busy, lifts: log.lifts, done: t >= a.end });
  if (t >= a.end && !a.finished) { a.finished = true; }
};

// The live design as a binary glTF file (metres, Y up) — racks and pallets stay instanced
// (EXT_mesh_gpu_instancing), so even big designs stay a manageable size.
Visualization.prototype.exportGLB = function (done) {
  const hidden = [];
  // leave out the invisible pick boxes and the outline (lines have no surface material in glTF)
  this.liveGroup.traverse((o) => { if (o.visible && ((o.isMesh && o.material && o.material.visible === false) || o.isLine)) { o.visible = false; hidden.push(o); } });
  const restore = () => hidden.forEach((o) => { o.visible = true; });
  try {
    new GLTFExporter().parse(this.liveGroup, (glb) => { restore(); done(glb); }, (err) => { restore(); done(null, String(err)); }, { binary: true, onlyVisible: true });
  } catch (e) { restore(); done(null, String(e)); }
};

Visualization.prototype.setMode = function (mode) {
  this.mode = mode;
  this.liveGroup.visible = mode === "live";
  this.routeGroup.visible = mode === "live";
  this.referenceGroup.visible = mode === "reference";
  this._dirty = true;
  if (mode === "live" && this._home) this.resetView();
};

window.WH = window.WH || {};
window.WH.Visualization = Visualization;
