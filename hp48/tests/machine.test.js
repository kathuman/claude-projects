// The 48GX machine around the CPU: memory controller, I/O registers, timers,
// keyboard, display decoding — run with:  node hp48/tests/machine.test.js
// Uses a synthetic ROM image (no HP firmware needed).
const Machine = require("../src/machine.js");
const { check, summary } = require("./harness.js");

// a synthetic 512 KB "ROM": nibble n holds (n mod 16), with an optional program at 0
function rom(prog) {
  const b = Buffer.alloc(524288);
  for (let i = 0; i < b.length; i++) b[i] = ((2 * i) & 15) | (((2 * i + 1) & 15) << 4);
  if (prog) { const s = prog.replace(/\s+/g, ""); for (let i = 0; i < s.length; i++) { const v = parseInt(s[i], 16), k = i >> 1; b[k] = i & 1 ? (b[k] & 15) | (v << 4) : (b[k] & 0xf0) | v; } }
  return b;
}
const fresh = (prog) => new Machine(rom(prog));
// configure the way the 48GX ROM does: I/O at 100, RAM (mask C0000) at 80000
function standard(m) { m.config(0x100); m.config(0xc0000); m.config(0x80000); return m; }

// ---------------------------------------------------------------- the configuration protocol
{
  const m = fresh();
  check("refuses an image that isn't 512 KB", (() => { try { new Machine(Buffer.alloc(100)); return false; } catch (e) { return true; } })());
  check("after reset, C=ID reports the I/O block (19), waiting for its base", m.id() === 0x19);
  m.config(0x100);
  check("one CONFIG places the I/O block (its size is fixed)", m.ioBase === 0x100);
  check("next, C=ID reports the RAM's mask ID (03) with no mask yet", m.id() === 0x00003);
  m.config(0xc0000);
  check("CONFIG C0000 gives the RAM its size; C=ID now reports its address ID (F4)", m.id() === 0xf4);
  m.config(0x80000);
  check("CONFIG 80000 places it; C=ID moves on to CE1 (05)", m.id() === 0x00005);
  m.config(0xff000); m.config(0x7f000); m.config(0xff000); m.config(0x7e000); m.config(0xff000); m.config(0x7e000);
  check("with all five configured, C=ID returns 0", m.id() === 0);
  const i = fresh(); i.config(0x123);
  check("the I/O base is aligned to 64 nibbles", i.ioBase === 0x100);
  const s = fresh(); s.config(0x100); s.config(0x12345);
  check("a size keeps only bits 12–19 (4K-nibble steps)", s.mod[1].mask === 0x12000);
}

// ---------------------------------------------------------------- reading and writing through the map
{
  const m = standard(fresh());
  check("ROM below 80000: nibble n holds n mod 16", m.read(0x12345) === 5 && m.read(0x7ffff) === 15);
  m.write(0x12345, 9);
  check("ROM can't be written", m.read(0x12345) === 5);
  m.write(0x80000, 7); m.write(0xbffff, 3);
  check("RAM at 80000–BFFFF reads back what was written", m.read(0x80000) === 7 && m.read(0xbffff) === 3);
  check("beyond the RAM (C0000 up) is unmapped: reads 0", m.read(0xc0000) === 0 && m.read(0xfffff) === 0);
  m.write(0x105, 0); m.io[0x20] = 0xa;
  check("I/O registers at 100–13F", m.read(0x120) === 0xa);
  // the I/O block wins over RAM placed on top of it
  const o = fresh(); o.config(0x80000); o.config(0xc0000); o.config(0x80000); o.io[0] = 0xd;
  check("where the I/O block and RAM overlap, I/O wins", o.read(0x80000) === 0xd && o.read(0x80040) === 0);
  // a window larger than the RAM repeats it
  const w = fresh(); w.config(0x100); w.config(0x80000); w.config(0x80000);
  w.write(0x80001, 6);
  check("a RAM window larger than the RAM repeats it (mirror at +40000)", w.read(0xc0001) === 6);
  // RAM over ROM
  const r = fresh(); r.config(0x100); r.config(0xf0000); r.config(0x00000);
  r.write(0x00500, 4);
  check("RAM configured over the ROM hides it", r.read(0x00500) === 4 && r.read(0x10500) === 0);
  // UNCNFG gives the address back
  r.unconfig(0x00000);
  check("UNCNFG releases the module at that address; the ROM shows again", r.read(0x00500) === 0 && r.mod[1].state === 0);
  r.unconfig(0x100);
  check("UNCNFG on the I/O block leaves it waiting for a new base", r.ioBase === -1 && r.id() === (0x19 | 0x100));
  // RESET
  const x = standard(fresh()); x.reset();
  check("RESET unconfigures every module (the I/O block waits for its base)", x.ioBase === -1 && x.mod.slice(1).every((q) => q.state === 0) && x.id() === 0x19);
  // A19: the upper half of the ROM
  const a = fresh(); a.config(0x100);
  check("without A19, 80000 up is not ROM", a.read(0x80003) === 0);
  a.write(0x129, 8);
  check("I/O 29 bit 3 (A19) maps the whole ROM", a.read(0x80003) === 3);
}

