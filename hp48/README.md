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
| 2 | Memory controller, I/O registers, timers, interrupts → the ROM boots | ✅ |
| 3 | Display (131 × 64 LCD, annunciators) and keyboard, in the browser | next |
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
- **[tests/saturn.test.js](tests/saturn.test.js) (118 checks):** hand-assembled programs for every instruction
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

## Phase 2: the machine — the ROM boots

[src/machine.js](src/machine.js) is the CPU's bus. It brings together:

- **The memory controller:**
  - five configurable modules in a daisy chain: I/O block, 128 KB RAM, bank switcher, port 1, port 2
  - the ROM below them all
  - C=ID, CONFIG and UNCNFG following the documented protocol
  - priority where modules overlap, and mirroring when a window is larger than its memory
  - the A19 bit for the upper half of the ROM, and the bank switcher
- **The 64 I/O registers:**
  - display: on, bit offset, contrast, start address, line offset, line count, menu address
  - annunciators
  - the CRC
  - timer controls
  - the keyboard service request
- **The two timers:** timer 1 is 4 bits at 16 Hz and timer 2 is 32 bits at 8192 Hz. When one passes zero it raises
  a service request, wakes the CPU and raises an interrupt INTOFF can't block.
- **The keyboard lines:** OUT selects lines and IN reads rows, with ON on IN bit 15.
- **Time while asleep:** while the CPU sleeps in SHUTDN, time still passes for the timers.

The hardware facts come from public documentation and MAME's BSD-licensed HP 48 driver, read for the facts only,
with no code taken.

### What the ROM showed

Two of my beliefs were wrong, and only the real firmware could show it:

- **The logical opcodes.** `0E f o` has 16 operations: 0–7 are AND and 8–F are OR, over the pairs A&B, B&C, C&A,
  D&C, B&A, C&B, A&C and C&D. I had half of them as OR and the rest as invalid, and the CPU, the disassembler
  and a unit test all shared that belief. The ROM stopped on `0E68` (`A=A!B B`), where the surrounding code only
  makes sense with the right table.
- **The CRC counts data reads only.** The ROM stores its clock with a checksum, and checks it with different code.
  If instruction fetches update the CRC, the two can never agree, so the ROM decided the clock was corrupt and
  restarted forever, a few times a second.

### The boot

With both fixed, the real 48GX ROM:
- configures its I/O at 00100 and its RAM at 80000
- probes the ports for cards
- switches the display on
- shows **"Try To Recover Memory?"** with YES and NO, as a real 48GX does when memory is lost

NO (the menu key at OUT line 8, IN bit 0) clears memory and shows **"Memory Clear"**, the stack (4: … 1:) and the
menu labels, then idles in the main loop. YES (line 1, bit 4) starts recovering memory instead.

### How phase 2 is checked
- **[tests/machine.test.js](tests/machine.test.js) (53 checks, synthetic ROM):**
  - the configuration protocol step by step
  - priority, mirroring, RAM over ROM, UNCNFG and RESET, the A19 bit
  - the bank switcher and port 2
  - the CRC rule
  - timer rates, carries, wake and interrupts
  - the keyboard lines, ON and interrupts
  - time passing while asleep
  - the display registers and pixel layout
- **[tests/boot.test.js](tests/boot.test.js) (real ROM, local only):** the cold start and the NO and YES paths.
  Screens are compared by hash, so no picture of the firmware's output is stored.
- **Mutation tests:** planted mistakes are all caught — instruction fetches counting in the CRC, a wrong module
  ID, timer 1 at twice its rate. The boot test catches the CRC mistake by itself.

```bash
node hp48/tests/saturn.test.js
node hp48/tests/machine.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/boot.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/rom.test.js
```
