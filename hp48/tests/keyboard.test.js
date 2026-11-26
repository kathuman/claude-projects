// The key map on the real 48GX ROM — run with:
//   HP48_ROM=/path/to/gxrom-r node hp48/tests/keyboard.test.js
// Skipped when there is no ROM (as on CI). Screens are compared with each
// other (or by hash), never stored as pictures.
//
// Each check types two different key sequences that must leave identical
// screens, e.g. "2 ENTER 3 ×" and "6 ENTER". A key wired to the wrong place in
// the matrix breaks these equalities, so they pin down every key used.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Machine = require("../src/machine.js");
const Keys = require("../src/keys.js");
const { check, summary } = require("./harness.js");

const ROM = process.env.HP48_ROM || path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "gxrom-r");
if (!fs.existsSync(ROM)) { console.log("keyboard: skipped (no ROM at " + ROM + "; set HP48_ROM)"); process.exit(0); }
const rom = fs.readFileSync(ROM);

// a machine at the stack (memory cleared), typing through the Keypad as the page does
function calc() {
  const m = new Machine(rom), pad = new Keys.Keypad(m);
  const run = (s) => { for (let i = 0; i < s * 100; i++) { m.run(Machine.CLOCK / 100); pad.update(); } };
  // a click shorter than the ROM's scan: the Keypad must hold it long enough
  const type = (seq) => { for (const id of seq.split(" ")) { const k = Keys.byId[id]; pad.press(k); run(0.01); pad.release(k); run(0.3); } return c; };
  const hash = () => crypto.createHash("sha1").update(Buffer.from(m.pixels().flatMap((r) => Array.from(r)))).digest("hex");
  const c = { m, type, hash, run, ann: () => m.display().annunciators };
  run(1); type("F"); run(3);                   // "Try To Recover Memory?" → NO
  return c;
}
const same = (a, b) => calc().type(a).hash() === calc().type(b).hash();

check("the map has 49 keys, all on different matrix positions",
  Keys.ALL.length === 49 && new Set(Keys.ALL.map((k) => k.line + ":" + k.bit)).size === 49);

const equal = [
  ["1 ENTER 2 ADD", "3 ENTER", "+"],
  ["9 ENTER 4 SUB", "5 ENTER", "−"],
  ["2 ENTER 3 MUL", "6 ENTER", "×"],
  ["8 ENTER 2 DIV", "4 ENTER", "÷"],
  ["7 NEG ENTER", "0 ENTER 7 SUB", "+/-"],
  ["1 DOT 5 ENTER 2 MUL", "3 ENTER", "."],
  ["1 EEX 2 ENTER", "1 0 0 ENTER", "EEX"],
  ["4 SQRT", "2 ENTER", "√x"],
  ["3 LS SQRT", "9 ENTER", "left shift (x²)"],
  ["2 ENTER 3 POW", "8 ENTER", "yˣ"],
  ["2 INV", "DOT 5 ENTER", "1/x"],
  ["0 SIN", "0 ENTER", "SIN"],
  ["0 COS", "1 ENTER", "COS"],
  ["0 TAN", "0 ENTER", "TAN"],
  ["1 SPC 2 ENTER", "1 ENTER 2 ENTER", "SPC"],
  ["1 2 BKSP ENTER", "1 ENTER", "⇦ (backspace)"],
  ["5 ENTER 6 ENTER BKSP", "5 ENTER", "⇦ (DROP)"],
  ["1 ENTER 2 ENTER LS RIGHT", "2 ENTER 1 ENTER", "left shift ▶ (SWAP)"],
  ["5 ENTER 0 LS INV", "5 ENTER 1 ENTER", "left shift 1/x (eˣ)"],
  ["1 0 0 RS POW", "2 ENTER", "right shift yˣ (LOG)"],
  ["7 8 ENTER", "7 ENTER 1 0 MUL 8 ADD", "digits 7 and 8"],
];
for (const [a, b, what] of equal) check(what + ": \"" + a + "\" and \"" + b + "\" leave the same screen", same(a, b));
check("…and different results differ: \"2 ENTER 3 ADD\" is not \"6 ENTER\"", !same("2 ENTER 3 ADD", "6 ENTER"));

// the annunciators follow the shift keys
const s = calc();
check("left shift lights its annunciator", (s.type("LS").ann() & 0x81) === 0x81);
check("right shift replaces it with its own", (s.type("RS").ann() & 0x83) === 0x82);
check("α lights the alpha annunciator", (calc().type("ALPHA").ann() & 0x84) === 0x84);

// every key reaches the ROM: pressed at the stack, each changes the screen or the annunciators
const base = calc(), h0 = base.hash(), a0 = base.ann();
const dead = Keys.ALL.filter((k) => { const c = calc().type(k.id); return c.hash() === h0 && c.ann() === a0; }).map((k) => k.id);
check("every one of the 49 keys does something at the stack", dead.length === 0, dead.join(" "));

// ON: CANCEL clears the command line
check("ON (CANCEL) abandons a number being typed", same("1 2 3 ON", "1 ENTER BKSP"));

summary("keyboard");
