// The Saturn CPU, instruction family by instruction family — run with:
//   node hp48/tests/saturn.test.js
// Programs are written as nibble strings in memory order (constants, offsets
// and addresses are least significant nibble first, as the CPU reads them).
const Saturn = require("../src/saturn.js");
const disasm = require("../src/disasm.js");
const { check, summary } = require("./harness.js");

function machine(prog, at) {
  const mem = new Uint8Array(0x100000), calls = { config: [], unconfig: [], out: [], shutdown: 0 };
  const bus = {
    read: (a) => mem[a], write: (a, v) => { mem[a] = v & 15; },
    config: (a) => calls.config.push(a), unconfig: (a) => calls.unconfig.push(a),
    id: () => 0x12345, reset: () => {}, out: (v) => calls.out.push(v), in: () => 0xbeef, shutdown: () => { calls.shutdown++; }
  };
  const cpu = new Saturn(bus);
  cpu.PC = at || 0;
  load(mem, prog, cpu.PC);
  return { cpu, mem, calls };
}
function load(mem, prog, at) { const s = prog.replace(/\s+/g, ""); for (let i = 0; i < s.length; i++) mem[at + i] = parseInt(s[i], 16); }
// run n instructions
function run(m, n) { for (let i = 0; i < n; i++) m.cpu.step(); return m.cpu; }
// a register as a hex string, most significant nibble first
const hx = (r) => Array.from(r).reverse().map((v) => v.toString(16)).join("");
const set = (r, s) => { s = s.padStart(16, "0"); for (let i = 0; i < 16; i++) r[i] = parseInt(s[15 - i], 16); };

// ---------------------------------------------------------------- loads and fields
{
  let m = machine("23 334321");         // P=3; LC(4) #1234 → nibbles 3..6
  run(m, 2);
  check("LC loads at P, least significant first", hx(m.cpu.C) === "0000000001234000", hx(m.cpu.C));
  m = machine("2E 32543");              // P=14; LC(3) #345 wraps: nibbles 14, 15, 0
  run(m, 2);
  check("LC wraps past nibble 15", hx(m.cpu.C) === "4500000000000003", hx(m.cpu.C));
  m = machine("20 80821BA");            // P=0; LA(2) #AB
  run(m, 2);
  check("LA loads A", hx(m.cpu.A) === "00000000000000ab", hx(m.cpu.A));
  // A=0 over each field, P = 5
  const fields = { 0: "ffffffffff0fffff", 1: "ffffffffff000000", 2: "fffffffffffff0ff", 3: "fffffffffffff000", 4: "0fffffffffffffff", 5: "f000000000000fff", 6: "ffffffffffffff00", 7: "0000000000000000" };
  for (const f in fields) {
    m = machine("25 A" + (8 + Number(f)).toString(16) + "0"); set(m.cpu.A, "ffffffffffffffff"); run(m, 2);
    check("A=0 over field " + Saturn.FIELD_NAMES[f], hx(m.cpu.A) === fields[f], hx(m.cpu.A));
  }
  m = machine("D0"); set(m.cpu.A, "ffffffffffffffff"); run(m, 1);
  check("A=0 A clears nibbles 0–4", hx(m.cpu.A) === "fffffffffff00000");
}

