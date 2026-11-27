// The stack reader and the supply chain pack on the real 48GX ROM — run with:
//   HP48_ROM=/path/to/gxrom-r node hp48/tests/scm-rom.test.js
// Skipped when there is no ROM (as on CI).
const fs = require("fs");
const path = require("path");
const Machine = require("../src/machine.js");
const Keys = require("../src/keys.js");
const Typer = require("../src/typer.js");
const Stack = require("../src/stack.js");
const SCM = require("../src/scm.js");
const { check, summary } = require("./harness.js");

const ROM = process.env.HP48_ROM || path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "gxrom-r");
if (!fs.existsSync(ROM)) { console.log("scm-rom: skipped (no ROM at " + ROM + "; set HP48_ROM)"); process.exit(0); }
const rom = fs.readFileSync(ROM);

const m = new Machine(rom), pad = new Keys.Keypad(m);
const run = (s) => { for (let i = 0; i < s * 100; i++) { m.run(Machine.CLOCK / 100); pad.update(); } };
run(1); pad.press(Keys.byId.F); run(0.08); pad.release(Keys.byId.F); run(3.5);           // "Try To Recover Memory?" → NO
const type = (text) => { const t = new Typer.Typist(m, pad, Keys.byId, Typer.plan(text, { enter: true }).keys); while (!t.advance(Machine.CLOCK / 10)); run(1); };
const stack = () => Stack.read(m);
const START = m.snapshot();

// ---------------------------------------------------------------- the reader, on objects the ROM made
const objects = [
  ["1.5", "real", 1.5], ["-0.002", "real", -0.002], ["123456789012", "real", 123456789012], ["6.02E23", "real", 6.02e23],
  ["-1E-300", "real", -1e-300], ["7", "real", 7], ["1 3 /", "real", 0.333333333333],
  ["\"Hello, 48\"", "string", "Hello, 48"], ["(1,-2)", "complex", [1, -2]], ["#1FFh", "binary", "1FF"], ["'X'", "name", "X"],
  ["{ 1 \"a\" { 2 } }", "list", null], ["« 1 + »", "program", null], ["'X^2+1'", "algebraic", null], ["42 \"Q\" →TAG", "tagged", 42],
];
const bad = [];
for (const [text, kind, value] of objects) {
  m.restore(START); type(text);
  const lv = stack(), o = lv[0];
  const ok = lv.length === 1 && o.type === kind && (value === null || JSON.stringify(o.value) === JSON.stringify(value));
  if (!ok) bad.push(text + " → " + lv.map((x) => x.type + " " + x.text).join(" | "));
}
check("the reader reads back each kind of object the ROM puts on the stack (" + objects.length + " objects)", bad.length === 0, bad.join("; "));
m.restore(START); type("{ 1 \"a\" { 2 } }");
check("…a list with a string and a list in it, as text", stack()[0].text === "{ 1 \"a\" { 2 } }", stack()[0].text);
m.restore(START); type("1 2 3");
check("…and the levels in order, level 1 first", stack().map((o) => o.value).join() === "3,2,1");

// ---------------------------------------------------------------- the pack
m.restore(START);
for (const line of SCM.installText().split("\n")) type(line);
check("installing leaves the stack empty (every line typed and run cleanly)", stack().length === 0, stack().map((o) => o.text).join(" | "));
const AFTER = m.snapshot();
for (const p of SCM.PROGRAMS) {
  m.restore(AFTER); type(SCM.exampleText(p));
  const lv = stack(), c = SCM.check(p, lv);
  check(p.name + ": the example gives the reference answers to 12 digits, and nothing else on the stack", c.ok && lv.length === c.rows.length, lv.map((o) => o.text).join(" | "));
}
// other inputs: a negative z in the newsvendor, k = 2 in the fill rate, the other cases of Little's law, no lead-time variation
const more = [
  ["NEWS", [10, 8, 2, 500, 100]], ["FILL", [800, 60, 2]], ["LITTL", [200, 0, 4]], ["LITTL", [200, 50, 0]],
  ["SS", [2.33, 40, 12, 9, 0]], ["EOQ", [5000, 50, 2]], ["BULL", [[10, 30, 10, 30], [18, 22, 18, 22]]],
];
for (const [name, inputs] of more) {
  const p = SCM.PROGRAMS.find((x) => x.name === name);
  m.restore(AFTER);
  type("« SCM » EVAL " + inputs.map((v) => (Array.isArray(v) ? "{ " + v.join(" ") + " }" : String(v))).join(" ") + " " + name);
  const lv = stack(), c = SCM.check(p, lv, inputs);
  check(name + " " + JSON.stringify(inputs) + " agrees with the reference", c.ok, lv.map((o) => o.text).join(" | ") + " want " + c.rows.map((r) => r.want).join(", "));
}

summary("scm-rom");
