// The typer without a ROM: decoding text, planning key presses, and the Typist's timing.
const Typer = require("../src/typer.js");
const Keys = require("../src/keys.js");
const { check, summary } = require("./harness.js");

const codes = (t) => Typer.decode(t).map((c) => c.code);
const keys = (t, o) => Typer.plan(t, o).keys.join(" ");

// ---------------------------------------------------------------- decoding
check("plain ASCII is its own code", codes("A1+").join() === "65,49,43");
check("Unicode « » → π ∠ map to the 48's character set", codes("«»→π∠").join() === "171,187,141,135,128");
check("HP's codes: \\<< \\>> \\-> \\pi \\<) \\oo", codes("\\<<\\>>\\->\\pi\\<)\\oo").join() === "171,187,141,135,128,159");
check("decimal codes \\171 and a doubled backslash", codes("\\171\\\\").join() === "171,92");
check("the %%HP header is dropped, CRLF becomes LF", codes("%%HP: T(3)A(D)F(.);\r\n1").join() === "10,49");
check("characters the 48 doesn't have are marked", codes("€").join() === "-1");

// ---------------------------------------------------------------- planning
check("typing starts in alpha lock", keys("") === "ALPHA ALPHA");
check("upper and lower case", keys("Ab") === "ALPHA ALPHA A LS B");
check("ENTER at the end on request", keys("1", { enter: true }) === "ALPHA ALPHA 1 ENTER");
check("a matched pair is typed as a person does: the pair key, then stepping over its partner",
  keys("(1)") === "ALPHA ALPHA LS DIV 1 ALPHA RIGHT ALPHA ALPHA");
check("' opens with the quote key (algebraic entry), « with its pair key", keys("'X'") === "ALPHA ALPHA ALPHA QUOTE ALPHA ALPHA X ALPHA RIGHT ALPHA ALPHA".replace(" X ", " INV ")
  && keys("«»") === "ALPHA ALPHA LS SUB ALPHA RIGHT ALPHA ALPHA");
check("a lone opening bracket deletes the pair's other half", keys("(") === "ALPHA ALPHA LS DIV DEL");
check("a lone closing bracket deletes the opening half and steps over", keys(")") === "ALPHA ALPHA LS DIV BKSP ALPHA RIGHT ALPHA ALPHA");
check("inside a string, brackets are just characters", keys('"(') === "ALPHA ALPHA RS SUB DEL LS DIV DEL" && keys('"()"') === "ALPHA ALPHA RS SUB LS DIV DEL LS DIV BKSP ALPHA RIGHT ALPHA ALPHA ALPHA RIGHT ALPHA ALPHA");
check("nested pairs match innermost first", keys("{(1)}") === "ALPHA ALPHA LS ADD LS DIV 1 ALPHA RIGHT ALPHA ALPHA ALPHA RIGHT ALPHA ALPHA");
check("comments are dropped outside strings, kept inside", keys("1 @two@ 3") === keys("1  3") && keys('"@"').indexOf("RS SUB") > 0 && Typer.plan('"@"').unsupported.join() === "@");
check("a comment runs to the end of the line", keys("1 @ two\n3") === keys("1  3"));
check("line breaks become spaces outside strings, stay inside", keys("1\n2") === keys("1 2") && keys('"\n"').indexOf("RS DOT") > 0);
check("^ is typed in a program and an algebraic", keys("«^»").indexOf("ALPHA POW ALPHA ALPHA") > 0 && keys("'^'").indexOf("ALPHA POW ALPHA ALPHA") > 0);
check("…but not at the top level of a string, where the key would run", Typer.plan('"^"').unsupported.join() === "^" && Typer.plan('«"^"»').unsupported.length === 0);
const u = Typer.plan("a&b;c€&");
check("characters with no key are listed once each and skipped", u.unsupported.join("") === "&;€" && u.keys.join(" ") === "ALPHA ALPHA LS A LS B LS C");
check("every key the table uses exists", Object.values(Typer.KEYS).every((s) => s.split(" ").every((k) => Keys.byId[k])));

// ---------------------------------------------------------------- the Typist waits for the ROM
function machine() {
  // asleep unless "busy" until a given time; run() just moves time on
  return { time: 0, busyUntil: 0, log: [], cpu: { get shutdown() { return m.time >= m.busyUntil; } },
    run(c) { this.time += c; }, key(line, bit, down) { this.log.push(line + ":" + bit + (down ? "+" : "-") + "@" + Math.round(this.time / 3686.4)); } };
}
let m = machine();
{
  const pad = new Keys.Keypad(m), t = new Typer.Typist(m, pad, Keys.byId, ["1", "2"]);
  let n = 0; while (!t.advance(3686400 / 100) && n++ < 1000);
  check("each key is held 60 ms, then the next waits 250 ms after the release", m.log.join(" ") === "1:3+@0 1:3-@60 1:2+@310 1:2-@370", m.log.join(" "));
}
m = machine();
{
  const pad = new Keys.Keypad(m), t = new Typer.Typist(m, pad, Keys.byId, ["1", "2"]);
  m.busyUntil = 3686400 * 0.8;                      // the ROM is busy for 0.8 s after the first key
  let n = 0; while (!t.advance(3686400 / 100) && n++ < 1000);
  const second = +m.log[2].split("@")[1];
  check("…and longer while the ROM is busy: the next key waits for it to sleep", second >= 800 && second <= 802, m.log.join(" "));
}
m = machine();
{
  const pad = new Keys.Keypad(m), t = new Typer.Typist(m, pad, Keys.byId, ["1", "2"]);
  m.busyUntil = Infinity;
  let n = 0; while (!t.advance(3686400 / 10) && n++ < 1000);
  check("a ROM that never settles is given 5 s, then typing goes on", +m.log[2].split("@")[1] >= 5060 && t.progress() === 1, m.log.join(" "));
}

summary("typer");