// ---------------------------------------------------------------- arithmetic: hex and decimal, carry
{
  let m = machine("C0"); set(m.cpu.A, "fffff"); set(m.cpu.B, "1"); run(m, 1);
  check("A=A+B A wraps with carry (hex)", hx(m.cpu.A).slice(-5) === "00000" && m.cpu.carry);
  m = machine("05 A6 0"); set(m.cpu.A, "99"); set(m.cpu.B, "01"); run(m, 2);   // SETDEC; A=A+B B
  check("A=A+B B in decimal: 99 + 1 = 00, carry", hx(m.cpu.A).slice(-2) === "00" && m.cpu.carry, hx(m.cpu.A));
  m = machine("05 A6 0"); set(m.cpu.A, "45"); set(m.cpu.B, "38"); run(m, 2);
  check("decimal add 45 + 38 = 83, no carry", hx(m.cpu.A).slice(-2) === "83" && !m.cpu.carry, hx(m.cpu.A));
  m = machine("E0"); set(m.cpu.A, "3"); set(m.cpu.B, "5"); run(m, 1);
  check("A=A-B A borrows: 3 − 5 = FFFFE, carry", hx(m.cpu.A).slice(-5) === "ffffe" && m.cpu.carry);
  m = machine("05 E0"); set(m.cpu.A, "3"); set(m.cpu.B, "5"); run(m, 2);
  check("decimal 3 − 5 = 99998, carry", hx(m.cpu.A).slice(-5) === "99998" && m.cpu.carry, hx(m.cpu.A));
  m = machine("E4"); set(m.cpu.A, "fffff"); run(m, 1);
  check("A=A+1 A overflows with carry", hx(m.cpu.A).slice(-5) === "00000" && m.cpu.carry);
  m = machine("CC"); run(m, 1);
  check("A=A-1 A from 0 borrows", hx(m.cpu.A).slice(-5) === "fffff" && m.cpu.carry);
  m = machine("EC"); set(m.cpu.A, "2"); set(m.cpu.B, "7"); run(m, 1);
  check("A=B-A: 7 − 2 = 5", hx(m.cpu.A).slice(-5) === "00005" && !m.cpu.carry);
  m = machine("F8"); set(m.cpu.A, "1"); run(m, 1);
  check("A=-A: 2's complement, carry set (field was non-zero)", hx(m.cpu.A).slice(-5) === "fffff" && m.cpu.carry);
  m = machine("F8"); m.cpu.carry = true; run(m, 1);
  check("A=-A of zero: zero, carry clear", hx(m.cpu.A).slice(-5) === "00000" && !m.cpu.carry);
  m = machine("05 F8"); set(m.cpu.A, "1"); run(m, 2);
  check("decimal A=-A: 10's complement 99999", hx(m.cpu.A).slice(-5) === "99999");
  m = machine("FC"); set(m.cpu.A, "12345"); m.cpu.carry = true; run(m, 1);
  check("A=-A-1: 1's complement, carry clear", hx(m.cpu.A).slice(-5) === "edcba" && !m.cpu.carry);
  m = machine("05 818F01"); set(m.cpu.A, "9"); run(m, 2);   // DEC; A=A+CON A,2
  check("A=A+CON adds in hex even in DEC mode: 9 + 2 = B", hx(m.cpu.A).slice(-5) === "0000b", hx(m.cpu.A));
  m = machine("818F84"); set(m.cpu.A, "3"); run(m, 1);      // A=A-CON A,5
  check("A=A-CON A,5: 3 − 5 = FFFFE, carry", hx(m.cpu.A).slice(-5) === "ffffe" && m.cpu.carry);
  m = machine("23 809"); run(m, 2);                         // P=3; C+P+1
  check("C+P+1 adds P + 1 to C.A", hx(m.cpu.C).slice(-5) === "00004");
}

// ---------------------------------------------------------------- copies, exchanges, logic
{
  let m = machine("D4 DE"); set(m.cpu.A, "1"); set(m.cpu.B, "abcdef0123"); set(m.cpu.C, "77"); run(m, 2);   // A=B A; CAEX A
  check("A=B A copies 5 nibbles; CAEX A swaps", hx(m.cpu.A).slice(-5) === "00077" && hx(m.cpu.C).slice(-5) === "f0123");
  m = machine("0E 7 0 0E 7 4"); set(m.cpu.A, "f0f0"); set(m.cpu.B, "ff00"); run(m, 1);
  check("A=A&B W", hx(m.cpu.A).slice(-4) === "f000");
  set(m.cpu.A, "f0f0"); run(m, 1);
  check("A=A!B W", hx(m.cpu.A).slice(-4) === "fff0");
  m = machine("102 112 129 81A1 1 0"); set(m.cpu.A, "123"); set(m.cpu.C, "456"); run(m, 2);   // R2=A; A=R2
  check("R2=A then A=R2", hx(m.cpu.R[2]).slice(-3) === "123" && hx(m.cpu.A).slice(-3) === "123");
  run(m, 1); check("CR1EX", hx(m.cpu.C).slice(-3) === "000" && hx(m.cpu.R[1]).slice(-3) === "456");
  m = machine("81A6 0 3"); set(m.cpu.A, "ab"); run(m, 1);   // R3=A B
  check("R3=A B (81A, field)", hx(m.cpu.R[3]).slice(-2) === "ab");
}

