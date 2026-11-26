/*
 * keys.js — the 48GX keyboard: 49 keys in nine rows, each with its place in
 * the key matrix (OUT line, IN bit), its labels, and the computer keys that
 * press it. Also Keypad, which holds a key down long enough for the ROM to
 * see it however quickly it is clicked.
 *
 * Matrix positions: from MAME's BSD-licensed HP 48 driver (facts only), and
 * checked on the real ROM. Labels are the functions the keys perform: main,
 * left-shifted (ls), right-shifted (rs) and alpha (a). The drawing is this
 * project's own. Pure, no DOM: window.HP48.Keys in the browser,
 * module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.Keys = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // [id, line, bit, main, ls, rs, alpha, computer keys]
  const K = (id, line, bit, main, ls, rs, a, pc) => ({ id, line, bit, main, ls: ls || "", rs: rs || "", a: a || "", pc: pc || [] });
  const ROWS = [
    [K("A", 1, 4, "", "", "", "A", ["F1"]), K("B", 8, 4, "", "", "", "B", ["F2"]), K("C", 8, 3, "", "", "", "C", ["F3"]),
     K("D", 8, 2, "", "", "", "D", ["F4"]), K("E", 8, 1, "", "", "", "E", ["F5"]), K("F", 8, 0, "", "", "", "F", ["F6"])],
    [K("MTH", 2, 4, "MTH", "RAD", "POLAR", "G"), K("PRG", 7, 4, "PRG", "CHARS", "", "H"), K("CST", 7, 3, "CST", "MODES", "", "I"),
     K("VAR", 7, 2, "VAR", "MEMORY", "", "J"), K("UP", 7, 1, "▲", "STACK", "", "K", ["ArrowUp"]), K("NXT", 7, 0, "NXT", "PREV", "MENU", "L", ["PageDown"])],
    [K("QUOTE", 0, 4, "'", "UP", "HOME", "M", ["'"]), K("STO", 6, 4, "STO", "DEF", "RCL", "N"), K("EVAL", 6, 3, "EVAL", "→NUM", "UNDO", "O"),
     K("LEFT", 6, 2, "◀", "PICTURE", "", "P", ["ArrowLeft"]), K("DOWN", 6, 1, "▼", "VIEW", "", "Q", ["ArrowDown"]), K("RIGHT", 6, 0, "▶", "SWAP", "", "R", ["ArrowRight"])],
    [K("SIN", 3, 4, "SIN", "ASIN", "∂", "S"), K("COS", 5, 4, "COS", "ACOS", "∫", "T"), K("TAN", 5, 3, "TAN", "ATAN", "Σ", "U"),
     K("SQRT", 5, 2, "√x", "x²", "ˣ√y", "V"), K("POW", 5, 1, "yˣ", "10ˣ", "LOG", "W", ["^"]), K("INV", 5, 0, "1/x", "eˣ", "LN", "X")],
    [K("ENTER", 4, 4, "ENTER", "EQUATION", "MATRIX", "", ["Enter"]), K("NEG", 4, 3, "+/-", "EDIT", "CMD", "Y"), K("EEX", 4, 2, "EEX", "PURG", "ARG", "Z"),
     K("DEL", 4, 1, "DEL", "CLEAR", "", "", ["Delete"]), K("BKSP", 4, 0, "⇦", "DROP", "", "", ["Backspace"])],
    [K("ALPHA", 3, 5, "α", "USER", "ENTRY", "", ["Tab"]), K("7", 3, 3, "7", "SOLVE", "", "", ["7"]), K("8", 3, 2, "8", "PLOT", "", "", ["8"]),
     K("9", 3, 1, "9", "SYMBOLIC", "", "", ["9"]), K("DIV", 3, 0, "÷", "( )", "#", "", ["/"])],
    [K("LS", 2, 5, "↰", "", "", "", ["["]), K("4", 2, 3, "4", "TIME", "", "", ["4"]), K("5", 2, 2, "5", "STAT", "", "", ["5"]),
     K("6", 2, 1, "6", "UNITS", "", "", ["6"]), K("MUL", 2, 0, "×", "[ ]", "_", "", ["*"])],
    [K("RS", 1, 5, "↱", "", "", "", ["]"]), K("1", 1, 3, "1", "I/O", "", "", ["1"]), K("2", 1, 2, "2", "LIBRARY", "", "", ["2"]),
     K("3", 1, 1, "3", "EQ LIB", "", "", ["3"]), K("SUB", 1, 0, "−", "« »", "\" \"", "", ["-"])],
    [K("ON", "on", 15, "ON", "CONT", "OFF", "", ["Escape"]), K("0", 0, 3, "0", "=", "→", "", ["0"]), K("DOT", 0, 2, ".", ",", "↵", "", [".", ","]),
     K("SPC", 0, 1, "SPC", "π", "∠", "", [" "]), K("ADD", 0, 0, "+", "{ }", ": :", "", ["+"])]
  ];
  const ALL = [].concat.apply([], ROWS);
  const BY_ID = {}; ALL.forEach((k) => { BY_ID[k.id] = k; });
  const BY_PC = {};
  ALL.forEach((k) => k.pc.forEach((c) => { BY_PC[c] = k; }));
  // letters press the key that carries them (type α first, as on the calculator)
  ALL.forEach((k) => { if (k.a && !BY_PC[k.a.toLowerCase()]) BY_PC[k.a.toLowerCase()] = k; });

  // the key a computer keyboard event presses, or null
  function fromEvent(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return null;
    return BY_PC[ev.key] || BY_PC[ev.key && ev.key.length === 1 ? ev.key.toLowerCase() : ev.key] || null;
  }

  // Holds keys down for at least MIN_HOLD of emulated time, so a click shorter
  // than the ROM's keyboard scan still registers. Call update() after each run.
  const MIN_HOLD = 3686400 * 0.06;              // 60 ms at the 48GX's clock
  function Keypad(machine) { this.m = machine; this.down = {}; }
  Keypad.prototype.press = function (k) {
    if (this.down[k.id]) { this.down[k.id].release = false; return; }
    this.down[k.id] = { k: k, t: this.m.time, release: false };
    this.m.key(k.line, k.bit, true);
  };
  Keypad.prototype.release = function (k) {
    const d = this.down[k.id]; if (!d) return;
    d.release = true; this.update();
  };
  Keypad.prototype.update = function () {
    for (const id in this.down) {
      const d = this.down[id];
      if (d.release && this.m.time - d.t >= MIN_HOLD) { this.m.key(d.k.line, d.k.bit, false); delete this.down[id]; }
    }
  };
  Keypad.MIN_HOLD = MIN_HOLD;
  Keypad.prototype.isDown = function (k) { return !!this.down[k.id]; };
  Keypad.prototype.releaseAll = function () { for (const id in this.down) this.down[id].release = true; this.update(); };

  return { ROWS: ROWS, ALL: ALL, byId: BY_ID, fromEvent: fromEvent, Keypad: Keypad, MIN_HOLD: MIN_HOLD };
});
