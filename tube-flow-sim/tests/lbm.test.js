// Validation tests for src/lbm.js — run with:  node tube-flow-sim/tests/lbm.test.js
// Each test compares the solver with an exact solution or a published result.
const TF = require("../src/lbm.js");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; }
  console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : ""));
}
const pct = (a, b) => (a / b - 1) * 100;

// ---------------------------------------------------------------- 1. Hagen–Poiseuille flow in an empty tube
{
  const R = 8, uc = 0.05, nu = 0.1;
  const s = new TF.Solver({ R: R, length: 40, ratio: 0, u: uc, nu: nu, disturbance: "none" });
  for (let k = 0; k < 4000; k++) s.step();
  s.macroscopic();
  let maxe = 0;
  for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) {
    const n = s.idx(20, y, z); if (s.solid[n]) continue;
    const r2 = ((y - s.cy) ** 2 + (z - s.cz) ** 2) / (R * R);
    maxe = Math.max(maxe, Math.abs(s.ux[n] - uc * (1 - r2)) / uc);
  }
  check("Poiseuille: velocity profile = u_c(1 − r²/R²) within 1% of u_c (curved wall, R = 8 cells)", maxe < 0.01, (maxe * 100).toFixed(2) + "%");
  const G = -(s.planeRho(30) - s.planeRho(10)) / 20 / 3, Gex = 4 * nu * uc / (R * R);
  check("Poiseuille: pressure gradient = 4μu_c/R² within 4%", Math.abs(pct(G, Gex)) < 4, pct(G, Gex).toFixed(2) + "%");
  // mass flux ρu is conserved along the tube (u alone varies by the small density drop)
  const flux = (x) => { let m = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) { const n = s.idx(x, y, z); if (!s.solid[n]) m += s.rho[n] * s.ux[n]; } return m; };
  check("Poiseuille: mass flux constant along the tube within 0.5%", Math.abs(pct(flux(35), flux(5))) < 0.5, pct(flux(35), flux(5)).toFixed(3) + "%");
  const m1 = s.mass(); for (let k = 0; k < 500; k++) s.step(); const m2 = s.mass();
  check("Poiseuille: total mass steady without any renormalisation", Math.abs(m2 / m1 - 1) < 1e-4, ((m2 / m1 - 1) * 100).toExponential(2) + "%");
}

// ---------------------------------------------------------------- 2. Stokes drag on a sphere moving along a tube (Haberman–Sayre wall factor)
{
  const R = 10, lam = 0.3, nu = 0.25, Re = 0.05, d = 2 * R * lam, u = Re * nu / d;
  const s = new TF.Solver({ R: R, length: 12 * R, ratio: lam, sphereX: 0.5, mode: "moving", u: u, nu: nu, disturbance: "none" });
  for (let k = 0; k < 5000; k++) s.step();
  const K = (1 - 0.75857 * lam ** 5) / (1 - 2.1050 * lam + 2.0865 * lam ** 3 - 1.7068 * lam ** 5 + 0.72603 * lam ** 6);
  const Fst = 6 * Math.PI * nu * (d / 2) * u * K;
  check("Stokes drag × wall factor K(λ = 0.3) = " + K.toFixed(3) + ", within 5% (sphere 6 cells across)", Math.abs(pct(s.force[0], Fst)) < 5, pct(s.force[0], Fst).toFixed(2) + "%");
  check("Stokes: no lift on an axisymmetric flow", Math.abs(s.force[1]) + Math.abs(s.force[2]) < 1e-6 * Math.abs(s.force[0]));
}

