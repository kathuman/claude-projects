// Long GPU benchmark: sphere in nearly unbounded uniform flow vs published results
// (Johnson & Patel 1999, J. Fluid Mech. 378; Schiller–Naumann drag correlation).
//   CHROME=<chrome.exe> node tube-flow-sim/tests/benchmark.js   (repo served on :8767; takes ~15 min)
const { chromium } = require("playwright");
const URL = process.env.TFTEST || "http://127.0.0.1:8767/tube-flow-sim/tests/gpu-bench.html";
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--enable-unsafe-webgpu"] });
  const p = await b.newPage(); p.setDefaultTimeout(0);
  await p.goto(URL);
  // CASES: "Re" (near-unbounded moving sphere) or "Re:mode:ratio:R:steps"
  const cases = (process.env.CASES || "100,300").split(",");
  for (const c of cases) {
    const [Re, mode, ratio, R, steps] = c.split(":");
    const o = { R: +(R || 40), ratio: +(ratio || 0.2), mode: mode || "moving", Re: +Re, steps: +(steps || (+Re < 200 ? 16000 : 40000)) };
    o.length = Math.round(4.5 * 2 * o.R);
    const r = await p.evaluate((o) => window.bench(o), o);
    console.log(JSON.stringify(Object.assign({ mode: o.mode, ratio: o.ratio }, r)));
  }
  await b.close();
})();
