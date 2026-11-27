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
check("typing starts in alpha lock (a mode the Typist resolves, not a key)", keys("") === "@LOCK");
check("upper and lower case", keys("Ab") === "@LOCK A LS B");
check("ENTER at the end on request", keys("1", { enter: true }) === "@LOCK 1 ENTER");
check("a matched pair is typed as a person does: the pair key, then stepping over its partner",
  keys("(1)") === "@LOCK LS DIV 1 @FREE RIGHT @LOCK");
check("' opens with the quote key (algebraic entry), « with its pair key", keys("'X'") === "@LOCK @FREE QUOTE @LOCK X @FREE RIGHT @LOCK".replace(" X ", " INV ")
  && keys("«»") === "@LOCK LS SUB @FREE RIGHT @LOCK");
check("a lone opening bracket deletes the pair's other half", keys("(") === "@LOCK LS DIV DEL");
check("a lone closing bracket deletes the opening half and steps over", keys(")") === "@LOCK LS DIV BKSP @FREE RIGHT @LOCK");
check("inside a string, brackets are just characters", keys('"(') === "@LOCK RS SUB LS DIV DEL" && keys('"()"') === "@LOCK RS SUB LS DIV DEL LS DIV BKSP @FREE RIGHT @LOCK RS SUB");
check("\" is typed as the one character at both ends (in alpha mode its key doesn't make a pair)", keys('{"a"}') === "@LOCK LS ADD RS SUB LS A RS SUB @FREE RIGHT @LOCK");
check("nested pairs match innermost first", keys("{(1)}") === "@LOCK LS ADD LS DIV 1 @FREE RIGHT @LOCK @FREE RIGHT @LOCK");
check("comments are dropped outside strings, kept inside", keys("1 @two@ 3") === keys("1  3") && keys('"@"').indexOf("RS SUB") > 0 && Typer.plan('"@"').unsupported.join() === "@");
check("a comment runs to the end of the line", keys("1 @ two\n3") === keys("1  3"));
check("line breaks become spaces outside strings, stay inside", keys("1\n2") === keys("1 2") && keys('"\n"').indexOf("RS DOT") > 0);
check("^ is typed in a program and an algebraic", keys("«^»").indexOf("@FREE POW @LOCK") > 0 && keys("'^'").indexOf("@FREE POW @LOCK") > 0);
check("…but not at the top level of a string, where the key would run", Typer.plan('"^"').unsupported.join() === "^" && Typer.plan('«"^"»').unsupported.length === 0);
const u = Typer.plan("a&b;c€&");
check("characters with no key are listed once each and skipped", u.unsupported.join("") === "&;€" && u.keys.join(" ") === "@LOCK LS A LS B LS C");
check("every key the table uses exists", Object.values(Typer.KEYS).every((s) => s.split(" ").every((k) => Keys.byId[k] || k === "@LOCK" || k === "@FREE")));

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

// ---------------------------------------------------------------- the Typist resolves @LOCK / @FREE by the α annunciator
// a calculator whose α key goes off → one-shot → lock → off, and whose one-shot drops after one character;
// "flaky" makes the next α α give one-shot instead of lock, as the ROM sometimes does after a command
function alphaMachine(flaky) {
  const mm = { time: 0, mode: "off", flaky: flaky, typed: [], cpu: { shutdown: true },
    display() { return { annunciators: this.mode === "off" ? 0x80 : 0x84 }; },
    run(c) { this.time += c; },
    key(line, bit, down) {
      if (!down) return;
      const k = Object.values(Keys.byId).find((x) => x.line === line && x.bit === bit);
      if (k.id === "ALPHA") {
        if (this.mode === "off") this.mode = "one";
        else if (this.mode === "one") { if (this.flaky) { this.flaky--; } else this.mode = "lock"; }
        else this.mode = "off";
        return;
      }
      if (k.id === "LS" || k.id === "RS") { this.typed.push(k.id); return; }
      this.typed.push((this.mode === "off" ? "" : "α") + k.id);
      if (this.mode === "one") this.mode = "off";
    } };
  return mm;
}
const typeAll = (mm, text) => { const t = new Typer.Typist(mm, new Keys.Keypad(mm), Keys.byId, Typer.plan(text).keys); let n = 0; while (!t.advance(3686400) && n++ < 1000); return mm.typed.join(" "); };
check("@LOCK: every letter is typed in alpha", typeAll(alphaMachine(0), "ABC") === "αA αB αC");
check("…and when α α gives one-shot alpha, the Typist relocks before the next character", typeAll(alphaMachine(1), "ABC") === "αA αB αC");
check("…but never between a shift and its key", typeAll(alphaMachine(1), "Ab") === "αA LS αB");
check("@FREE presses α again when one α only turned one-shot into lock (the quote key must not type in alpha)",
  typeAll(alphaMachine(1), "'X'").split(" ").includes("QUOTE") && !typeAll(alphaMachine(1), "'X'").includes("αQUOTE"));
check("@FREE turns alpha off for ^ and back on after", typeAll(alphaMachine(0), "«A^B»").split(" ").filter((x) => /^α?(A|B|POW)$/.test(x)).join(" ") === "αA POW αB");

summary("typer");
