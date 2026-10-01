/*
 * sim-worker.js — runs the lattice-Boltzmann solver off the main thread, so the
 * page stays smooth however heavy the grid. Messages:
 *   in:  {type:"init", opts}  build a solver (opts as for TF.Solver)
 *        {type:"flow", u, nu} change speed/viscosity without rebuilding
 *        {type:"run", on}      start/stop; {type:"step", n} advance n steps; {type:"reset"}
 *        {type:"disturb", mode} "none" | "kick" | "noise"; {type:"pulse", pulse} pulsatile inflow {amp, period}
 *   out: {type:"geometry", ...} once per init
 *        {type:"frame", t, ux, uy, uz, rho (transferred), samples:[...], stepsPerSec}
 * A sample is recorded every `sampleEvery` steps (~200 per flow-through): [t, Fx, Fy, Fz, Δρ, recirculation, mass].
 */
importScripts("lbm.js");

let S = null, running = false, sampleEvery = 20, pending = [], lastPost = 0, rate = 0;

function geometry() {
  return { type: "geometry", Nx: S.Nx, Ny: S.Ny, Nz: S.Nz, R: S.R, cy: S.cy, cz: S.cz, sx: S.sx, r: S.r, xRear: S.xRear, body: S.bodyInfo(), solid: S.solid.slice(), nLinks: S.nLinks, fluid: S.fluid.length, collision: S.collision };
}
let nSamples = 0, lastMass = 0;
function sample() {
  // cheap readings only: the forces are computed every step anyway; two cross-sections and the
  // wake axis are read straight from their populations; total mass every 20th sample
  const a = Math.max(1, Math.round(S.sx - 2 * S.R)), b = Math.min(S.spongeX - 2, Math.round(S.xRear - S.r + 4 * S.R));   // (for a sphere: 4 tube radii past its centre)
  if (nSamples++ % 20 === 0) lastMass = S.mass();
  pending.push([S.t, S.force[0], S.force[1], S.force[2], S.planeRhoF(a) - S.planeRhoF(b), S.recirculationF(), lastMass, a, b]);
}
function post() {
  S.macroscopic();
  const msg = { type: "frame", t: S.t, ux: S.ux.slice(), uy: S.uy.slice(), uz: S.uz.slice(), rho: S.rho.slice(), samples: pending, stepsPerSec: rate, collision: S.collision };
  pending = [];
  postMessage(msg, [msg.ux.buffer, msg.uy.buffer, msg.uz.buffer, msg.rho.buffer]);
  lastPost = performance.now();
}
function advance(n) {
  for (let i = 0; i < n; i++) { S.step(); if (S.t % sampleEvery === 0) sample(); }
}
function loop() {
  if (!running || !S) return;
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < 40) { advance(1); n++; }
  const dt = (performance.now() - t0) / 1000;
  rate = rate ? 0.8 * rate + 0.2 * n / dt : n / dt;
  if (performance.now() - lastPost > 80) post();
  setTimeout(loop, 0);
}

onmessage = function (e) {
  const m = e.data;
  if (m.type === "init") {
    S = new TF.Solver(m.opts);
    // ~200 samples per flow-through of the tube, at least one per step
    sampleEvery = Math.max(1, Math.round(S.Nx / Math.max(S.u, 1e-6) / 200));
    pending = []; rate = 0; nSamples = 0;
    postMessage(geometry());
    post();
  } else if (m.type === "flow" && S) { S.setFlow(m.u, m.nu); sampleEvery = Math.max(1, Math.round(S.Nx / Math.max(S.u, 1e-6) / 200)); }
  else if (m.type === "disturb" && S) { S.disturb = m.mode; }
  else if (m.type === "pulse" && S) { S.setPulse(m.pulse); }
  else if (m.type === "reset" && S) { S.reset(); pending = []; post(); }
  else if (m.type === "step" && S) { advance(m.n || 1); post(); }
  else if (m.type === "run") { const was = running; running = !!m.on; if (running && !was) loop(); }
};