// ---------------------------------------------------------------- the bank switcher (CE1) and port 2 (NCE3)
{
  const m = fresh(); standard(m);
  m.config(0xff000); m.config(0x7f000);          // CE1 at 7F000
  check("reading the bank switcher returns 0", m.read(0x7f044) === 0);
  check("…and selects the bank from address bits 1–6", m.bank === 0x44);
  m.config(0xff000); m.config(0x7e000);          // CE2
  m.config(0xff000); m.config(0x7d000);          // NCE3
  m.read(0x7f000);
  check("port 2 (NCE3) is off while bank bit 6 is clear", m.page[0x7d] !== 4);
  m.read(0x7f040);
  check("…and on once it is set", m.page[0x7d] === 4);
}

// ---------------------------------------------------------------- CRC
{
  const m = standard(fresh());
  m.write(0x104, 0); m.write(0x105, 0); m.write(0x106, 0); m.write(0x107, 0);
  let crc = 0; const seq = [0x80000, 0x80001, 0x12345];
  m.write(0x80000, 0xa); m.write(0x80001, 0x3);
  seq.forEach((a) => { const v = m.read(a); crc = (crc >> 4) ^ (((crc ^ v) & 15) * 0x1081); });
  const got = m.read(0x104) | (m.read(0x105) << 4) | (m.read(0x106) << 8) | (m.read(0x107) << 12);
  check("data reads update the CRC: crc = (crc >> 4) ^ (((crc ^ n) & 15) × 1081h)", got === crc, got.toString(16) + " vs " + crc.toString(16));
  m.fetch(0x80000); m.fetch(0x12345);
  const again = m.read(0x104) | (m.read(0x105) << 4) | (m.read(0x106) << 8) | (m.read(0x107) << 12);
  check("instruction fetches and I/O reads leave it alone", again === crc);
  m.write(0x106, 0xf);
  check("writing a CRC nibble sets it", (m.crc >> 8 & 15) === 0xf);
}

// ---------------------------------------------------------------- timers
{
  const m = standard(fresh());
  m.t2 = 1000; m.tick(Machine.CLOCK);
  check("timers stand still while 2F bit 0 is clear", m.t2 === 1000);
  m.write(0x12f, 1);                              // run
  m.t2 = 100000; m.t1 = 15; m.tick(Machine.CLOCK);
  check("timer 2 counts down at 8192 Hz", m.t2 === 100000 - 8192, m.t2);
  check("timer 1 counts down at 16 Hz: after 1 s (16 ticks) it has gone full circle", m.t1 === 15, m.t1);
  m.t1 = 5; m.tick(Machine.CLOCK / 16 * 2 + 10);
  check("timer 1: 2 ticks in 1/8 s", m.t1 === 3, m.t1);
  // carry from 0: service request, wake, interrupt
  m.write(0x12e, 4); m.t1 = 0; m.cpu.shutdown = true; m.io[0x18] = 0;
  m.tick(Machine.CLOCK / 16 + 1);
  check("timer 1 passing zero wraps to F and sets its service request", m.t1 === 15 && (m.io[0x2e] & 8) && (m.io[0x18] & 4));
  check("…and wakes the CPU when 2E bit 2 is set", m.cpu.shutdown === false);
  m.write(0x12e, 2); m.t1 = 0; m.cpu.intEnabled = false; m.cpu.inInterrupt = false; m.cpu.PC = 0x500;
  m.tick(Machine.CLOCK / 16 + 1);
  check("…and raises an interrupt INTOFF can't block when 2E bit 1 is set", m.cpu.PC === 0xf && m.cpu.inInterrupt);
  const t = standard(fresh()); t.write(0x12f, 1 | 4); t.t2 = 0; t.cpu.shutdown = true;
  t.tick(Math.ceil(Machine.CLOCK / 8192) + 1);
  check("timer 2 wraps from 0 to FFFFFFFF and wakes the CPU (2F bit 2)", t.t2 === 0xffffffff && !t.cpu.shutdown);
  t.write(0x138, 5);
  check("timer 2 is readable and writable nibble by nibble at 138–13F", (t.t2 & 15) === 5 && t.read(0x13f) === 15);
}

