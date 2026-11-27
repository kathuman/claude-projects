// The typer and the snapshots on the real 48GX ROM — run with:
//   HP48_ROM=/path/to/gxrom-r node hp48/tests/typer-rom.test.js
// Skipped when there is no ROM (as on CI). Screens are compared with each other, never stored.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Machine = require("../src/machine.js");
const Keys = require("../src/keys.js");
const Typer = require("../src/typer.js");
const { check, summary } = require("./harness.js");

const ROM = process.env.HP48_ROM || path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "gxrom-r");
if (!fs.existsSync(ROM)) { console.log("typer-rom: skipped (no ROM at " + ROM + "; set HP48_ROM)"); process.exit(0); }
const rom = fs.readFileSync(ROM);

const hash = (m) => crypto.createHash("sha1").update(Buffer.from(m.pixels().flatMap((r) => Array.from(r)))).digest("hex");
function driver(m) {
  const pad = new Keys.Keypad(m);
  const run = (s) => { for (let i = 0; i < s * 100; i++) { m.run(Machine.CLOCK / 100); pad.update(); } };
  const type = (seq) => { for (const id of (Array.isArray(seq) ? seq : seq.split(" ")).filter(Boolean)) { const k = Keys.byId[id]; pad.press(k); run(0.01); pad.release(k); run(0.25); } };
  return { run, type };
}
// the stack after "Memory Clear", as a snapshot every check starts from
const base = new Machine(rom), bd = driver(base);
bd.run(1); bd.type("F"); bd.run(3);
const START = base.snapshot();
// type through the Typist, which waits for the ROM to be idle between keys, as the page does
function typeOn(m, keys) { const t = new Typer.Typist(m, new Keys.Keypad(m), Keys.byId, keys); while (!t.advance(Machine.CLOCK / 10)); driver(m).run(0.5); }
const from = (seq) => { const m = new Machine(rom); m.restore(START); typeOn(m, Array.isArray(seq) ? seq : seq.split(" ")); return hash(m); };
const typed = (text) => from(Typer.plan(text, { enter: true }).keys);
const chr = (n) => from(String(n).split("").join(" ") + " ALPHA ALPHA C PRG RIGHT ENTER");   // n CHR, typed by hand

// ---------------------------------------------------------------- snapshots
{
  const a = new Machine(rom); a.restore(START);
  const da = driver(a); da.type("1 2 ENTER 3");
  const snap = JSON.parse(JSON.stringify(a.snapshot()));        // through JSON, as stored
  const b = new Machine(rom); b.restore(snap);
  da.type("ADD 4 MUL"); driver(b).type("ADD 4 MUL");
  check("a restored snapshot (mid-entry) carries on exactly as the original", hash(a) === hash(b) && a.time === b.time && Buffer.compare(Buffer.from(a.ram), Buffer.from(b.ram)) === 0);
  const x = new Machine(rom); x.restore(START); const dx = driver(x); dx.run(100); dx.type("ALPHA ALPHA COS CST C UP SIN ENTER");
  const y = new Machine(rom); y.restore(START); y.elapse(100); driver(y).type("ALPHA ALPHA COS CST C UP SIN ENTER");
  const z = new Machine(rom); z.restore(START); z.elapse(101); driver(z).type("ALPHA ALPHA COS CST C UP SIN ENTER");
  check("100 s away (elapse) reads the same TICKS as 100 s idling", hash(x) === hash(y));
  check("…and 101 s reads differently", hash(z) !== hash(y));
  let refused = "";
  try { const o = new Machine(Buffer.from(rom).fill(0, 0, 16)); o.restore(START); } catch (e) { refused = e.message; }
  check("a snapshot from another ROM is refused", /different ROM/.test(refused), refused);
}

// ---------------------------------------------------------------- every character, against n CHR
{
  const bad = [];
  for (const n of Object.keys(Typer.KEYS).map(Number)) {
    if (n === 10 || n === 34 || n === 94) continue;               // newline and " can't be checked inside a string; ^ below
    const text = '"' + String.fromCharCode(n) + '"';
    const p = Typer.plan(text.replace(String.fromCharCode(n), "\\" + String(n).padStart(3, "0")), { enter: true });
    if (from(p.keys) !== chr(n)) bad.push(n);
  }
  check("every character in the table types itself (" + (Object.keys(Typer.KEYS).length - 3) + " characters, each against n CHR)", bad.length === 0, bad.join(" "));
}

// ---------------------------------------------------------------- whole objects, against typing by hand
const same = [
  ["« 1 + »", "LS SUB 1 SPC ADD ENTER", "a program"],
  ["« 2 ^ »", "LS SUB 2 SPC POW ENTER", "^ in a program"],
  ["'X^2'", "QUOTE ALPHA INV POW 2 ENTER", "an algebraic with ^"],
  ["« 'X^2' »", "LS SUB QUOTE ALPHA INV POW 2 ENTER", "an algebraic in a program"],
  ["{ 1 2 }", "LS ADD 1 SPC 2 ENTER", "a list"],
  ["[ 1 2 ]", "LS MUL 1 SPC 2 ENTER", "a vector"],
  ["(1,2)", "LS DIV 1 LS DOT 2 ENTER", "a complex number"],
  ['{ 1 "A" }', "LS ADD 1 SPC RS SUB ALPHA A ENTER", "a string in a list (the quote key types one character in alpha)"],
];
for (const [text, hand, what] of same) check(what + ": " + text + " typed equals typing it by hand", typed(text) === from(hand));
check("a string with case and punctuation: \"Hi!\" equals 72 CHR 105 CHR + 33 CHR +",
  typed('"Hi!"') === from("7 2 ALPHA ALPHA C PRG RIGHT ENTER 1 0 5 ALPHA ALPHA C PRG RIGHT ENTER ADD 3 3 ALPHA ALPHA C PRG RIGHT ENTER ADD"));
check("HP's ASCII format (header, \\<< \\-> \\>>, comments, line breaks) types the same as the Unicode text",
  typed("%%HP: T(3)A(D)F(.);\r\n\\<< \\-> x @ square it\r\n  'x^2'\r\n\\>>") === typed("« → x 'x^2' »"));
{
  // and it runs: 3, the program, EVAL → 9
  const m = new Machine(rom); m.restore(START); const d = driver(m);
  typeOn(m, ["3", "ENTER"].concat(Typer.plan("« → x 'x^2' »", { enter: true }).keys, ["EVAL"]));
  check("…and the typed program runs: 3 « → x 'x^2' » EVAL leaves 9", hash(m) === from("9 ENTER"));
}

summary("typer-rom");
