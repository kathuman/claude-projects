/*
 * stack.js — reads the calculator's stack out of its memory, so the page can
 * show results as text, check them and export them.
 *
 * Where the stack is: the 48GX keeps the address of stack level 1 at 806F8
 * (found on the real ROM by putting known numbers on the stack and searching
 * RAM for the pointer that leads to them). From there, each level is a 5-nibble
 * pointer to an object, level 1 first, until a pointer of 0.
 *
 * Objects (RPL): each starts with its prolog's address, and every prolog's
 * code starts with the address 028FC. Reals are BCD: a
 * 3-nibble exponent (10's complement), a 12-digit mantissa and a sign nibble,
 * all stored low nibble first. Strings and binary integers carry a length;
 * lists, programs and algebraics run until SEMI. An element that isn't an
 * object is a pointer to one (often a ROM constant or command).
 *
 * Pure, no DOM: read(peek) takes any nibble reader. window.HP48.Stack in the
 * browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.Stack = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DSKTOP = 0x806f8;
  const P = { REAL: 0x02933, LREAL: 0x02955, CMPLX: 0x02977, LCMPLX: 0x0299d, CHAR: 0x029bf, ARRAY: 0x029e8,
    STR: 0x02a2c, HXS: 0x02a4e, LIST: 0x02a74, DIR: 0x02a96, ALG: 0x02ab8, UNIT: 0x02ada, TAG: 0x02afc,
    GROB: 0x02b1e, LIB: 0x02b40, BAK: 0x02b62, PROG: 0x02d9d, GNAME: 0x02e48, LNAME: 0x02e6d, XLIB: 0x02e92,
    SB: 0x02911, SEMI: 0x0312b };
  const NAMES = {}; Object.keys(P).forEach(function (k) { NAMES[P[k]] = k; });
  const COMPOSITE = [P.LIST, P.ALG, P.PROG, P.UNIT];
  const LENGTHED = [P.STR, P.HXS, P.ARRAY, P.GROB, P.LIB, P.BAK, P.DIR];

  function reader(peek) {
    const n5 = function (a) { return peek(a) | (peek(a + 1) << 4) | (peek(a + 2) << 8) | (peek(a + 3) << 12) | (peek(a + 4) << 16); };
    const n2 = function (a) { return peek(a) | (peek(a + 1) << 4); };
    const chars = function (a, n) { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(n2(a + 2 * i)); return s; };
    // is the word at a an object's prolog? Every prolog's code starts with the address 028FC (checked on
    // the real ROM); a command's code instead starts with the address just past itself.
    const isObject = function (a) { const p = n5(a); return p !== 0 && n5(p) === 0x028fc; };

    // a real at a (after its prolog): its value and the digits as the 48 stores them
    function real(a, long) {
      const ed = long ? 5 : 3, md = long ? 15 : 12;
      let e = 0; for (let i = ed - 1; i >= 0; i--) e = e * 10 + peek(a + i);
      if (e >= Math.pow(10, ed) / 2) e -= Math.pow(10, ed);
      let m = ""; for (let i = ed + md - 1; i >= ed; i--) m += peek(a + i);
      const neg = peek(a + ed + md) >= 5;
      const v = (neg ? -1 : 1) * parseFloat(m[0] + "." + m.slice(1) + "e" + e);
      return v === 0 ? 0 : v;
    }
    const fmt = function (v) {
      if (v === 0) return "0";
      const a = Math.abs(v);
      if (a >= 1e12 || a < 1e-11) return v.toExponential(11).replace(/\.?0+e/, "E").replace("E+", "E");
      return String(parseFloat(v.toPrecision(12)));
    };

    // the object at a → { type, value?, text, size }
    function obj(a, depth) {
      depth = depth || 0;
      const p = n5(a);
      if (!isObject(a)) {
        // a pointer: to an object (often in ROM) or to a command
        if (depth < 6 && isObject(p)) { const o = obj(p, depth + 1); return Object.assign({}, o, { size: 5 }); }
        return { type: "command", text: "cmd#" + p.toString(16).toUpperCase().padStart(5, "0"), size: 5 };
      }
      const b = a + 5;
      switch (p) {
        case P.REAL: { const v = real(b, false); return { type: "real", value: v, text: fmt(v), size: 21 }; }
        case P.LREAL: { const v = real(b, true); return { type: "real", value: v, text: fmt(v), size: 26 }; }
        case P.CMPLX: { const x = real(b, false), y = real(b + 16, false); return { type: "complex", value: [x, y], text: "(" + fmt(x) + "," + fmt(y) + ")", size: 37 }; }
        case P.CHAR: { const c = String.fromCharCode(n2(b)); return { type: "char", value: c, text: c, size: 7 }; }
        case P.SB: { const v = n5(b); return { type: "sysbin", value: v, text: "<" + v.toString(16).toUpperCase() + "h>", size: 10 }; }
        case P.STR: { const len = n5(b); const s = chars(b + 5, (len - 5) >> 1); return { type: "string", value: s, text: "\"" + s + "\"", size: 5 + len }; }
        case P.HXS: {
          const len = n5(b); let h = "";
          for (let i = len - 6; i >= 5; i--) h += peek(b + i).toString(16);
          h = h.replace(/^0+(?=.)/, "").toUpperCase() || "0";
          return { type: "binary", value: h, text: "# " + h + "h", size: 5 + len };
        }
        case P.GNAME: case P.LNAME: { const n = n2(b), s = chars(b + 2, n); return { type: "name", value: s, text: "'" + s + "'", size: 7 + 2 * n }; }
        case P.TAG: {
          const n = n2(b), tag = chars(b + 2, n), inner = obj(b + 2 + 2 * n, depth + 1);
          return { type: "tagged", tag: tag, value: inner.value, inner: inner, text: tag + ": " + inner.text, size: 7 + 2 * n + inner.size };
        }
        case P.XLIB: return { type: "command", text: "XLIB " + (n5(b) & 0xfff) + " " + n5(b + 3), size: 11 };
        default:
          if (COMPOSITE.indexOf(p) >= 0) {
            const items = []; let x = b, ok = true;
            while (n5(x) !== P.SEMI && items.length < 500) {
              const o = obj(x, depth + 1);
              if (!o.size) { ok = false; break; }
              items.push(o); x += o.size;
            }
            const size = ok ? x + 5 - a : 0;
            if (p === P.LIST) return { type: "list", value: items.map(function (o) { return o.value; }), items: items, text: "{ " + items.map(function (o) { return o.text; }).join(" ") + (items.length ? " }" : "}"), size: size };
            const kind = p === P.PROG ? "program" : p === P.ALG ? "algebraic" : "unit";
            return { type: kind, items: items, text: kind === "program" ? "« program »" : kind === "algebraic" ? "'algebraic'" : "unit", size: size };
          }
          if (LENGTHED.indexOf(p) >= 0) { const len = n5(b); return { type: (NAMES[p] || "object").toLowerCase(), text: (NAMES[p] || "object").toLowerCase(), size: 5 + len }; }
          return { type: "object", text: "object #" + p.toString(16).toUpperCase(), size: 0 };
      }
    }

    // the stack, level 1 first
    function levels(max) {
      max = max || 100;
      const top = n5(DSKTOP), out = [];
      for (let i = 0; i < max; i++) {
        const ptr = n5(top + 5 * i);
        if (ptr === 0) break;
        out.push(obj(ptr));
      }
      return out;
    }
    return { levels: levels, object: obj, real: real };
  }

  // the stack of a machine (or any nibble reader), level 1 first
  function read(peekOrMachine, max) {
    const peek = typeof peekOrMachine === "function" ? peekOrMachine : function (a) { return peekOrMachine.peek(a); };
    return reader(peek).levels(max);
  }
  // levels as CSV: level, type, value
  function csv(levels) {
    const q = function (s) { return /[",\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s; };
    return "level,type,value\n" + levels.map(function (o, i) { return (i + 1) + "," + o.type + "," + q(o.type === "real" ? String(o.value) : o.text); }).join("\n") + "\n";
  }

  return { read: read, csv: csv, reader: reader, DSKTOP: DSKTOP, PROLOG: P };
});