// ---------------------------------------------------------------- keyboard and ON
{
  const m = standard(fresh());
  m.key(3, 2, true); m.key(5, 0, true);
  m.out(1 << 3);
  check("IN returns the rows of the driven line", m.in() === 4);
  m.out((1 << 3) | (1 << 5));
  check("…and ORs several lines", m.in() === 5);
  m.out(0);
  check("no line driven, no key", m.in() === 0);
  m.key("on", 0, true);
  check("ON always shows in IN bit 15, whatever OUT is", m.in() === 0x8000);
  m.key("on", 0, false); m.key(3, 2, false); m.key(5, 0, false);
  const k = standard(fresh()); k.cpu.shutdown = true; k.cpu.intEnabled = false;
  k.key(1, 4, true);
  check("a key press wakes the CPU even with interrupts off (the interrupt waits)", !k.cpu.shutdown && k.cpu.intPending && k.cpu.PC === 0);
  const n = standard(fresh()); n.cpu.intEnabled = false; n.cpu.PC = 0x400;
  n.key("on", 0, true);
  check("ON raises an interrupt INTOFF can't block", n.cpu.PC === 0xf && n.cpu.RSTK[0] === 0x400);
  check("a key event sets the keyboard service request (I/O 19 bit 3)", (n.io[0x19] & 8) === 8);
}

// ---------------------------------------------------------------- running: time passes while the CPU sleeps
{
  // a program: SHUTDN, then loop (GOTO to itself)
  const m = fresh("807 6FFF");
  m.run(Machine.CLOCK / 10);
  check("asleep with no timer running: stays asleep, time still passes", m.cpu.shutdown && Math.abs(m.time - Machine.CLOCK / 10) < 1);
  const w = fresh("807 6FFF"); w.config(0x100); w.write(0x12f, 1); w.write(0x12e, 4); w.t1 = 2;
  w.run(Machine.CLOCK / 4);
  check("asleep with timer 1 set to wake: wakes after 3 ticks (≈ 0.19 s) and runs on", !w.cpu.shutdown && w.cpu.PC >= 3);
}

// ---------------------------------------------------------------- the display registers and pixels
{
  const m = standard(fresh());
  const put = (r, v, n) => { for (let i = 0; i < n; i++) m.io[r + i] = (v >> (4 * i)) & 15; };
  put(0x20, 0x80101, 5); put(0x25, 0, 3); m.io[0x28] = 0xf; m.io[0x29] = 0x3; put(0x30, 0x90000, 5); m.io[0] = 8 | 2; m.io[1] = 7;
  const d = m.display();
  check("display registers: on, bit offset, start (made even), lines, menu, contrast",
    d.on && d.bitOffset === 2 && d.start === 0x80100 && d.lines === 63 && d.menu === 0x90000 && d.contrast === 7, JSON.stringify(d));
  const z = standard(fresh());
  const p = (r, v, n) => { for (let i = 0; i < n; i++) z.io[r + i] = (v >> (4 * i)) & 15; };
  p(0x20, 0x80000, 5); z.io[0x28] = 1; z.io[0x29] = 0; p(0x30, 0x81000, 5);
  z.write(0x80000, 0b0101);                      // line 0: pixels 0 and 2
  z.write(0x80000 + 34 + 1, 0b1000);              // line 1: pixel 4 + 3 = 7
  z.write(0x81000, 1);                           // the menu's first line (screen line 2)
  const px = z.pixels();
  check("pixels: least significant bit first within a nibble", px[0][0] === 1 && px[0][1] === 0 && px[0][2] === 1);
  check("pixels: 34 nibbles a line", px[1][7] === 1);
  check("pixels: after line count + 1 lines, the menu address takes over", px[2][0] === 1);
  check("pixels: 131 × 64", px.length === 64 && px[0].length === 131);
  check("the line counter runs 63 → 0", (() => { z.time = 0; const a = z.linesLeft(); z.time = Machine.CLOCK / 4096 * 10; return a === 63 && z.linesLeft() === 53; })());
}

summary("machine");
