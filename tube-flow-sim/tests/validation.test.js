// The validation suite (src/validation.js) — run with:  node tube-flow-sim/tests/validation.test.js
// Prints every check and writes tests/validation-results.json, which validation.html shows as the
// recorded results (the page can re-run the same cases in the browser).
const fs = require("fs"), path = require("path");
const TF = require("../src/lbm.js"), V = require("../src/validation.js");
const only = process.argv.slice(2);
let pass = 0, fail = 0;
const results = V.run(TF, {
  only: only.length ? only : null,
  onCase: (c) => {
    console.log("— " + c.title + " (" + c.seconds.toFixed(0) + " s)");
    c.checks.forEach((k) => { if (k.pass) pass++; else fail++; console.log((k.pass ? "ok   " : "FAIL ") + k.name + "  → " + (typeof k.value === "number" ? k.value.toPrecision(3) : k.value) + (k.unit ? " " + k.unit : "") + "  (tolerance " + k.tol + (k.unit && typeof k.tol === "number" ? " " + k.unit : "") + ")"); });
  }
});
if (!only.length) {
  const pkg = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").match(/APP_VERSION = "([0-9.]+)"/);
  fs.writeFileSync(path.join(__dirname, "validation-results.json"), JSON.stringify({ app: "Tube Flow v" + (pkg ? pkg[1] : "?"), date: new Date().toISOString().slice(0, 10), runtime: "Node " + process.version, results: results }, null, 1));
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
