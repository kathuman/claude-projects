# HP 48 emulator

An emulator of the HP 48GX calculator, for the browser. It emulates the hardware — the Saturn CPU, the memory
controller, the display, the keyboard and the timers — and runs the calculator's own firmware (its ROM).

**No ROM is included.** The ROM is HP's copyrighted firmware. hpcalc.org has hosted 48-series ROMs since HP began
allowing downloads in 2000, but there is no explicit licence, so this repository never contains one. You load a ROM
file in the browser (it stays on your device), dumped from your own calculator or obtained at your own discretion.
The emulator targets the 48GX, revision R.

## Status

| Phase | What | State |
|---|---|---|
| 1 | Saturn CPU core and disassembler | ✅ |
| 2 | Memory controller, I/O registers, timers, interrupts → the ROM boots | next |
| 3 | Display (131 × 64 LCD, annunciators) and keyboard | |
| 4 | Memory kept between visits, loading programs, speed control, translations | |

## Phase 1: the Saturn CPU

[src/saturn.js](src/saturn.js) implements the Saturn instruction set from its documentation (not from another
emulator's code: Emu48 and x48 are GPL):
- **Registers:** the 16-nibble registers A–D and R0–R4, D0/D1, P, ST/HST, the 8-level return stack, carry, and
  hex/decimal modes.
- **Fields:** all nine — P, WP, XS, X, S, M, B, W and A.
- **The rest of the machine is behind a bus:** memory, CONFIG/UNCNFG/C=ID, the keyboard lines and SHUTDN.

[src/disasm.js](src/disasm.js) is a disassembler written separately, sharing no decoding code with the CPU, so the
two can check each other.

### How it is checked
- **[tests/saturn.test.js](tests/saturn.test.js) (116 checks):** hand-assembled programs for every instruction
  family:
  - loads and the fields
  - hex and decimal arithmetic with their carry rules
  - negation, shifts and the sticky bit
  - copies, exchanges and logic
  - D0/D1 and memory transfers
  - P, ST and HST
  - every jump, call and return
  - tests with GOYES/RTNYES
  - the return stack's 8 levels
  - I/O, memory-controller hooks and interrupts
  - unknown opcodes

  A fuzz test then decodes 20,000 random instructions with both the CPU and the disassembler; they must agree on
  which are valid and on every straight-line instruction's length.
- **[tests/rom.test.js](tests/rom.test.js), on the real ROM:**
  - It checks the image (512 KB, "Version HP48-R").
  - It runs the reset code. All 1,255 instructions up to the first SHUTDN decode identically in the CPU and the
    disassembler.
  - On the way, the ROM configures its I/O registers at 00100 and two more memory modules, as a 48GX boots, then
    waits in SHUTDN for an interrupt, which needs the phase-2 timers.
  - It reads the ROM from `$HP48_ROM` (default: `Downloads/gxrom-r`) and is skipped when there is none, as on CI.
- **Mutation tests:** planted mistakes are all caught — GOSUB measured from the wrong place, no decimal mode, the
  P field one nibble too wide. The ROM run catches the GOSUB mistake by itself.

```bash
node hp48/tests/saturn.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/rom.test.js
```
