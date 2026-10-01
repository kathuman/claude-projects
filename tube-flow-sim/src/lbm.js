/*
 * lbm.js — D3Q19 lattice-Boltzmann solver for flow through a tube past a sphere.
 *
 * Numerics (all standard, chosen for accuracy and robustness at low viscosity):
 *   - TRT collision (two relaxation times, "magic" Λ = 3/16): as cheap as BGK but
 *     stable much closer to τ = 1/2, and its wall position doesn't drift with viscosity.
 *   - Curved walls by interpolated bounce-back (Bouzidi, linear): every lattice link
 *     that crosses the tube wall or the sphere knows where it crosses (q ∈ (0,1]), so
 *     the sphere is a sphere, not a pile of cubes. Walls may move along the axis.
 *   - Inlet: velocity given (parabolic for pipe flow, uniform for the moving-sphere
 *     frame), outlet: pressure ρ = 1 — both by non-equilibrium extrapolation (Guo),
 *     so mass is conserved without any renormalisation.
 *   - Forces on the sphere (and on the tube wall) by momentum exchange on the
 *     boundary links — drag along x, lift across.
 * No velocity or density clamps: if a case is beyond what the grid can resolve, the
 * case setup (caseToLattice) says so instead.
 *
 * Coordinates: x along the tube (inlet at x = 0), tube axis at the centre of y and z.
 * Browser: self.TF.Solver / self.TF.caseToLattice; Node: module.exports.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.TF = root.TF || {}; Object.assign(root.TF, factory()); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const Q = 19;
  const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
  const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
  const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1];
  const W = [1 / 3, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  const OPP = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17];
  const PAIRS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18]];
  const MAGIC = 3 / 16;           // TRT magic parameter Λ
  const NU_MIN = 0.0034;          // τ ≥ 0.51: the smallest lattice viscosity we run
  const NU_MAX = 0.25;            // τ ≤ 1.25: beyond this low-Re runs get slow and less accurate
  const U_MAX = 0.1;              // lattice speed cap: Mach 0.17
  const U_TARGET = 0.08;          // preferred lattice speed: Mach 0.14 (compressibility error ~ Ma² ≈ 2%)

  // ------------------------------------------------------------------ generated kernels
  // The D3Q19 velocity set is fixed, so the per-node collision is written out in full
  // (no inner loops or table lookups) by generating its source once — 2–4× faster in JS.
  function makeKernels() {
    const v = (i) => "f" + i;
    const sum = (coef) => { const t = []; for (let i = 0; i < Q; i++) { if (coef(i) === 1) t.push("+" + v(i)); else if (coef(i) === -1) t.push("-" + v(i)); } return t.join("") || "0"; };
    let load = "const b = fl[k] * 19;\n";
    for (let i = 0; i < Q; i++) load += "const " + v(i) + " = f[b + " + i + "];\n";
    load += "const rho = " + sum(() => 1) + ";\nconst ir = 1 / rho;\n";
    load += "const ux = (" + sum((i) => CX[i]) + ") * ir, uy = (" + sum((i) => CY[i]) + ") * ir, uz = (" + sum((i) => CZ[i]) + ") * ir;\n";
    load += "const usq = 1.5 * (ux * ux + uy * uy + uz * uz);\n";
    const cuExpr = (i) => { const t = []; if (CX[i]) t.push((CX[i] > 0 ? "+" : "-") + "ux"); if (CY[i]) t.push((CY[i] > 0 ? "+" : "-") + "uy"); if (CZ[i]) t.push((CZ[i] > 0 ? "+" : "-") + "uz"); return t.length ? "(" + t.join("") + ")" : "0"; };
    // TRT
    let trt = "for (let k = 0; k < fl.length; k++) {\n" + load;
    trt += "f[b] = f0 - wp * (f0 - " + W[0] + " * rho * (1 - usq));\n";
    PAIRS.forEach(([i, o]) => {
      trt += "{ const cu = " + cuExpr(i) + ", wr = " + W[i] + " * rho;\n";
      trt += "const dp = wp * (0.5 * (" + v(i) + " + " + v(o) + ") - wr * (1 + 4.5 * cu * cu - usq)), dm = wm * (0.5 * (" + v(i) + " - " + v(o) + ") - wr * 3 * cu);\n";
      trt += "f[b + " + i + "] = " + v(i) + " - dp - dm; f[b + " + o + "] = " + v(o) + " - dp + dm; }\n";
    });
    trt += "}";
    // regularised BGK
    let reg = "for (let k = 0; k < fl.length; k++) {\n" + load;
    for (let i = 0; i < Q; i++) reg += "const e" + i + " = " + W[i] + " * rho * (1 + 3 * " + cuExpr(i) + " + 4.5 * " + cuExpr(i) + " * " + cuExpr(i) + " - usq);\n";
    const comp = (fa, fb) => { const t = []; for (let i = 0; i < Q; i++) { const c = fa(i) * fb(i); if (c) t.push((c > 0 ? "+" : "-") + "(" + v(i) + " - e" + i + ")"); } return t.join("") || "0"; };
    reg += "const pxx = " + comp((i) => CX[i], (i) => CX[i]) + ", pyy = " + comp((i) => CY[i], (i) => CY[i]) + ", pzz = " + comp((i) => CZ[i], (i) => CZ[i]) + ";\n";
    reg += "const pxy = " + comp((i) => CX[i], (i) => CY[i]) + ", pxz = " + comp((i) => CX[i], (i) => CZ[i]) + ", pyz = " + comp((i) => CY[i], (i) => CZ[i]) + ";\n";
    reg += "const tr = (pxx + pyy + pzz) / 3;\n";
    for (let i = 0; i < Q; i++) {
      const t = [];
      if (CX[i]) t.push("pxx"); if (CY[i]) t.push("pyy"); if (CZ[i]) t.push("pzz");
      const cross = []; if (CX[i] * CY[i]) cross.push((CX[i] * CY[i] > 0 ? "+" : "-") + "pxy"); if (CX[i] * CZ[i]) cross.push((CX[i] * CZ[i] > 0 ? "+" : "-") + "pxz"); if (CY[i] * CZ[i]) cross.push((CY[i] * CZ[i] > 0 ? "+" : "-") + "pyz");
      const qp = (t.length ? t.join("+") : "0") + (cross.length ? "+2*(" + cross.join("") + ")" : "") + "-tr";
      reg += "f[b + " + i + "] = e" + i + " + om * " + (4.5 * W[i]) + " * (" + qp + ");\n";
    }
    reg += "}";
    return {
      trt: new Function("f", "fl", "wp", "wm", trt),
      reg: new Function("f", "fl", "om", reg)
    };
  }
  const K = makeKernels();

  // ------------------------------------------------------------------ case → lattice
  // A physical case (fluid, tube, sphere, speed) mapped onto a grid with `tubeCells`
  // across the tube. Picks the lattice speed and viscosity that reproduce the case's
  // Reynolds number within the stability and Mach limits; if the grid can't reach it,
  // runs the highest Reynolds number it can and says so.
  function caseToLattice(c) {
    const tubeCells = c.tubeCells;
    const R = tubeCells / 2;                        // tube radius in cells
    const d = 2 * R * c.ratio;                      // sphere diameter in cells
    const Re = c.speed * c.ratio * c.tubeDiameter / c.nu;
    let u = U_TARGET, nu = u * d / Re, note = null;
    if (nu < NU_MIN) {                              // high Re: lower the viscosity floor by raising the speed
      nu = NU_MIN; u = Re * nu / d;
      if (u > U_MAX) { u = U_MAX; note = "under-resolved"; }
    } else if (nu > NU_MAX) {                       // very low Re: slow the flow instead
      nu = NU_MAX; u = Re * nu / d;
    }
    const ReSim = u * d / nu;
    const dx = c.tubeDiameter / (2 * R);            // metres per cell
    const dt = nu * dx * dx / c.nu;                 // seconds per step
    return {
      R: R, d: d, u: u, nu: nu, tau: 3 * nu + 0.5, mach: u * Math.sqrt(3),
      Re: Re, ReSim: ReSim, resolved: !note, note: note,
      ReMax: U_MAX * d / NU_MIN,
      dx: dx, dt: dt,
      forceScale: c.rho * Math.pow(dx, 4) / (dt * dt),   // lattice force → newtons
      pressureScale: c.rho * dx * dx / (dt * dt)          // lattice pressure → pascals
    };
  }

  // ------------------------------------------------------------------ solver
  // opts: { R (tube radius, cells), length (cells), ratio (sphere/tube diameter),
  //         sphereX (fraction of length), mode: "pipe" | "moving", u, nu }
  function Solver(opts) {
    const R = opts.R;
    const Ny = Math.ceil(2 * R) + 2, Nz = Ny, Nx = Math.round(opts.length);
    this.Nx = Nx; this.Ny = Ny; this.Nz = Nz; this.N = Nx * Ny * Nz;
    this.R = R; this.cy = (Ny - 1) / 2; this.cz = (Nz - 1) / 2;
    this.ratio = opts.ratio || 0;
    this.r = R * this.ratio;                          // sphere radius (cells)
    this.sx = (opts.sphereX === undefined ? 0.3 : opts.sphereX) * Nx;
    this.mode = opts.mode || "pipe";
    this.u = opts.u; this.nu = opts.nu;
    this.disturb = opts.disturbance || "kick";
    // collision: TRT where the grid Reynolds number (u·Δx/ν) is low — its walls sit exactly where they
    // should at any viscosity — and regularised BGK where it's high, for stability
    this.collisionMode = opts.collision || "auto";
    this.collision = this.collisionMode;
    this.t = 0;

    const N = this.N, solid = this.solid = new Uint8Array(N), self = this;
    const inTube = function (y, z) { const dy = y - self.cy, dz = z - self.cz; return dy * dy + dz * dz < R * R; };
    const inSphere = function (x, y, z) { if (!self.r) return false; const a = x - self.sx, b = y - self.cy, c = z - self.cz; return a * a + b * b + c * c <= self.r * self.r; };
    this.isSolidAt = function (x, y, z) { return !inTube(y, z) || inSphere(x, y, z); };
    for (let z = 0; z < Nz; z++) for (let y = 0; y < Ny; y++) for (let x = 0; x < Nx; x++) solid[x + Nx * (y + Ny * z)] = this.isSolidAt(x, y, z) ? 1 : 0;

    // fluid node lists: everything, interior (streamed), inlet and outlet layers
    const all = [], interior = [], inlet = [], outlet = [];
    for (let n = 0; n < N; n++) {
      if (solid[n]) continue;
      all.push(n);
      const x = n % Nx;
      if (x === 0) inlet.push(n); else if (x === Nx - 1) outlet.push(n); else interior.push(n);
    }
    this.fluid = Int32Array.from(all); this.interior = Int32Array.from(interior);
    // outlet sponge: the last ~12% of the tube runs at a higher viscosity, damping pressure waves and
    // eddies before they reach the outlet (nothing is measured there)
    const spongeX = opts.sponge === false ? Nx : Math.round(Nx * 0.88);
    this.spongeX = spongeX;
    this.core = Int32Array.from(all.filter(function (n) { return n % Nx < spongeX; }));
    this.spongeNodes = Int32Array.from(all.filter(function (n) { return n % Nx >= spongeX; }));
    this.inlet = Int32Array.from(inlet); this.outlet = Int32Array.from(outlet);
    this.offsets = CX.map(function (cx, i) { return cx + Nx * (CY[i] + Ny * CZ[i]); });

    // boundary links: from fluid node n along direction j into a wall, crossing at fraction q
    const links = [];
    const crossing = function (x, y, z, j) {
      let best = Infinity, which = 0;
      // tube wall: (y + t cy − cy0)² + (z + t cz − cz0)² = R²
      const a = CY[j] * CY[j] + CZ[j] * CZ[j];
      if (a > 0) {
        const py = y - self.cy, pz = z - self.cz, b = 2 * (py * CY[j] + pz * CZ[j]), c = py * py + pz * pz - R * R;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) { const t = (-b + Math.sqrt(disc)) / (2 * a); if (t > 1e-9 && t <= 1 + 1e-9 && t < best) { best = t; which = 1; } }
      }
      if (self.r) {
        const px = x - self.sx, py = y - self.cy, pz = z - self.cz;
        const aa = CX[j] * CX[j] + CY[j] * CY[j] + CZ[j] * CZ[j], bb = 2 * (px * CX[j] + py * CY[j] + pz * CZ[j]), cc = px * px + py * py + pz * pz - self.r * self.r;
        const disc = bb * bb - 4 * aa * cc;
        if (disc >= 0) { const t = (-bb - Math.sqrt(disc)) / (2 * aa); if (t > 1e-9 && t <= 1 + 1e-9 && t < best) { best = t; which = 2; } }
      }
      return best === Infinity ? { q: 0.5, which: inSphere(x + CX[j], y + CY[j], z + CZ[j]) ? 2 : 1 } : { q: Math.min(1, best), which: which };
    };
    for (let k = 0; k < all.length; k++) {
      const n = all[k], x = n % Nx, y = Math.floor(n / Nx) % Ny, z = Math.floor(n / (Nx * Ny));
      if (x === 0 || x === Nx - 1) continue;                     // inlet/outlet layers are set by their own conditions
      for (let j = 1; j < Q; j++) {
        const xn = x + CX[j], yn = y + CY[j], zn = z + CZ[j];
        if (xn < 0 || xn >= Nx) continue;                       // inlet/outlet planes, handled by their conditions
        if (!solid[xn + Nx * (yn + Ny * zn)]) continue;
        const c = crossing(x, y, z, j);
        const back = n - this.offsets[j];                        // the fluid node behind n (for q < 1/2)
        const bx = x - CX[j], by = y - CY[j], bz = z - CZ[j];
        const backOK = bx >= 0 && bx < Nx && by >= 0 && by < Ny && bz >= 0 && bz < Nz && !solid[back];
        links.push(n, j, c.q, c.which, backOK ? back : -1);
      }
    }
    this.nLinks = links.length / 5;
    this.lNode = new Int32Array(this.nLinks); this.lDir = new Uint8Array(this.nLinks); this.lQ = new Float32Array(this.nLinks);
    this.lWhich = new Uint8Array(this.nLinks); this.lBack = new Int32Array(this.nLinks);
    for (let k = 0; k < this.nLinks; k++) { this.lNode[k] = links[5 * k]; this.lDir[k] = links[5 * k + 1]; this.lQ[k] = links[5 * k + 2]; this.lWhich[k] = links[5 * k + 3]; this.lBack[k] = links[5 * k + 4]; }

    // streaming sources for every interior node and direction (−1 where the source is a wall)
    this.src = new Int32Array(this.interior.length * Q);
    for (let k = 0; k < this.interior.length; k++) {
      const n = this.interior[k];
      for (let i = 0; i < Q; i++) { const s = n - this.offsets[i]; this.src[k * Q + i] = solid[s] ? -1 : s * Q + i; }
    }
    this.f = new Float32Array(N * Q); this.fNew = new Float32Array(N * Q);
    this.rho = new Float32Array(N); this.ux = new Float32Array(N); this.uy = new Float32Array(N); this.uz = new Float32Array(N);
    this.force = [0, 0, 0]; this.wallForce = [0, 0, 0];
    this.wallFx = new Float64Array(Nx);               // axial wall force per cross-section (wall shear along the tube)
    this.reset();
    this.pickCollision();
  }

  Solver.prototype.idx = function (x, y, z) { return x + this.Nx * (y + this.Ny * z); };

  // inflow velocity at a node of the inlet plane (with a start-up ramp and the optional disturbance)
  // axial flow speed at (y, z) for speed U: parabolic (pipe) or uniform (moving sphere)
  Solver.prototype.profile = function (y, z, U) {
    if (this.mode === "moving") return U;
    const r2 = ((y - this.cy) * (y - this.cy) + (z - this.cz) * (z - this.cz)) / (this.R * this.R);
    return U * Math.max(0, 1 - r2);
  };
  Solver.prototype.inflow = function (y, z, out) {
    out[0] = this.profile(y, z, this.uCur); out[1] = 0; out[2] = 0;
    // a brief asymmetric pulse (like any real rig's imperfections) lets unstable wakes break symmetry
    if (this.disturb === "kick") {
      const t0 = this.rampSteps(), dur = 2 * this.R / Math.max(this.u, 1e-4);
      if (this.t > t0 && this.t < t0 + dur) out[1] = 0.03 * this.u * Math.sin(Math.PI * (this.t - t0) / dur);
    } else if (this.disturb === "noise") {
      out[1] = 0.01 * this.u * (Math.random() - 0.5) * 2; out[2] = 0.01 * this.u * (Math.random() - 0.5) * 2;
    }
  };
  // start-up ramp: one convective time across the tube, or the viscous time if that's
  // shorter (slow, viscous flows settle by diffusion long before the fluid crosses the tube)
  Solver.prototype.rampSteps = function () { return Math.max(100, Math.min(2 * this.R / Math.max(this.u, 1e-6), this.R * this.R / this.nu)); };
  // axial wall velocity (moving-sphere frame: the tube slides past a fixed sphere at the sphere's speed)
  Solver.prototype.wallU = function () { return this.mode === "moving" ? this.uCur : 0; };

  // Start from the undisturbed flow (the inflow profile everywhere), not from rest: an impulsive start
  // at this Mach number sends pressure waves up and down the tube that low viscosity barely damps.
  Solver.prototype.reset = function () {
    const f = this.f, fl = this.fluid, Nx = this.Nx, Ny = this.Ny;
    this.f.fill(0); this.fNew.fill(0);
    this.uCur = this.u;
    for (let k = 0; k < fl.length; k++) {
      const n = fl[k], b = n * Q, y = Math.floor(n / Nx) % Ny, z = Math.floor(n / (Nx * Ny));
      const u0 = this.profile(y, z, this.u);
      for (let i = 0; i < Q; i++) f[b + i] = feq(i, 1, u0, 0, 0);
    }
    this.rho.fill(1); this.ux.fill(0); this.uy.fill(0); this.uz.fill(0);
    this.t = 0; this.force = [0, 0, 0]; this.wallForce = [0, 0, 0];
  };
  // a new speed is eased in over about one convective time across the tube (no pressure shock)
  Solver.prototype.setFlow = function (u, nu) { this.u = u; this.nu = nu; this.pickCollision(); };
  Solver.prototype.pickCollision = function () {
    this.collision = this.collisionMode !== "auto" ? this.collisionMode : (this.u / this.nu > 4 ? "reg" : "trt");
  };

  function feq(i, rho, ux, uy, uz) {
    const cu = CX[i] * ux + CY[i] * uy + CZ[i] * uz;
    return W[i] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy + uz * uz));
  }

  Solver.prototype.step = function () {
    const f = this.f, fNew = this.fNew, Nx = this.Nx;
    const wp = 1 / (3 * this.nu + 0.5);                        // ω+ (sets the viscosity)
    const wm = 1 / (MAGIC / (1 / wp - 0.5) + 0.5);             // ω− from Λ
    if (this.uCur !== this.u) {
      const du = Math.max(Math.abs(this.u), 1e-6) / this.rampSteps();
      this.uCur = Math.abs(this.u - this.uCur) <= du ? this.u : this.uCur + Math.sign(this.u - this.uCur) * du;
    }
    // 1. collide, in place (TRT, or regularised BGK at high grid Reynolds numbers); the outlet sponge
    //    always uses the regularised scheme at a raised viscosity
    if (this.collision === "reg") K.reg(f, this.core, 1 - wp); else K.trt(f, this.core, wp, wm);
    if (this.spongeNodes.length) K.reg(f, this.spongeNodes, 1 - 1 / (3 * Math.max(3 * this.nu, 0.03) + 0.5));
    // 2. stream (pull) into interior nodes; links whose source is a wall are filled in step 3
    const it = this.interior, src = this.src;
    for (let k = 0, m = 0; k < it.length; k++) {
      const b = it[k] * Q;
      for (let i = 0; i < Q; i++, m++) { const s = src[m]; if (s >= 0) fNew[b + i] = f[s]; }
    }
    // 3. interpolated bounce-back on every wall link, with momentum exchange
    const Fs = [0, 0, 0], Fw = [0, 0, 0], uw = this.wallU(), wx = this.wallFx;
    wx.fill(0);
    const lN = this.lNode, lD = this.lDir, lQ = this.lQ, lW = this.lWhich, lB = this.lBack;
    for (let k = 0; k < this.nLinks; k++) {
      const n = lN[k], j = lD[k], o = OPP[j], q = lQ[k], b = n * Q;
      const mov = lW[k] === 1 && uw !== 0 ? 6 * W[j] * CX[j] * uw : 0;     // 2 w ρ (c·u_w)/c_s², ρ ≈ 1
      let v;
      if (q < 0.5 && lB[k] >= 0) v = 2 * q * f[b + j] + (1 - 2 * q) * f[lB[k] * Q + j] - mov;
      else if (q >= 0.5) v = f[b + j] / (2 * q) + (2 * q - 1) / (2 * q) * f[b + o] - mov / (2 * q);
      else v = f[b + j] - mov;
      fNew[b + o] = v;
      // momentum handed to the wall: c_j (f̃_j + f_o)  (moving wall: Galilean-corrected)
      const s = f[b + j] + v, ux = lW[k] === 1 ? uw : 0;
      const fx = CX[j] * s - ux * (f[b + j] - v), fy = CY[j] * s, fz = CZ[j] * s;
      if (lW[k] === 2) { Fs[0] += fx; Fs[1] += fy; Fs[2] += fz; } else { Fw[0] += fx; Fw[1] += fy; Fw[2] += fz; wx[n % Nx] += fx; }
    }
    this.force = Fs; this.wallForce = Fw;
    // 4. inlet (velocity) and outlet (pressure) by non-equilibrium extrapolation
    const tmp = [0, 0, 0], Ny = this.Ny;
    const macro = function (b) {
      let r = 0, x = 0, y = 0, z = 0;
      for (let i = 0; i < Q; i++) { const v = fNew[b + i]; r += v; x += v * CX[i]; y += v * CY[i]; z += v * CZ[i]; }
      return [r, x / r, y / r, z / r];
    };
    for (let k = 0; k < this.inlet.length; k++) {
      const n = this.inlet[k], y = Math.floor(n / Nx) % Ny, z = Math.floor(n / (Nx * Ny));
      const nb = n + 1, bn = nb * Q, m = macro(bn), b = n * Q;
      this.inflow(y, z, tmp);
      for (let i = 0; i < Q; i++) fNew[b + i] = feq(i, m[0], tmp[0], tmp[1], tmp[2]) + (fNew[bn + i] - feq(i, m[0], m[1], m[2], m[3]));
    }
    for (let k = 0; k < this.outlet.length; k++) {
      const n = this.outlet[k], nb = n - 1, bn = nb * Q, m = macro(bn), b = n * Q;
      for (let i = 0; i < Q; i++) fNew[b + i] = feq(i, 1, m[1], m[2], m[3]) + (fNew[bn + i] - feq(i, m[0], m[1], m[2], m[3]));
    }
    // 5. swap
    this.f = fNew; this.fNew = f;
    this.t++;
  };

  // density and velocity on every fluid node (for the views and the instruments)
  Solver.prototype.macroscopic = function () {
    const f = this.f, fl = this.fluid, rho = this.rho, ux = this.ux, uy = this.uy, uz = this.uz;
    for (let k = 0; k < fl.length; k++) {
      const n = fl[k], b = n * Q;
      let r = 0, x = 0, y = 0, z = 0;
      for (let i = 0; i < Q; i++) { const v = f[b + i]; r += v; x += v * CX[i]; y += v * CY[i]; z += v * CZ[i]; }
      rho[n] = r; ux[n] = x / r; uy[n] = y / r; uz[n] = z / r;
    }
  };
  // density and velocity of one node straight from its populations (no full-field pass)
  Solver.prototype.nodeMacro = function (n, out) {
    const f = this.f, b = n * Q;
    let r = 0, x = 0;
    for (let i = 0; i < Q; i++) { const v = f[b + i]; r += v; x += v * CX[i]; }
    out[0] = r; out[1] = x / r;
    return out;
  };
  // cheap readings for the instruments: mean density on a cross-section, and the recirculation
  // length on the axis, computed from the populations of just those nodes
  Solver.prototype.planeRhoF = function (x) {
    const tmp = [0, 0]; let s = 0, c = 0;
    for (let z = 0; z < this.Nz; z++) for (let y = 0; y < this.Ny; y++) { const n = this.idx(x, y, z); if (!this.solid[n]) { s += this.nodeMacro(n, tmp)[0]; c++; } }
    return c ? s / c : 1;
  };
  Solver.prototype.recirculationF = function () {
    if (!this.r) return 0;
    const tmp = [0, 0], y = Math.round(this.cy), z = Math.round(this.cz), x0 = Math.ceil(this.sx + this.r);
    let last = -1, a = 0, b = 0;
    for (let x = x0; x < this.Nx - 1; x++) {
      const n = this.idx(x, y, z); if (this.solid[n]) continue;
      const u = this.nodeMacro(n, tmp)[1];
      if (u < 0) { last = x; a = u; } else if (last >= 0) { b = u; break; }
    }
    if (last < 0) return 0;
    return Math.max(0, last + (b !== a ? -a / (b - a) : 0) - (this.sx + this.r));
  };
  // total mass of the fluid
  Solver.prototype.mass = function () { let m = 0; const f = this.f, fl = this.fluid; for (let k = 0; k < fl.length; k++) { const b = fl[k] * Q; for (let i = 0; i < Q; i++) m += f[b + i]; } return m; };
  // mean density over the fluid nodes of the cross-section at x (call macroscopic() first)
  Solver.prototype.planeRho = function (x) {
    let s = 0, c = 0;
    for (let z = 0; z < this.Nz; z++) for (let y = 0; y < this.Ny; y++) { const n = this.idx(x, y, z); if (!this.solid[n]) { s += this.rho[n]; c++; } }
    return c ? s / c : 1;
  };
  // mean axial velocity (flow rate / area) over the cross-section at x
  Solver.prototype.planeU = function (x) {
    let s = 0, c = 0;
    for (let z = 0; z < this.Nz; z++) for (let y = 0; y < this.Ny; y++) { const n = this.idx(x, y, z); if (!this.solid[n]) { s += this.ux[n]; c++; } }
    return c ? s / c : 0;
  };
  // length of the recirculation bubble behind the sphere, measured on the axis (cells; 0 if none)
  Solver.prototype.recirculation = function () {
    if (!this.r) return 0;
    const y = Math.round(this.cy), z = Math.round(this.cz), x0 = Math.ceil(this.sx + this.r);
    let last = -1;
    for (let x = x0; x < this.Nx - 1; x++) { const n = this.idx(x, y, z); if (this.solid[n]) continue; if (this.ux[n] < 0) last = x; else if (last >= 0) break; }
    if (last < 0) return 0;
    const a = this.ux[this.idx(last, y, z)], b = this.ux[this.idx(last + 1, y, z)];
    const xz = last + (b !== a ? -a / (b - a) : 0);           // where u crosses zero
    return Math.max(0, xz - (this.sx + this.r));
  };

  return { Solver: Solver, caseToLattice: caseToLattice, Q: Q, CX: CX, CY: CY, CZ: CZ, W: W, OPP: OPP, NU_MIN: NU_MIN, U_MAX: U_MAX, U_TARGET: U_TARGET };
});
