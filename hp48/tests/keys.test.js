// The key map, the Keypad's minimum hold, and the ROM file loader — no ROM needed.
const Keys = require("../src/keys.js");
const RomFile = require("../src/romfile.js");
const { check, summary } = require("./harness.js");

// ---------------------------------------------------------------- the key map
check("nine rows: four of six keys, then five of five (ENTER is double width)",
  Keys.ROWS.map((r) => r.length).join("") === "666655555");
check("49 keys on 49 different matrix positions", Keys.ALL.length === 49 && new Set(Keys.ALL.map((k) => k.line + ":" + k.bit)).size === 49);
check("lines 0–8 and IN bits 0–5, ON on its own (bit 15)",
  Keys.ALL.every((k) => (k.id === "ON" ? k.line === "on" && k.bit === 15 : k.line >= 0 && k.line <= 8 && k.bit >= 0 && k.bit <= 5)));
const at = (id) => Keys.byId[id].line + ":" + Keys.byId[id].bit;
check("the menu keys found by scanning the ROM: A at line 1 bit 4, F at line 8 bit 0", at("A") === "1:4" && at("F") === "8:0");
check("line 8 holds the menu keys B–F (bits 4 to 0)", ["B", "C", "D", "E", "F"].map(at).join(" ") === "8:4 8:3 8:2 8:1 8:0");
check("the shifts are bit 5 of lines 2 (left) and 1 (right), α of line 3", at("LS") === "2:5" && at("RS") === "1:5" && at("ALPHA") === "3:5");
const letters = Keys.ALL.map((k) => k.a).filter(Boolean).sort().join("");
check("the alpha letters A–Z each appear on exactly one key", letters === "ABCDEFGHIJKLMNOPQRSTUVWXYZ", letters);

// computer keys
const ev = (key, mods) => Object.assign({ key, ctrlKey: false, metaKey: false, altKey: false }, mods || {});
const id = (key, mods) => { const k = Keys.fromEvent(ev(key, mods)); return k ? k.id : null; };
check("digits, operators and Enter map to their keys", ["7", "+", "-", "*", "/", ".", "Enter", "Backspace"].map((k) => id(k)).join(" ") === "7 ADD SUB MUL DIV DOT ENTER BKSP");
check("F1–F6 are the menu keys, Esc is ON, arrows are arrows",
  ["F1", "F6", "Escape", "ArrowUp", "ArrowLeft"].map((k) => id(k)).join(" ") === "A F ON UP LEFT");
check("letters press the key that carries them, either case", id("g") === "MTH" && id("G") === "MTH" && id("z") === "EEX");
check("Ctrl/Cmd/Alt combinations are left to the browser", id("c", { ctrlKey: true }) === null && id("7", { metaKey: true }) === null);
check("unmapped keys press nothing", id("Shift") === null && id("q", {}) === "DOWN" && id("§") === null);

// ---------------------------------------------------------------- the Keypad holds a click long enough
function stub() { return { time: 0, log: [], key(line, bit, down) { this.log.push(line + ":" + bit + (down ? "+" : "-")); } }; }
{
  const m = stub(), pad = new Keys.Keypad(m), k = Keys.byId["7"];
  pad.press(k); m.time += 1000; pad.release(k);
  check("a short click stays down", m.log.join() === "3:3+" && pad.isDown(k));
  m.time += Keys.MIN_HOLD; pad.update();
  check("…until the minimum hold has passed in emulated time", m.log.join() === "3:3+,3:3-" && !pad.isDown(k));
  check("the minimum hold is 60 ms at 3.6864 MHz", Keys.MIN_HOLD === 3686400 * 0.06);
}
{
  const m = stub(), pad = new Keys.Keypad(m), k = Keys.byId["ENTER"];
  pad.press(k); m.time += Keys.MIN_HOLD + 1; pad.release(k);
  check("a long press is released at once", m.log.join() === "4:4+,4:4-");
  pad.press(k); pad.press(k);
  check("pressing a key that is already down doesn't press it twice", m.log.join() === "4:4+,4:4-,4:4+");
}
{
  const m = stub(), pad = new Keys.Keypad(m), k = Keys.byId["ADD"];
  pad.press(k); pad.release(k); pad.press(k);
  check("pressed again before its release came due, the key just stays down", m.log.join() === "0:0+" && pad.isDown(k));
  m.time += Keys.MIN_HOLD * 2; pad.update();
  check("…and is not released by the earlier click", pad.isDown(k));
  pad.releaseAll();
  check("releaseAll lets go of everything (window lost focus)", !pad.isDown(k) && m.log.join() === "0:0+,0:0-");
}

// ---------------------------------------------------------------- ROM files
function image(rev) {
  const b = new Uint8Array(RomFile.SIZE);
  const s = "Version HP48-" + rev;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i), a = 0x7ffaf + 2 * i;           // two nibbles a character, low first
    const put = (n, v) => { b[n >> 1] = (n & 1) ? (b[n >> 1] & 15) | (v << 4) : (b[n >> 1] & 0xf0) | v; };
    put(a, c & 15); put(a + 1, c >> 4);
  }
  return b;
}
{
  const r = RomFile.load(image("R"));
  check("a 512 KB packed image is taken as it is, revision read", !r.error && r.revision === "R" && r.bytes.length === 524288);
  const p = image("P"), u = new Uint8Array(1048576);
  for (let i = 0; i < p.length; i++) { u[2 * i] = p[i] & 15; u[2 * i + 1] = p[i] >> 4; }
  const r2 = RomFile.load(u.buffer);
  check("a 1 MB one-nibble-per-byte image is packed (from an ArrayBuffer too)", !r2.error && r2.revision === "P" && r2.bytes.every((v, i) => v === p[i]));
  check("a 256 KB file is refused as a 48S/SX ROM", /48S\/SX/.test(RomFile.load(new Uint8Array(262144)).error));
  const big = new Uint8Array(1048576).fill(0xff);
  check("a 1 MB packed file is refused (perhaps a 49G ROM)", /49G/.test(RomFile.load(big).error));
  check("a file of another size is refused, with its size", /12,345 bytes/.test(RomFile.load(new Uint8Array(12345)).error));
  check("512 KB without the version text is refused", /doesn't identify/.test(RomFile.load(new Uint8Array(524288)).error));
}

// the twelve application keys are printed in the right-shift colour (HP 48G Series User's Guide: "Keys that have
// only labels printed in green represent applications"); their left shift is an unlabelled companion menu
{
  const APPS = { PRG: "CHARS", CST: "MODES", VAR: "MEMORY", UP: "STACK", 7: "SOLVE", 8: "PLOT", 9: "SYMBOLIC",
    4: "TIME", 5: "STAT", 1: "I/O", 2: "LIBRARY", 3: "EQ LIB" };
  const wrong = Object.keys(APPS).filter((id) => Keys.byId[id].rs !== APPS[id] || Keys.byId[id].ls !== "");
  check("the twelve applications are right-shift labels, with no left-shift label", !wrong.length, wrong.join(", "));
  check("…and UNITS, not an application key, stays left-shift", Keys.byId["6"].ls === "UNITS" && Keys.byId["6"].rs === "");
}

summary("keys");
