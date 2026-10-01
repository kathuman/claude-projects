// GPU solver parity with the validated CPU solver — needs Playwright and a WebGPU-capable Chromium:
//   CHROME=<path to chrome.exe> node tube-flow-sim/tests/gpu.test.js   (serve the repo on :8767 first)
const { chromium } = require("playwright");
const URL = process.env.TFTEST || "http://127.0.0.1:8767/tube-flow-sim/tests/gpu-parity.html";
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--enable-unsafe-webgpu"] });
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
  await p.goto(URL);
  const cases = await p.evaluate(() => TF.PARITY_CASES);      // shared with validation.html (src/gpu-parity.js)

  for (const [name, o] of cases) {
    const r = await p.evaluate(([o]) => window.parity(o, 400), [o]);
    if (r.error) { check(name + ": WebGPU available", false, r.error); continue; }
    console.log("   " + name + ": " + r.adapter + ", " + r.nodes + " nodes, " + r.links + " links, " + r.collision);
    check(name + ": velocity field matches the CPU solver (max diff < 5e-4 of max speed; float32 summation order)", r.maxVelocityDiff < 5e-4, r.maxVelocityDiff.toExponential(2));
    check(name + ": density matches (max diff < 1e-5)", r.maxDensityDiff < 1e-5, r.maxDensityDiff.toExponential(2));
    check(name + ": drag on the body matches (0.01%)", Math.abs(r.dragGPU / r.dragCPU - 1) < 1e-4, r.dragGPU.toExponential(5) + " vs " + r.dragCPU.toExponential(5));
    // the wall force sums ~13k nearly-cancelling link terms: float32 on the GPU vs double on the CPU
    check(name + ": wall force matches (0.5%)", Math.abs(r.wallGPU / r.wallCPU - 1) < 5e-3, r.wallGPU.toExponential(4) + " vs " + r.wallCPU.toExponential(4));
    check(name + ": mass matches (1e-6)", Math.abs(r.massGPU / r.massCPU - 1) < 1e-6, (r.massGPU / r.massCPU - 1).toExponential(2));
  }
  const sp = await p.evaluate(() => window.speed({ R: 32, length: 288, ratio: 0.3, u: 0.08, nu: 0.006, mode: "pipe", disturbance: "none" }, 200));
  console.log("   speed: " + sp.nodes.toLocaleString() + " nodes, " + sp.stepsPerSec.toFixed(0) + " steps/s, " + sp.MLUPS.toFixed(0) + " million lattice updates/s");
  check("GPU runs a 64-cell-tube grid at ≥ 30 steps/s", sp.stepsPerSec >= 30, sp.stepsPerSec.toFixed(0));
  check("no WebGPU errors or warnings", errs.length === 0, errs.slice(0, 3).join(" | "));
  await b.close();
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
