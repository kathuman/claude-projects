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
| 3 | Display (131 × 64 LCD, annunciators) and keyboard, in the browser | ✅ |
| 4 | Memory kept between visits, typing programs, saving to a file, Spanish and Danish | ✅ |
| 0.5 | Compact keyboard, the stack reader, a supply chain toolkit | ✅ |

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

## Phase 3: the calculator in the browser

[index.html](index.html) is the calculator. [src/app.js](src/app.js) runs the page:
- **The ROM:** you load your own file (button or drag and drop). [src/romfile.js](src/romfile.js) accepts a
  512 KB packed image or a 1 MB one-nibble-per-byte image, reads the revision, and explains why it refuses
  anything else: a 48S/SX ROM, a 49G ROM, a file of another size. The ROM is kept in this browser's IndexedDB
  so it is there on the next visit, and *Forget ROM* deletes it. It is never uploaded.
- **The display:**
  - the 131 × 64 LCD, drawn from the display registers, with the contrast the ROM sets
  - the six annunciators: shifts, α, battery, busy, transmitting
- **Running:** at the 48GX's own speed (3.69 MHz), 4× or as fast as the device can, with pause and restart.
  The emulator itself runs about 16 million instructions a second in Node, so real speed costs little.
- **The keyboard:** [src/keys.js](src/keys.js) has all 49 keys:
  - each key's place in the key matrix (OUT line, IN bit), from MAME's BSD-licensed driver (facts only)
  - the labels of what each key does: main, left-shifted, right-shifted and alpha
  - the computer keys that press it

  Click, touch or type. The drawing is this project's own, in the blueprint theme, with no HP marks.
- **Holding keys down long enough:** a click can be shorter than the ROM's keyboard scan, so the Keypad holds
  every key down for at least 60 ms of emulated time. Without it, quick clicks are lost: the keyboard test fails
  5 checks.

### How phase 3 is checked
- **[tests/keys.test.js](tests/keys.test.js) (26 checks, no ROM):**
  - the layout and matrix positions
  - the alpha letters A–Z, once each
  - the computer-key mapping
  - the Keypad's minimum hold, in emulated time
  - every ROM file layout, accepted or refused with its reason
- **[tests/keyboard.test.js](tests/keyboard.test.js) (28 checks, real ROM, local only):** pairs of key sequences
  that must leave identical screens, such as `2 ENTER 3 ×` and `6 ENTER`, `1 ENTER 2 ENTER ↰ ▶` (SWAP) and
  `2 ENTER 1 ENTER`, or `1 0 0 ↱ yˣ` (LOG) and `2 ENTER`. A key wired to the wrong matrix position breaks them.
  The test also checks that the shift and α annunciators light, that all 49 keys do something at the stack, and
  that ON cancels the command line.
- **The page in Chrome**, driven over the DevTools protocol:
  - the ROM loaded through the file input
  - NO pressed with F6, `1 ENTER 2 +` typed, `4 ×` clicked, giving 12
  - the shift annunciator lit
  - the ROM back from IndexedDB after a reload
- **Mutation tests:** planted mistakes are all caught — two keys on one position, SIN wired as COS, 8 wired as
  5, × wired as ÷, no minimum hold, an unpacked ROM packed high nibble first.

## Phase 4: memory, programs and languages

- **The calculator between visits.** `Machine.snapshot()` captures everything that changes: CPU registers, return
  stack, RAM, I/O, the memory map and the timers. It is plain JSON and names its ROM by checksum. The page saves it to
  IndexedDB every 5 seconds and when the page is hidden or closed. On the next visit it is restored, and
  `elapse(seconds)` advances the timers by the time away, as they count in a calculator that is switched off, so the
  clock stays right. *Save to file* and *Open a saved file* move a calculator between browsers. The file holds the
  memory, never the ROM.
