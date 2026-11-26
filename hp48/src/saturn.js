/*
 * saturn.js — the HP Saturn CPU, the processor of the HP 48 series.
 *
 * Written from the documented instruction set (not from another emulator's
 * code). Everything is nibbles: memory is addressed in 4-bit units over a
 * 20-bit address space, and the working registers are 16 nibbles (64 bits).
 *
 *   A B C D      working registers, 16 nibbles each (index 0 = least significant)
 *   R0–R4        scratch registers, 16 nibbles
 *   D0 D1        20-bit data pointers        PC   20-bit program counter
 *   P            4-bit pointer (selects a nibble for the P and WP fields)
 *   ST           16 program status bits      HST  4 hardware status bits
 *                                                 (1 XM, 2 SB sticky bit, 4 SR, 8 MP)
 *   RSTK         8-level return stack        carry, and HEX/DEC arithmetic mode
 *   IN OUT       keyboard / I-O lines (16 and 12 bits)
 *
 * Fields — the nibble ranges an instruction works on:
 *   P [P]  WP [0..P]  XS [2]  X [0..2]  S [15]  M [3..14]  B [0..1]  W [0..15]  A [0..4]
 *
 * The CPU talks to the rest of the machine through a bus:
 *   bus.read(addr) → nibble        bus.write(addr, nibble)
 *   bus.config(addr), bus.unconfig(addr), bus.id() → 20-bit id, bus.reset(),
 *   bus.out(value), bus.in() → 16 bits, bus.shutdown()
 * (memory management, keyboard and timers come with the machine, not the CPU).
 *
 * step() executes one instruction and returns the cycles it took (an estimate
 * from the nibbles fetched and moved; exact timing is not needed for the
 * calculator to work). Unknown opcodes throw.
 *
 * Pure, no DOM: window.HP48.Saturn in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.Saturn = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MASK = 0xfffff;
  const FIELD_NAMES = ["P", "WP", "XS", "X", "S", "M", "B", "W"];

  function Saturn(bus) {
    this.bus = bus;
    this.A = new Uint8Array(16); this.B = new Uint8Array(16); this.C = new Uint8Array(16); this.D = new Uint8Array(16);
    this.R = [new Uint8Array(16), new Uint8Array(16), new Uint8Array(16), new Uint8Array(16), new Uint8Array(16)];
    this.reset();
  }

  Saturn.prototype.reset = function () {
    [this.A, this.B, this.C, this.D].concat(this.R).forEach(function (r) { r.fill(0); });
    this.D0 = 0; this.D1 = 0; this.PC = 0; this.P = 0;
    this.ST = 0; this.HST = 0; this.carry = false; this.hex = true;
    this.RSTK = []; this.IN = 0; this.OUT = 0;
    this.intEnabled = false; this.inInterrupt = false; this.intPending = false;
    this.shutdown = false; this.cycles = 0;
  };

  // ---------------------------------------------------------------- fetch
  Saturn.prototype.nib = function () { const n = this.bus.read(this.PC) & 15; this.PC = (this.PC + 1) & MASK; this.cyc++; return n; };
  // n nibbles, least significant first (constants, offsets and addresses are stored that way)
  Saturn.prototype.nibs = function (n) { let v = 0; for (let i = 0; i < n; i++) v += this.nib() * Math.pow(16, i); return v; };
  function signed(v, n) { const m = Math.pow(16, n); return v >= m / 2 ? v - m : v; }

  // ---------------------------------------------------------------- fields
  // [first, last] nibble of a field code (0–7 as named, 15 = A); for memory transfers with a count, use count()
  Saturn.prototype.field = function (f) {
    switch (f) {
      case 0: return [this.P, this.P];
      case 1: return [0, this.P];
      case 2: return [2, 2];
      case 3: return [0, 2];
      case 4: return [15, 15];
      case 5: return [3, 14];
      case 6: return [0, 1];
      case 7: return [0, 15];
      case 15: return [0, 4];
      default: throw new Error("bad field code " + f);
    }
  };

  // ---------------------------------------------------------------- register helpers
  function get5(r) { return r[0] + 16 * r[1] + 256 * r[2] + 4096 * r[3] + 65536 * r[4]; }
  function set5(r, v) { for (let i = 0; i < 5; i++) { r[i] = v & 15; v >>>= 4; } }
  Saturn.prototype.base = function () { return this.hex ? 16 : 10; };

  // dst[f] = a[f] + b[f] (+ carry chain); sets carry
  Saturn.prototype.add = function (dst, a, b, f) {
    const base = this.base(); let c = 0;
    for (let i = f[0]; i <= f[1]; i++) {
      let s = a[i] + b[i] + c;
      if (s >= base) { s -= base; c = 1; } else c = 0;
      dst[i] = s & 15;
    }
    this.carry = c === 1;
  };
  Saturn.prototype.sub = function (dst, a, b, f) {
    const base = this.base(); let c = 0;
    for (let i = f[0]; i <= f[1]; i++) {
      let s = a[i] - b[i] - c;
      if (s < 0) { s += base; c = 1; } else c = 0;
      dst[i] = s & 15;
    }
    this.carry = c === 1;
  };
  // add / subtract a small constant k (≥ 0) over the field
  Saturn.prototype.addk = function (r, k, f, base) {
    base = base || this.base(); let c = k;
    for (let i = f[0]; i <= f[1]; i++) {
      let s = r[i] + c;
      c = 0;
      while (s >= base) { s -= base; c++; }
      r[i] = s & 15;
    }
    this.carry = c > 0;
  };
  Saturn.prototype.subk = function (r, k, f, base) {
    base = base || this.base(); let c = k;
    for (let i = f[0]; i <= f[1]; i++) {
      let s = r[i] - c;
      c = 0;
      while (s < 0) { s += base; c++; }
      r[i] = s & 15;
    }
    this.carry = c > 0;
  };
  function zero(r, f) { for (let i = f[0]; i <= f[1]; i++) r[i] = 0; }
  function copy(dst, src, f) { for (let i = f[0]; i <= f[1]; i++) dst[i] = src[i]; }
  function exch(a, b, f) { for (let i = f[0]; i <= f[1]; i++) { const t = a[i]; a[i] = b[i]; b[i] = t; } }
  function isZero(r, f) { for (let i = f[0]; i <= f[1]; i++) if (r[i]) return false; return true; }
  function equal(a, b, f) { for (let i = f[0]; i <= f[1]; i++) if (a[i] !== b[i]) return false; return true; }
  // a > b over the field, as an unsigned number
  function greater(a, b, f) { for (let i = f[1]; i >= f[0]; i--) if (a[i] !== b[i]) return a[i] > b[i]; return false; }
  // 2's (10's) complement: carry set unless the field was zero
  Saturn.prototype.neg = function (r, f) {
    const z = isZero(r, f), base = this.base(); let c = 0;
    for (let i = f[0]; i <= f[1]; i++) {
      let s = -r[i] - c;
      if (s < 0) { s += base; c = 1; } else c = 0;
      r[i] = s & 15;
    }
    this.carry = !z;
  };
  // 1's (9's) complement: carry cleared
  Saturn.prototype.not = function (r, f) {
    const top = this.base() - 1;
    for (let i = f[0]; i <= f[1]; i++) r[i] = (top - r[i]) & 15;
    this.carry = false;
  };
  function shl(r, f) { for (let i = f[1]; i > f[0]; i--) r[i] = r[i - 1]; r[f[0]] = 0; }
  // shift right: a non-zero nibble shifted out sets the sticky bit
  Saturn.prototype.shr = function (r, f) {
    if (r[f[0]]) this.HST |= 2;
    for (let i = f[0]; i < f[1]; i++) r[i] = r[i + 1];
    r[f[1]] = 0;
  };
  // shift right by one bit over the field; a 1 shifted out sets the sticky bit
  Saturn.prototype.shrb = function (r, f) {
    if (r[f[0]] & 1) this.HST |= 2;
    for (let i = f[0]; i <= f[1]; i++) r[i] = (r[i] >> 1) | (i < f[1] ? (r[i + 1] & 1) << 3 : 0);
  };

  // ---------------------------------------------------------------- memory transfers
  Saturn.prototype.store = function (addr, r, first, last) {
    for (let i = first; i <= last; i++) { this.bus.write((addr + i - first) & MASK, r[i]); this.cyc++; }
  };
  Saturn.prototype.load = function (addr, r, first, last) {
    for (let i = first; i <= last; i++) { r[i] = this.bus.read((addr + i - first) & MASK) & 15; this.cyc++; }
  };
  Saturn.prototype.read5 = function (addr) { let v = 0; for (let i = 0; i < 5; i++) v += (this.bus.read((addr + i) & MASK) & 15) * Math.pow(16, i); return v; };

  // ---------------------------------------------------------------- the return stack (8 levels)
  Saturn.prototype.push = function (a) { if (this.RSTK.length === 8) this.RSTK.shift(); this.RSTK.push(a & MASK); };
  Saturn.prototype.pop = function () { return this.RSTK.length ? this.RSTK.pop() : 0; };

  // ---------------------------------------------------------------- conditional jumps
  // after a test: the 2-nibble GOYES offset follows (relative to where it sits); 00 = RTNYES
  Saturn.prototype.goyes = function () {
    const at = this.PC, off = this.nibs(2);
    if (!this.carry) return;
    if (off === 0) this.PC = this.pop();
    else this.PC = (at + signed(off, 2)) & MASK;
  };

  // the register a 2-bit code names, for the A/B/C/D families
  Saturn.prototype.reg = function (i) { return [this.A, this.B, this.C, this.D][i]; };

  // equality / zero tests, op 0–F (shared by 8A and 9 with fields 0–7)
  Saturn.prototype.testEq = function (op, f) {
    const A = this.A, B = this.B, C = this.C, D = this.D;
    const pairs = [[A, B], [B, C], [C, A], [D, C]];
    if (op < 4) this.carry = equal(pairs[op][0], pairs[op][1], f);
    else if (op < 8) this.carry = !equal(pairs[op - 4][0], pairs[op - 4][1], f);
    else if (op < 12) this.carry = isZero(this.reg(op - 8), f);
    else this.carry = !isZero(this.reg(op - 12), f);
  };
  // magnitude tests, op 0–F (8B, and 9 with fields 8–F)
  Saturn.prototype.testCmp = function (op, f) {
    const A = this.A, B = this.B, C = this.C, D = this.D;
    const p = [[A, B], [B, C], [C, A], [D, C]][op & 3];
    if (op < 4) this.carry = greater(p[0], p[1], f);
    else if (op < 8) this.carry = greater(p[1], p[0], f);
    else if (op < 12) this.carry = !greater(p[1], p[0], f);
    else this.carry = !greater(p[0], p[1], f);
  };

  // the A-family (opcode A with fields, C with field A): add / double / dec, or with op ≥ 8 … see aOps
  Saturn.prototype.arith1 = function (op, f) {
    const A = this.A, B = this.B, C = this.C, D = this.D;
    switch (op) {
      case 0: this.add(A, A, B, f); break; case 1: this.add(B, B, C, f); break;
      case 2: this.add(C, C, A, f); break; case 3: this.add(D, D, C, f); break;
      case 4: this.add(A, A, A, f); break; case 5: this.add(B, B, B, f); break;
      case 6: this.add(C, C, C, f); break; case 7: this.add(D, D, D, f); break;
      case 8: this.add(B, B, A, f); break; case 9: this.add(C, C, B, f); break;
      case 10: this.add(A, A, C, f); break; case 11: this.add(C, C, D, f); break;
      case 12: this.subk(A, 1, f); break; case 13: this.subk(B, 1, f); break;
      case 14: this.subk(C, 1, f); break; case 15: this.subk(D, 1, f); break;
    }
  };
  // the A-family with op ≥ 8 in the opcode (A with fields 8–F, and D): clear, copy, exchange
  Saturn.prototype.arith2 = function (op, f) {
    const A = this.A, B = this.B, C = this.C, D = this.D;
    switch (op) {
      case 0: zero(A, f); break; case 1: zero(B, f); break; case 2: zero(C, f); break; case 3: zero(D, f); break;
      case 4: copy(A, B, f); break; case 5: copy(B, C, f); break; case 6: copy(C, A, f); break; case 7: copy(D, C, f); break;
      case 8: copy(B, A, f); break; case 9: copy(C, B, f); break; case 10: copy(A, C, f); break; case 11: copy(C, D, f); break;
      case 12: exch(A, B, f); break; case 13: exch(B, C, f); break; case 14: exch(C, A, f); break; case 15: exch(D, C, f); break;
    }
  };
  // the B-family (B with fields 0–7, and E): subtract / increment / reverse subtract
  Saturn.prototype.arith3 = function (op, f) {
    const A = this.A, B = this.B, C = this.C, D = this.D;
    switch (op) {
      case 0: this.sub(A, A, B, f); break; case 1: this.sub(B, B, C, f); break;
      case 2: this.sub(C, C, A, f); break; case 3: this.sub(D, D, C, f); break;
      case 4: this.addk(A, 1, f); break; case 5: this.addk(B, 1, f); break;
      case 6: this.addk(C, 1, f); break; case 7: this.addk(D, 1, f); break;
      case 8: this.sub(B, B, A, f); break; case 9: this.sub(C, C, B, f); break;
      case 10: this.sub(A, A, C, f); break; case 11: this.sub(C, C, D, f); break;
      case 12: this.sub(A, B, A, f); break; case 13: this.sub(B, C, B, f); break;
      case 14: this.sub(C, A, C, f); break; case 15: this.sub(D, C, D, f); break;
    }
  };
  // the B-family with op ≥ 8 (B with fields 8–F, and F): shifts and negation
  Saturn.prototype.arith4 = function (op, f) {
    const r = this.reg(op & 3);
    if (op < 4) shl(r, f);
    else if (op < 8) this.shr(r, f);
    else if (op < 12) this.neg(r, f);
    else this.not(r, f);
  };

  // ---------------------------------------------------------------- interrupts
  Saturn.prototype.interrupt = function () {
    if (this.shutdown) this.shutdown = false;
    if (!this.intEnabled || this.inInterrupt) { this.intPending = true; return false; }
    this.inInterrupt = true; this.intPending = false;
    this.push(this.PC); this.PC = 0x0000f;
    return true;
  };

  // ---------------------------------------------------------------- one instruction
  Saturn.prototype.step = function () {
    if (this.shutdown) return 0;
    this.cyc = 0;
    const at = this.PC;
    this.lastPC = at;
    const n0 = this.nib();
    switch (n0) {
      case 0x0: this.op0(); break;
      case 0x1: this.op1(); break;
      case 0x2: this.P = this.nib(); break;                                       // P=n
      case 0x3: { const n = this.nib() + 1; for (let i = 0; i < n; i++) this.C[(this.P + i) & 15] = this.nib(); break; } // LC
      case 0x4: case 0x5: {                                                        // GOC / GONC (00 = RTNC / RTNNC)
        const pos = this.PC, off = this.nibs(2), take = n0 === 4 ? this.carry : !this.carry;
        if (take) { if (off === 0) this.PC = this.pop(); else this.PC = (pos + signed(off, 2)) & MASK; }
        break;
      }
      case 0x6: { const pos = this.PC, off = this.nibs(3); this.PC = (pos + signed(off, 3)) & MASK; break; }   // GOTO
      case 0x7: { const off = this.nibs(3); this.push(this.PC); this.PC = (this.PC + signed(off, 3)) & MASK; break; } // GOSUB
      case 0x8: this.op8(); break;
      case 0x9: { const f = this.nib(), t = this.nib(); if (f < 8) this.testEq(t, this.field(f)); else this.testCmp(t, this.field(f - 8)); this.goyes(); break; }
      case 0xa: { const f = this.nib(), o = this.nib(); if (f < 8) this.arith1(o, this.field(f)); else this.arith2(o, this.field(f - 8)); break; }
      case 0xb: { const f = this.nib(), o = this.nib(); if (f < 8) this.arith3(o, this.field(f)); else this.arith4(o, this.field(f - 8)); break; }
      case 0xc: this.arith1(this.nib(), this.field(15)); break;
      case 0xd: this.arith2(this.nib(), this.field(15)); break;
      case 0xe: this.arith3(this.nib(), this.field(15)); break;
      case 0xf: this.arith4(this.nib(), this.field(15)); break;
    }
    this.cycles += this.cyc + 2;
    return this.cyc + 2;
  };

  Saturn.prototype.op0 = function () {
    const n = this.nib();
    switch (n) {
      case 0x0: this.HST |= 1; this.PC = this.pop(); break;                        // RTNSXM
      case 0x1: this.PC = this.pop(); break;                                       // RTN
      case 0x2: this.carry = true; this.PC = this.pop(); break;                    // RTNSC
      case 0x3: this.carry = false; this.PC = this.pop(); break;                   // RTNCC
      case 0x4: this.hex = true; break;                                            // SETHEX
      case 0x5: this.hex = false; break;                                           // SETDEC
      case 0x6: this.push(get5(this.C)); break;                                    // RSTK=C
      case 0x7: set5(this.C, this.pop()); break;                                   // C=RSTK
      case 0x8: this.ST &= 0xf000; break;                                          // CLRST
      case 0x9: { const s = this.ST & 0xfff; this.C[0] = s & 15; this.C[1] = (s >> 4) & 15; this.C[2] = (s >> 8) & 15; break; } // C=ST
      case 0xa: this.ST = (this.ST & 0xf000) | this.C[0] | (this.C[1] << 4) | (this.C[2] << 8); break; // ST=C
      case 0xb: {                                                                  // CSTEX
        const s = this.ST & 0xfff;
        this.ST = (this.ST & 0xf000) | this.C[0] | (this.C[1] << 4) | (this.C[2] << 8);
        this.C[0] = s & 15; this.C[1] = (s >> 4) & 15; this.C[2] = (s >> 8) & 15; break;
      }
      case 0xc: this.carry = this.P === 15; this.P = (this.P + 1) & 15; break;     // P=P+1
      case 0xd: this.carry = this.P === 0; this.P = (this.P - 1) & 15; break;      // P=P-1
      case 0xe: {                                                                  // logical AND / OR
        const fc = this.nib(), op = this.nib(), f = this.field(fc);
        const pairs = [[this.A, this.B], [this.B, this.C], [this.C, this.A], [this.D, this.C]];
        const p = pairs[op & 3];
        if (op > 7) throw this.bad();
        for (let i = f[0]; i <= f[1]; i++) p[0][i] = op < 4 ? (p[0][i] & p[1][i]) : (p[0][i] | p[1][i]);
        break;
      }
      case 0xf: this.PC = this.pop(); this.inInterrupt = false; break;              // RTI
    }
  };

  Saturn.prototype.op1 = function () {
    const n = this.nib();
    const A = this.A, C = this.C, W = [0, 15];
    switch (n) {
      case 0x0: { const r = this.nib(); this.R[this.rIndex(r)].set(r < 8 ? A : C); break; }                   // Rn=A / Rn=C
      case 0x1: { const r = this.nib(); (r < 8 ? A : C).set(this.R[this.rIndex(r)]); break; }                 // A=Rn / C=Rn
      case 0x2: { const r = this.nib(); exch(r < 8 ? A : C, this.R[this.rIndex(r)], W); break; }              // ARnEX / CRnEX
      case 0x3: {
        const op = this.nib(), src = op & 4 ? C : A;
        const four = op & 8, which = op & 1 ? "D1" : "D0", ex = op & 2;
        const v = get5(src), cur = this[which];
        if (!four) {
          if (ex) { this[which] = v; set5(src, cur); } else this[which] = v;
        } else {
          const lo = v & 0xffff;
          if (ex) { this[which] = (cur & 0xf0000) | lo; const t = cur & 0xffff; for (let i = 0; i < 4; i++) src[i] = (t >> (4 * i)) & 15; }
          else this[which] = (cur & 0xf0000) | lo;
        }
        break;
      }
      case 0x4: {                                                                  // DATx=r / r=DATx, field A or B
        const op = this.nib(), f = op & 8 ? [0, 1] : [0, 4];
        this.memop(op & 7, f[0], f[1]); break;
      }
      case 0x5: {                                                                  // with a field, or a count of nibbles
        const op = this.nib(), x = this.nib();
        if (op & 8) this.memop(op & 7, 0, x); else { const f = this.field(x); this.memop(op & 7, f[0], f[1]); }
        break;
      }
      case 0x6: { const k = this.nib() + 1, s = this.D0 + k; this.carry = s > MASK; this.D0 = s & MASK; break; } // D0=D0+n
      case 0x7: { const k = this.nib() + 1, s = this.D1 + k; this.carry = s > MASK; this.D1 = s & MASK; break; } // D1=D1+n
      case 0x8: { const k = this.nib() + 1, s = this.D0 - k; this.carry = s < 0; this.D0 = s & MASK; break; }    // D0=D0-n
      case 0xc: { const k = this.nib() + 1, s = this.D1 - k; this.carry = s < 0; this.D1 = s & MASK; break; }    // D1=D1-n
      case 0x9: this.D0 = (this.D0 & 0xfff00) | this.nibs(2); break;             // D0=(2)
      case 0xa: this.D0 = (this.D0 & 0xf0000) | this.nibs(4); break;             // D0=(4)
      case 0xb: this.D0 = this.nibs(5); break;                                    // D0=(5)
      case 0xd: this.D1 = (this.D1 & 0xfff00) | this.nibs(2); break;             // D1=(2)
      case 0xe: this.D1 = (this.D1 & 0xf0000) | this.nibs(4); break;             // D1=(4)
      case 0xf: this.D1 = this.nibs(5); break;                                    // D1=(5)
    }
  };
  // R0–R4 from the low 3 bits; codes 5–7 (and 13–15) are not registers
  Saturn.prototype.rIndex = function (r) { const i = r & 7; if (i > 4) throw this.bad(); return i; };
  // op: 0 DAT0=A, 1 DAT1=A, 2 A=DAT0, 3 A=DAT1, 4 DAT0=C, 5 DAT1=C, 6 C=DAT0, 7 C=DAT1
  Saturn.prototype.memop = function (op, first, last) {
    const r = op & 4 ? this.C : this.A, addr = op & 1 ? this.D1 : this.D0;
    if (op & 2) this.load(addr, r, first, last); else this.store(addr, r, first, last);
  };

  Saturn.prototype.op8 = function () {
    const n = this.nib();
    switch (n) {
      case 0x0: this.op80(); break;
      case 0x1: this.op81(); break;
      case 0x2: this.HST &= ~this.nib() & 15; break;                              // HS=0 n (CLRHST = 82F)
      case 0x3: { const m = this.nib(); this.carry = (this.HST & m) === 0; this.goyes(); break; } // ?HS=0 n
      case 0x4: this.ST &= ~(1 << this.nib()); break;                              // ST=0 n
      case 0x5: this.ST |= 1 << this.nib(); break;                                 // ST=1 n
      case 0x6: { const b = this.nib(); this.carry = !(this.ST & (1 << b)); this.goyes(); break; } // ?ST=0 n
      case 0x7: { const b = this.nib(); this.carry = !!(this.ST & (1 << b)); this.goyes(); break; } // ?ST=1 n
      case 0x8: { const v = this.nib(); this.carry = this.P !== v; this.goyes(); break; }          // ?P#n
      case 0x9: { const v = this.nib(); this.carry = this.P === v; this.goyes(); break; }          // ?P=n
      case 0xa: this.testEq(this.nib(), this.field(15)); this.goyes(); break;
      case 0xb: this.testCmp(this.nib(), this.field(15)); this.goyes(); break;
      case 0xc: { const pos = this.PC, off = this.nibs(4); this.PC = (pos + signed(off, 4)) & MASK; break; }   // GOLONG
      case 0xd: this.PC = this.nibs(5); break;                                                              // GOVLNG
      case 0xe: { const off = this.nibs(4); this.push(this.PC); this.PC = (this.PC + signed(off, 4)) & MASK; break; } // GOSUBL
      case 0xf: { const a = this.nibs(5); this.push(this.PC); this.PC = a; break; }                        // GOSBVL
    }
  };

  Saturn.prototype.op80 = function () {
    const n = this.nib(), C = this.C, A = this.A;
    switch (n) {
      case 0x0: this.OUT = (this.OUT & 0xff0) | C[0]; this.bus.out(this.OUT); break;                  // OUT=CS
      case 0x1: this.OUT = C[0] | (C[1] << 4) | (C[2] << 8); this.bus.out(this.OUT); break;           // OUT=C
      case 0x2: case 0x3: {                                                                            // A=IN / C=IN
        this.IN = this.bus.in() & 0xffff; const r = n === 2 ? A : C;
        for (let i = 0; i < 4; i++) r[i] = (this.IN >> (4 * i)) & 15; break;
      }
      case 0x4: this.bus.unconfig(get5(C)); break;                                 // UNCNFG
      case 0x5: this.bus.config(get5(C)); break;                                   // CONFIG
      case 0x6: set5(C, this.bus.id()); break;                                     // C=ID
      case 0x7: this.shutdown = true; this.bus.shutdown(); break;                  // SHUTDN
      case 0x8: {
        const m = this.nib();
        switch (m) {
          case 0x0: this.intEnabled = true; if (this.intPending) this.interrupt(); break;   // INTON
          case 0x1: this.nib(); break;                                                      // RSI (80810)
          case 0x2: { const k = this.nib() + 1; for (let i = 0; i < k; i++) A[(this.P + i) & 15] = this.nib(); break; } // LA
          case 0x3: break;                                                                  // BUSCB
          case 0x4: this.bitop(A, this.nib(), 0); break;                                     // ABIT=0
          case 0x5: this.bitop(A, this.nib(), 1); break;                                     // ABIT=1
          case 0x6: { const b = this.nib(); this.carry = !this.bit(A, b); this.goyes(); break; } // ?ABIT=0
          case 0x7: { const b = this.nib(); this.carry = this.bit(A, b); this.goyes(); break; }  // ?ABIT=1
          case 0x8: this.bitop(C, this.nib(), 0); break;                                     // CBIT=0
          case 0x9: this.bitop(C, this.nib(), 1); break;                                     // CBIT=1
          case 0xa: { const b = this.nib(); this.carry = !this.bit(C, b); this.goyes(); break; } // ?CBIT=0
          case 0xb: { const b = this.nib(); this.carry = this.bit(C, b); this.goyes(); break; }  // ?CBIT=1
          case 0xc: this.PC = this.read5(get5(A)); break;                                    // PC=(A)
          case 0xd: break;                                                                  // BUSCD
          case 0xe: this.PC = this.read5(get5(C)); break;                                    // PC=(C)
          case 0xf: this.intEnabled = false; break;                                          // INTOFF
        }
        break;
      }
      case 0x9: this.addk(C, this.P + 1, [0, 4], 16); break;                       // C+P+1 (always hexadecimal)
      case 0xa: this.bus.reset(); break;                                           // RESET
      case 0xb: break;                                                             // BUSCC
      case 0xc: C[this.nib()] = this.P; break;                                     // C=P n
      case 0xd: this.P = C[this.nib()]; break;                                     // P=C n
      case 0xe: C[0] = 0; break;                                                   // SREQ? (no service requests here)
      case 0xf: { const i = this.nib(), t = C[i]; C[i] = this.P; this.P = t; break; } // CPEX n
    }
  };
  Saturn.prototype.bit = function (r, b) { return !!(r[b >> 2] & (1 << (b & 3))); };
  Saturn.prototype.bitop = function (r, b, v) { if (v) r[b >> 2] |= 1 << (b & 3); else r[b >> 2] &= ~(1 << (b & 3)) & 15; };

  Saturn.prototype.op81 = function () {
    const n = this.nib(), W = [0, 15];
    switch (n) {
      case 0x0: case 0x1: case 0x2: case 0x3: {                                    // ASLC … DSLC (circular, whole register)
        const r = this.reg(n), t = r[15]; for (let i = 15; i > 0; i--) r[i] = r[i - 1]; r[0] = t; break;
      }
      case 0x4: case 0x5: case 0x6: case 0x7: {                                    // ASRC … DSRC
        const r = this.reg(n - 4), t = r[0]; if (t) this.HST |= 2;
        for (let i = 0; i < 15; i++) r[i] = r[i + 1]; r[15] = t; break;
      }
      case 0x8: {                                                                  // r=r+CON / r=r-CON f, n (always hexadecimal)
        const f = this.field(this.nib()), rr = this.nib(), k = this.nib() + 1, r = this.reg(rr & 3);
        if (rr & 8) this.subk(r, k, f, 16); else this.addk(r, k, f, 16);
        break;
      }
      case 0x9: { const f = this.field(this.nib()), r = this.reg(this.nib() & 3); this.shrb(r, f); break; }  // rSRB f
      case 0xa: {                                                                  // Rn=r f / r=Rn f / rRnEX f
        const f = this.field(this.nib()), t = this.nib(), x = this.nib(), r = x < 8 ? this.A : this.C, s = this.R[this.rIndex(x)];
        if (t === 0) copy(s, r, f); else if (t === 1) copy(r, s, f); else if (t === 2) exch(r, s, f); else throw this.bad();
        break;
      }
      case 0xb: {
        const m = this.nib(), A = this.A, C = this.C;
        switch (m) {
          case 0x2: this.PC = get5(A); break;                                      // PC=A
          case 0x3: this.PC = get5(C); break;                                      // PC=C
          case 0x4: set5(A, this.PC); break;                                       // A=PC
          case 0x5: set5(C, this.PC); break;                                       // C=PC
          case 0x6: { const t = get5(A); set5(A, this.PC); this.PC = t; break; }   // APCEX
          case 0x7: { const t = get5(C); set5(C, this.PC); this.PC = t; break; }   // CPCEX
          default: throw this.bad();
        }
        break;
      }
      case 0xc: case 0xd: case 0xe: case 0xf: this.shrb(this.reg(n - 12), W); break; // ASRB … DSRB (whole register)
    }
  };

  Saturn.prototype.bad = function () { return new Error("unknown opcode at " + (this.lastPC === undefined ? "?" : this.lastPC.toString(16)) + " (PC now " + this.PC.toString(16).padStart(5, "0") + ")"); };

  Saturn.FIELD_NAMES = FIELD_NAMES;
  Saturn.get5 = get5; Saturn.set5 = set5;
  return Saturn;
});
