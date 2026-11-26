// The real 48GX ROM booting on the emulated machine — run with:
//   HP48_ROM=/path/to/gxrom-r node hp48/tests/boot.test.js
// HP's firmware is never in this repository: the test reads it from $HP48_ROM
// (or the default path below) and is skipped when it isn't there, as on CI.
// Screens are compared by hash, so no picture of the firmware's output is stored.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Machine = require("../src/machine.js");
const { check, summary } = require("./harness.js");

const ROM = process.env.HP48_ROM || path.join(process.env.USERPROFILE || process.env.HOME || "", "Downloads", "gxrom-r");
if (!fs.existsSync(ROM)) { console.log("boot: skipped (no ROM at " + ROM + "; set HP48_ROM)"); process.exit(0); }

const m = new Machine(fs.readFileSync(ROM));
let error = null;
const run = (hundredths) => { for (let t = 0; t < hundredths && !error; t++) { try { m.run(Machine.CLOCK / 100); } catch (e) { error = e.message; } } };
const hash = () => crypto.createHash("sha1").update(Buffer.from(m.pixels().flatMap((r) => Array.from(r)))).digest("hex");
const press = (line, bit) => { m.key(line, bit, true); run(20); m.key(line, bit, false); };
const PROMPT = "9803b61e670a20c71d74efe21ab572b49513ff58";      // "Try To Recover Memory?"  YES … NO
const STACK = "0bca89e9713a7a917d2aa34a66df5fa30e0b0af7";       // "Memory Clear", stack 4: … 1:, menu labels

// power-up with blank memory
run(100);
check("power-up runs with no unknown opcode", error === null, error);
const mem = m.mod.map((x) => x.state);
check("the ROM configures the I/O block at 00100 and 128 KB of RAM at 80000", m.ioBase === 0x100 && m.mod[1].state === 2 && m.mod[1].base === 0x80000 && m.mod[1].mask === 0xc0000, JSON.stringify(mem));
check("…switches the display on, with its memory in RAM", (m.io[0] & 8) === 8 && m.display().start >= 0x80000 && m.display().start < 0xc0000);
check("…shows \"Try To Recover Memory?\" (screen hash)", hash() === PROMPT, hash());
check("…and waits for a key, asleep (SHUTDN)", m.cpu.shutdown);

// NO: the menu key at OUT line 8, IN bit 0
press(8, 0); run(300);
check("NO (line 8, bit 0) clears memory and shows the stack (screen hash)", hash() === STACK, hash());
check("…then idles in the main loop, asleep with timer 2 running", m.cpu.shutdown && (m.io[0x2f] & 1) === 1);
check("still no unknown opcode", error === null, error);

// YES on a fresh machine: memory recovery starts
const y = new Machine(fs.readFileSync(ROM));
for (let t = 0; t < 100; t++) y.run(Machine.CLOCK / 100);
y.key(1, 4, true); for (let t = 0; t < 20; t++) y.run(Machine.CLOCK / 100); y.key(1, 4, false);
for (let t = 0; t < 50; t++) y.run(Machine.CLOCK / 100);
const yh = crypto.createHash("sha1").update(Buffer.from(y.pixels().flatMap((r) => Array.from(r)))).digest("hex");
check("YES (line 1, bit 4) starts recovering memory instead: a different screen, busy", yh !== PROMPT && yh !== STACK && !y.cpu.shutdown);

summary("boot");