// ---------------------------------------------------------------- shifts and the sticky bit
{
  let m = machine("F0"); set(m.cpu.A, "12345"); run(m, 1);
  check("ASL A", hx(m.cpu.A).slice(-5) === "23450");
  m = machine("F4"); set(m.cpu.A, "12345"); run(m, 1);
  check("ASR A shifts right and sets SB (5 shifted out)", hx(m.cpu.A).slice(-5) === "01234" && (m.cpu.HST & 2));
  m = machine("F4"); set(m.cpu.A, "12340"); run(m, 1);
  check("ASR A: a zero shifted out leaves SB clear", !(m.cpu.HST & 2));
  m = machine("810 814"); set(m.cpu.A, "f000000000000001"); run(m, 1);
  check("ASLC rotates the whole register left", hx(m.cpu.A) === "000000000000001f");
  run(m, 1); check("ASRC rotates back, SB set (f rotated out)", hx(m.cpu.A) === "f000000000000001" && (m.cpu.HST & 2));
  m = machine("81C"); set(m.cpu.A, "3"); run(m, 1);
  check("ASRB: bit shift right, 1 out sets SB", hx(m.cpu.A).slice(-1) === "1" && (m.cpu.HST & 2));
  m = machine("8196 0"); set(m.cpu.A, "1f0"); run(m, 1);   // ASRB.B
  check("ASRB.B shifts within the B field (F0 → 78), nibble 2 untouched", hx(m.cpu.A).slice(-3) === "178", hx(m.cpu.A));
}

// ---------------------------------------------------------------- pointers, D0/D1 and memory
{
  let m = machine("1B54321 1D BA 1EFEDC 1F00001");
  run(m, 1); check("D0=(5)", m.cpu.D0 === 0x12345);
  run(m, 1); check("D1=(2) sets the low 2 nibbles", m.cpu.D1 === 0xab);
  run(m, 1); check("D1=(4) sets the low 4 nibbles", m.cpu.D1 === 0xcdef);
  run(m, 1); check("D1=(5)", m.cpu.D1 === 0x10000);
  m = machine("1BFFFFF 160 160");
  run(m, 2); check("D0=D0+1 wraps past FFFFF with carry", m.cpu.D0 === 0 && m.cpu.carry);
  run(m, 1); check("…and clears carry next time", m.cpu.D0 === 1 && !m.cpu.carry);
  m = machine("180"); run(m, 1); check("D0=D0-1 from 0 borrows", m.cpu.D0 === 0xfffff && m.cpu.carry);
  m = machine("132"); set(m.cpu.A, "abcde"); m.cpu.D0 = 0x11111; run(m, 1);
  check("AD0EX", m.cpu.D0 === 0xabcde && hx(m.cpu.A).slice(-5) === "11111");
  m = machine("138"); set(m.cpu.A, "abcde"); m.cpu.D0 = 0x11111; run(m, 1);
  check("D0=AS: low 4 nibbles only", m.cpu.D0 === 0x1bcde);
  m = machine("1B00002 140 1B00002 112 142");                // D0=20000; DAT0=A A; then A=DAT0 A
  set(m.cpu.A, "fedcba9876543210");
  run(m, 2);
  check("DAT0=A A writes nibbles 0–4 at D0, low first", Array.from(m.mem.slice(0x20000, 0x20006)).join(",") === "0,1,2,3,4,0");
  set(m.cpu.A, "0"); run(m, 3);
  check("A=DAT0 A reads them back", hx(m.cpu.A).slice(-5) === "43210");
  m = machine("1B00003 1502 1B00003 1522");                  // DAT0=A XS; A=DAT0 XS
  set(m.cpu.A, "f00"); run(m, 2);
  check("DAT0=A XS stores nibble 2 at D0 itself", m.mem[0x30000] === 15 && m.mem[0x30001] === 0);
  set(m.cpu.A, "0"); run(m, 2);
  check("A=DAT0 XS reads it into nibble 2", hx(m.cpu.A).slice(-3) === "f00");
  m = machine("1B00004 15C6");                                // DAT0=C 7 (count form)
  set(m.cpu.C, "7654321"); run(m, 2);
  check("DAT0=C 7 (count) writes 7 nibbles", Array.from(m.mem.slice(0x40000, 0x40008)).join("") === "12345670");
  m = machine("14A"); m.cpu.D0 = 0x50000; m.mem[0x50000] = 9; m.mem[0x50001] = 8; run(m, 1);
  check("A=DAT0 B", hx(m.cpu.A).slice(-2) === "89");
}

