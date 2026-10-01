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

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
