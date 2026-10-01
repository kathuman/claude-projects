/*
 * gpu-parity.js — runs the CPU solver (lbm.js) and the GPU solver (lbm-gpu.js) on the same case and
 * compares them. Used by tests/gpu-parity.html (driven by tests/gpu.test.js) and by validation.html.
 *   TF.PARITY_CASES                  the cases the tests run: [name, solver options]
 *   await TF.gpuParity(opts, steps)  → max velocity/density differences, drag, wall force, mass on both
 *   await TF.gpuSpeed(opts, steps)   → steps per second and million lattice updates per second
 */
(function (root) {
  "use strict";
  const TF = root.TF;
  TF.PARITY_CASES = [
    ["pipe, Re 30", { R: 8, length: 48, ratio: 0.35, u: 0.05, nu: 0.05 * 5.6 / 30, mode: "pipe", disturbance: "none" }],
    ["pipe, regularised, Re 150", { R: 8, length: 48, ratio: 0.35, u: 0.08, nu: 0.08 * 5.6 / 150, mode: "pipe", disturbance: "none" }],
    ["moving sphere, TRT, Re 1", { R: 8, length: 48, ratio: 0.3, u: 0.01, nu: 0.01 * 4.8, mode: "moving", disturbance: "none" }],
    ["cube, pulsatile inflow, Re 40", { R: 8, length: 48, ratio: 0.42, u: 0.05, nu: 0.05 * 6.72 / 40, mode: "pipe", disturbance: "none", body: { shape: "cube" }, inflow: "pulsatile", pulse: { amp: 0.4, period: 150 } }],
    ["bar across the tube, uniform inflow, Re 60", { R: 8, length: 48, ratio: 0.25, u: 0.06, nu: 0.06 * 4 / 60, mode: "pipe", disturbance: "none", body: { shape: "bar" }, inflow: "uniform" }],
    ["NACA 4412 wing at 8°, moving, Re 200", { R: 8, length: 48, ratio: 0.8, u: 0.05, nu: 0.05 * 12.8 / 200, mode: "moving", disturbance: "none", body: { shape: "wing", naca: "4412", alpha: 8 } }]
  ];
  let gpuP = null;
  const gpu = () => gpuP || (gpuP = TF.gpuAvailable());
  TF.gpuParity = async function (opts, steps) {
    const g = await gpu();
    if (!g) return { error: "no WebGPU adapter" };
    const S = new TF.Solver(opts), G = await TF.GPUSolver.create(g.device, opts);
    const all = Array.from(S.fluid);
    G.gatherer("field", all);
    G.gatherer("planes", []); G.gatherer("axis", []);
    for (let k = 0; k < steps; k++) S.step();
    G.step(steps);
    const r = await G.read({ field: true, mass: true });
    S.macroscopic();
    let du = 0, dr = 0, umax = 0;
    all.forEach((n, i) => {
      du = Math.max(du, Math.abs(r.field[4 * i + 1] - S.ux[n]), Math.abs(r.field[4 * i + 2] - S.uy[n]), Math.abs(r.field[4 * i + 3] - S.uz[n]));
      dr = Math.max(dr, Math.abs(r.field[4 * i] - S.rho[n]));
      umax = Math.max(umax, Math.abs(S.ux[n]));
    });
    const out = {
      adapter: [g.info.vendor, g.info.architecture].filter(Boolean).join(" "),
      nodes: S.fluid.length, links: S.nLinks, collision: S.collision,
      maxVelocityDiff: du / umax, maxDensityDiff: dr,
      dragCPU: S.force[0], dragGPU: r.force[0], liftGPU: Math.hypot(r.force[1], r.force[2]),
      wallCPU: S.wallForce[0], wallGPU: r.wallForce[0],
      massCPU: S.mass(), massGPU: r.mass
    };
    G.destroy();
    return out;
  };
  TF.gpuSpeed = async function (opts, steps) {
    const g = await gpu();
    if (!g) return { error: "no WebGPU adapter" };
    const G = await TF.GPUSolver.create(g.device, opts);
    G.gatherer("planes", []); G.gatherer("axis", []);
    G.step(20); await G.read({});
    const t0 = performance.now(); G.step(steps); await G.read({});
    const ms = performance.now() - t0;
    const out = { nodes: G.cpu.fluid.length, stepsPerSec: steps / ms * 1000, MLUPS: G.cpu.fluid.length * steps / ms / 1000 };
    G.destroy();
    return out;
  };
})(typeof self !== "undefined" ? self : this);
