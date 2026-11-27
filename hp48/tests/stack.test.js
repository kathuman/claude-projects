// The stack reader on a synthetic memory: objects encoded by hand the way the 48 stores them.
const Stack = require("../src/stack.js");
const { check, summary } = require("./harness.js");

const P = Stack.PROLOG;
function memory() {
  const mem = new Map();
  const put5 = (a, v) => { for (let i = 0; i < 5; i++) mem.set(a + i, (v >> (4 * i)) & 15); };
  // every prolog's code starts with 028FC; SEMI is a command (its code starts just past itself)
  Object.values(P).forEach((p) => put5(p, p === P.SEMI ? p + 5 : 0x028fc));
  let free = 0x90000;
  const w = (nibs) => { const a = free; nibs.forEach((n, i) => mem.set(a + i, n)); free += nibs.length; return a; };
  const n5 = (v) => [0, 1, 2, 3, 4].map((i) => (v >> (4 * i)) & 15);
  const n2 = (v) => [v & 15, (v >> 4) & 15];
  const chars = (s) => [...s].flatMap((c) => n2(c.charCodeAt(0)));
  // a real: exponent (3 digits, 10's complement), 12 mantissa digits, sign — low nibble first
  const realNibs = (v) => {
    if (v === 0) return Array(16).fill(0);
    const e = Math.floor(Math.log10(Math.abs(v)));
    const m = (Math.abs(v) / Math.pow(10, e)).toFixed(11).replace(".", "");      // d.ddddddddddd → 12 digits
    const ee = e < 0 ? 1000 + e : e;
    return [ee % 10, Math.floor(ee / 10) % 10, Math.floor(ee / 100)].concat([...m].reverse().map(Number), [v < 0 ? 9 : 0]);
  };
  const enc = {
    real: (v) => n5(P.REAL).concat(realNibs(v)),
    cmplx: (x, y) => n5(P.CMPLX).concat(realNibs(x), realNibs(y)),
    str: (s) => n5(P.STR).concat(n5(5 + 2 * s.length), chars(s)),
    hxs: (hex, digits) => { const d = [...hex.padStart(digits, "0")].reverse().map((c) => parseInt(c, 16)); return n5(P.HXS).concat(n5(5 + d.length), d); },
    name: (s) => n5(P.GNAME).concat(n2(s.length), chars(s)),
    tag: (t, inner) => n5(P.TAG).concat(n2(t.length), chars(t), inner),
    list: (...items) => n5(P.LIST).concat(...items, n5(P.SEMI)),
    ptr: (a) => n5(a),
  };
  const stack = (objs) => {
    const addrs = objs.map((o) => w(o));
    const top = w([].concat(...addrs.map(n5), n5(0)));
    put5(Stack.DSKTOP, top);
  };
  return { peek: (a) => mem.get(a) || 0, w, enc, stack };
}

const M = memory(), E = M.enc;
const romOne = M.w(E.real(1));                         // a constant elsewhere, referred to by pointer
M.stack([
  E.real(1.5), E.real(-0.002), E.real(123456789012), E.real(6.02e23), E.real(-1e-300), E.real(0),
  E.str("Hello, 48"), E.cmplx(1, -2), E.hxs("1FF", 16), E.name("SCM"),
  E.tag("Q", E.real(692.820323028)),
  E.list(E.real(1), E.str("a"), E.list(E.real(2)), E.ptr(romOne)),
]);
const lv = Stack.read(M.peek);
const texts = lv.map((o) => o.text);
check("reads every level, level 1 first, and stops at the 0 pointer", lv.length === 12 && lv[0].type === "real" && lv[11].type === "list");
check("reals: decimals, negatives, 12 digits, large and tiny exponents, zero",
  [lv[0].value, lv[1].value, lv[2].value, lv[3].value, lv[4].value, lv[5].value].join() === [1.5, -0.002, 123456789012, 6.02e23, -1e-300, 0].join(), texts.slice(0, 6).join(" | "));
check("…shown as the 48 would: 6.02E23, -1E-300", texts[3] === "6.02E23" && texts[4] === "-1E-300");
check("a string", lv[6].type === "string" && lv[6].value === "Hello, 48" && texts[6] === "\"Hello, 48\"");
check("a complex number", lv[7].type === "complex" && texts[7] === "(1,-2)");
check("a binary integer, leading zeros dropped", lv[8].type === "binary" && texts[8] === "# 1FFh");
check("a name", texts[9] === "'SCM'");
check("a tagged result keeps its tag and its number", lv[10].type === "tagged" && lv[10].tag === "Q" && lv[10].value === 692.820323028 && texts[10] === "Q: 692.820323028");
check("a list, nested, with a pointer to an object elsewhere", texts[11] === "{ 1 \"a\" { 2 } 1 }" && lv[11].value.length === 4, texts[11]);
check("an empty stack reads as no levels", (() => { const e = memory(); e.stack([]); return Stack.read(e.peek).length === 0; })());
check("CSV: level, type, value, with quoting", Stack.csv(lv.slice(5, 8)) === "level,type,value\n1,real,0\n2,string,\"\"\"Hello, 48\"\"\"\n3,complex,\"(1,-2)\"\n");

summary("stack");
