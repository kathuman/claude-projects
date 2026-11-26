/*
 * disasm.js — Saturn disassembler: one instruction at an address → its
 * mnemonic and length in nibbles. Written separately from the CPU (it shares
 * no decoding code with saturn.js), so the two can check each other: on real
 * ROM code, every instruction the CPU executes in a straight line must
 * advance the PC by exactly the length the disassembler reports.
 *
 *   disasm(read, addr) → { text, len, valid }      read(addr) → nibble
 *
 * Mnemonics follow the usual HP style (A=A+B A, ?C#0 B, GOYES, …).
 * Pure: window.HP48.disasm in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.disasm = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const F = ["P", "WP", "XS", "X", "S", "M", "B", "W"];
  const fname = function (f) { return f === 15 ? "A" : F[f] || null; };
  const hex = function (v, n) { return v.toString(16).toUpperCase().padStart(n, "0"); };
  const R = ["A", "B", "C", "D"];
  const EQ = ["?A=B", "?B=C", "?C=A", "?D=C", "?A#B", "?B#C", "?C#A", "?D#C", "?A=0", "?B=0", "?C=0", "?D=0", "?A#0", "?B#0", "?C#0", "?D#0"];
  const CMP = ["?A>B", "?B>C", "?C>A", "?D>C", "?A<B", "?B<C", "?C<A", "?D<C", "?A>=B", "?B>=C", "?C>=A", "?D>=C", "?A<=B", "?B<=C", "?C<=A", "?D<=C"];
  const AR1 = ["A=A+B", "B=B+C", "C=C+A", "D=D+C", "A=A+A", "B=B+B", "C=C+C", "D=D+D", "B=B+A", "C=C+B", "A=A+C", "C=C+D", "A=A-1", "B=B-1", "C=C-1", "D=D-1"];
  const AR2 = ["A=0", "B=0", "C=0", "D=0", "A=B", "B=C", "C=A", "D=C", "B=A", "C=B", "A=C", "C=D", "ABEX", "BCEX", "CAEX", "DCEX"];
  const AR3 = ["A=A-B", "B=B-C", "C=C-A", "D=D-C", "A=A+1", "B=B+1", "C=C+1", "D=D+1", "B=B-A", "C=C-B", "A=A-C", "C=C-D", "A=B-A", "B=C-B", "C=A-C", "D=C-D"];
  const AR4 = ["ASL", "BSL", "CSL", "DSL", "ASR", "BSR", "CSR", "DSR", "A=-A", "B=-B", "C=-C", "D=-D", "A=-A-1", "B=-B-1", "C=-C-1", "D=-D-1"];
  const MEM = ["DAT0=A", "DAT1=A", "A=DAT0", "A=DAT1", "DAT0=C", "DAT1=C", "C=DAT0", "C=DAT1"];
  const D13 = ["D0=A", "D1=A", "AD0EX", "AD1EX", "D0=C", "D1=C", "CD0EX", "CD1EX", "D0=AS", "D1=AS", "AD0XS", "AD1XS", "D0=CS", "D1=CS", "CD0XS", "CD1XS"];
  const OP0 = ["RTNSXM", "RTN", "RTNSC", "RTNCC", "SETHEX", "SETDEC", "RSTK=C", "C=RSTK", "CLRST", "C=ST", "ST=C", "CSTEX", "P=P+1", "P=P-1", null, "RTI"];

  function disasm(read, addr) {
    const n = function (i) { return read((addr + i) & 0xfffff) & 15; };
    const num = function (i, k) { let v = 0; for (let j = 0; j < k; j++) v += n(i + j) * Math.pow(16, j); return v; };
    const sgn = function (v, k) { const m = Math.pow(16, k); return v >= m / 2 ? v - m : v; };
    const target = function (base, off, k) { return hex((base + sgn(off, k)) & 0xfffff, 5); };
    const out = function (text, len) { return { text: text, len: len, valid: true }; };
    const bad = function (len) { return { text: "???", len: len, valid: false }; };
    // a test followed by its GOYES (2 nibbles at offset i)
    const yes = function (test, i) { const o = num(i, 2); return out(test + (o === 0 ? " RTNYES" : " GOYES " + target(addr + i, o, 2)), i + 2); };
    const a = n(0);
    switch (a) {
      case 0x0: {
        const b = n(1);
        if (b === 0xe) { const f = fname(n(2)), o = n(3); if (!f || o > 7) return bad(4); return out(["A=A&B", "B=B&C", "C=C&A", "D=D&C", "A=A!B", "B=B!C", "C=C!A", "D=D!C"][o] + " " + f, 4); }
        return out(OP0[b], 2);
      }
      case 0x1: {
        const b = n(1), c = n(2);
        switch (b) {
          case 0x0: case 0x1: case 0x2: {
            if ((c & 7) > 4) return bad(3);
            const r = (c < 8 ? "A" : "C"), k = "R" + (c & 7);
            return out(b === 0 ? k + "=" + r : b === 1 ? r + "=" + k : r + k + "EX", 3);
          }
          case 0x3: return out(D13[c], 3);
          case 0x4: return out(MEM[c & 7] + " " + (c & 8 ? "B" : "A"), 3);
          case 0x5: { const x = n(3); if (c & 8) return out(MEM[c & 7] + " " + (x + 1), 4); const f = fname(x); return f ? out(MEM[c] + " " + f, 4) : bad(4); }
          case 0x6: return out("D0=D0+ " + (c + 1), 3);
          case 0x7: return out("D1=D1+ " + (c + 1), 3);
          case 0x8: return out("D0=D0- " + (c + 1), 3);
          case 0xc: return out("D1=D1- " + (c + 1), 3);
          case 0x9: return out("D0=(2) " + hex(num(2, 2), 2), 4);
          case 0xa: return out("D0=(4) " + hex(num(2, 4), 4), 6);
          case 0xb: return out("D0=(5) " + hex(num(2, 5), 5), 7);
          case 0xd: return out("D1=(2) " + hex(num(2, 2), 2), 4);
          case 0xe: return out("D1=(4) " + hex(num(2, 4), 4), 6);
          default: return out("D1=(5) " + hex(num(2, 5), 5), 7);
        }
      }
      case 0x2: return out("P= " + n(1), 2);
      case 0x3: { const k = n(1) + 1; let s = ""; for (let i = k - 1; i >= 0; i--) s += hex(n(2 + i), 1); return out("LC(" + k + ") #" + s, 2 + k); }
      case 0x4: { const o = num(1, 2); return out(o === 0 ? "RTNC" : o === 2 ? "NOP3" : "GOC " + target(addr + 1, o, 2), 3); }
      case 0x5: { const o = num(1, 2); return out(o === 0 ? "RTNNC" : "GONC " + target(addr + 1, o, 2), 3); }
      case 0x6: return out("GOTO " + target(addr + 1, num(1, 3), 3), 4);
      case 0x7: return out("GOSUB " + target(addr + 4, num(1, 3), 3), 4);
      case 0x8: return op8(n, num, out, bad, yes, target, addr);
      case 0x9: { const f = n(1), t = n(2); return yes((f < 8 ? EQ[t] : CMP[t]) + " " + F[f & 7], 3); }
      case 0xa: { const f = n(1), t = n(2); return out((f < 8 ? AR1[t] : AR2[t]) + " " + F[f & 7], 3); }
      case 0xb: { const f = n(1), t = n(2); return out((f < 8 ? AR3[t] : AR4[t]) + " " + F[f & 7], 3); }
      case 0xc: return out(AR1[n(1)] + " A", 2);
      case 0xd: return out(AR2[n(1)] + " A", 2);
      case 0xe: return out(AR3[n(1)] + " A", 2);
      default: return out(AR4[n(1)] + " A", 2);
    }
  }

  function op8(n, num, out, bad, yes, target, addr) {
    const b = n(1), c = n(2);
    switch (b) {
      case 0x0:
        switch (c) {
          case 0x0: return out("OUT=CS", 3); case 0x1: return out("OUT=C", 3);
          case 0x2: return out("A=IN", 3); case 0x3: return out("C=IN", 3);
          case 0x4: return out("UNCNFG", 3); case 0x5: return out("CONFIG", 3);
          case 0x6: return out("C=ID", 3); case 0x7: return out("SHUTDN", 3);
          case 0x8: {
            const d = n(3);
            switch (d) {
              case 0x0: return out("INTON", 4);
              case 0x1: return n(4) === 0 ? out("RSI", 5) : bad(5);
              case 0x2: { const k = n(4) + 1; let s = ""; for (let i = k - 1; i >= 0; i--) s += hex(n(5 + i), 1); return out("LA(" + k + ") #" + s, 5 + k); }
              case 0x3: return out("BUSCB", 4);
              case 0x4: return out("ABIT=0 " + n(4), 5); case 0x5: return out("ABIT=1 " + n(4), 5);
              case 0x6: return yes("?ABIT=0 " + n(4), 5); case 0x7: return yes("?ABIT=1 " + n(4), 5);
              case 0x8: return out("CBIT=0 " + n(4), 5); case 0x9: return out("CBIT=1 " + n(4), 5);
              case 0xa: return yes("?CBIT=0 " + n(4), 5); case 0xb: return yes("?CBIT=1 " + n(4), 5);
              case 0xc: return out("PC=(A)", 4); case 0xd: return out("BUSCD", 4);
              case 0xe: return out("PC=(C)", 4); default: return out("INTOFF", 4);
            }
          }
          case 0x9: return out("C+P+1", 3); case 0xa: return out("RESET", 3); case 0xb: return out("BUSCC", 3);
          case 0xc: return out("C=P " + n(3), 4); case 0xd: return out("P=C " + n(3), 4);
          case 0xe: return out("SREQ?", 3); default: return out("CPEX " + n(3), 4);
        }
      case 0x1: {
        if (c < 4) return out(R[c] + "SLC", 3);
        if (c < 8) return out(R[c - 4] + "SRC", 3);
        if (c === 8) { const f = n(3), r = n(4), k = n(5) + 1, fn = (f === 15 ? "A" : F[f]); if (!fn || (r & 4)) return bad(6); return out(R[r & 3] + "=" + R[r & 3] + (r & 8 ? "-" : "+") + "CON " + fn + ", " + k, 6); }
        if (c === 9) { const f = n(3), r = n(4), fn = (f === 15 ? "A" : F[f]); if (!fn || r > 3) return bad(5); return out(R[r] + "SRB." + fn, 5); }
        if (c === 0xa) {
          const f = n(3), t = n(4), x = n(5), fn = (f === 15 ? "A" : F[f]);
          if (!fn || t > 2 || (x & 7) > 4) return bad(6);
          const r = x < 8 ? "A" : "C", k = "R" + (x & 7);
          return out((t === 0 ? k + "=" + r : t === 1 ? r + "=" + k : r + k + "EX") + "." + fn, 6);
        }
        if (c === 0xb) { const d = n(3); const t = { 2: "PC=A", 3: "PC=C", 4: "A=PC", 5: "C=PC", 6: "APCEX", 7: "CPCEX" }[d]; return t ? out(t, 4) : bad(4); }
        return out(R[c - 12] + "SRB", 3);
      }
      case 0x2: return out(c === 15 ? "CLRHST" : c === 1 ? "XM=0" : c === 2 ? "SB=0" : c === 4 ? "SR=0" : c === 8 ? "MP=0" : "HS=0 " + c, 3);
      case 0x3: return yes(c === 1 ? "?XM=0" : c === 2 ? "?SB=0" : c === 4 ? "?SR=0" : c === 8 ? "?MP=0" : "?HS=0 " + c, 3);
      case 0x4: return out("ST=0 " + c, 3);
      case 0x5: return out("ST=1 " + c, 3);
      case 0x6: return yes("?ST=0 " + c, 3);
      case 0x7: return yes("?ST=1 " + c, 3);
      case 0x8: return yes("?P# " + c, 3);
      case 0x9: return yes("?P= " + c, 3);
      case 0xa: return yes(["?A=B", "?B=C", "?C=A", "?D=C", "?A#B", "?B#C", "?C#A", "?D#C", "?A=0", "?B=0", "?C=0", "?D=0", "?A#0", "?B#0", "?C#0", "?D#0"][c] + " A", 3);
      case 0xb: return yes(["?A>B", "?B>C", "?C>A", "?D>C", "?A<B", "?B<C", "?C<A", "?D<C", "?A>=B", "?B>=C", "?C>=A", "?D>=C", "?A<=B", "?B<=C", "?C<=A", "?D<=C"][c] + " A", 3);
      case 0xc: return out("GOLONG " + target(addr + 2, num(2, 4), 4), 6);
      case 0xd: return out("GOVLNG " + num(2, 5).toString(16).toUpperCase().padStart(5, "0"), 7);
      case 0xe: return out("GOSUBL " + target(addr + 6, num(2, 4), 4), 6);
      default: return out("GOSBVL " + num(2, 5).toString(16).toUpperCase().padStart(5, "0"), 7);
    }
  }

  return disasm;
});