// ---------------------------------------------------------------- 3. Momentum balance: pressure + momentum flux = force on sphere and wall
{
  const R = 8, lam = 0.35, nu = 0.04, u = 0.05;
  const s = new TF.Solver({ R: R, length: 64, ratio: lam, u: u, nu: nu, disturbance: "none" });
  for (let k = 0; k < 5000; k++) s.step();
  s.macroscopic();
  // mean (p + ρu²) over the cross-section × the tube's true area πR² (the node count over-counts the circle)
  const plane = (x) => { let p = 0, m = 0, c = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) { const n = s.idx(x, y, z); if (!s.solid[n]) { p += s.rho[n] / 3; m += s.rho[n] * s.ux[n] * s.ux[n]; c++; } } return (p + m) / c * Math.PI * R * R; };
  // control volume between two cross-sections well inside the tube: (p + ρu²)·A in − out = force on the solids
  // between them (wall links on the two bounding planes count half)
  const a0 = 8, a1 = s.Nx - 9;
  let wall = 0.5 * (s.wallFx[a0] + s.wallFx[a1]);
  for (let x = a0 + 1; x < a1; x++) wall += s.wallFx[x];
  const lhs = plane(a0) - plane(a1), rhs = s.force[0] + wall;
  check("momentum balance: Δ(p + ρu²)·πR² = drag on sphere + wall within 3%", Math.abs(pct(rhs, lhs)) < 3, pct(rhs, lhs).toFixed(2) + "%");
  check("steady symmetric flow: no lift", Math.hypot(s.force[1], s.force[2]) < 1e-5 * s.force[0]);
  check("drag acts downstream", s.force[0] > 0);
}

// ---------------------------------------------------------------- 4. Recirculation bubble appears with Reynolds number
{
  const run = (Re) => {
    const R = 8, lam = 0.4, d = 2 * R * lam, u = 0.06, nu = u * d / Re;
    const s = new TF.Solver({ R: R, length: 72, ratio: lam, u: u, nu: nu, disturbance: "none" });
    for (let k = 0; k < 4000; k++) s.step();
    s.macroscopic();
    return s.recirculation() / d;
  };
  const l5 = run(5), l60 = run(60), l120 = run(120);
  check("no recirculation at Re 5", l5 === 0, l5.toFixed(2));
  check("recirculation bubble at Re 60, longer at Re 120", l60 > 0 && l120 > l60, "L/d " + l60.toFixed(2) + " → " + l120.toFixed(2));
}

// ---------------------------------------------------------------- 4b. Steady state at low viscosity (no lingering pressure waves)
{
  const R = 10, lam = 0.3, d = 2 * R * lam, u = 0.08, nu = u * d / 100;
  const s = new TF.Solver({ R: R, length: 90, ratio: lam, u: u, nu: nu, disturbance: "none" });
  const read = () => [s.mass(), s.force[0], s.planeRhoF(5) - s.planeRhoF(60)];
  for (let k = 0; k < 6000; k++) s.step();
  const a = read(); for (let k = 0; k < 1200; k++) s.step(); const b = read();
  check("Re 100 (regularised collision): mass, drag and pressure drop steady to 1% after 6000 steps",
    Math.abs(b[0] / a[0] - 1) < 1e-2 && Math.abs(b[1] / a[1] - 1) < 1e-2 && Math.abs(b[2] / a[2] - 1) < 1e-2,
    [b[0] / a[0] - 1, b[1] / a[1] - 1, b[2] / a[2] - 1].map((x) => (x * 100).toFixed(3) + "%").join(", "));
  // a speed change is eased in: no density shock at the inlet
  s.setFlow(0.04, nu); let worst = 0;
  for (let k = 0; k < 600; k++) { s.step(); if (k % 20 === 0) worst = Math.max(worst, Math.abs(s.planeRhoF(1) - 1)); }
  check("halving the speed mid-run: inlet density stays within 3% of rest", worst < 0.03, (worst * 100).toFixed(2) + "%");
}

