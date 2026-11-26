// The CPU on the real 48GX ROM — run with:  node hp48/tests/rom.test.js
// The ROM is HP's copyrighted firmware and is never in this repository: the
// test reads it from $HP48_ROM (or the default path below) and is skipped
// when it isn't there, as on CI.
const fs = require("fs");
const path = require("path");
const Saturn = require("../src/saturn.js");
const disasm = require("../src/disasm.js");
const { check, summary } = require("./harness.js");

const ROM = process.env.HP48_ROM || path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "gxrom-r");
if (!fs.existsSync(ROM)) { console.log("rom: skipped (no ROM at " + ROM + "; set HP48_ROM)"); process.exit(0); }

const bytes = fs.readFileSync(ROM);
check("the ROM is 512 KB (two nibbles a byte)", bytes.length === 524288, bytes.length);
const mem = new Uint8Array(0x100000);
for (let i = 0; i < bytes.length; i++) { mem[2 * i] = bytes[i] & 15; mem[2 * i + 1] = bytes[i] >> 4; }
const text = (a, k) => { let s = ""; for (let i = 0; i < k; i++) s += String.fromCharCode(mem[a + 2 * i] | (mem[a + 2 * i + 1] << 4)); return s; };
check("it is a 48GX, revision R ('Version HP48-R' at 7FFAF)", text(0x7ffaf, 14) === "Version HP48-R", text(0x7ffaf, 14));

// run the reset code on a flat memory (the memory controller comes in phase 2):
// the CPU and the independent disassembler must agree on every instruction
const cfg = [];
const bus = { read: (a) => mem[a], write: (a, v) => { mem[a] = v; }, config: (a) => cfg.push(a), unconfig: () => {}, id: () => 0, reset: () => {}, out: () => {}, in: () => 0, shutdown: () => {} };
const cpu = new Saturn(bus);
const JUMPY = /^(GO|RTN|RTI|PC=|APCEX|CPCEX|NOP3)|GOYES|RTNYES/;
let steps = 0, mism = 0, invalid = null, seen = new Set();
while (steps < 100000 && !cpu.shutdown) {
  const at = cpu.PC, d = disasm((a) => mem[a], at);
  seen.add(at);
  if (!d.valid) { invalid = at.toString(16) + " " + d.text; break; }
  try { cpu.step(); } catch (e) { invalid = e.message; break; }
  if (cpu.PC !== ((at + d.len) & 0xfffff) && !JUMPY.test(d.text)) mism++;
  steps++;
}
check("the reset code runs with no unknown opcode", invalid === null, invalid);
check("CPU and disassembler agree on all " + steps + " instructions (" + seen.size + " addresses)", mism === 0, mism);
check("the ROM maps its I/O registers (00100) first, then two more modules", cfg.length === 3 && cfg[0] === 0x100, cfg.map((a) => a.toString(16)).join(" "));
check("…and waits in SHUTDN for an interrupt (timers come with phase 2)", cpu.shutdown);
check("the first instructions are P=3, GOTO 001BC", disasm((a) => mem[a], 0).text === "P= 3" && disasm((a) => mem[a], 2).text === "GOTO 001BC");

summary("rom");