// ---------------------------------------------------------------- P, ST and HST
{
  let m = machine("2F 0C"); run(m, 2);
  check("P=P+1 wraps 15 → 0 with carry", m.cpu.P === 0 && m.cpu.carry);
  m = machine("0D"); run(m, 1); check("P=P-1 wraps 0 → 15 with carry", m.cpu.P === 15 && m.cpu.carry);
  m = machine("27 80C3 80D3"); run(m, 2);
  check("C=P 3", m.cpu.C[3] === 7);
  m.cpu.C[3] = 9; run(m, 1); check("P=C 3", m.cpu.P === 9);
  m = machine("80F0"); m.cpu.P = 4; m.cpu.C[0] = 11; run(m, 1);
  check("CPEX 0", m.cpu.P === 11 && m.cpu.C[0] === 4);
  m = machine("85F 85C 08"); run(m, 3);
  check("CLRST clears ST 0–11, keeps 12–15", m.cpu.ST === 0x9000, m.cpu.ST.toString(16));
  m = machine("09 0A 0B"); m.cpu.ST = 0xfabc; run(m, 1);
  check("C=ST copies ST 0–11 into C.X", hx(m.cpu.C).slice(-3) === "abc");
  set(m.cpu.C, "123"); run(m, 1); check("ST=C", m.cpu.ST === 0xf123);
  set(m.cpu.C, "777"); run(m, 1); check("CSTEX", m.cpu.ST === 0xf777 && hx(m.cpu.C).slice(-3) === "123");
  m = machine("82F"); m.cpu.HST = 15; run(m, 1); check("CLRHST", m.cpu.HST === 0);
  m = machine("822"); m.cpu.HST = 15; run(m, 1); check("SB=0 clears only the sticky bit", m.cpu.HST === 13);
}

