/*
 * machine.js — the HP 48GX around the Saturn CPU: the memory controller, the
 * I/O registers, the timers, the keyboard lines and the display registers.
 * It is the CPU's bus.
 *
 * Memory controller. Five configurable modules form a daisy chain, highest
 * priority first; the ROM (NCE1) sits below them all:
 *   HDW   the 64 I/O registers            NCE2  RAM (128 KB = 256 K nibbles)
 *   CE1   the bank switcher (port 2)      CE2   port 1 card     NCE3  port 2 card
 *   NCE1  ROM: 00000–7FFFF (the whole space when I/O 29 bit 3, "A19", is set)
 * C=ID reports the first module in the chain that is not fully configured:
 * mask ID | its mask while its size is unknown, address ID | its base while
 * its base is unknown; 0 once all are configured. CONFIG sets the size
 * (mask = C.A & FF000) and then the base (C.A & mask); the I/O block knows its
 * size, so one CONFIG places it. UNCNFG releases the module at that address.
 * Where configured modules overlap, the higher one wins; a module smaller than
 * its window repeats through it. Unmapped addresses read 0.
 *
 * Timers: timer 1 (4 bits) counts down at 16 Hz and timer 2 (32 bits) at
 * 8192 Hz, both only while I/O 2F bit 0 is set. A count passing below zero
 * sets the service request, and per its control register (2E / 2F) wakes the
 * CPU (bit 2) and raises a non-maskable interrupt (bit 1).
 *
 * Keyboard: OUT bits 0–8 drive the key lines; IN returns the rows of the
 * driven lines that have a key down, plus the ON key (bit 15) whatever OUT
 * is. A new key press raises a keyboard interrupt (maskable); ON raises a
 * non-maskable one. Either wakes the CPU.
 *
 * CRC: every data read outside the I/O block updates the 16-bit CRC in I/O
 * 04–07: crc = (crc >> 4) ^ (((crc ^ nibble) & 15) × 1081h). Instruction
 * fetches don't count: the ROM checksums its saved clock with code that
 * differs between storing and checking, so counting fetches makes the two
 * disagree and the ROM restarts forever.
 *
 * Hardware facts from public documentation and MAME's BSD-licensed HP 48
 * driver (read for the facts; no code taken). Pure, no DOM: window.HP48.Machine
 * in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./saturn.js"));
  else { root.HP48 = root.HP48 || {}; root.HP48.Machine = factory(root.HP48.Saturn); }
})(typeof self !== "undefined" ? self : this, function (Saturn) {
  "use strict";

  const MASK = 0xfffff;
  const CLOCK = 3686400;                       // the 48GX's CPU clock, Hz (cycles here are estimates)
  const T2_PERIOD = CLOCK / 8192;              // cycles per timer-2 tick
  const RAM_NIBBLES = 0x40000;                 // 128 KB
  const HDW = 0, NCE2 = 1, CE1 = 2, CE2 = 3, NCE3 = 4;
  const ADDR_ID = [0x19, 0xf4, 0xf6, 0xf8, 0xf2];
  const MASK_ID = [0x00, 0x03, 0x05, 0x07, 0x01];
  const UNCONF = 0, MASK_KNOWN = 1, CONF = 2;
  const ON_BIT = 0x8000;

  function Machine(romBytes) {
    if (!romBytes || romBytes.length !== 524288) throw new Error("expected a 512 KB 48GX ROM image");
    this.rom = new Uint8Array(0x100000);
    for (let i = 0; i < romBytes.length; i++) { this.rom[2 * i] = romBytes[i] & 15; this.rom[2 * i + 1] = romBytes[i] >> 4; }
    this.ram = new Uint8Array(RAM_NIBBLES);
    this.io = new Uint8Array(64);
    this.cpu = new Saturn(this);
    this.keys = new Uint16Array(9);            // rows down on each key line (OUT bit)
    this.on = false;
    this.powerOn();
  }

  // ---------------------------------------------------------------- reset
  Machine.prototype.powerOn = function () {
    this.cpu.reset();
    this.io.fill(0);
    this.crc = 0; this.t1 = 0; this.t2 = 0; this.t2acc = 0; this.t2ticks = 0;
    this.bank = 0; this.outLines = 0; this.prevKeys = 0; this.time = 0;
    this.modReset();
  };
  Machine.prototype.modReset = function () {
    this.mod = [0, 1, 2, 3, 4].map(function (i) { return { state: i === HDW ? MASK_KNOWN : UNCONF, mask: i === HDW ? 0xfffc0 : 0, base: 0 }; });
    this.remap();
  };

  // ---------------------------------------------------------------- the memory map
  // a page table of 4K-nibble pages for RAM / ports / ROM; the I/O block is checked first
  Machine.prototype.remap = function () {
    this.page = new Int8Array(256).fill(-1);   // module index (NCE2…NCE3) or 5 = ROM, -1 unmapped
    const a19 = !!(this.io[0x29] & 8);
    const romTop = a19 ? 0x100000 : 0x80000;
    for (let p = 0; p < 256; p++) if (p * 0x1000 < romTop) this.page[p] = 5;
    // lowest priority first, so higher modules overwrite
    for (let i = NCE3; i >= NCE2; i--) {
      const m = this.mod[i];
      if (m.state !== CONF) continue;
      if (i === NCE3 && (a19 || !(this.bank & 0x40))) continue;   // port 2 needs the bank switcher's enable bit
      for (let p = 0; p < 256; p++) if (((p * 0x1000) & m.mask) === m.base) this.page[p] = i;
    }
    const h = this.mod[HDW];
    this.ioBase = h.state === CONF ? h.base : -1;
  };

  Machine.prototype.read = function (a) {
    a &= MASK;
    if (this.ioBase >= 0 && a >= this.ioBase && a < this.ioBase + 64) return this.ioRead(a - this.ioBase);
    let v = 0;
    switch (this.page[a >> 12]) {
      case 5: v = this.rom[a]; break;
      case NCE2: v = this.ram[(a - this.mod[NCE2].base) & (RAM_NIBBLES - 1)]; break;
      case CE1: {                                                 // reading the bank switcher selects the port-2 bank
        const b = (a - this.mod[CE1].base) & 0x7e;
        if (b !== this.bank) { this.bank = b; this.remap(); }
        v = 0; break;
      }
      default: v = 0;                                              // no cards in the ports
    }
    this.crc = (this.crc >> 4) ^ (((this.crc ^ v) & 15) * 0x1081);
    return v;
  };
  // an instruction fetch: the same memory, but it leaves the CRC alone (the CRC counts data reads only)
  Machine.prototype.fetch = function (a) {
    a &= MASK;
    if (this.ioBase >= 0 && a >= this.ioBase && a < this.ioBase + 64) return this.ioRead(a - this.ioBase);
    switch (this.page[a >> 12]) {
      case 5: return this.rom[a];
      case NCE2: return this.ram[(a - this.mod[NCE2].base) & (RAM_NIBBLES - 1)];
      default: return 0;
    }
  };
  Machine.prototype.write = function (a, v) {
    a &= MASK; v &= 15;
    if (this.ioBase >= 0 && a >= this.ioBase && a < this.ioBase + 64) return this.ioWrite(a - this.ioBase, v);
    if (this.page[a >> 12] === NCE2) this.ram[(a - this.mod[NCE2].base) & (RAM_NIBBLES - 1)] = v;
  };

  // ---------------------------------------------------------------- CONFIG / UNCNFG / C=ID / RESET
  Machine.prototype.config = function (a) {
    for (let i = 0; i < 5; i++) {
      const m = this.mod[i];
      if (m.state === UNCONF) { m.mask = a & 0xff000; m.state = MASK_KNOWN; return; }
      if (m.state === MASK_KNOWN) { m.base = a & m.mask; m.state = CONF; this.remap(); return; }
    }
  };
  Machine.prototype.unconfig = function (a) {
    for (let i = 0; i < 5; i++) {
      const m = this.mod[i];
      if (m.state === CONF && (a & m.mask) === m.base) { m.state = i === HDW ? MASK_KNOWN : UNCONF; this.remap(); return; }
    }
  };
  Machine.prototype.id = function () {
    for (let i = 0; i < 5; i++) {
      const m = this.mod[i];
      if (m.state === UNCONF) return (MASK_ID[i] | m.mask) & MASK;
      if (m.state === MASK_KNOWN) return (ADDR_ID[i] | (m.base & ~0x3f)) & MASK;
    }
    return 0;
  };
  Machine.prototype.reset = function () { this.modReset(); };

  // ---------------------------------------------------------------- I/O registers
  Machine.prototype.ioRead = function (r) {
    switch (r) {
      case 0x04: return this.crc & 15;
      case 0x05: return (this.crc >> 4) & 15;
      case 0x06: return (this.crc >> 8) & 15;
      case 0x07: return (this.crc >> 12) & 15;
      case 0x0f: return 0;                                         // no cards, none write-enabled
      case 0x28: return this.linesLeft() & 15;
      case 0x29: return ((this.linesLeft() >> 4) & 3) | (this.io[0x29] & 12);
      case 0x37: return this.t1 & 15;
      default:
        if (r >= 0x38) return (this.t2 >>> (4 * (r - 0x38))) & 15;
        return this.io[r];
    }
  };
  Machine.prototype.ioWrite = function (r, v) {
    switch (r) {
      case 0x04: case 0x05: case 0x06: case 0x07: { const s = 4 * (r - 4); this.crc = (this.crc & ~(15 << s)) | (v << s); return; }
      case 0x0f: return;
      case 0x37: this.t1 = v; return;
      case 0x29: { const old = this.io[0x29]; this.io[0x29] = v; if ((old ^ v) & 8) this.remap(); return; }
      default:
        if (r >= 0x38) { const s = 4 * (r - 0x38); this.t2 = ((this.t2 & ~(15 << s)) | (v << s)) >>> 0; return; }
        this.io[r] = v;
    }
  };
  // the display's line counter: 64 lines a frame, about 64 frames a second (read by the ROM to sync)
  Machine.prototype.linesLeft = function () { const line = Math.floor(this.time / (CLOCK / 4096)) % 64; return 63 - line; };

  // ---------------------------------------------------------------- keyboard
  Machine.prototype.out = function (v) { this.outLines = v & 0x1ff; };
  Machine.prototype.in = function () {
    let v = 0;
    for (let i = 0; i < 9; i++) if (this.outLines & (1 << i)) v |= this.keys[i];
    if (this.on) v |= ON_BIT;
    return v;
  };
  // press or release a key at (OUT line, IN bit); ON is press("on")
  Machine.prototype.key = function (line, bit, down) {
    if (line === "on") {
      this.on = down;
      if (down) { this.io[0x19] |= 8; this.cpu.interrupt(true); }
      return;
    }
    if (down) this.keys[line] |= 1 << bit; else this.keys[line] &= ~(1 << bit);
    if (down) { this.io[0x19] |= 8; this.cpu.interrupt(false); }
  };
  Machine.prototype.shutdown = function () {};

  // ---------------------------------------------------------------- timers
  // advance the timers by `cycles` of CPU time
  Machine.prototype.tick = function (cycles) {
    this.time += cycles;
    if (!(this.io[0x2f] & 1)) return;                              // both timers run only while 2F bit 0 is set
    this.t2acc += cycles;
    while (this.t2acc >= T2_PERIOD) {
      this.t2acc -= T2_PERIOD;
      // timer 2: 8192 Hz
      const before = this.t2;
      this.t2 = (this.t2 - 1) >>> 0;
      if (before === 0) this.timerCarry(0x2f);
      // timer 1: every 512 timer-2 ticks (16 Hz)
      if (++this.t2ticks % 512 === 0) {
        const b1 = this.t1;
        this.t1 = (this.t1 - 1) & 15;
        if (b1 === 0) this.timerCarry(0x2e);
      }
    }
  };
  Machine.prototype.timerCarry = function (ctrl) {
    const c = this.io[ctrl];
    this.io[ctrl] |= 8;                                            // service request
    this.io[0x18] |= 4;
    if (c & 4) this.cpu.shutdown = false;                          // wake
    if (c & 2) this.cpu.interrupt(true);                           // interrupt (non-maskable)
  };

  // ---------------------------------------------------------------- run
  // run about `cycles` of CPU time; while the CPU sleeps (SHUTDN), time still passes for the timers
  Machine.prototype.run = function (cycles) {
    const end = this.time + cycles;
    while (this.time < end) {
      if (this.cpu.shutdown) {
        // jump to the next timer-2 tick (or the end of the slice)
        const step = Math.max(1, Math.min(end - this.time, T2_PERIOD - this.t2acc));
        this.tick(step);
        if (!(this.io[0x2f] & 1) && this.cpu.shutdown) { this.time = end; break; }   // asleep with no timer running: only a key wakes it
        continue;
      }
      this.tick(this.cpu.step());
    }
  };

  // ---------------------------------------------------------------- the display registers (read by the screen)
  Machine.prototype.display = function () {
    const io = this.io;
    const n5 = function (r) { return io[r] | (io[r + 1] << 4) | (io[r + 2] << 8) | (io[r + 3] << 12) | (io[r + 4] << 16); };
    let loff = io[0x25] | (io[0x26] << 4) | (io[0x27] << 8); if (loff & 0x800) loff -= 0x1000;
    return {
      on: !!(io[0x00] & 8), bitOffset: io[0x00] & 7,
      contrast: io[0x01] | ((io[0x02] & 1) << 4),
      start: n5(0x20) & 0xffffe, lineOffset: loff,
      lines: (io[0x28] | ((io[0x29] & 3) << 4)) & 0x3f, menu: n5(0x30) & 0xffffe,
      annunciators: io[0x0b] | (io[0x0c] << 4)
    };
  };
  // the 131 × 64 screen as rows of 0/1 pixels (the top area from start, then the menu)
  Machine.prototype.pixels = function () {
    const d = this.display(), rows = [], self = this;
    const peek = function (a) { a &= MASK; if (self.ioBase >= 0 && a >= self.ioBase && a < self.ioBase + 64) return self.io[a - self.ioBase]; const p = self.page[a >> 12]; return p === 5 ? self.rom[a] : p === NCE2 ? self.ram[(a - self.mod[NCE2].base) & (RAM_NIBBLES - 1)] : 0; };
    let addr = d.start;
    for (let y = 0; y < 64; y++) {
      if (y === d.lines + 1) addr = d.menu;
      const row = new Uint8Array(131);
      for (let x = 0; x < 131; x++) { const b = x + (y <= d.lines ? d.bitOffset : 0); row[x] = (peek(addr + (b >> 2)) >> (b & 3)) & 1; }
      rows.push(row);
      addr += 34 + (y <= d.lines ? d.lineOffset : 0);
    }
    return rows;
  };

  // ---------------------------------------------------------------- keeping the calculator between visits
  // A snapshot is everything that changes: the CPU, RAM, I/O, the memory map,
  // the timers. Plain JSON (hex strings), so it can be stored or saved to a
  // file. It names the ROM it was taken with, by checksum.
  const hex = function (a) { let s = ""; for (let i = 0; i < a.length; i++) s += a[i].toString(16); return s; };
  const unhex = function (s, n) { if (s.length !== n || /[^0-9a-f]/.test(s)) throw new Error("damaged snapshot"); const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = parseInt(s[i], 16); return a; };
  Machine.prototype.romId = function () {
    if (this._romId) return this._romId;
    let h = 0x811c9dc5;                                            // FNV-1a over the ROM's nibbles
    for (let i = 0; i < this.rom.length; i++) { h ^= this.rom[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return (this._romId = h.toString(16).padStart(8, "0"));
  };
  Machine.prototype.snapshot = function () {
    const c = this.cpu;
    return {
      format: "hp48gx-state", version: 1, rom: this.romId(),
      cpu: {
        A: hex(c.A), B: hex(c.B), C: hex(c.C), D: hex(c.D), R: c.R.map(hex),
        D0: c.D0, D1: c.D1, PC: c.PC, P: c.P, ST: c.ST, HST: c.HST, carry: c.carry, hex: c.hex,
        RSTK: c.RSTK.slice(), IN: c.IN, OUT: c.OUT, intEnabled: c.intEnabled, inInterrupt: c.inInterrupt,
        intPending: c.intPending, pendingNmi: c.pendingNmi, shutdown: c.shutdown, cycles: c.cycles
      },
      io: hex(this.io), ram: hex(this.ram),
      mod: this.mod.map(function (x) { return { state: x.state, mask: x.mask, base: x.base }; }),
      crc: this.crc, t1: this.t1, t2: this.t2, t2acc: this.t2acc, t2ticks: this.t2ticks,
      bank: this.bank, outLines: this.outLines, time: this.time
    };
  };
  // restore a snapshot (throws if it is damaged or from another ROM); every key is released
  Machine.prototype.restore = function (s) {
    if (!s || s.format !== "hp48gx-state" || s.version !== 1) throw new Error("not an HP 48GX state");
    if (s.rom !== this.romId()) throw new Error("this state was saved with a different ROM");
    const c = this.cpu, k = s.cpu, r16 = function (x) { return unhex(x, 16); };
    const ram = unhex(s.ram, RAM_NIBBLES), io = unhex(s.io, 64), regs = [k.A, k.B, k.C, k.D].map(r16), R = k.R.map(r16);
    if (R.length !== 5 || !Array.isArray(k.RSTK) || k.RSTK.length > 8 || !Array.isArray(s.mod) || s.mod.length !== 5) throw new Error("damaged snapshot");
    c.A.set(regs[0]); c.B.set(regs[1]); c.C.set(regs[2]); c.D.set(regs[3]);
    for (let i = 0; i < 5; i++) c.R[i].set(R[i]);
    ["D0", "D1", "PC", "P", "ST", "HST", "carry", "hex", "IN", "OUT", "intEnabled", "inInterrupt", "intPending", "pendingNmi", "shutdown", "cycles"]
      .forEach(function (f) { c[f] = k[f]; });
    c.RSTK = k.RSTK.slice();
    this.ram.set(ram); this.io.set(io);
    this.mod = s.mod.map(function (x) { return { state: x.state, mask: x.mask, base: x.base }; });
    this.crc = s.crc; this.t1 = s.t1; this.t2 = s.t2 >>> 0; this.t2acc = s.t2acc; this.t2ticks = s.t2ticks;
    this.bank = s.bank; this.outLines = s.outLines; this.time = s.time;
    this.keys.fill(0); this.on = false;
    this.remap();
  };
  // Time passes while the page is closed: the timers count on, as they do in a
  // calculator that is switched off, so its clock stays right. A count that
  // passes zero raises its service request (and wakes the CPU) as it would have.
  Machine.prototype.elapse = function (seconds) {
    if (!(seconds > 0) || !(this.io[0x2f] & 1)) return;
    const ticks = Math.floor(seconds * 8192);
    const before = this.t2;
    this.t2 = (this.t2 - ticks) >>> 0;
    if (ticks > before) this.timerCarry(0x2f);
    const t1ticks = Math.floor((this.t2ticks % 512 + ticks) / 512);
    this.t2ticks += ticks;
    if (t1ticks > 0) {
      const b1 = this.t1;
      this.t1 = ((this.t1 - t1ticks) % 16 + 16) % 16;
      if (t1ticks > b1) this.timerCarry(0x2e);
    }
    this.time += ticks * T2_PERIOD;
  };

  Machine.CLOCK = CLOCK; Machine.ON_BIT = ON_BIT;
  return Machine;
});
