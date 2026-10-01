/*
 * validation.js — the validation suite as data: each case runs the solver on a problem with a known
 * answer and returns the measured value, the reference, the error and whether it is within tolerance,
 * plus what the report needs to plot. Shared by tests/validation.test.js (Node, writes
 * tests/validation-results.json) and validation.html (runs the same cases in the browser, in a worker).
 *
 * Grid convergence: Poiseuille flow on five grids — observed order of accuracy of the velocity profile by
 * least squares, and on three of them (refinement ratio 2) the flow rate's observed order, Richardson
 * extrapolation and Roache's grid convergence index, GCI = 1.25·|ε|/(r^p − 1). The Stokes drag is a
 * resolution study instead: how a small sphere's surface falls on the lattice scatters its drag by about
 * ±1%, more than the resolution trend at 6–10 cells across, so Richardson extrapolation does not apply
 * (oscillatory convergence); the scatter itself is reported as the uncertainty.
 *
 *   TF.validation.run(TF, { only: ["stokes-k"], progress: (msg, frac) => … }) → [result, …]
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.TF = root.TF || {}; root.TF.validation = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const HS = (lam) => (1 - 0.75857 * lam ** 5) / (1 - 2.1050 * lam + 2.0865 * lam ** 3 - 1.7068 * lam ** 5 + 0.72603 * lam ** 6);
  const pct = (a, b) => (a / b - 1) * 100;
  // least-squares slope of log(e) against log(h)
  const slope = (h, e) => { const x = h.map(Math.log), y = e.map(Math.log), n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; } return sxy / sxx; };

  // ---------------------------------------------------------------- building blocks
  function poiseuille(TF, R, tick) {
    const uc = 0.05, nu = 0.1, L = 40;
    const s = new TF.Solver({ R: R, length: L, ratio: 0, u: uc, nu: nu, disturbance: "none" });
    const steps = Math.max(4000, Math.ceil(4 * R * R / nu));
    for (let k = 0; k < steps; k++) { s.step(); if (tick && k % 500 === 0) tick(k / steps); }
    s.macroscopic();
    let maxe = 0, se = 0, n = 0; const prof = [];
    const xm = L / 2, zc = Math.round(s.cz);
    for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) {
      const i = s.idx(xm, y, z); if (s.solid[i]) continue;
      const r2 = ((y - s.cy) ** 2 + (z - s.cz) ** 2) / (R * R), e = (s.ux[i] - uc * (1 - r2)) / uc;
      maxe = Math.max(maxe, Math.abs(e)); se += e * e; n++;
      if (z === zc) prof.push([+((y - s.cy) / R).toFixed(4), +(s.ux[i] / uc).toFixed(5)]);
    }
    const G = -(s.planeRho(30) - s.planeRho(10)) / 20 / 3, Gex = 4 * nu * uc / (R * R);
    const flux = (x) => { let m = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) { const i = s.idx(x, y, z); if (!s.solid[i]) m += s.rho[i] * s.ux[i]; } return m; };
    let q = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) { const i = s.idx(xm, y, z); if (!s.solid[i]) q += s.rho[i] * s.ux[i]; }
    const m1 = s.mass(); for (let k = 0; k < 500; k++) s.step(); const m2 = s.mass();
    return { R: R, Q: q / (Math.PI * R * R * uc / 2), maxErr: maxe, l2: Math.sqrt(se / n), gradErr: pct(G, Gex), fluxErr: pct(flux(35), flux(5)), massDrift: m2 / m1 - 1, profile: prof };
  }
  // fast: a tube 8R long run for 6 viscous times R²/ν (the same drag as 12R and 12.5 viscous times, within 0.02%)
  function stokes(TF, R, lam, tick, fast) {
    const nu = 0.25, Re = 0.05, d = 2 * R * lam, u = Re * nu / d;
    const s = new TF.Solver({ R: R, length: Math.round((fast ? 8 : 12) * R), ratio: lam, sphereX: 0.5, mode: "moving", u: u, nu: nu, disturbance: "none" });
    const steps = fast ? Math.ceil(6 * R * R / nu) : Math.ceil(5000 * (R / 10) ** 2);
    for (let k = 0; k < steps; k++) { s.step(); if (tick && k % 500 === 0) tick(k / steps); }
    const Fref = 6 * Math.PI * nu * (d / 2) * u * HS(lam);
    return { R: R, d: d, lam: lam, F: s.force[0], Fref: Fref, K: s.force[0] / (6 * Math.PI * nu * (d / 2) * u), Kref: HS(lam), err: pct(s.force[0], Fref), lift: Math.hypot(s.force[1], s.force[2]) / Math.abs(s.force[0]) };
  }
  function icosphere(levels) {
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return p.map((c) => c / l); });
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let it = 0; it < levels; it++) {
      const c = new Map(), mid = (a, b) => { const k = a < b ? a + "_" + b : b + "_" + a; if (c.has(k)) return c.get(k); const m = v[a].map((x, i) => (x + v[b][i]) / 2), l = Math.hypot(m[0], m[1], m[2]); v.push(m.map((x) => x / l)); c.set(k, v.length - 1); return v.length - 1; };
      const nf = []; for (const [a, b, cc] of f) { const ab = mid(a, b), bc = mid(b, cc), ca = mid(cc, a); nf.push([a, ab, ca], [b, bc, ab], [cc, ca, bc], [ab, bc, ca]); } f = nf;
    }
    const out = new Float32Array(f.length * 9); f.forEach((tri, i) => tri.forEach((vi, k) => { for (let m = 0; m < 3; m++) out[9 * i + 3 * k + m] = v[vi][m]; }));
    return out;
  }

  // ---------------------------------------------------------------- the cases
  const CASES = [
    { id: "poiseuille", group: "Exact solutions", title: "Pipe flow (Hagen–Poiseuille)", cite: "Hagen 1839, Poiseuille 1840",
      what: "An empty tube 16 cells across: the velocity profile must be the parabola u = u_c(1 − r²/R²), the pressure gradient 4μu_c/R², the mass flux the same at every cross-section, and the total mass constant with no corrections applied.",
      run(TF, tick) {
        const r = poiseuille(TF, 8, tick);
        return { checks: [
          { name: "velocity profile, max error (of u_c)", value: r.maxErr * 100, unit: "%", tol: 1, pass: r.maxErr < 0.01 },
          { name: "pressure gradient vs 4μu_c/R²", value: r.gradErr, unit: "%", tol: 4, pass: Math.abs(r.gradErr) < 4 },
          { name: "mass flux, inlet vs outlet half", value: r.fluxErr, unit: "%", tol: 0.5, pass: Math.abs(r.fluxErr) < 0.5 },
          { name: "total mass drift over 500 steps", value: r.massDrift * 100, unit: "%", tol: "± 0.01 %", pass: Math.abs(r.massDrift) < 1e-4 }
        ], plot: { type: "profile", points: r.profile } };
      } },
    { id: "stokes-k", group: "Published results", title: "Stokes drag on a sphere moving along a tube", cite: "Haberman & Sayre 1958 (wall factor K(λ))",
      what: "A sphere moving slowly (Re 0.05) along the axis of a tube of still fluid, at three blockages λ = d/D. The drag must be Stokes' 6πμaU times the Haberman–Sayre wall factor K(λ), which grows steeply with λ.",
      run(TF, tick) {
        const lams = [0.2, 0.3, 0.4], res = lams.map((l, i) => stokes(TF, 10, l, tick ? (f) => tick((i + f) / lams.length) : null));
        return { checks: res.map((r) => ({ name: "λ = " + r.lam + " (sphere " + r.d.toFixed(0) + " cells): K = " + r.K.toFixed(3) + " vs " + r.Kref.toFixed(3), value: r.err, unit: "%", tol: 5, pass: Math.abs(r.err) < 5 }))
          .concat([{ name: "no side force on an axisymmetric flow (|F_side|/F_drag)", value: Math.max(...res.map((r) => r.lift)), unit: "", tol: 1e-6, pass: res.every((r) => r.lift < 1e-6) }]),
          plot: { type: "wallfactor", points: res.map((r) => [r.lam, r.K]) } };
      } },
    { id: "momentum", group: "Conservation", title: "Momentum balance", cite: "control-volume momentum theorem",
      what: "Flow past a sphere in a tube at Re ≈ 7: the drop in pressure plus momentum flux between two cross-sections must equal the force on the sphere plus the wall shear between them — the forces are measured independently, by momentum exchange on the boundary links.",
      run(TF, tick) {
        const R = 8, s = new TF.Solver({ R: R, length: 64, ratio: 0.35, u: 0.05, nu: 0.04, disturbance: "none" });
        for (let k = 0; k < 5000; k++) { s.step(); if (tick && k % 500 === 0) tick(k / 5000); }
        s.macroscopic();
        const plane = (x) => { let p = 0, m = 0, c = 0; for (let z = 0; z < s.Nz; z++) for (let y = 0; y < s.Ny; y++) { const n = s.idx(x, y, z); if (!s.solid[n]) { p += s.rho[n] / 3; m += s.rho[n] * s.ux[n] * s.ux[n]; c++; } } return (p + m) / c * Math.PI * R * R; };
        const a0 = 8, a1 = s.Nx - 9; let wall = 0.5 * (s.wallFx[a0] + s.wallFx[a1]); for (let x = a0 + 1; x < a1; x++) wall += s.wallFx[x];
        const lhs = plane(a0) - plane(a1), rhs = s.force[0] + wall;
        return { checks: [{ name: "Δ(p + ρu²)·A vs drag on sphere + wall", value: pct(rhs, lhs), unit: "%", tol: 3, pass: Math.abs(pct(rhs, lhs)) < 3 }] };
      } },
    { id: "stl", group: "Geometry", title: "Imported shapes: an STL sphere", cite: "consistency with the exact sphere",
      what: "The same Stokes case with the sphere replaced by a 5,120-triangle STL mesh of it. Shapes from files are found by ray parity and their surfaces by bisection; the drag must match the exact sphere's.",
      run(TF, tick) {
        const tris = icosphere(4), R = 10, lam = 0.3, nu = 0.25, d = 2 * R * lam, u = 0.05 * nu / d;
        const go = (body, w) => { const s = new TF.Solver({ R: R, length: 12 * R, ratio: lam, sphereX: 0.5, mode: "moving", u: u, nu: nu, disturbance: "none", body: body }); for (let k = 0; k < 5000; k++) { s.step(); if (tick && k % 500 === 0) tick((w + k / 5000) / 2); } return s.force[0]; };
        const a = go({ shape: "sphere" }, 0), b = go({ shape: "mesh", mesh: tris }, 1);
        return { checks: [{ name: "STL sphere drag vs exact sphere drag", value: pct(b, a), unit: "%", tol: 1.5, pass: Math.abs(pct(b, a)) < 1.5 }] };
      } },
    { id: "pulse", group: "Boundary conditions", title: "Pulsatile inflow", cite: "imposed flow rate",
      what: "The inflow rate swings 40% about its mean; a sinusoid fitted to the flow rate near the inlet over one period must have that amplitude, in phase.",
      run(TF, tick) {
        const T = 2000, A = 0.4, p = new TF.Solver({ R: 6, length: 60, ratio: 0, u: 0.04, nu: 0.1, inflow: "pulsatile", pulse: { amp: A, period: T }, disturbance: "none" });
        let c0 = 0, c1 = 0, c2 = 0; const M = 40, series = [];
        for (let k = 0; k < M; k++) { const t = 3 * T + k * T / M; while (p.t < t) { p.step(); if (tick && p.t % 500 === 0) tick(p.t / (4 * T)); } p.macroscopic(); const q = p.planeU(3), w = 2 * Math.PI * t / T; c0 += q / M; c1 += 2 * q * Math.sin(w) / M; c2 += 2 * q * Math.cos(w) / M; series.push([k / M, q]); }
        const amp = Math.hypot(c1, c2) / c0, lag = Math.atan2(-c2, c1) * 180 / Math.PI;
        return { checks: [{ name: "flow-rate amplitude vs 40%", value: pct(amp, A), unit: "%", tol: 3, pass: Math.abs(amp / A - 1) < 0.03 }, { name: "phase lag", value: lag, unit: "°", tol: 5, pass: Math.abs(lag) < 5 }],
          plot: { type: "pulse", amp: A, mean: c0, points: series } };
      } },
    { id: "conv-poiseuille", group: "Grid convergence", title: "Grid convergence: pipe flow", cite: "order of accuracy",
      what: "Pipe flow on five grids, 8 to 32 cells across. With curved-wall bounce-back the error should fall as the square of the cell size (second order). On the grids 8, 16 and 32 cells across (refinement ratio 2): the flow rate's observed order, its Richardson extrapolation to an infinitely fine grid, and the grid convergence index (GCI) — the numerical uncertainty of the finest grid's flow rate.",
      run(TF, tick) {
        const Rs = [4, 6, 8, 12, 16], w = [0, 0.05, 0.12, 0.25, 0.5, 1], res = Rs.map((R, i) => poiseuille(TF, R, tick ? (f) => tick(w[i] + f * (w[i + 1] - w[i])) : null));
        const p = slope(Rs.map((R) => 1 / R), res.map((r) => r.l2));
        const Q = [res[0].Q, res[2].Q, res[4].Q], r = 2, e21 = Q[2] - Q[1], e32 = Q[1] - Q[0];
        const pq = Math.log(Math.abs(e32 / e21)) / Math.log(r), Qx = Q[2] + e21 / (Math.pow(r, pq) - 1), gci = 1.25 * Math.abs(e21 / Q[2]) / (Math.pow(r, pq) - 1);
        return { checks: [
          { name: "observed order of accuracy, RMS velocity profile (5 grids)", value: p, unit: "", tol: "≥ 1.5", pass: p >= 1.5 },
          { name: "observed order, flow rate (8 → 16 → 32 cells)", value: pq, unit: "", tol: "1.5 – 3", pass: pq > 1.5 && pq < 3 },
          { name: "flow rate extrapolated to a fine grid, vs exact", value: (Qx - 1) * 100, unit: "%", tol: 0.5, pass: Math.abs(Qx - 1) < 0.005 },
          { name: "GCI of the 32-cell grid's flow rate", value: gci * 100, unit: "%", tol: "< 2 %", pass: gci < 0.02 }
        ], plot: { type: "convergence", x: "cells across the tube", points: res.map((x) => [2 * x.R, x.l2]), order: p, q: [[8, Q[0]], [16, Q[1]], [32, Q[2]]], qx: Qx, gci: gci } };
      } },
    { id: "conv-stokes", group: "Grid convergence", title: "Resolution study: Stokes drag", cite: "Haberman & Sayre 1958; ASME V&V 20 (oscillatory convergence)",
      what: "The wall-corrected Stokes drag (λ = 0.3) with the sphere 6, 7.5, 9 and 9.6 cells across. The error shrinks with resolution, but where the sphere's surface falls between lattice nodes scatters the drag by about ±1% — more than the trend at these resolutions — so the convergence is not monotonic and Richardson extrapolation does not apply. The spread is the honest uncertainty: treat the drag on a body 6–10 cells across as good to about ±3%. (Below ~6 cells it drops fast: 12% low at 4.8 cells.)",
      run(TF, tick) {
        const Rs = [10, 12.5, 15, 16], w = Rs.map((R) => R ** 4), tot = w.reduce((a, b) => a + b);
        let acc = 0;
        const res = Rs.map((R, i) => { const r = stokes(TF, R, 0.3, tick ? (f) => tick((acc + f * w[i]) / tot) : null, true); acc += w[i]; return r; });
        const errs = res.map((r) => r.err), spread = Math.max(...errs) - Math.min(...errs), worst = Math.max(...errs.map(Math.abs));
        return { checks: res.map((r) => ({ name: "sphere " + r.d.toFixed(1) + " cells across: K = " + r.K.toFixed(3) + " vs " + r.Kref.toFixed(3), value: r.err, unit: "%", tol: 5, pass: Math.abs(r.err) < 5 }))
          .concat([{ name: "spread across the four grids (the scatter from surface alignment)", value: spread, unit: "%", tol: "< 3 %", pass: spread < 3 },
                   { name: "finest grid (9.6 cells) vs Haberman–Sayre", value: errs[errs.length - 1], unit: "%", tol: 3, pass: Math.abs(errs[errs.length - 1]) < 3 }]),
          plot: { type: "resolution", points: res.map((x) => [x.d, x.K]), ref: HS(0.3), worst: worst } };
      } }
  ];

  function run(TF, opts) {
    opts = opts || {};
    const list = CASES.filter((c) => !opts.only || opts.only.indexOf(c.id) >= 0), out = [];
    list.forEach((c, i) => {
      const t0 = Date.now();
      const tick = opts.progress ? (f) => opts.progress(c.title, (i + Math.min(1, f)) / list.length) : null;
      if (opts.progress) opts.progress(c.title, i / list.length);
      const r = c.run(TF, tick);
      out.push(Object.assign({ id: c.id, group: c.group, title: c.title, cite: c.cite, what: c.what, seconds: (Date.now() - t0) / 1000, pass: r.checks.every((k) => k.pass) }, r));
      if (opts.onCase) opts.onCase(out[out.length - 1]);
    });
    return out;
  }
  return { CASES: CASES, run: run, HS: HS, icosphere: icosphere };
});