- **Typing programs.** [src/typer.js](src/typer.js) turns text into key presses, so the calculator's own command line
  parses it. It accepts plain Unicode («, », →, π …) and HP's ASCII transfer format (`%%HP:` header, `\<<`, `\->`,
  `\171` …). `@` comments are dropped, and line breaks outside strings become spaces.
  - **Each character's keys were found by the ROM, not from a manual.** From a snapshot, every key was pressed inside a
    string, plain and shifted, in alpha lock. The resulting screen was matched against the one `n CHR` leaves for
    every character code n. That gave 114 characters, plus lower case.
  - **Pairs are typed as a person types them.** An opening bracket or quote with a partner presses the pair key,
    which also sets the entry mode the ROM expects (algebraic after `'`), and its partner is stepped over. Unbalanced
    halves use the pair less its other half.
  - **The typist waits for the ROM.** It holds each key 60 ms, then waits at least 250 ms and until the CPU is asleep
    before the next. Keys pressed sooner are not always read the same way: after yˣ in a program, α α gave one-shot
    alpha instead of alpha lock. 150 ms was the shortest wait that passed every check.
  - **Some characters have no key** (`&`, `;`, `@`, `\` …). The page says which were left out. Binary objects
    (`HPHP48-` files) need the serial port, which isn't emulated yet.
- **Languages:** English, Spanish (Latin America) and Danish, with the same i18n module as Escapement and Turbine Lab.
  The calculator's own key labels stay as printed on it.

### How phase 4 is checked
- **[tests/machine.test.js](tests/machine.test.js)** (now 62 checks): snapshot round trips, damaged or foreign
  snapshots refused, keys released on restore, the timers' arithmetic for time away.
- **[tests/typer.test.js](tests/typer.test.js) (25 checks, no ROM):**
  - decoding: Unicode, HP codes, `\nnn`, the header
  - planning: case, pairs, nesting, comments, line breaks, `^`, unsupported characters
  - the Typist's timing: the hold, the settle, waiting for a busy ROM, giving up after 5 s
- **[tests/typer-rom.test.js](tests/typer-rom.test.js) (15 checks, real ROM, local only):**
  - snapshots: a restored snapshot taken mid-entry carries on exactly as the original (screen, RAM and time). After
    `elapse(100)` the ROM's `TICKS` reads the same as after 100 s idling, and `elapse(101)` reads differently.
  - every character: each one typed into a string leaves the same screen as `n CHR`.
  - whole objects: programs, lists, vectors, complex numbers and algebraics, including `^`, equal typing them by hand.
    An HP ASCII file equals its Unicode text, and the typed program runs: `3 « → x 'x^2' » EVAL` leaves 9.
- **[tests/i18n.test.js](tests/i18n.test.js) (9 checks):** both dictionaries cover every page key and every message,
  with the same placeholders, and nothing left over.
- **In Chrome:**
  - the HP ASCII file was typed through the panel and run (9)
  - a reload carried the calculator on with an identical screen
  - *Save to file*, *Restart*, then *Open a saved file* brought the same screen back
  - the Spanish and Danish pages were checked
- **Mutation tests:** planted mistakes are all caught:
  - a snapshot that drops the return stack
  - time away that doesn't move timer 2, or moves it at half rate
  - a 20 ms settle
  - a typist that doesn't wait for the ROM to sleep, caught by the unit test only
  - θ typed as ε
  - closing brackets typed instead of stepped over
  - a missing Spanish message

## How it works: the Learn page

[learn.html](learn.html) explains the calculator from the chip up, for someone of about 18 with no electronics
background, in English, Spanish and Danish. It covers:
- nibbles, the registers and their fields
- fetch, decode, execute
- the memory controller and the bus
- the keyboard matrix and the screen
- sleep, timers and interrupts
- what the ROM holds, and how RPL runs as threaded code on three Saturn instructions
- how a real number is stored, and one key press from start to finish

It has two live parts:
- a small program you can step through, on the emulator's own `saturn.js` with a 256-nibble memory
- a box that shows how any number you type is stored, nibble by nibble

Its figures were measured or checked here rather than quoted:
- 90,000 instructions for one + press, counted in the emulator
- the RPL inner loop (`142 164 808C`), which appears 272 times in the revision R ROM
- every instruction encoding, taken from the disassembler

## 0.5: the supply chain toolkit and the stack reader

- **The keyboard** now uses compact legends: each key's shifted functions sit in its top corners and its alpha
  letter in its bottom corner, so keys are taller and easier to tap. On narrow screens the right-shift label drops
  to a second line.
- **The stack reader.** [src/stack.js](src/stack.js) reads the stack from the calculator's memory, so results can
  be shown as text, copied, exported as CSV and checked.
  - **Where the stack is:** the address of stack level 1 is kept at 806F8. I found it on the real ROM by putting
    known numbers on the stack and searching RAM for the pointer that leads to them; it was the only one. From
    there each level is a 5-nibble pointer, until a pointer of 0. Small numbers often point into ROM, where the
    firmware keeps constants such as 7, 8 and 9.
  - **Objects:**
    - each starts with its prolog's address, and every prolog's code starts with 028FC (also checked on the ROM)
    - reals are BCD: exponent, 12-digit mantissa, sign
    - strings, binary integers, names, complex numbers, tagged objects and lists are decoded
    - programs and algebraics are recognised
- **The supply chain toolkit.** [src/scm.js](src/scm.js) holds seven RPL programs and a JavaScript reference for
  each. *Install the programs* types them into a directory `SCM` and puts them on the menu keys:
  - EOQ, safety stock and reorder point
  - newsvendor: the inverse normal is found by Newton's method on the ROM's own `UTPN`
  - fill rate, with the normal loss function
  - Little's law
  - the bullwhip ratio, from two lists

  Each program has a form with its inputs in stack order. *Run on the calculator* types them, runs the program,
  reads the stack and compares each result with the reference to 12 digits. The programs are written for what
  the 48GX keyboard can type: `^.5` for √, and `« + » STREAM` for Σ.
- **Two typing fixes found on the ROM:**
  - In alpha mode the quote key types one `"`, not a pair. The earlier tests passed only because ENTER closes an
    unterminated string; inside a list the string swallowed the closing brace.
  - α α does not always lock alpha: after some commands it gives one-shot alpha. The Typist now resolves two plan
    words by watching the α annunciator. `@LOCK` presses α α when alpha is off, and again before any later
    character if alpha has dropped; a character typed with one-shot alpha is still right. `@FREE` presses α until
    the annunciator goes out.

### How 0.5 is checked
- **[tests/stack.test.js](tests/stack.test.js) (11 checks, no ROM):** objects encoded by hand on a synthetic memory
  (reals of every kind, strings, complex, binary, names, tagged results, nested lists with pointers), the empty
  stack, CSV.
- **[tests/scm.test.js](tests/scm.test.js) (16 checks, no ROM):**
  - the normal distribution and its inverse against known values
  - every reference formula
  - the install text, which must type every character
  - the checker
- **[tests/scm-rom.test.js](tests/scm-rom.test.js) (18 checks, real ROM):**
  - the reader on 15 kinds of objects the ROM itself put on the stack
  - installing the pack leaves the stack clean
  - every program's example, and a second set of inputs, agree with the reference to 12 digits, with nothing else
    left on the stack. The second set includes a newsvendor below 50% (a negative z) and the other cases of
    Little's law.
- **[tests/typer.test.js](tests/typer.test.js)** (now 31 checks) adds a simulated calculator whose α α sometimes
  gives one-shot alpha.
- **Mutation tests:** planted mistakes are all caught:
  - a wrong stack address, caught by the ROM test
  - the sign or the negative exponents of reals ignored
  - the wrong rule for recognising objects
  - EOQ without its factor 2, caught by the ROM test
  - a checker loose to 1e-3
  - the quote typed as a pair again
  - no relock when alpha drops, and @FREE without its retry: these two are caught by the unit tests only, because
    the real ROM runs no longer hit those cases
- **In Chrome:**
  - the pack installed with the button, in about 3 seconds
  - EOQ, NEWS and BULL run from their forms, each shown as agreeing with the reference
  - the stack panel shows the result
  - the page fits a 390 px phone

```bash
node hp48/tests/saturn.test.js
node hp48/tests/machine.test.js
node hp48/tests/keys.test.js
node hp48/tests/typer.test.js
node hp48/tests/stack.test.js
node hp48/tests/scm.test.js
node hp48/tests/i18n.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/boot.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/rom.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/keyboard.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/typer-rom.test.js
HP48_ROM=/path/to/gxrom-r node hp48/tests/scm-rom.test.js
```
