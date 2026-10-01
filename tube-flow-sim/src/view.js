/*
 * view.js — everything you see in the 3D stage (three.js r186).
 *
 * It is fed the solver's output (whichever backend): the geometry once, then frames
 * with an axis-plane slice and a velocity field (full resolution on the CPU grids, a
 * downsampled copy on the big GPU grids). From that it draws:
 *   - tracers, advected through the field;
 *   - dye, like the coloured streaks in a real water tunnel: a passive concentration
 *     carried by the same field (MacCormack semi-Lagrangian advection), released from a
 *     rake upstream or from the sphere's surface, drawn by ray-marching a 3D texture;
 *   - vortex surfaces: isosurfaces of the Q-criterion (where rotation beats strain),
 *     meshed with surface nets;
 *   - streamlines from a movable rake (RK2 through the field);
 *   - the axial slice (speed, vorticity or pressure; optionally time-averaged) and a
 *     movable cross-section;
 *   - video recording of the canvas.
 * Coordinates: scene x along the tube, the tube radius is 1 scene unit.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ------------------------------------------------------------------ colour maps
const SEQ = [[0, 0x0d, 0x36, 0x6b], [0.14, 0x10, 0x42, 0x81], [0.28, 0x18, 0x4f, 0x95], [0.42, 0x25, 0x6a, 0xbf], [0.58, 0x39, 0x87, 0xe5], [0.72, 0x6d, 0xa7, 0xec], [0.86, 0x9e, 0xc5, 0xf4], [1, 0xcd, 0xe2, 0xfb]];
function seq(t, o) { t = t < 0 ? 0 : t > 1 ? 1 : t; for (let k = 0; k < SEQ.length - 1; k++) { const a = SEQ[k], b = SEQ[k + 1]; if (t <= b[0]) { const u = (t - a[0]) / (b[0] - a[0]); o[0] = (a[1] + (b[1] - a[1]) * u) / 255; o[1] = (a[2] + (b[2] - a[2]) * u) / 255; o[2] = (a[3] + (b[3] - a[3]) * u) / 255; return o; } } return o; }
const NEG = [0xe3, 0x49, 0x48], MID = [0x38, 0x38, 0x35], POS = [0x2a, 0x78, 0xd6];
function div(t, o) { t = t < -1 ? -1 : t > 1 ? 1 : t; let a, b, u; if (t < 0) { a = NEG; b = MID; u = t + 1; } else { a = MID; b = POS; u = t; } o[0] = (a[0] + (b[0] - a[0]) * u) / 255; o[1] = (a[1] + (b[1] - a[1]) * u) / 255; o[2] = (a[2] + (b[2] - a[2]) * u) / 255; return o; }

// ------------------------------------------------------------------ the view
export function createView(stageEl) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  stageEl.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a2f52);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 1.2; controls.maxDistance = 60;
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x16263a, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fd3ff, 0.5); fill.position.set(-4, -2, -3); scene.add(fill);

  const V = {
    renderer, scene, camera, controls, G: null, F: null, L: null, scale: 0.1,
    opts: { tracers: true, nTracers: 3000, axial: false, field: "speed", average: false, cross: false, crossX: 0.55, dye: true, dyeSource: "rake", vortex: false, vortexLevel: 0.6, streamlines: false, rakeY: 0 },
    drawCost: 16, justDrew: false, lastDraw: 0, lastTick: 0, onCaption: null
  };
  const tubeGroup = new THREE.Group(); scene.add(tubeGroup);
  const sphereMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 48, 32), new THREE.MeshStandardMaterial({ color: 0x223140, roughness: 0.3, metalness: 0.55 }));
  scene.add(sphereMesh);

  // ---------------------------------------------------------------- geometry
  V.setGeometry = function (G) {
    V.G = G; V.scale = 1 / G.R;
    const len = G.Nx * V.scale;
    tubeGroup.clear();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, len, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x5b7c99, transparent: true, opacity: 0.08, side: THREE.BackSide, depthWrite: false, roughness: 0.2 }));
    shell.rotation.z = Math.PI / 2; tubeGroup.add(shell);
    const ringMat = new THREE.LineBasicMaterial({ color: 0x5b86ad, transparent: true, opacity: 0.45 });
    const circle = []; for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; circle.push(new THREE.Vector3(0, Math.cos(a), Math.sin(a))); }
    const rings = Math.max(4, Math.round(len / 1.5));
    for (let k = 0; k <= rings; k++) { const r = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), ringMat); r.position.x = -len / 2 + len * k / rings; tubeGroup.add(r); }
    [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach((d) => { tubeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-len / 2, d[1], d[2]), new THREE.Vector3(len / 2, d[1], d[2])]), ringMat)); });
    sphereMesh.visible = G.r > 0;
    sphereMesh.geometry.dispose(); sphereMesh.geometry = new THREE.SphereGeometry(Math.max(0.01, G.r * V.scale), 64, 40);
    sphereMesh.position.set((G.sx - G.Nx / 2) * V.scale, 0, 0);
    axial.setup(); cross.setup();
    V.resetDye(); resetTracers(); V.resetAverage();
    V.resetView();
  };
  V.resetView = function () {
    if (!V.G) return;
    const len = V.G.Nx * V.scale;
    camera.position.set(-len * 0.12, len * 0.32, len * 0.78);
    controls.target.set((V.G.sx - V.G.Nx / 2) * V.scale + len * 0.12, 0, 0);
    controls.update();
  };
  V.resize = function () { const w = stageEl.clientWidth, h = stageEl.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  window.addEventListener("resize", V.resize);
  const toScene = (x, y, z, o) => { o[0] = (x - V.G.Nx / 2) * V.scale; o[1] = (y - V.G.cy) * V.scale; o[2] = (z - V.G.cz) * V.scale; return o; };

  // ---------------------------------------------------------------- field sampling (lattice coordinates)
  function velAt(px, py, pz, o) {
    const Fd = V.F.field, s = Fd.s, nx = Fd.nx, ny = Fd.ny, nz = Fd.nz;
    let cx = px / s, cy = py / s, cz = pz / s;
    if (cx < 0) cx = 0; else if (cx > nx - 1.001) cx = nx - 1.001; if (cy < 0) cy = 0; else if (cy > ny - 1.001) cy = ny - 1.001; if (cz < 0) cz = 0; else if (cz > nz - 1.001) cz = nz - 1.001;
    const x0 = cx | 0, y0 = cy | 0, z0 = cz | 0, fx = cx - x0, fy = cy - y0, fz = cz - z0, sY = nx, sZ = nx * ny, i = x0 + y0 * sY + z0 * sZ;
    const w = [(1 - fx) * (1 - fy) * (1 - fz), fx * (1 - fy) * (1 - fz), (1 - fx) * fy * (1 - fz), fx * fy * (1 - fz), (1 - fx) * (1 - fy) * fz, fx * (1 - fy) * fz, (1 - fx) * fy * fz, fx * fy * fz];
    const id = [i, i + 1, i + sY, i + 1 + sY, i + sZ, i + 1 + sZ, i + sY + sZ, i + 1 + sY + sZ];
    o[0] = o[1] = o[2] = 0;
    for (let k = 0; k < 8; k++) { const n = id[k]; if (!(Fd.rho[n] > 0)) continue; o[0] += Fd.ux[n] * w[k]; o[1] += Fd.uy[n] * w[k]; o[2] += Fd.uz[n] * w[k]; }
    return o;
  }
  const inFluid = (x, y, z) => { const G = V.G, a = x - G.sx, b = y - G.cy, c = z - G.cz; return b * b + c * c < G.R * G.R * 0.97 && a * a + b * b + c * c >= G.r * G.r && x > 0 && x < G.Nx - 1; };

  // ---------------------------------------------------------------- tracers
  const pGeo = new THREE.BufferGeometry();
  const pMat = new THREE.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
  const P = {};
  function seed(i, anywhere) {
    const G = V.G, r = G.R * Math.sqrt(Math.random()) * 0.94, th = Math.random() * Math.PI * 2;
    P.x[i] = anywhere ? 1 + Math.random() * (G.Nx - 3) : 0.5 + Math.random() * 1.5;
    P.y[i] = G.cy + r * Math.cos(th); P.z[i] = G.cz + r * Math.sin(th); P.age[i] = 0;
    P.max[i] = (G.Nx / Math.max((V.L ? V.L.u : 0.05) * 0.15, 1e-5)) * (0.8 + Math.random() * 0.4);
  }
  function resetTracers() {
    if (!V.G) return;
    const n = V.opts.nTracers;
    ["x", "y", "z", "age", "max"].forEach((k) => { P[k] = new Float32Array(n); });
    P.pos = new Float32Array(n * 3); P.col = new Float32Array(n * 3);
    pGeo.setAttribute("position", new THREE.BufferAttribute(P.pos, 3)); pGeo.setAttribute("color", new THREE.BufferAttribute(P.col, 3));
    for (let i = 0; i < n; i++) seed(i, true);
  }
  const vs = [0, 0, 0], cs = [0, 0, 0], sp = [0, 0, 0];
  function advectTracers(dt) {
    const n = V.opts.nTracers, norm = Math.max(1e-6, V.L.u * 1.15), G = V.G;
    for (let i = 0; i < n; i++) {
      velAt(P.x[i], P.y[i], P.z[i], vs);
      P.x[i] += vs[0] * dt; P.y[i] += vs[1] * dt; P.z[i] += vs[2] * dt; P.age[i] += dt;
      if (P.x[i] >= G.Nx - 1.2 || P.age[i] > P.max[i] || !inFluid(P.x[i], P.y[i], P.z[i])) seed(i, false);
      toScene(P.x[i], P.y[i], P.z[i], sp); P.pos[3 * i] = sp[0]; P.pos[3 * i + 1] = sp[1]; P.pos[3 * i + 2] = sp[2];
      seq(Math.hypot(vs[0], vs[1], vs[2]) / norm, cs); P.col[3 * i] = cs[0]; P.col[3 * i + 1] = cs[1]; P.col[3 * i + 2] = cs[2];
    }
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- slices
  function makeSlice(planeGeom) {
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d"), tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(planeGeom(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    mesh.visible = false; mesh.renderOrder = 2; scene.add(mesh);
    return { canvas, ctx, tex, mesh };
  }
  // axial plane through the axis (x, y at z = centre), optionally time-averaged
  const axial = makeSlice(() => new THREE.PlaneGeometry(1, 1));
  let avg = null;
  V.resetAverage = function () { avg = null; };
  axial.setup = function () {
    const G = V.G;
    axial.mesh.geometry.dispose(); axial.mesh.geometry = new THREE.PlaneGeometry(G.Nx * V.scale, G.Ny * V.scale);
    axial.canvas.width = G.Nx; axial.canvas.height = G.Ny;
  };
  axial.draw = function () {
    const G = V.G, F = V.F, Nx = G.Nx, Ny = G.Ny, z = Math.round(G.cz), img = axial.ctx.createImageData(Nx, Ny), d = img.data, c = [0, 0, 0];
    let P2 = F.slice;
    if (V.opts.average) {
      if (!avg || avg.ux.length !== Nx * Ny) avg = { n: 0, ux: new Float32Array(Nx * Ny), uy: new Float32Array(Nx * Ny), rho: new Float32Array(Nx * Ny) };
      avg.n++; const w = 1 / avg.n;
      for (let k = 0; k < Nx * Ny; k++) { avg.ux[k] += (F.slice.ux[k] - avg.ux[k]) * w; avg.uy[k] += (F.slice.uy[k] - avg.uy[k]) * w; avg.rho[k] += (F.slice.rho[k] - avg.rho[k]) * w; }
      P2 = avg;
    }
    const solid = (x, y) => G.solid[x + Nx * (y + Ny * z)];
    const sn = Math.max(1e-6, V.L.u * 1.15), vn = Math.max(1e-6, V.L.u * 2 / Math.max(1, G.r));
    let pmin = Infinity, pmax = -Infinity;
    if (V.opts.field === "pressure") for (let q = 0; q < Nx * Ny; q++) { if (!solid(q % Nx, (q / Nx) | 0)) { const r = P2.rho[q]; if (r < pmin) pmin = r; if (r > pmax) pmax = r; } }
    for (let y = 0; y < Ny; y++) for (let x = 0; x < Nx; x++) {
      const k = x + Nx * y, di = ((Ny - 1 - y) * Nx + x) * 4;
      if (solid(x, y)) { d[di + 3] = 0; continue; }
      if (V.opts.field === "speed") seq(Math.hypot(P2.ux[k], P2.uy[k]) / sn, c);
      else if (V.opts.field === "pressure") seq((P2.rho[k] - pmin) / Math.max(1e-9, pmax - pmin), c);
      else {
        const xm = x > 0 && !solid(x - 1, y) ? k - 1 : k, xp = x < Nx - 1 && !solid(x + 1, y) ? k + 1 : k, ym = !solid(x, y - 1) ? k - Nx : k, yp = !solid(x, y + 1) ? k + Nx : k;
        div(((P2.uy[xp] - P2.uy[xm]) - (P2.ux[yp] - P2.ux[ym])) * 0.5 / vn, c);
      }
      d[di] = c[0] * 255; d[di + 1] = c[1] * 255; d[di + 2] = c[2] * 255; d[di + 3] = 225;
    }
    axial.ctx.putImageData(img, 0, 0); axial.tex.needsUpdate = true;
  };
  // movable cross-section (y, z at a chosen x), drawn from the field
  const cross = makeSlice(() => new THREE.PlaneGeometry(2, 2));
  cross.setup = function () { const Fd = V.F && V.F.field; cross.canvas.width = 64; cross.canvas.height = 64; cross.mesh.rotation.y = Math.PI / 2; };
  cross.draw = function () {
    const G = V.G, Fd = V.F.field, s = Fd.s, W = 64, img = cross.ctx.createImageData(W, W), d = img.data, c = [0, 0, 0];
    const x = Math.max(1, Math.min(G.Nx - 2, V.opts.crossX * G.Nx)), sn = Math.max(1e-6, V.L.u * 1.15), vn = Math.max(1e-6, V.L.u * 2 / Math.max(1, G.r));
    const o = [0, 0, 0], o2 = [0, 0, 0], o3 = [0, 0, 0], h = 0.5;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const yy = G.cy + (i / (W - 1) * 2 - 1) * G.R, zz = G.cz + ((W - 1 - j) / (W - 1) * 2 - 1) * G.R, di = (j * W + i) * 4;
      const a = yy - G.cy, b = zz - G.cz, dx = x - G.sx;
      if (a * a + b * b >= G.R * G.R || dx * dx + a * a + b * b < G.r * G.r) { d[di + 3] = 0; continue; }
      if (V.opts.field === "vorticity") {             // streamwise vorticity ω_x = ∂uz/∂y − ∂uy/∂z
        velAt(x, yy + h, zz, o); velAt(x, yy - h, zz, o2); const duz = (o[2] - o2[2]) / (2 * h);
        velAt(x, yy, zz + h, o); velAt(x, yy, zz - h, o3); const duy = (o[1] - o3[1]) / (2 * h);
        div((duz - duy) / vn, c);
      } else { velAt(x, yy, zz, o); seq(Math.hypot(o[0], o[1], o[2]) / sn, c); }
      d[di] = c[0] * 255; d[di + 1] = c[1] * 255; d[di + 2] = c[2] * 255; d[di + 3] = 235;
    }
    cross.ctx.putImageData(img, 0, 0); cross.tex.needsUpdate = true;
    cross.mesh.position.set((x - G.Nx / 2) * V.scale, 0, 0);
  };

  // ---------------------------------------------------------------- dye (concentration on the field's grid)
  const dye = { c: null, tmp: null, back: null, tex: null, dims: null };
  const volMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: null }, boxMin: { value: new THREE.Vector3() }, boxMax: { value: new THREE.Vector3() }, color: { value: new THREE.Color(0xff5fa2) }, gain: { value: 1.6 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `precision highp float; precision highp sampler3D;
      uniform sampler3D tex; uniform vec3 boxMin, boxMax, color; uniform float gain; varying vec3 vW;
      vec2 hitBox(vec3 o, vec3 d){ vec3 t0=(boxMin-o)/d, t1=(boxMax-o)/d; vec3 a=min(t0,t1), b=max(t0,t1); return vec2(max(max(a.x,a.y),a.z), min(min(b.x,b.y),b.z)); }
      void main(){
        vec3 o = cameraPosition, dir = normalize(vW - cameraPosition);
        vec2 t = hitBox(o, dir); t.x = max(t.x, 0.0); if (t.x >= t.y) discard;
        float acc = 0.0; vec3 col = vec3(0.0); const int STEPS = 160; float dt = (t.y - t.x) / float(STEPS);
        for (int i = 0; i < STEPS; i++){
          vec3 p = o + dir * (t.x + (float(i) + 0.5) * dt);
          vec3 uvw = (p - boxMin) / (boxMax - boxMin);
          float c = texture(tex, uvw).r;
          float a = 1.0 - exp(-c * gain * dt * 6.0);
          col += (1.0 - acc) * a * mix(color, vec3(1.0), c * 0.35);
          acc += (1.0 - acc) * a;
          if (acc > 0.97) break;
        }
        if (acc < 0.01) discard;
        gl_FragColor = vec4(col / max(acc, 1e-3), acc);
      }`,
    transparent: true, depthWrite: false, side: THREE.BackSide
  });
  const volMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volMat); volMesh.renderOrder = 3; volMesh.frustumCulled = false; scene.add(volMesh);
  V.resetDye = function () { dye.c = null; };
  function ensureDye() {
    const Fd = V.F.field, n = Fd.nx * Fd.ny * Fd.nz;
    if (dye.c && dye.dims && dye.dims[0] === Fd.nx && dye.dims[1] === Fd.ny && dye.dims[2] === Fd.nz && dye.dims[3] === Fd.s) return;
    dye.c = new Float32Array(n); dye.tmp = new Float32Array(n); dye.back = new Float32Array(n); dye.dims = [Fd.nx, Fd.ny, Fd.nz, Fd.s];
    dye.u8 = new Uint8Array(n);
    if (dye.tex) dye.tex.dispose();
    dye.tex = new THREE.Data3DTexture(dye.u8, Fd.nx, Fd.ny, Fd.nz);
    dye.tex.format = THREE.RedFormat; dye.tex.type = THREE.UnsignedByteType; dye.tex.minFilter = dye.tex.magFilter = THREE.LinearFilter; dye.tex.unpackAlignment = 1;
    volMat.uniforms.tex.value = dye.tex;
    const s = Fd.s, G = V.G, lo = [0, 0, 0], hi = [0, 0, 0];
    toScene(-0.5 * s, -0.5 * s, -0.5 * s, lo); toScene((Fd.nx - 0.5) * s, (Fd.ny - 0.5) * s, (Fd.nz - 0.5) * s, hi);
    volMat.uniforms.boxMin.value.set(lo[0], lo[1], lo[2]); volMat.uniforms.boxMax.value.set(hi[0], hi[1], hi[2]);
    volMesh.scale.set(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]); volMesh.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  }
  // trilinear sample of a coarse scalar field at coarse coordinates
  function sampleC(a, Fd, cx, cy, cz) {
    const nx = Fd.nx, ny = Fd.ny, nz = Fd.nz;
    if (cx < 0) cx = 0; else if (cx > nx - 1.001) cx = nx - 1.001; if (cy < 0) cy = 0; else if (cy > ny - 1.001) cy = ny - 1.001; if (cz < 0) cz = 0; else if (cz > nz - 1.001) cz = nz - 1.001;
    const x0 = cx | 0, y0 = cy | 0, z0 = cz | 0, fx = cx - x0, fy = cy - y0, fz = cz - z0, sY = nx, sZ = nx * ny, i = x0 + y0 * sY + z0 * sZ;
    return a[i] * (1 - fx) * (1 - fy) * (1 - fz) + a[i + 1] * fx * (1 - fy) * (1 - fz) + a[i + sY] * (1 - fx) * fy * (1 - fz) + a[i + 1 + sY] * fx * fy * (1 - fz) +
      a[i + sZ] * (1 - fx) * (1 - fy) * fz + a[i + 1 + sZ] * fx * (1 - fy) * fz + a[i + sY + sZ] * (1 - fx) * fy * fz + a[i + 1 + sY + sZ] * fx * fy * fz;
  }
  // one MacCormack step of ∂c/∂t + u·∇c = 0 over `dt` lattice steps, then the sources
  function advectDye(dt) {
    ensureDye();
    const Fd = V.F.field, s = Fd.s, nx = Fd.nx, ny = Fd.ny, nz = Fd.nz, c = dye.c, f1 = dye.tmp, f2 = dye.back, k = dt / s;
    const ux = Fd.ux, uy = Fd.uy, uz = Fd.uz, rho = Fd.rho;
    for (let z = 0, n = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, n++) {
      f1[n] = rho[n] > 0 ? sampleC(c, Fd, x - ux[n] * k, y - uy[n] * k, z - uz[n] * k) : 0;
    }
    for (let z = 0, n = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, n++) {
      f2[n] = rho[n] > 0 ? sampleC(f1, Fd, x + ux[n] * k, y + uy[n] * k, z + uz[n] * k) : 0;
    }
    for (let z = 0, n = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++, n++) {
      if (!(rho[n] > 0)) { c[n] = 0; continue; }
      let v = f1[n] + 0.5 * (c[n] - f2[n]);
      // limiter: stay within the values the plain step would have interpolated from
      const px = Math.max(0, Math.min(nx - 1, Math.round(x - ux[n] * k))), py = Math.max(0, Math.min(ny - 1, Math.round(y - uy[n] * k))), pz = Math.max(0, Math.min(nz - 1, Math.round(z - uz[n] * k)));
      const m = px + nx * (py + ny * pz); let lo = c[m], hi = c[m];
      if (px + 1 < nx) { lo = Math.min(lo, c[m + 1]); hi = Math.max(hi, c[m + 1]); } if (px > 0) { lo = Math.min(lo, c[m - 1]); hi = Math.max(hi, c[m - 1]); }
      if (py + 1 < ny) { lo = Math.min(lo, c[m + nx]); hi = Math.max(hi, c[m + nx]); } if (py > 0) { lo = Math.min(lo, c[m - nx]); hi = Math.max(hi, c[m - nx]); }
      if (pz + 1 < nz) { lo = Math.min(lo, c[m + nx * ny]); hi = Math.max(hi, c[m + nx * ny]); } if (pz > 0) { lo = Math.min(lo, c[m - nx * ny]); hi = Math.max(hi, c[m - nx * ny]); }
      c[n] = v < lo ? lo : v > hi ? hi : v;
    }
    // sources: a rake of nozzles upstream (alternating rows), or the sphere's surface
    const G = V.G;
    if (V.opts.dyeSource === "rake") {
      // a cross of nozzles: one row across the tube, one up the middle
      const xs = Math.max(1, Math.round((G.sx - 3 * G.r) / s)), rr = (G.R * 0.8) / s, pts = [];
      for (let a = -4; a <= 4; a++) { pts.push([a, 0]); if (a) pts.push([0, a]); }
      for (const [a, b] of pts) {
        const y = Math.round(G.cy / s + a * rr / 4.5), z = Math.round(G.cz / s + b * rr / 4.5);
        if (y < 0 || y >= ny || z < 0 || z >= nz) continue;
        const n = xs + nx * (y + ny * z); if (rho[n] > 0) c[n] = 1;
      }
    } else {
      const rr = (G.r + 1.2 * s) / s, cxs = G.sx / s, cys = G.cy / s, czs = G.cz / s;
      for (let z = Math.floor(czs - rr); z <= Math.ceil(czs + rr); z++) for (let y = Math.floor(cys - rr); y <= Math.ceil(cys + rr); y++) for (let x = Math.floor(cxs - rr); x <= Math.ceil(cxs + rr); x++) {
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        const n = x + nx * (y + ny * z), dd = Math.hypot(x - cxs, y - cys, z - czs);
        if (rho[n] > 0 && dd <= rr) c[n] = 1;
      }
    }
    for (let n = 0; n < c.length; n++) dye.u8[n] = Math.min(255, c[n] * 255);
    dye.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- vortex surfaces (Q-criterion, surface nets)
  const vortexMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, transparent: true, opacity: 0.88, side: THREE.DoubleSide }));
  vortexMesh.visible = false; scene.add(vortexMesh);
  function qField() {
    const Fd = V.F.field, nx = Fd.nx, ny = Fd.ny, nz = Fd.nz, s = Fd.s, Q = new Float32Array(nx * ny * nz), ux = Fd.ux, uy = Fd.uy, uz = Fd.uz, rho = Fd.rho;
    const ref = Math.pow(V.L.u / Math.max(1, 2 * V.G.r), 2);
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const n = x + nx * (y + ny * z);
      if (!(rho[n] > 0)) { Q[n] = -1e9; continue; }
      // central differences, one-sided where a neighbour is inside a wall (walls have zero velocity,
      // so leaving them out avoids false vortex surfaces wrapped around the sphere)
      const D = (arr, st) => { const p = rho[n + st] > 0, m = rho[n - st] > 0; return p && m ? (arr[n + st] - arr[n - st]) / (2 * s) : p ? (arr[n + st] - arr[n]) / s : m ? (arr[n] - arr[n - st]) / s : 0; };
      const sy = nx, sz = nx * ny;
      const a11 = D(ux, 1), a12 = D(ux, sy), a13 = D(ux, sz), a21 = D(uy, 1), a22 = D(uy, sy), a23 = D(uy, sz), a31 = D(uz, 1), a32 = D(uz, sy), a33 = D(uz, sz);
      // Q = ½(|Ω|² − |S|²) = −½ Σ a_ij a_ji
      Q[n] = -0.5 * (a11 * a11 + a22 * a22 + a33 * a33 + 2 * (a12 * a21 + a13 * a31 + a23 * a32)) / ref;
    }
    return Q;
  }
  function surfaceNets(Q, Fd, level) {
    const nx = Fd.nx, ny = Fd.ny, nz = Fd.nz, s = Fd.s, vid = new Int32Array(nx * ny * nz).fill(-1), pos = [], idx = [], sc = [0, 0, 0];
    const at = (x, y, z) => Q[x + nx * (y + ny * z)] - level;
    for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      let inside = 0, cnt = 0, px = 0, py = 0, pz = 0; const v = [];
      for (let k = 0; k < 8; k++) { const val = at(x + (k & 1), y + ((k >> 1) & 1), z + ((k >> 2) & 1)); v.push(val); if (val > 0) inside++; }
      if (inside === 0 || inside === 8) continue;
      const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b] of E) {
        if ((v[a] > 0) === (v[b] > 0)) continue;
        const t = v[a] / (v[a] - v[b]);
        px += (a & 1) + t * ((b & 1) - (a & 1)); py += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1)); pz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1)); cnt++;
      }
      vid[x + nx * (y + ny * z)] = pos.length / 3;
      toScene((x + px / cnt) * s, (y + py / cnt) * s, (z + pz / cnt) * s, sc); pos.push(sc[0], sc[1], sc[2]);
    }
    const cell = (x, y, z) => (x < 0 || y < 0 || z < 0) ? -1 : vid[x + nx * (y + ny * z)];
    for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const v0 = at(x, y, z);
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(([dx, dy, dz]) => {
        const v1 = at(x + dx, y + dy, z + dz); if ((v0 > 0) === (v1 > 0)) return;
        // the four cells sharing this edge
        let q;
        if (dx) q = [cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z)];
        else if (dy) q = [cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1)];
        else q = [cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z)];
        if (q.some((i) => i < 0)) return;
        if (v0 > 0) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
      });
    }
    return { pos: new Float32Array(pos), idx: idx };
  }
  function updateVortex() {
    const m = surfaceNets(qField(), V.F.field, V.opts.vortexLevel);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3)); g.setIndex(m.idx); g.computeVertexNormals();
    // colour by the sense of rotation about the tube axis (ω_x): red one way, blue the other
    const col = new Float32Array(m.pos.length), o = [0, 0, 0], o2 = [0, 0, 0], c = [0, 0, 0], G = V.G, vn = Math.max(1e-6, V.L.u * 2 / Math.max(1, G.r)), h = 0.75;
    for (let i = 0; i < m.pos.length / 3; i++) {
      const x = m.pos[3 * i] / V.scale + G.Nx / 2, y = m.pos[3 * i + 1] / V.scale + G.cy, z = m.pos[3 * i + 2] / V.scale + G.cz;
      velAt(x, y + h, z, o); velAt(x, y - h, z, o2); const duz = (o[2] - o2[2]) / (2 * h);
      velAt(x, y, z + h, o); velAt(x, y, z - h, o2); const duy = (o[1] - o2[1]) / (2 * h);
      div(-(duz - duy) / vn * 6, c); col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    vortexMesh.geometry.dispose(); vortexMesh.geometry = g;
    V.vortexTriangles = m.idx.length / 3;
  }

  // ---------------------------------------------------------------- streamlines
  const streamMesh = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  streamMesh.visible = false; streamMesh.frustumCulled = false; scene.add(streamMesh);
  function updateStreamlines() {
    const G = V.G, pos = [], col = [], o = [0, 0, 0], o2 = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], norm = Math.max(1e-6, V.L.u * 1.15);
    const x0 = Math.max(2, G.sx - 3 * G.r), nSeeds = 28, h = 0.6;
    for (let i = 0; i < nSeeds; i++) {
      const t = (i + 0.5) / nSeeds * 2 - 1, ang = V.opts.rakeY * Math.PI / 2;
      let x = x0, y = G.cy + t * G.R * 0.92 * Math.cos(ang), z = G.cz + t * G.R * 0.92 * Math.sin(ang);
      for (let k = 0; k < 2 * G.Nx / h; k++) {
        velAt(x, y, z, o); const sp = Math.hypot(o[0], o[1], o[2]); if (sp < 1e-7) break;
        const xm = x + 0.5 * h * o[0] / sp, ym = y + 0.5 * h * o[1] / sp, zm = z + 0.5 * h * o[2] / sp;
        velAt(xm, ym, zm, o2); const s2 = Math.hypot(o2[0], o2[1], o2[2]); if (s2 < 1e-7) break;
        const xn = x + h * o2[0] / s2, yn = y + h * o2[1] / s2, zn = z + h * o2[2] / s2;
        if (!inFluid(xn, yn, zn)) break;
        toScene(x, y, z, a); toScene(xn, yn, zn, b); pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        seq(s2 / norm, c); col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
        x = xn; y = yn; z = zn;
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    streamMesh.geometry.dispose(); streamMesh.geometry = g;
  }

  // ---------------------------------------------------------------- frames, options, drawing
  let lastT = null, lastHeavy = 0;
  V.setFrame = function (F, L) {
    V.F = F; V.L = L;
    const dt = lastT === null ? 0 : Math.max(0, F.t - lastT); lastT = F.t;
    if (V.opts.dye && dt > 0 && dt < 5000) advectDye(dt);
    if (V.opts.axial) axial.draw();
    if (V.opts.cross) cross.draw();
    const now = performance.now();
    if (now - lastHeavy > 350) {                       // the meshing work, a few times a second
      lastHeavy = now;
      if (V.opts.vortex) updateVortex();
      if (V.opts.streamlines) updateStreamlines();
    }
  };
  V.set = function (k, v) {
    V.opts[k] = v;
    if (k === "nTracers") resetTracers();
    if (k === "average" || k === "field") V.resetAverage();
    if (k === "dyeSource") V.resetDye();
    points.visible = V.opts.tracers; axial.mesh.visible = V.opts.axial; cross.mesh.visible = V.opts.cross;
    volMesh.visible = V.opts.dye; vortexMesh.visible = V.opts.vortex; streamMesh.visible = V.opts.streamlines;
    if (V.F && V.L && V.G) {
      if (V.opts.axial) axial.draw(); if (V.opts.cross) cross.draw();
      if (V.opts.vortex) updateVortex(); if (V.opts.streamlines) updateStreamlines();
    }
  };
  V.frameReset = function () { lastT = null; V.resetDye(); V.resetAverage(); };

  // Called every animation frame. Draws less often if frames are slow (software rendering), so
  // the solver keeps the CPU.
  V.tick = function (running, stepsPerSec) {
    const now = performance.now();
    if (V.justDrew) { V.drawCost = 0.8 * V.drawCost + 0.2 * (now - V.lastDraw); V.justDrew = false; }
    const interval = V.drawCost > 45 ? Math.min(400, V.drawCost * 8) : 0;
    if (V.onCaption) V.onCaption(interval > 0);
    if (now - V.lastDraw < interval) return;
    if (V.F && V.G && V.L && running && V.lastTick && V.opts.tracers) {
      const steps = (stepsPerSec || 0) * (now - V.lastTick) / 1000;
      if (steps > 0) advectTracers(Math.min(steps, 200));
    }
    V.lastTick = now;
    controls.update();
    renderer.render(scene, camera);
    if (recTrack && recTrack.requestFrame) recTrack.requestFrame();
    V.frames = (V.frames || 0) + 1;
    V.lastDraw = now; V.justDrew = true;
  };

  // ---------------------------------------------------------------- recording
  let rec = null, recTrack = null;
  V.recording = () => !!rec;
  V.record = function (on, done) {
    if (on && !rec) {
      // VP8 first: VP9 encoding of a WebGL canvas can silently produce an empty file
      const types = ["video/webm;codecs=vp8", "video/webm", "video/webm;codecs=vp9"];
      const type = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      if (!type) { done && done(null, "This browser can't record video."); return false; }
      // frames are pushed explicitly after each render (requestFrame), so the video holds exactly what was drawn
      const stream = renderer.domElement.captureStream(0), chunks = [], mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
      recTrack = stream.getVideoTracks()[0];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => { done && done(new Blob(chunks, { type: "video/webm" })); };
      mr.start(500); rec = mr;
      return true;
    }
    if (!on && rec) { rec.stop(); rec = null; recTrack = null; }
    return false;
  };
  V.set("dye", V.opts.dye);
  return V;
}
