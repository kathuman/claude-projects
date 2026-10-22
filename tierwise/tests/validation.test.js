// The validation suite (src/validation.js) — run with:  node tierwise/tests/validation.test.js
// Prints every check and writes tests/validation-results.json, which validation.html shows as the recorded
// results (the page can re-run the same cases in the browser).
const fs = require("fs"), path = require("path");
const P = require("../src/plan.js"), N = require("../src/network.js"), K = require("../src/constrained.js"), I = require("../src/invest.js"), V = require("../src/validation.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
const only = process.argv.slice(2);

(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} });
  const ctx = { P: P, N: N, K: K, I: I, highs: highs };
  let pass = 0, fail = 0;
  const results = await V.run(ctx, {
    only: only.length ? only : null,
    onCase: (c) => {
      console.log("— " + c.title + " (" + c.seconds.toFixed(1) + " s)");
      c.checks.forEach((k) => { if (k.pass) pass++; else fail++; console.log((k.pass ? "ok   " : "FAIL ") + k.name + "  → " + (typeof k.value === "number" ? k.value.toPrecision(4) : k.value) + (k.unit ? " " + k.unit : "") + "  (expect " + k.tol + (k.unit && typeof k.tol === "number" ? " " + k.unit : "") + ")"); });
    }
  });
  if (!only.length) {
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").match(/version (\d+\.\d+\.\d+)/);
    fs.writeFileSync(path.join(__dirname, "validation-results.json"), JSON.stringify({ app: "Tierwise v" + (readme ? readme[1] : "?"), date: new Date().toISOString().slice(0, 10), runtime: "Node " + process.version, results: results }, null, 1));
  }
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