// ---------------------------------------------------------------- 5. Physical case → lattice
{
  const water = { nu: 1.004e-6, rho: 998 };
  const c = { ...water, tubeDiameter: 0.02, ratio: 0.3, speed: 0.005, tubeCells: 32 };
  const L = TF.caseToLattice(c);
  check("case: Re = U·d/ν (water, 6 mm sphere, 5 mm/s → 29.9)", Math.abs(L.Re - 0.005 * 0.006 / 1.004e-6) < 1e-9 && Math.abs(L.ReSim - L.Re) < 1e-9, L.Re.toFixed(2));
  check("case: Mach ≤ 0.17 and τ ≥ 0.51", L.mach <= 0.1733 && L.tau >= 0.51 - 1e-12);
  // dimensional consistency: drag coefficient is the same in lattice and physical units
  const Flat = 1e-3, Fphys = Flat * L.forceScale;
  const CdLat = Flat / (0.5 * 1 * L.u ** 2 * Math.PI * (L.d / 2) ** 2), CdPhys = Fphys / (0.5 * 998 * 0.005 ** 2 * Math.PI * 0.003 ** 2);
  check("case: force scale keeps the drag coefficient unit-free", Math.abs(CdLat / CdPhys - 1) < 1e-9);
  const air = TF.caseToLattice({ nu: 1.516e-5, rho: 1.204, tubeDiameter: 0.05, ratio: 0.3, speed: 2, tubeCells: 32 });
  check("case: air at 2 m/s in a 5 cm tube (Re ≈ 2000) is flagged as beyond this grid", !air.resolved && air.ReSim < air.Re && air.ReSim <= air.ReMax + 1e-9, "Re " + air.Re.toFixed(0) + " → simulated " + air.ReSim.toFixed(0));
  const slow = TF.caseToLattice({ nu: 1.12e-3, rho: 1261, tubeDiameter: 0.02, ratio: 0.3, speed: 0.001, tubeCells: 32 });
  check("case: creeping flow in glycerol runs slow but within limits", slow.resolved && slow.tau <= 1.25 + 1e-9 && slow.u < 0.05, "u " + slow.u.toExponential(2));
}

// ---------------------------------------------------------------- 6. Bodies other than a sphere, and STL import
{
  const R = 10, opts = (body, ratio) => ({ R: R, length: 60, ratio: ratio, sphereX: 0.5, u: 0.02, nu: 0.1, disturbance: "none", body: body, geometryOnly: true });
  // solid cells inside the body (away from the tube wall) vs. its volume
  const bodyCells = (s) => { let c = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) for (let x = 0; x < s.Nx; x++) if (s.body.inside(x, y, z)) c++; return c; };
  const a = R * 0.42;            // faces off the grid nodes (a node on a face is in or out by rounding)
  const shapes = [
    ["ellipsoid, length 2 × width", { shape: "ellipsoid", aspect: 2 }, 4 / 3 * Math.PI * a * a * 2 * a],
    ["cylinder along the flow, length 1.5 × width", { shape: "cylinder", aspect: 1.5 }, Math.PI * a * a * 3 * a],
    ["cube", { shape: "cube" }, 8 * a * a * a]
  ];
  for (const [name, body, vol] of shapes) {
    const s = new TF.Solver(opts(body, 0.42)), c = bodyCells(s);
    check("body: " + name + " — solid cells match its volume within 6%", Math.abs(pct(c, vol)) < 6, pct(c, vol).toFixed(2) + "%");
  }
  // generic surface crossing (bisection) agrees with the exact one: an ellipsoid of aspect 1 is a sphere
  const sph = new TF.Solver(opts({ shape: "sphere" }, 0.37)), ell = TF.makeBody({ shape: "ellipsoid", ratio: 0.37, aspect: 1 }, R, sph.sx, sph.cy, sph.cz);
  ell.hit = null;
  let worst = 0, nb = 0;
  for (let k = 0; k < sph.nLinks; k++) {
    if (sph.lWhich[k] !== 2) continue;
    const n = sph.lNode[k], j = sph.lDir[k], x = n % sph.Nx, y = Math.floor(n / sph.Nx) % sph.Ny, z = Math.floor(n / (sph.Nx * sph.Ny));
    worst = Math.max(worst, Math.abs(ell.cross(x, y, z, TF.CX[j], TF.CY[j], TF.CZ[j]) - sph.lQ[k])); nb++;
  }
  check("body: wall crossings by bisection match the exact sphere (" + nb + " links) within 1e-6", worst < 1e-6, worst.toExponential(2));

  // STL: a cube as 12 triangles, binary and ASCII, imported as a mesh → the same cells as the cube primitive
  const V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [1, 2, 6], [1, 6, 5], [0, 4, 7], [0, 7, 3]];
  const bin = new ArrayBuffer(84 + 50 * F.length), dv = new DataView(bin); dv.setUint32(80, F.length, true);
  F.forEach((f, t) => f.forEach((vi, k) => V[vi].forEach((c, m) => dv.setFloat32(84 + 50 * t + 12 + 12 * k + 4 * m, c * 7.5, true))));
  const ascii = "solid cube\n" + F.map((f) => "facet normal 0 0 0\nouter loop\n" + f.map((vi) => "vertex " + V[vi].map((c) => c * 7.5).join(" ")).join("\n") + "\nendloop\nendfacet").join("\n") + "\nendsolid cube\n";
  const tb = TF.parseSTL(bin), ta = TF.parseSTL(Buffer.from(ascii));
  check("STL: binary and ASCII files read the same 12 triangles", tb.length === 108 && ta.length === 108 && tb.every((v, i) => v === ta[i]));
  const cubeP = new TF.Solver(opts({ shape: "cube" }, 0.42)), cubeM = new TF.Solver(opts({ shape: "mesh", mesh: tb }, 0.42));
  let same = 0, diff = 0;
  for (let n = 0; n < cubeP.N; n++) { if (cubeP.solid[n] === cubeM.solid[n]) same++; else diff++; }
  check("STL: an imported cube fills exactly the cells of the cube primitive", diff === 0, diff + " cells differ");
  check("STL: frontal area of the imported cube = (2a)² within 2%, mesh watertight", Math.abs(pct(cubeM.body.area, 4 * 4.2 * 4.2)) < 2 && cubeM.body.leaky === 0, pct(cubeM.body.area, 4 * 4.2 * 4.2).toFixed(2) + "%");
}

