// Minimal test harness for the HP 48 emulator tests.
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}
function summary(name) {
  console.log(name + ": " + pass + " passed, " + fail + " failed");
  if (fail) process.exit(1);
}
module.exports = { check, summary };