// ---------------------------------------------------------------- jumps, calls, returns
{
  let m = machine("6 F00"); run(m, 1);
  check("GOTO: relative to the offset field (0 + 1 + 0x00F = 0x10)", m.cpu.PC === 0x10, m.cpu.PC.toString(16));
  m = machine("7 C00"); run(m, 1);
  check("GOSUB: relative to the next instruction (4 + 0xC = 0x10), return address 4", m.cpu.PC === 0x10 && m.cpu.RSTK[0] === 4);
  m = machine("7 FFF"); m.cpu.PC = 0x100; load(m.mem, "7 FFF", 0x100); run(m, 1);
  check("GOSUB −1", m.cpu.PC === 0x103);
  m = machine("8C 0001"); run(m, 1);
  check("GOLONG: relative to the offset field (2 + 0x1000)", m.cpu.PC === 0x1002, m.cpu.PC.toString(16));
  m = machine("8E 0100"); run(m, 1);
  check("GOSUBL: relative to the next instruction (6 + 0x10), returns to 6", m.cpu.PC === 0x16 && m.cpu.RSTK[0] === 6);
  m = machine("8D 54321"); run(m, 1); check("GOVLNG", m.cpu.PC === 0x12345);
  m = machine("8F 54321"); run(m, 1); check("GOSBVL pushes 7", m.cpu.PC === 0x12345 && m.cpu.RSTK[0] === 7);
  m = machine("01"); m.cpu.RSTK = [0x222]; run(m, 1); check("RTN", m.cpu.PC === 0x222 && m.cpu.RSTK.length === 0);
  m = machine("02"); m.cpu.RSTK = [0x10]; run(m, 1); check("RTNSC sets carry", m.cpu.carry && m.cpu.PC === 0x10);
  m = machine("00"); m.cpu.RSTK = [0x10]; run(m, 1); check("RTNSXM sets XM", (m.cpu.HST & 1) === 1);
  m = machine("4 01"); m.cpu.carry = true; run(m, 1); check("GOC taken: relative to the offset field", m.cpu.PC === 0x11);
  m = machine("4 01"); run(m, 1); check("GOC not taken", m.cpu.PC === 3);
  m = machine("5 00"); m.cpu.RSTK = [0x40]; run(m, 1); check("RTNNC (GONC 00) returns when carry clear", m.cpu.PC === 0x40);
  m = machine("4 00"); m.cpu.RSTK = [0x40]; run(m, 1); check("RTNC doesn't return when carry clear", m.cpu.PC === 3 && m.cpu.RSTK.length === 1);
  m = machine("81B2"); set(m.cpu.A, "abcde"); run(m, 1); check("PC=A", m.cpu.PC === 0xabcde);
  m = machine("81B4"); run(m, 1); check("A=PC holds the next instruction's address", hx(m.cpu.A).slice(-5) === "00004");
  m = machine("81B6"); set(m.cpu.A, "00100"); run(m, 1); check("APCEX", m.cpu.PC === 0x100 && hx(m.cpu.A).slice(-5) === "00004");
  m = machine("808C"); set(m.cpu.A, "00200"); load(m.mem, "54321", 0x200); run(m, 1); check("PC=(A) reads a 5-nibble address", m.cpu.PC === 0x12345);
  // the return stack keeps 8 levels: the oldest is lost
  m = machine(""); for (let i = 1; i <= 9; i++) m.cpu.push(i);
  check("RSTK: 8 levels, the oldest dropped", m.cpu.RSTK.length === 8 && m.cpu.RSTK[0] === 2);
  for (let i = 0; i < 8; i++) m.cpu.pop();
  check("RSTK: popping empty gives 0", m.cpu.pop() === 0);
  m = machine("06 07"); set(m.cpu.C, "abcdef"); run(m, 1); set(m.cpu.C, "0"); run(m, 1);
  check("RSTK=C / C=RSTK move C.A only", hx(m.cpu.C) === "00000000000bcdef");
}

// ---------------------------------------------------------------- tests with GOYES / RTNYES
{
  let m = machine("8A0 10"); set(m.cpu.A, "5"); set(m.cpu.B, "5"); run(m, 1);
  check("?A=B A true → GOYES relative to its field (3 + 1)", m.cpu.carry && m.cpu.PC === 4);
  m = machine("8A0 10"); set(m.cpu.B, "5"); run(m, 1);
  check("?A=B A false → falls through", !m.cpu.carry && m.cpu.PC === 5);
  m = machine("8A8 00"); m.cpu.RSTK = [0x99]; run(m, 1);
  check("?A=0 A RTNYES returns", m.cpu.PC === 0x99);
  m = machine("9E0 00"); m.cpu.RSTK = [0x99]; set(m.cpu.A, "5"); set(m.cpu.B, "1"); run(m, 1);   // ?A>B B (9, field 8+6)
  check("?A>B B with 9-family field codes", m.cpu.carry);
  m = machine("8B4 00"); set(m.cpu.A, "1"); set(m.cpu.B, "2"); m.cpu.RSTK = [1]; run(m, 1);
  check("?A<B A", m.cpu.carry);
  m = machine("8BC 00"); set(m.cpu.A, "2"); set(m.cpu.B, "2"); m.cpu.RSTK = [1]; run(m, 1);
  check("?A<=B A on equal", m.cpu.carry);
  m = machine("897 00"); m.cpu.P = 7; m.cpu.RSTK = [1]; run(m, 1); check("?P= 7", m.cpu.carry);
  m = machine("873 00"); m.cpu.ST = 8; m.cpu.RSTK = [1]; run(m, 1); check("?ST=1 3", m.cpu.carry);
  m = machine("832 00"); m.cpu.HST = 2; m.cpu.RSTK = [1]; run(m, 1); check("?SB=0 false when SB set", !m.cpu.carry);
  m = machine("80875 00"); set(m.cpu.A, "20"); m.cpu.RSTK = [1]; run(m, 1); check("?ABIT=1 5", m.cpu.carry);
  m = machine("80849 80859"); set(m.cpu.A, "ffff"); run(m, 1);
  check("ABIT=0 9", hx(m.cpu.A).slice(-4) === "fdff");
  run(m, 1); check("ABIT=1 9", hx(m.cpu.A).slice(-4) === "ffff");
}