// ---------------------------------------------------------------- 7. A meshed sphere (STL) has the drag of the exact sphere (Stokes, moving frame)
{
  // icosphere, 4 subdivisions (5120 triangles)
  let verts = [], faces = [];
  { const t = (1 + Math.sqrt(5)) / 2;
    verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((c) => c / l); });
    faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let it = 0; it < 4; it++) {
      const cache = new Map(), mid = (a, b) => { const k = a < b ? a + "_" + b : b + "_" + a; if (cache.has(k)) return cache.get(k); const m = verts[a].map((c, i) => (c + verts[b][i]) / 2), l = Math.hypot(...m); verts.push(m.map((c) => c / l)); cache.set(k, verts.length - 1); return verts.length - 1; };
      const nf = []; for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } faces = nf;
    }
  }
  const tris = new Float32Array(faces.length * 9); faces.forEach((f, i) => f.forEach((v, k) => verts[v].forEach((c, m) => { tris[9 * i + 3 * k + m] = c; })));
  const R = 10, lam = 0.3, nu = 0.25, d = 2 * R * lam, u = 0.05 * nu / d;
  const run = (body) => { const s = new TF.Solver({ R: R, length: 12 * R, ratio: lam, sphereX: 0.5, mode: "moving", u: u, nu: nu, disturbance: "none", body: body }); for (let k = 0; k < 5000; k++) s.step(); return s; };
  const exact = run({ shape: "sphere" }), mesh = run({ shape: "mesh", mesh: tris });
  check("STL sphere (" + faces.length + " triangles): Stokes drag within 1.5% of the exact sphere's", Math.abs(pct(mesh.force[0], exact.force[0])) < 1.5, pct(mesh.force[0], exact.force[0]).toFixed(2) + "%");
}

// ---------------------------------------------------------------- 8. Inflow: uniform inflow develops into pipe flow; pulsatile flow rate follows the pulse
{
  const R = 6, s = new TF.Solver({ R: R, length: 160, ratio: 0, u: 0.08, nu: 0.02, inflow: "uniform", disturbance: "none" });
  for (let k = 0; k < 6000; k++) s.step();
  s.macroscopic();
  const cl = (x) => s.ux[s.idx(x, Math.round(s.cy), Math.round(s.cz))] / s.planeU(x);
  check("uniform inflow (tube Re 48): flat at the inlet (centre/mean < 1.1), developed downstream (> 1.8; parabolic 2)", cl(1) < 1.1 && cl(130) > 1.8, cl(1).toFixed(2) + " → " + cl(130).toFixed(2));
  const T = 2000, A = 0.4, p = new TF.Solver({ R: R, length: 60, ratio: 0, u: 0.04, nu: 0.1, inflow: "pulsatile", pulse: { amp: A, period: T }, disturbance: "none" });
  // fit c0 + c1 sin ωt + c2 cos ωt to the flow rate near the inlet over the fourth period
  let c0 = 0, c1 = 0, c2 = 0; const M = 40;
  for (let k = 0; k < M; k++) { const t = 3 * T + k * T / M; while (p.t < t) p.step(); p.macroscopic(); const q = p.planeU(3), w = 2 * Math.PI * t / T; c0 += q / M; c1 += 2 * q * Math.sin(w) / M; c2 += 2 * q * Math.cos(w) / M; }
  const amp = Math.hypot(c1, c2) / c0, lag = Math.atan2(-c2, c1) * 180 / Math.PI;
  check("pulsatile inflow (amplitude 40%): flow-rate amplitude within 3%, in phase within 5°", Math.abs(amp / A - 1) < 0.03 && Math.abs(lag) < 5, "amplitude " + amp.toFixed(3) + ", lag " + lag.toFixed(1) + "°");
}

