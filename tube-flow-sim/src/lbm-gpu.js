/*
 * lbm-gpu.js — the same lattice-Boltzmann scheme as lbm.js, on the GPU (WebGPU compute).
 *
 * The CPU solver builds the geometry (solid nodes, boundary links with their q
 * fractions, inlet/outlet/sponge lists); this uploads it and runs every step as five
 * compute passes — collide (TRT or regularised, sponge), stream (pull), interpolated
 * bounce-back with momentum exchange per link, inlet, outlet — with the populations
 * stored direction-major (f[i·N + n]) so neighbouring threads read neighbouring memory.
 * tests/gpu.test.js runs both solvers on the same case and requires them to agree.
 *
 * Readouts (async, a few times a second): forces summed over the sphere and wall links,
 * mean density on two cross-sections, the axial velocity on the axis (recirculation),
 * the axis-plane slice, a downsampled 3D velocity field for the tracers, total mass.
 *
 *   const g = await TF.GPUSolver.create(device, opts)   // opts as for TF.Solver
 *   g.step(n); const r = await g.read({ field: 2 });     // r.force, r.slice, r.field, …
 */
(function (root) {
  "use strict";
  const TF = root.TF;
  const Q = 19, CX = TF.CX, CY = TF.CY, CZ = TF.CZ, W = TF.W, OPP = TF.OPP;
  const WG = 128;

  const common = /* wgsl */`
struct P {
  N: u32, Nx: u32, Ny: u32, Nz: u32,
  wp: f32, wm: f32, ws: f32, reg: u32,
  u: f32, vy: f32, vz: f32, mode: u32,
  cy: f32, cz: f32, R: f32, uw: f32,
  nIn: u32, nOut: u32, nLinks: u32, seed: u32,
  us: array<vec4<f32>, 2>,             // inflow speed for each step of the batch (pulsatile inflow)
};
@group(0) @binding(0) var<uniform> p: P;
const CX = array<i32, 19>(${CX.join(",")});
const CY = array<i32, 19>(${CY.join(",")});
const CZ = array<i32, 19>(${CZ.join(",")});
const W = array<f32, 19>(${W.map((w) => w.toFixed(10)).join(",")});
const OPP = array<u32, 19>(${OPP.join(",")});
fn feq(i: u32, rho: f32, ux: f32, uy: f32, uz: f32) -> f32 {
  let cu = f32(CX[i]) * ux + f32(CY[i]) * uy + f32(CZ[i]) * uz;
  return W[i] * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy + uz * uz));
}
`;

  // 1. collide in place: flags 0 fluid, 1 solid, 2 sponge (regularised at raised viscosity)
  const collideSrc = common + /* wgsl */`
@group(0) @binding(1) var<storage, read_write> f: array<f32>;
@group(0) @binding(2) var<storage, read> flags: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x;
  if (n >= p.N) { return; }
  let fl = flags[n];
  if (fl == 1u) { return; }
  var g: array<f32, 19>;
  var rho = 0.0; var ux = 0.0; var uy = 0.0; var uz = 0.0;
  for (var i = 0u; i < 19u; i++) { let v = f[i * p.N + n]; g[i] = v; rho += v; ux += v * f32(CX[i]); uy += v * f32(CY[i]); uz += v * f32(CZ[i]); }
  ux /= rho; uy /= rho; uz /= rho;
  if (p.reg == 1u || fl == 2u) {
    let om = select(1.0 - p.wp, 1.0 - p.ws, fl == 2u);
    var e: array<f32, 19>;
    var pxx = 0.0; var pyy = 0.0; var pzz = 0.0; var pxy = 0.0; var pxz = 0.0; var pyz = 0.0;
    for (var i = 0u; i < 19u; i++) {
      e[i] = feq(i, rho, ux, uy, uz);
      let ne = g[i] - e[i]; let cx = f32(CX[i]); let cy = f32(CY[i]); let cz = f32(CZ[i]);
      pxx += cx * cx * ne; pyy += cy * cy * ne; pzz += cz * cz * ne; pxy += cx * cy * ne; pxz += cx * cz * ne; pyz += cy * cz * ne;
    }
    let tr = (pxx + pyy + pzz) / 3.0;
    for (var i = 0u; i < 19u; i++) {
      let cx = f32(CX[i]); let cy = f32(CY[i]); let cz = f32(CZ[i]);
      let qp = cx * cx * pxx + cy * cy * pyy + cz * cz * pzz + 2.0 * (cx * cy * pxy + cx * cz * pxz + cy * cz * pyz) - tr;
      f[i * p.N + n] = e[i] + om * 4.5 * W[i] * qp;
    }
  } else {
    let usq = 1.5 * (ux * ux + uy * uy + uz * uz);
    f[n] = g[0] - p.wp * (g[0] - W[0] * rho * (1.0 - usq));
    for (var k = 0u; k < 9u; k++) {
      let i = 2u * k + 1u; let o = i + 1u;
      let cu = f32(CX[i]) * ux + f32(CY[i]) * uy + f32(CZ[i]) * uz;
      let eqp = W[i] * rho * (1.0 + 4.5 * cu * cu - usq); let eqm = W[i] * rho * 3.0 * cu;
      let dp = p.wp * (0.5 * (g[i] + g[o]) - eqp); let dm = p.wm * (0.5 * (g[i] - g[o]) - eqm);
      f[i * p.N + n] = g[i] - dp - dm; f[o * p.N + n] = g[o] - dp + dm;
    }
  }
}`;

  // 2. stream (pull) into interior fluid nodes from fluid neighbours
  const streamSrc = common + /* wgsl */`
@group(0) @binding(1) var<storage, read> f: array<f32>;
@group(0) @binding(2) var<storage, read_write> fn2: array<f32>;
@group(0) @binding(3) var<storage, read> flags: array<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x;
  if (n >= p.N || flags[n] == 1u) { return; }
  let x = i32(n % p.Nx); let y = i32((n / p.Nx) % p.Ny); let z = i32(n / (p.Nx * p.Ny));
  if (x == 0 || x == i32(p.Nx) - 1) { return; }
  fn2[n] = f[n];
  for (var i = 1u; i < 19u; i++) {
    let s = u32(x - CX[i]) + p.Nx * (u32(y - CY[i]) + p.Ny * u32(z - CZ[i]));
    if (flags[s] != 1u) { fn2[i * p.N + n] = f[i * p.N + s]; }
  }
}`;

  // 3. interpolated bounce-back on each wall link; momentum exchange per link
  const linkSrc = common + /* wgsl */`
struct Link { node: u32, dir: u32, q: f32, which: u32, back: i32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(1) var<storage, read> f: array<f32>;
@group(0) @binding(2) var<storage, read_write> fn2: array<f32>;
@group(0) @binding(3) var<storage, read> links: array<Link>;
@group(0) @binding(4) var<storage, read_write> lf: array<vec4<f32>>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let k = gid.x;
  if (k >= p.nLinks) { return; }
  let L = links[k]; let n = L.node; let j = L.dir; let o = OPP[j]; let q = L.q;
  let fj = f[j * p.N + n];
  var mov = 0.0;
  if (L.which == 1u) { mov = 6.0 * W[j] * f32(CX[j]) * p.uw; }
  var v: f32;
  if (q < 0.5 && L.back >= 0) { v = 2.0 * q * fj + (1.0 - 2.0 * q) * f[j * p.N + u32(L.back)] - mov; }
  else if (q >= 0.5) { v = fj / (2.0 * q) + (2.0 * q - 1.0) / (2.0 * q) * f[o * p.N + n] - mov / (2.0 * q); }
  else { v = fj - mov; }
  fn2[o * p.N + n] = v;
  let s = fj + v;
  var uxw = 0.0; if (L.which == 1u) { uxw = p.uw; }
  lf[k] = vec4<f32>(f32(CX[j]) * s - uxw * (fj - v), f32(CY[j]) * s, f32(CZ[j]) * s, f32(L.which));
}`;

  // 4./5. inlet (velocity) and outlet (pressure), non-equilibrium extrapolation
  const bcSrc = common + /* wgsl */`
@group(0) @binding(1) var<storage, read_write> fn2: array<f32>;
@group(0) @binding(2) var<storage, read> nodes: array<u32>;
fn hash(a: u32) -> f32 { var x = a * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return f32(x) / 4294967295.0; }
@compute @workgroup_size(${WG})
fn inlet(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  // dispatched with (groups, s + 1) for step s of the batch: only the last row runs, and knows its step
  if (gid.x >= p.nIn || gid.y + 1u != nw.y) { return; }
  let sp = p.us[gid.y >> 2u][gid.y & 3u];
  let n = nodes[gid.x]; let nb = n + 1u;
  var rho = 0.0; var ux = 0.0; var uy = 0.0; var uz = 0.0;
  for (var i = 0u; i < 19u; i++) { let v = fn2[i * p.N + nb]; rho += v; ux += v * f32(CX[i]); uy += v * f32(CY[i]); uz += v * f32(CZ[i]); }
  ux /= rho; uy /= rho; uz /= rho;
  let y = f32((n / p.Nx) % p.Ny); let z = f32(n / (p.Nx * p.Ny));
  var ub = sp;
  if (p.mode == 0u) { let r2 = ((y - p.cy) * (y - p.cy) + (z - p.cz) * (z - p.cz)) / (p.R * p.R); ub = sp * max(0.0, 1.0 - r2); }
  var vy = p.vy; var vz = p.vz;
  if (p.seed != 0u) { vy = vy * (hash(n * 7u + p.seed) * 2.0 - 1.0); vz = vz * (hash(n * 13u + p.seed * 3u) * 2.0 - 1.0); }
  for (var i = 0u; i < 19u; i++) { fn2[i * p.N + n] = feq(i, rho, ub, vy, vz) + (fn2[i * p.N + nb] - feq(i, rho, ux, uy, uz)); }
}
@compute @workgroup_size(${WG})
fn outlet(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.nOut) { return; }
  let n = nodes[gid.x]; let nb = n - 1u;
  var rho = 0.0; var ux = 0.0; var uy = 0.0; var uz = 0.0;
  for (var i = 0u; i < 19u; i++) { let v = fn2[i * p.N + nb]; rho += v; ux += v * f32(CX[i]); uy += v * f32(CY[i]); uz += v * f32(CZ[i]); }
  ux /= rho; uy /= rho; uz /= rho;
  for (var i = 0u; i < 19u; i++) { fn2[i * p.N + n] = feq(i, 1.0, ux, uy, uz) + (fn2[i * p.N + nb] - feq(i, rho, ux, uy, uz)); }
}`;

  // readouts: macroscopic values at a list of nodes; partial sums of link forces and of mass
  const gatherSrc = common + /* wgsl */`
@group(0) @binding(1) var<storage, read> f: array<f32>;
@group(0) @binding(2) var<storage, read> idx: array<u32>;
@group(0) @binding(3) var<storage, read_write> out: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> cnt: vec4<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= cnt.x) { return; }
  let n = idx[gid.x];
  if (n == 0xffffffffu) { out[gid.x] = vec4<f32>(0.0); return; }
  var rho = 0.0; var ux = 0.0; var uy = 0.0; var uz = 0.0;
  for (var i = 0u; i < 19u; i++) { let v = f[i * p.N + n]; rho += v; ux += v * f32(CX[i]); uy += v * f32(CY[i]); uz += v * f32(CZ[i]); }
  out[gid.x] = vec4<f32>(rho, ux / rho, uy / rho, uz / rho);
}`;
  const sumSrc = common + /* wgsl */`
@group(0) @binding(1) var<storage, read> lf: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> part: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> f: array<f32>;
@group(0) @binding(4) var<storage, read> flags: array<u32>;
var<workgroup> a: array<vec4<f32>, ${WG}>;
var<workgroup> b: array<vec4<f32>, ${WG}>;
@compute @workgroup_size(${WG})
fn links(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  var sp = vec4<f32>(0.0); var wl = vec4<f32>(0.0);
  if (gid.x < p.nLinks) { let v = lf[gid.x]; if (v.w > 1.5) { sp = vec4<f32>(v.xyz, 0.0); } else { wl = vec4<f32>(v.xyz, 0.0); } }
  a[lid.x] = sp; b[lid.x] = wl; workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s = s >> 1u) { if (lid.x < s) { a[lid.x] += a[lid.x + s]; b[lid.x] += b[lid.x + s]; } workgroupBarrier(); }
  if (lid.x == 0u) { part[2u * wid.x] = a[0]; part[2u * wid.x + 1u] = b[0]; }
}
@compute @workgroup_size(${WG})
fn mass(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  var m = 0.0;
  if (gid.x < p.N && flags[gid.x] != 1u) { for (var i = 0u; i < 19u; i++) { m += f[i * p.N + gid.x]; } }
  a[lid.x] = vec4<f32>(m, 0.0, 0.0, 0.0); workgroupBarrier();
  for (var s = ${WG / 2}u; s > 0u; s = s >> 1u) { if (lid.x < s) { a[lid.x] += a[lid.x + s]; } workgroupBarrier(); }
  if (lid.x == 0u) { part[wid.x] = a[0]; }
}`;

  function GPUSolver() {}

  GPUSolver.create = async function (device, opts) {
    const g = new GPUSolver();
    g.device = device;
    // geometry from the CPU solver (no populations allocated beyond what it needs)
    const S = new TF.Solver(Object.assign({}, opts, { geometryOnly: true }));
    g.cpu = S;
    Object.assign(g, { Nx: S.Nx, Ny: S.Ny, Nz: S.Nz, N: S.N, R: S.R, cy: S.cy, cz: S.cz, sx: S.sx, r: S.r, xRear: S.xRear, mode: S.mode, solid: S.solid, inflowKind: S.inflowKind, pulse: S.pulse });
    g.u = opts.u; g.nu = opts.nu; g.uCur = opts.u; g.t = 0; g.disturb = opts.disturbance || "kick"; g.collisionMode = opts.collision || "auto";
    const N = S.N, buf = (size, usage) => device.createBuffer({ size: Math.max(16, size), usage: usage });
    const ST = GPUBufferUsage.STORAGE, CP = GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    g.fA = buf(N * Q * 4, ST | CP); g.fB = buf(N * Q * 4, ST | CP);
    const flags = new Uint32Array(N);
    for (let n = 0; n < N; n++) flags[n] = S.solid[n] ? 1 : (n % S.Nx >= S.spongeX ? 2 : 0);
    g.flags = buf(N * 4, ST | CP); device.queue.writeBuffer(g.flags, 0, flags);
    const L = new ArrayBuffer(S.nLinks * 32), Lu = new Uint32Array(L), Lf = new Float32Array(L), Li = new Int32Array(L);
    for (let k = 0; k < S.nLinks; k++) { Lu[8 * k] = S.lNode[k]; Lu[8 * k + 1] = S.lDir[k]; Lf[8 * k + 2] = S.lQ[k]; Lu[8 * k + 3] = S.lWhich[k]; Li[8 * k + 4] = S.lBack[k]; }
    g.links = buf(L.byteLength, ST | CP); device.queue.writeBuffer(g.links, 0, L);
    g.nLinks = S.nLinks;
    g.lf = buf(S.nLinks * 16, ST | CP);
    g.inNodes = buf(S.inlet.length * 4, ST | CP); device.queue.writeBuffer(g.inNodes, 0, S.inlet);
    g.outNodes = buf(S.outlet.length * 4, ST | CP); device.queue.writeBuffer(g.outNodes, 0, S.outlet);
    g.uni = buf(112, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    g.linkGroups = Math.ceil(S.nLinks / WG); g.nodeGroups = Math.ceil(N / WG);
    g.part = buf(Math.max(g.linkGroups * 2, g.nodeGroups) * 16, ST | CP);
    // pipelines
    const pipe = (code, entry) => device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code: code }), entryPoint: entry || "main" } });
    g.pCollide = pipe(collideSrc); g.pStream = pipe(streamSrc); g.pLink = pipe(linkSrc);
    g.pIn = pipe(bcSrc, "inlet"); g.pOut = pipe(bcSrc, "outlet"); g.pGather = pipe(gatherSrc);
    g.pSumL = pipe(sumSrc, "links"); g.pSumM = pipe(sumSrc, "mass");
    // bind groups; `bufs` may be a list (bindings 0, 1, 2…) or [[binding, buffer], …]
    const bg = (pl, bufs) => device.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: bufs.map((b, i) => Array.isArray(b) ? { binding: b[0], resource: { buffer: b[1] } } : { binding: i, resource: { buffer: b } }) });
    g.bgFn = bg;
    g.bg = [0, 1].map(function (ph) {
      const a = ph ? g.fB : g.fA, b = ph ? g.fA : g.fB;      // a = current, b = next
      return {
        collide: bg(g.pCollide, [g.uni, a, g.flags]),
        stream: bg(g.pStream, [g.uni, a, b, g.flags]),
        link: bg(g.pLink, [g.uni, a, b, g.links, g.lf]),
        inlet: bg(g.pIn, [g.uni, b, g.inNodes]),
        outlet: bg(g.pOut, [g.uni, b, g.outNodes])
      };
    });
    g.sumLBG = bg(g.pSumL, [[0, g.uni], [1, g.lf], [2, g.part]]);
    g.sumMBG = new Map([g.fA, g.fB].map((buf) => [buf, bg(g.pSumM, [[0, g.uni], [2, g.part], [3, buf], [4, g.flags]])]));
    g.phase = 0;
    g.reset();
    return g;
  };

  GPUSolver.prototype.rampSteps = function () { return Math.max(100, Math.min(2 * this.R / Math.max(this.u, 1e-6), this.R * this.R / this.nu)); };
  GPUSolver.prototype.pickCollision = function () { this.collision = this.collisionMode !== "auto" ? this.collisionMode : (this.u / this.nu > 4 ? "reg" : "trt"); };
  GPUSolver.prototype.setFlow = function (u, nu) { this.u = u; this.nu = nu; this.pickCollision(); };
  GPUSolver.prototype.setPulse = function (pulse) { this.pulse = pulse; this.cpu.pulse = pulse; };
  GPUSolver.prototype.bodyInfo = function () { return this.cpu.bodyInfo(); };

  // start from the undisturbed inflow, like the CPU solver
  GPUSolver.prototype.reset = function () {
    const S = this.cpu, N = this.N, f = new Float32Array(N * Q);
    this.uCur = this.u; this.t = 0;
    for (let k = 0; k < S.fluid.length; k++) {
      const n = S.fluid[k], y = Math.floor(n / this.Nx) % this.Ny, z = Math.floor(n / (this.Nx * this.Ny));
      const u0 = S.profile(y, z, this.u), usq = 1.5 * u0 * u0;
      for (let i = 0; i < Q; i++) { const cu = CX[i] * u0; f[i * N + n] = W[i] * (1 + 3 * cu + 4.5 * cu * cu - usq); }
    }
    this.device.queue.writeBuffer(this.fA, 0, f); this.device.queue.writeBuffer(this.fB, 0, f);
    this.phase = 0; this.pickCollision();
  };

  // the buffer holding the newest populations (each step writes the other one)
  GPUSolver.prototype.latest = function () { return this.phase === 1 ? this.fB : this.fA; };

  GPUSolver.prototype.writeUniforms = function () {
    const wp = 1 / (3 * this.nu + 0.5), wm = 1 / (3 / 16 / (1 / wp - 0.5) + 0.5), ws = 1 / (3 * Math.max(3 * this.nu, 0.03) + 0.5);
    let vy = 0, vz = 0, seed = 0;
    if (this.disturb === "kick") {
      const t0 = this.rampSteps(), dur = 2 * this.R / Math.max(this.u, 1e-4);
      if (this.t > t0 && this.t < t0 + dur) vy = 0.03 * this.u * Math.sin(Math.PI * (this.t - t0) / dur);
    } else if (this.disturb === "noise") { vy = vz = 0.01 * this.u; seed = (this.t * 2654435761 >>> 0) | 1; }
    const b = new ArrayBuffer(112), u = new Uint32Array(b), fl = new Float32Array(b);
    u[0] = this.N; u[1] = this.Nx; u[2] = this.Ny; u[3] = this.Nz;
    fl[4] = wp; fl[5] = wm; fl[6] = ws; u[7] = this.collision === "reg" ? 1 : 0;
    fl[8] = this.uCur; fl[9] = vy; fl[10] = vz; u[11] = this.inflowKind === "uniform" || this.mode === "moving" ? 1 : 0;
    fl[12] = this.cy; fl[13] = this.cz; fl[14] = this.R; fl[15] = this.mode === "moving" ? this.uCur : 0;
    u[16] = this.cpu.inlet.length; u[17] = this.cpu.outlet.length; u[18] = this.nLinks; u[19] = seed;
    for (let s = 0; s < 8; s++) fl[20 + s] = this.uCur * TF.pulseFactor(this.inflowKind, this.pulse, this.t + s);
    this.device.queue.writeBuffer(this.uni, 0, b);
  };

  // advance n steps (one submit; uniforms — eased speed, disturbance — updated per batch of steps)
  GPUSolver.prototype.step = function (n) {
    const dev = this.device;
    let left = n || 1;
    while (left > 0) {
      const batch = Math.min(left, 8);
      if (this.uCur !== this.u) {
        const du = Math.max(Math.abs(this.u), 1e-6) / this.rampSteps() * batch;
        this.uCur = Math.abs(this.u - this.uCur) <= du ? this.u : this.uCur + Math.sign(this.u - this.uCur) * du;
      }
      this.writeUniforms();
      const enc = dev.createCommandEncoder();
      for (let s = 0; s < batch; s++) {
        const B = this.bg[this.phase], pass = enc.beginComputePass();
        pass.setPipeline(this.pCollide); pass.setBindGroup(0, B.collide); pass.dispatchWorkgroups(this.nodeGroups);
        pass.setPipeline(this.pStream); pass.setBindGroup(0, B.stream); pass.dispatchWorkgroups(this.nodeGroups);
        pass.setPipeline(this.pLink); pass.setBindGroup(0, B.link); pass.dispatchWorkgroups(this.linkGroups);
        pass.setPipeline(this.pIn); pass.setBindGroup(0, B.inlet); pass.dispatchWorkgroups(Math.ceil(this.cpu.inlet.length / WG), s + 1);
        pass.setPipeline(this.pOut); pass.setBindGroup(0, B.outlet); pass.dispatchWorkgroups(Math.ceil(this.cpu.outlet.length / WG));
        pass.end();
        this.phase ^= 1;
      }
      dev.queue.submit([enc.finish()]);
      this.t += batch; left -= batch;
    }
  };

  // Advance `chunks` × `every` steps, recording the forces after every chunk on the GPU (link sums
  // copied into a history buffer), then read the whole history back at once: evenly spaced force
  // samples at full resolution without a GPU→CPU round trip per sample.
  GPUSolver.prototype.stepSampled = async function (chunks, every) {
    const dev = this.device, partBytes = this.linkGroups * 2 * 16, size = chunks * partBytes;
    if (!this.hist || this.hist.size < size) { if (this.hist) this.hist.destroy(); this.hist = dev.createBuffer({ size: size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); }
    const times = [];
    for (let c = 0; c < chunks; c++) {
      this.step(every);
      const enc = dev.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(this.pSumL); pass.setBindGroup(0, this.sumLBG); pass.dispatchWorkgroups(this.linkGroups); pass.end();
      enc.copyBufferToBuffer(this.part, 0, this.hist, c * partBytes, partBytes);
      dev.queue.submit([enc.finish()]);
      times.push(this.t);
    }
    const st = dev.createBuffer({ size: size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(this.hist, 0, st, 0, size); dev.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(st.getMappedRange().slice(0)); st.unmap(); st.destroy();
    const out = [];
    for (let c = 0; c < chunks; c++) {
      const o = c * this.linkGroups * 8, f = [0, 0, 0];
      for (let g = 0; g < this.linkGroups; g++) { f[0] += a[o + 8 * g]; f[1] += a[o + 8 * g + 1]; f[2] += a[o + 8 * g + 2]; }
      out.push([times[c], f[0], f[1], f[2]]);
    }
    return out;
  };

  // a reusable "gather" of macroscopic values at a fixed list of nodes
  GPUSolver.prototype.gatherer = function (name, indices) {
    const dev = this.device, n = indices.length;
    const idx = dev.createBuffer({ size: Math.max(16, n * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(idx, 0, indices instanceof Uint32Array ? indices : Uint32Array.from(indices));
    const out = dev.createBuffer({ size: Math.max(16, n * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const cnt = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(cnt, 0, new Uint32Array([n, 0, 0, 0]));
    const g = { n: n, out: out, groups: Math.ceil(n / WG), bg: new Map([this.fA, this.fB].map((buf) => [buf, this.bgFn(this.pGather, [this.uni, buf, idx, out, cnt])])) };
    (this.gathers = this.gathers || {})[name] = g;
    return g;
  };

  // Read the instruments (and optionally the slice and a downsampled field). Resolves with plain arrays.
  GPUSolver.prototype.read = async function (want) {
    want = want || {};
    const dev = this.device, enc = dev.createCommandEncoder(), latest = this.latest();
    const jobs = [];
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pSumL); pass.setBindGroup(0, this.sumLBG); pass.dispatchWorkgroups(this.linkGroups);
    pass.end();
    const partBytes = this.linkGroups * 2 * 16;
    const st = dev.createBuffer({ size: partBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(this.part, 0, st, 0, partBytes);
    jobs.push(["force", st, partBytes]);
    const names = ["planes", "axis"].concat(want.slice ? ["slice"] : []).concat(want.field ? ["field"] : []);
    names.forEach((nm) => {
      const gth = this.gathers && this.gathers[nm]; if (!gth || !gth.n) return;
      const p2 = enc.beginComputePass(); p2.setPipeline(this.pGather); p2.setBindGroup(0, gth.bg.get(latest)); p2.dispatchWorkgroups(gth.groups); p2.end();
      const s2 = dev.createBuffer({ size: gth.n * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.copyBufferToBuffer(gth.out, 0, s2, 0, gth.n * 16);
      jobs.push([nm, s2, gth.n * 16]);
    });
    if (want.mass) {
      // (the link sums above already went to `part`; copy them before reusing it — encoder order guarantees this)
      const p3 = enc.beginComputePass(); p3.setPipeline(this.pSumM); p3.setBindGroup(0, this.sumMBG.get(latest)); p3.dispatchWorkgroups(this.nodeGroups); p3.end();
      const s3 = dev.createBuffer({ size: this.nodeGroups * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.copyBufferToBuffer(this.part, 0, s3, 0, this.nodeGroups * 16);
      jobs.push(["mass", s3, this.nodeGroups * 16]);
    }
    dev.queue.submit([enc.finish()]);
    const t = this.t, res = { t: t };
    await Promise.all(jobs.map(async (j) => {
      await j[1].mapAsync(GPUMapMode.READ);
      const a = new Float32Array(j[1].getMappedRange().slice(0));
      j[1].unmap(); j[1].destroy();
      if (j[0] === "force") {
        const s = [0, 0, 0], w = [0, 0, 0];
        for (let g = 0; g < this.linkGroups; g++) { for (let c = 0; c < 3; c++) { s[c] += a[8 * g + c]; w[c] += a[8 * g + 4 + c]; } }
        res.force = s; res.wallForce = w;
      } else if (j[0] === "mass") { let m = 0; for (let g = 0; g < this.nodeGroups; g++) m += a[4 * g]; res.mass = m; }
      else res[j[0]] = a;
    }));
    return res;
  };

  // free the GPU memory (switching grids or solvers)
  GPUSolver.prototype.destroy = function () {
    [this.fA, this.fB, this.flags, this.links, this.lf, this.inNodes, this.outNodes, this.uni, this.part, this.hist].forEach(function (b) { if (b) b.destroy(); });
    const gs = this.gathers || {};
    Object.keys(gs).forEach(function (k) { gs[k].out.destroy(); });
    this.gathers = {};
  };

  root.TF.GPUSolver = GPUSolver;
  root.TF.gpuAvailable = async function () {
    if (!root.navigator || !navigator.gpu) return null;
    try {
      const ad = await navigator.gpu.requestAdapter();
      if (!ad) return null;
      const lim = ad.limits;
      const dev = await ad.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize, maxBufferSize: lim.maxBufferSize } });
      return { adapter: ad, device: dev, maxBuffer: Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize), info: ad.info || {} };
    } catch (e) { return null; }
  };
})(typeof self !== "undefined" ? self : this);