// ---------------------------------------------------------------- I/O, MMU hooks and interrupts
{
  let m = machine("801 803 805 806 804 807"); set(m.cpu.C, "abc"); run(m, 1);
  check("OUT=C sends 12 bits to the bus", m.calls.out[0] === 0xabc);
  run(m, 1); check("C=IN reads 16 bits", hx(m.cpu.C).slice(-4) === "beef");
  set(m.cpu.C, "80000"); run(m, 1); check("CONFIG passes C.A to the bus", m.calls.config[0] === 0x80000);
  run(m, 1); check("C=ID reads the bus's id", hx(m.cpu.C).slice(-5) === "12345");
  run(m, 1); check("UNCNFG", m.calls.unconfig[0] === 0x12345);
  run(m, 1); check("SHUTDN halts until an interrupt", m.cpu.shutdown && m.calls.shutdown === 1 && m.cpu.step() === 0);
  m.cpu.interrupt(); check("an interrupt wakes it (interrupts still off → pending)", !m.cpu.shutdown && m.cpu.intPending);
  m = machine("8080"); m.cpu.intPending = true; m.cpu.PC = 0x500; load(m.mem, "8080", 0x500); run(m, 1);
  check("INTON with an interrupt pending: taken at once → 0000F", m.cpu.PC === 0xf && m.cpu.RSTK[0] === 0x504 && m.cpu.inInterrupt);
  load(m.mem, "0F", 0xf); run(m, 1);
  check("RTI returns and ends the interrupt", m.cpu.PC === 0x504 && !m.cpu.inInterrupt);
  m.cpu.interrupt(); m.cpu.interrupt();
  check("no nested interrupts", m.cpu.RSTK.length === 1);
}

// ---------------------------------------------------------------- unknown opcodes
{
  ["105", "81B0", "0E08", "81A030", "125"].forEach((p) => {
    const m = machine(p); let threw = false; try { m.cpu.step(); } catch (e) { threw = true; }
    check("unknown opcode " + p + " is refused", threw);
  });
}

// ---------------------------------------------------------------- CPU and disassembler agree on every encoding
{
  let s = 20260126; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
  let agree = 0, lenBad = 0, validBad = 0;
  const JUMPY = /^(GO|RTN|RTI|PC=|APCEX|CPCEX|NOP3)|GOYES|RTNYES/;
  for (let t = 0; t < 20000; t++) {
    const m = machine("");
    for (let i = 0; i < 24; i++) m.mem[0x1000 + i] = Math.floor(rnd() * 16);
    m.cpu.PC = 0x1000; m.cpu.RSTK = [0x7777];
    const d = disasm((a) => m.mem[a], 0x1000);
    let threw = false; try { m.cpu.step(); } catch (e) { threw = true; }
    if (threw !== !d.valid) { validBad++; if (validBad < 4) console.log("  valid mismatch: " + d.text + " threw " + threw + " " + Array.from(m.mem.slice(0x1000, 0x1008)).map((x) => x.toString(16)).join("")); continue; }
    if (threw || m.cpu.shutdown) continue;
    if (!JUMPY.test(d.text) && m.cpu.PC !== 0x1000 + d.len) { lenBad++; if (lenBad < 4) console.log("  length mismatch: " + d.text + " " + d.len + " vs " + (m.cpu.PC - 0x1000)); }
    else agree++;
  }
  check("20,000 random instructions: CPU and disassembler agree on what is valid", validBad === 0, validBad);
  check("…and on every straight-line instruction's length (" + agree + " compared)", lenBad === 0, lenBad);
}

summary("saturn");
