/*
 * typer.js — turns program text into key presses, so the calculator's own
 * command line reads it, as if typed by hand.
 *
 * Text can be plain Unicode («, », →, π, ∠ …) or HP's ASCII transfer format:
 * a "%%HP: T(3)A(D)F(.);" header and codes such as \<< \>> \-> \pi or \171.
 * Comments (@ … @ or @ to the end of the line) are dropped outside strings, and
 * line breaks outside strings become spaces.
 *
 * The key sequence for each character was found by the real ROM, not written
 * from a manual: from a snapshot, every key was pressed inside a string, plain,
 * left-shifted and right-shifted, in alpha lock, and the screen matched with
 * the one "n CHR" leaves for each character code n. tests/typer-rom.test.js
 * checks every entry the same way. Typing starts with α α (alpha lock), and
 * every sequence leaves alpha lock on.
 *
 * Pure, no DOM: window.HP48.Typer in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.Typer = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // character code (the 48's own character set) → keys, in alpha lock
  const KEYS = {
    10: "RS DOT", 32: "SPC", 33: "LS DEL", 35: "RS DIV", 36: "LS 4", 37: "RS TAN", 39: "RS QUOTE", 42: "MUL", 43: "ADD",
    44: "LS DOT", 45: "SUB", 46: "DOT", 47: "DIV", 48: "0", 49: "1", 50: "2", 51: "3", 52: "4", 53: "5", 54: "6", 55: "7",
    56: "8", 57: "9", 58: "RS ADD", 60: "LS 2", 61: "LS 0", 62: "RS 2", 63: "LS BKSP",
    65: "A", 66: "B", 67: "C", 68: "D", 69: "E", 70: "F", 71: "MTH", 72: "PRG", 73: "CST", 74: "VAR", 75: "UP", 76: "NXT",
    77: "QUOTE", 78: "STO", 79: "EVAL", 80: "LEFT", 81: "DOWN", 82: "RIGHT", 83: "SIN", 84: "COS", 85: "TAN", 86: "SQRT",
    87: "POW", 88: "INV", 89: "NEG", 90: "EEX", 95: "RS MUL", 124: "RS VAR", 126: "RS SQRT",
    128: "RS SPC", 129: "RS INV", 135: "LS SPC", 137: "LS 3", 138: "RS 3", 139: "RS 1", 140: "RS A", 141: "RS 0",
    142: "RS LEFT", 143: "RS DOWN", 144: "RS UP", 145: "RS MTH", 146: "RS D", 147: "RS E", 148: "RS PRG", 149: "RS F",
    150: "RS NXT", 151: "RS RIGHT", 152: "RS SIN", 153: "RS COS", 154: "RS POW", 155: "RS C", 156: "RS EEX",
    157: "RS EVAL", 159: "RS CST", 161: "RS DEL", 162: "RS 4", 163: "LS 5", 164: "LS 6", 165: "RS 5", 176: "RS 6",
    177: "RS NEG", 181: "RS STO", 191: "RS BKSP", 223: "RS B"
  };
  // lower case: left shift and the letter's key
  for (let c = 97; c <= 122; c++) KEYS[c] = "LS " + KEYS[c - 32];
  // ^ : out of alpha for the yˣ key, which types ^ in a program or an algebraic
  KEYS[94] = "ALPHA POW ALPHA ALPHA";

  // Keys that type a pair, with the cursor inside, as a person types them: the
  // opening character presses the pair key (which also sets the entry mode the
  // ROM expects, e.g. algebraic after '), and its partner is stepped over.
  // A character without a partner is the pair less its other half: the opening
  // one deletes the closing half (DEL); the closing one deletes the opening
  // half (⇦) and steps over what is left.
  const STEP_OVER = "ALPHA RIGHT ALPHA ALPHA";
  const PAIRS = { 40: [41, "LS DIV"], 91: [93, "LS MUL"], 123: [125, "LS ADD"], 171: [187, "LS SUB"], 34: [34, "RS SUB"], 39: [39, "ALPHA QUOTE ALPHA ALPHA"] };
  const CLOSERS = {}; Object.keys(PAIRS).forEach(function (o) { CLOSERS[PAIRS[o][0]] = +o; });
  const ALONE_OPEN = {}, ALONE_CLOSE = {};
  Object.keys(PAIRS).forEach(function (o) {
    const k = PAIRS[o][1];
    ALONE_OPEN[o] = k + " DEL";
    ALONE_CLOSE[PAIRS[o][0]] = k + " BKSP " + STEP_OVER;
  });
  ALONE_OPEN[39] = KEYS[39]; ALONE_CLOSE[39] = KEYS[39];        // a lone ' is just the character
  [40, 41, 91, 93, 123, 125, 171, 187, 34].forEach(function (c) { KEYS[c] = ALONE_OPEN[c] || ALONE_CLOSE[c]; });

  // Unicode → the 48's character set (128–159 are its own; 160–255 are Latin-1)
  const UNI = { "∠": 128, "x̄": 129, "∇": 130, "√": 131, "∫": 132, "Σ": 133, "▶": 134, "π": 135, "∂": 136, "≤": 137, "≥": 138,
    "≠": 139, "α": 140, "→": 141, "←": 142, "↓": 143, "↑": 144, "γ": 145, "δ": 146, "ε": 147, "η": 148, "θ": 149, "λ": 150,
    "ρ": 151, "σ": 152, "τ": 153, "ω": 154, "Δ": 155, "Π": 156, "Ω": 157, "■": 158, "∞": 159 };
  // HP's ASCII transfer codes (translation mode 3)
  const TRI = { "<)": 128, "x-": 129, ".V": 130, "v/": 131, ".S": 132, "GS": 133, "|>": 134, "pi": 135, ".d": 136, "<=": 137,
    ">=": 138, "=/": 139, "Ga": 140, "->": 141, "<-": 142, "|v": 143, "|^": 144, "Gg": 145, "Gd": 146, "Ge": 147, "Gn": 148,
    "Gh": 149, "Gl": 150, "Gr": 151, "Gs": 152, "Gt": 153, "Gw": 154, "GD": 155, "PI": 156, "GW": 157, "[]": 158, "oo": 159,
    "<<": 171, ">>": 187, "^o": 176, "Gm": 181 };

  // text → character codes; unknown characters are kept as -1 with their text
  function decode(text) {
    text = String(text).replace(/\r\n?/g, "\n").replace(/^\s*%%HP:[^;\n]*;/, "");
    const out = [];
    for (let i = 0; i < text.length;) {
      const ch = text[i];
      if (ch === "\\") {
        const two = text.substr(i + 1, 2), dec = /^\d{3}/.exec(text.substr(i + 1, 3));
        if (TRI[two] !== undefined) { out.push({ code: TRI[two], text: "\\" + two }); i += 3; continue; }
        if (dec && +dec[0] < 256) { out.push({ code: +dec[0], text: "\\" + dec[0] }); i += 4; continue; }
        if (text[i + 1] === "\\") { out.push({ code: 92, text: "\\\\" }); i += 2; continue; }
      }
      if (text.substr(i, 2) === "x̄") { out.push({ code: 129, text: "x̄" }); i += 2; continue; }
      const cp = text.codePointAt(i), s = String.fromCodePoint(cp);
      const code = UNI[s] !== undefined ? UNI[s] : cp === 9 ? 32 : cp < 256 ? cp : -1;
      out.push({ code: code, text: s });
      i += s.length;
    }
    return out;
  }

  // Drop comments and turn line breaks into spaces, outside strings.
  function tidy(chars) {
    const out = [];
    let inString = false, comment = false;
    for (const c of chars) {
      if (comment) { if (c.code === 64 || c.code === 10) { comment = false; if (c.code === 10) out.push({ code: 32, text: " " }); } continue; }
      if (c.code === 34) inString = !inString;
      if (!inString && c.code === 64) { comment = true; continue; }
      if (!inString && c.code === 10) { out.push({ code: 32, text: " " }); continue; }
      out.push(c);
    }
    return out;
  }

  // match the pairs: index of each opening character → its closing partner's index
  function match(chars) {
    const partner = {}, stack = [];
    let inString = -1;
    chars.forEach(function (c, i) {
      if (inString >= 0) { if (c.code === 34) { partner[inString] = i; partner[i] = inString; inString = -1; } return; }
      if (c.code === 34) { inString = i; return; }
      const top = stack.length ? stack[stack.length - 1] : -1;
      if (c.code === 39 && top >= 0 && chars[top].code === 39) { stack.pop(); partner[top] = i; partner[i] = top; return; }
      if (PAIRS[c.code]) { stack.push(i); return; }
      if (CLOSERS[c.code] !== undefined && top >= 0 && chars[top].code === CLOSERS[c.code]) { stack.pop(); partner[top] = i; partner[i] = top; }
    });
    return partner;
  }

  // text → { keys: [key ids], unsupported: [characters], chars: count }
  function plan(text, opts) {
    opts = opts || {};
    const chars = tidy(decode(text)), partner = match(chars);
    const keys = ["ALPHA", "ALPHA"], unsupported = [];
    let depthPrg = 0, inString = false;
    chars.forEach(function (c, i) {
      let seq;
      const paired = partner[i] !== undefined, opening = paired && partner[i] > i;
      if (paired && opening) seq = PAIRS[c.code][1];
      else if (paired) seq = STEP_OVER;
      else seq = KEYS[c.code];
      // ^ types itself only in a program or an algebraic; at the top level of a string it would run
      if (c.code === 94 && inString && depthPrg === 0) seq = null;
      if (!seq) { if (unsupported.indexOf(c.text) < 0) unsupported.push(c.text); return; }
      if (paired && c.code === 34) inString = opening;
      if (paired && c.code === 171) depthPrg++; if (paired && c.code === 187) depthPrg--;
      seq.split(" ").forEach(function (k) { keys.push(k); });
    });
    if (opts.enter) keys.push("ENTER");
    return { keys: keys, unsupported: unsupported, chars: chars.length };
  }

  // Presses a list of keys on a machine, each held for the Keypad's minimum,
  // and waits until the ROM is idle again (asleep, waiting for a key) before
  // the next: keys pressed while it is still busy are not always read the same
  // way (α α after yˣ in a program, for one). advance(cycles) runs the machine
  // for about that long and returns true when every key has been typed.
  const SETTLE = 3686400 * 0.25;                 // 20 ms after the release, at least
  const PATIENCE = 3686400 * 5;                  // give up waiting for idle after 5 s
  function Typist(machine, pad, keysById, keys) {
    this.m = machine; this.pad = pad; this.byId = keysById; this.keys = keys.slice();
    this.i = 0; this.phase = "press"; this.t = 0; this.total = keys.length;
  }
  Typist.prototype.advance = function (cycles) {
    const m = this.m, end = m.time + cycles;
    while (m.time < end && this.i < this.keys.length) {
      const k = this.byId[this.keys[this.i]];
      if (this.phase === "press") { this.pad.press(k); this.t = m.time; this.phase = "hold"; }
      if (this.phase === "hold") {
        const left = this.t + this.pad.constructor.MIN_HOLD - m.time;
        if (left > 0) { m.run(Math.min(left, end - m.time)); continue; }
        this.pad.release(k); this.t = m.time; this.phase = "settle";
      }
      if (this.phase === "settle") {
        const waited = m.time - this.t;
        if (waited >= SETTLE && (m.cpu.shutdown || waited >= PATIENCE)) { this.i++; this.phase = "press"; continue; }
        m.run(Math.min(waited < SETTLE ? SETTLE - waited : 3686400 / 1000, end - m.time));
      }
    }
    if (m.time < end && this.i >= this.keys.length) m.run(end - m.time);
    return this.i >= this.keys.length;
  };
  Typist.prototype.progress = function () { return this.total ? this.i / this.total : 1; };

  return { plan: plan, decode: decode, KEYS: KEYS, Typist: Typist };
});