// ---------------------------------------------------------------- 9. Wing sections (NACA 4-digit) at an angle of attack
{
  // geometry: a NACA 0012 of chord 25.6 cells and span 25.6 has the section's area (0.684·t·c²) × span
  const g = new TF.Solver({ R: 16, length: 144, ratio: 0.8, sphereX: 0.3, u: 0.05, nu: 0.05, body: { shape: "wing", naca: "0012", alpha: 0, span: 0.8 }, geometryOnly: true });
  let cells = 0; for (let z = 0; z < g.Nz; z++) for (let y = 0; y < g.Ny; y++) for (let x = 0; x < g.Nx; x++) if (g.body.inside(x, y, z)) cells++;
  const vol = 0.68385 * 0.12 * 25.6 * 25.6 * 25.6;
  check("wing: NACA 0012 solid cells match its volume within 8% (trailing edge thinner than a cell)", Math.abs(pct(cells, vol)) < 8, pct(cells, vol).toFixed(1) + "%");
  check("wing: thin-airfoil zero-lift angle of NACA 2412 = −2.08° (textbook −2.077°)", Math.abs(TF.thinAirfoil("2412").alphaL0 + 2.077) < 0.01, TF.thinAirfoil("2412").alphaL0.toFixed(3) + "°");
  // flow: the wing flying through still air in a tube (uniform stream), Re 600 on the chord
  const R = 12, ratio = 0.8, c = 2 * R * ratio, u = 0.06, nu = u * c / 600;
  const fly = (naca, alpha, span) => {
    const s = new TF.Solver({ R: R, length: 9 * R, ratio: ratio, sphereX: 0.3, mode: "moving", u: u, nu: nu, disturbance: "none", body: { shape: "wing", naca: naca, alpha: alpha, span: span || 1 } });
    let fx = 0, fz = 0; for (let k = 0; k < 5000; k++) { s.step(); if (k >= 4000) { fx += s.force[0] / 1000; fz += s.force[2] / 1000; } }
    const q = 0.5 * u * u * s.body.area; return { cd: fx / q, cl: fz / q, thin: s.nThin || 0 };
  };
  const w0 = fly("0012", 0), w6 = fly("0012", 6), c4 = fly("4412", 0), c2 = fly("2412", 0), f6 = fly("0012", 6, 0.5);
  check("wing: symmetric section at α = 0 has no lift", Math.abs(w0.cl) < 1e-5, w0.cl.toExponential(1));
  check("wing: NACA 0012 at α = 6°, wall to wall: C_L between 0.4 and 1 (thin-airfoil 0.66; low Re lowers, the tube's walls raise it)", w6.cl > 0.4 && w6.cl < 1, "C_L " + w6.cl.toFixed(3) + ", C_D " + w6.cd.toFixed(3));
  check("wing: camber gives lift at α = 0 — NACA 4412 > 2412 > 0 (needs the thin trailing edge: " + c4.thin + " links through it)", c4.cl > c2.cl && c2.cl > 0.03, "C_L " + c4.cl.toFixed(3) + " / " + c2.cl.toFixed(3));
  check("wing: a short wing (aspect ratio 0.6) loses most of its lift to the tip vortices (C_L 2D / 3D > 2)", w6.cl / f6.cl > 2, (w6.cl / f6.cl).toFixed(2) + "×");
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
