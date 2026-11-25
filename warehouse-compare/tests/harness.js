// Minimal test harness shared by the warehouse-compare tests.
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);
function summary(name) {
  console.log(name + ": " + pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
}
module.exports = { check, near, summary };
