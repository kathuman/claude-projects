// Streaming to GRBL, against a fake GRBL that behaves like the real one where it matters: a 128-byte receive buffer
// (overflowing it is a failure), a 15-block planner, "ok" when a line is taken, M0 that waits in Hold for cycle start
// and is answered only then, feed hold, cycle start, soft reset, and status reports with WPos, Bf and Pn.
import { describe, expect, it } from "vitest";
import { DEFAULT_MACHINE } from "../src/machine/config";
import { program, resumeProgram } from "../src/machine/gcode";
import { clean, parseStatus, Streamer, type StreamEvent } from "../src/machine/grbl";
import { planToolpath } from "../src/machine/toolpath";
import { randomSeq, readBack } from "./gcode-reader";

class FakeGrbl {
  rx = "";
  planner: string[] = [];
  readonly plannerSize = 15;
  state: "Idle" | "Run" | "Hold" = "Idle";
  waitingM0 = false;
  pos = { X: 0, Y: 0, Z: 18 };
  executed: string[] = [];
  out: string[] = [];
  overflow = false;
  holdPin = false;
  resets = 0;

  write(s: string): void {
    for (const ch of s) {
      if (ch === "?") this.out.push(this.report());
      else if (ch === "!") this.state = "Hold";
      else if (ch === "~") {
        if (this.state === "Hold") {
          this.state = this.planner.length ? "Run" : "Idle";
          if (this.waitingM0) { this.waitingM0 = false; this.out.push("ok"); }
        }
      } else if (ch === "\x18") {
        this.rx = ""; this.planner = []; this.state = "Idle"; this.waitingM0 = false; this.resets++;
        this.out.push("Grbl 1.1h ['$' for help]");
      } else if (ch.charCodeAt(0) >= 0x80) { /* overrides: ignored */ }
      else { this.rx += ch; if (this.rx.length > 128) this.overflow = true; }
    }
  }

  private report(): string {
    const st = this.state === "Hold" ? "Hold:0" : this.state;
    return `<${st}|WPos:${this.pos.X.toFixed(3)},${this.pos.Y.toFixed(3)},${this.pos.Z.toFixed(3)}|Bf:${this.plannerSize - this.planner.length},${128 - this.rx.length}|Ov:100,100,100${this.holdPin ? "|Pn:H" : ""}>`;
  }

  /** parse what fits, then run one planner block */
  tick(): void {
    while (!this.waitingM0) {
      const nl = this.rx.indexOf("\n");
      if (nl < 0) break;
      const line = this.rx.slice(0, nl);
      if (/^M0\b/.test(line)) {
        if (this.planner.length) break;              // M0 waits for the planner to empty
        this.rx = this.rx.slice(nl + 1);
        this.state = "Hold"; this.waitingM0 = true;   // answered only on cycle start
        break;
      }
      if (this.planner.length >= this.plannerSize) break;
      this.rx = this.rx.slice(nl + 1);
      if (line.includes("ERRTEST")) { this.out.push("error:20"); continue; }
      if (/^G1 |^G92 /.test(line)) this.planner.push(line);
      this.out.push("ok");
    }
    if (this.state !== "Hold" && this.planner.length) {
      const b = this.planner.shift()!;
      this.executed.push(b);
      const m = /^G(?:1|92) ([XYZ])(-?[\d.]+)/.exec(b);
      if (m) this.pos[m[1] as "X" | "Y" | "Z"] = Number(m[2]);
      this.state = this.planner.length ? "Run" : "Idle";
    }
  }
}

function harness(onEvent: (e: StreamEvent, s: Streamer, g: FakeGrbl) => void = () => undefined) {
  const g = new FakeGrbl(), events: StreamEvent[] = [];
  const s: Streamer = new Streamer({ write: (x) => g.write(x) }, (e) => { events.push(e); onEvent(e, s, g); });
  const run = (maxTicks = 200000, until: () => boolean = () => !s.running) => {
    for (let t = 0; t < maxTicks; t++) {
      g.tick();
      if (t % 3 === 0) s.poll();
      while (g.out.length) s.receive(g.out.shift()!);
      if (until()) return t;
    }
    throw new Error("did not finish");
  };
  /** run until `until`, letting queued resumes (microtasks) happen between batches */
  const drive = async (until: () => boolean, batches = 400) => {
    for (let i = 0; i < batches; i++) {
      try { run(500, until); return; } catch { /* not yet */ }
      await Promise.resolve();
    }
    throw new Error("did not get there");
  };
  return { g, s, events, run, drive };
}

const c = { ...DEFAULT_MACHINE, pauseEvery: 100 };
const seq = randomSeq(300, c.nails, 20, 11);
const plan = planToolpath(seq, c);
const prog = program(seq, plan, c);
const autoResume = (e: StreamEvent, s: Streamer) => { if (e.type === "paused" && e.reason !== "user" && e.reason !== "hold") queueMicrotask(() => s.resume()); };

describe("status reports", () => {
  it("reads state, work position, buffers, overrides and pins", () => {
    const st = parseStatus("<Hold:0|WPos:12.500,-8.000,3.300|Bf:15,128|Ov:110,100,100|Pn:H>")!;
    expect(st.state).toBe("Hold"); expect(st.sub).toBe(0);
    expect(st.wpos).toEqual([12.5, -8, 3.3]); expect(st.bf).toEqual([15, 128]); expect(st.ov).toEqual([110, 100, 100]); expect(st.pins).toBe("H");
  });
  it("works out the work position from MPos and the last WCO", () => {
    const w = { v: null as [number, number, number] | null };
    parseStatus("<Idle|MPos:10.000,0.000,20.000|WCO:2.000,0.000,2.000>", w);
    expect(parseStatus("<Run|MPos:12.000,1.000,20.000>", w)!.wpos).toEqual([10, 1, 18]);
    expect(parseStatus("ok")).toBeNull();
  });
  it("strips comments", () => {
    expect(clean("G1 X1.000 F600 ; line 3")).toBe("G1 X1.000 F600");
    expect(clean("; just a comment")).toBe("");
    expect(clean("M0 (pause) ; tie on")).toBe("M0");
  });
});

describe("streaming a program", () => {
  it("winds the whole piece without overflowing GRBL's buffer, stopping where the program says", async () => {
    const h = harness(autoResume);
    h.s.start(prog);
    // resumes are queued as microtasks; let them run between batches of ticks
    for (let i = 0; i < 400 && h.s.running; i++) { try { h.run(2000); } catch { /* keep going */ } await Promise.resolve(); }
    expect(h.s.running).toBe(false);
    expect(h.g.overflow).toBe(false);
    const pauses = h.events.filter((e) => e.type === "paused").map((e) => (e as { reason: string }).reason);
    expect(pauses).toEqual(["tieOn", "check", "check", "done"]);
    expect(h.events.filter((e) => e.type !== "status").at(-1)!.type).toBe("done");
    const back = readBack(h.g.executed.join("\n"), c);
    expect(back.nails).toEqual(Array.from(seq.slice(1)));
    expect(back.offGap).toBe(0);
  });

  it("knows how far the machine has really got from the planner's fill", async () => {
    const h = harness(autoResume);
    h.s.start(prog);
    for (let i = 0; i < 3 && h.s.running; i++) { try { h.run(2000, () => h.g.executed.length > 900); } catch { /* */ } await Promise.resolve(); }
    h.s.poll(); while (h.g.out.length) h.s.receive(h.g.out.shift()!);
    const done = h.g.executed.filter((l) => l.startsWith("G1")).length, mv = h.s.executedMove();
    // the move it reports is the last G1 the fake has run, give or take what the last status report missed
    expect(Math.abs(mv + 1 - done)).toBeLessThanOrEqual(1);
  });

  it("pauses and resumes on request, and recognises a hold from the thread-break switch", async () => {
    let held = 0;
    const h = harness((e, s, g) => {
      autoResume(e, s);
      if (e.type === "paused" && (e.reason === "user" || e.reason === "hold")) { held++; queueMicrotask(() => { g.holdPin = false; s.resume(); }); }
    });
    h.s.start(prog);
    await h.drive(() => h.g.executed.length > 400 && !h.s.paused);
    h.s.pause();
    await h.drive(() => h.s.paused === "user" || h.events.some((e) => e.type === "paused" && e.reason === "user"));
    expect(h.events.some((e) => e.type === "paused" && e.reason === "user")).toBe(true);
    await h.drive(() => h.g.executed.length > 1200 && !h.s.paused);
    h.g.holdPin = true; h.g.state = "Hold";                       // the thread breaks: GRBL's Hold input
    await h.drive(() => h.events.some((e) => e.type === "paused" && e.reason === "hold"));
    await h.drive(() => !h.s.running);
    expect(held).toBe(2);
    expect(readBack(h.g.executed.join("\n"), c).nails).toEqual(Array.from(seq.slice(1)));
  });

  it("holds and reports a line GRBL rejects", () => {
    const h = harness();
    h.s.start([{ text: "G1 X1 F600", move: 0, line: 1 }, { text: "G1 ERRTEST", move: 1, line: 2 }, { text: "G1 X2 F600", move: 2, line: 3 }]);
    try { h.run(100, () => h.events.some((e) => e.type === "error")); } catch { /* */ }
    const err = h.events.find((e) => e.type === "error") as { code: number; line: number };
    expect(err.code).toBe(20); expect(err.line).toBe(2);
    expect(h.s.paused).toBe("user");
  });

  it("stops by holding first, then resetting, so the position is kept", () => {
    const h = harness(autoResume);
    h.s.start(prog);
    try { h.run(3000, () => h.g.executed.length > 300); } catch { /* */ }
    h.s.stop();
    h.run(200);
    expect(h.g.resets).toBe(1);
    expect(h.events.some((e) => e.type === "stopped")).toBe(true);
    expect(h.events.filter((e) => e.type === "done")).toEqual([]);
    expect(h.s.running).toBe(false);
  });

  it("sends commands one at a time", () => {
    const h = harness();
    const writes: string[] = [];
    const s = new Streamer({ write: (x) => { writes.push(x); h.g.write(x); } }, () => undefined);
    s.command(["$100=71.111", "$101=80", "$102=400"]);
    expect(writes.filter((w) => w.endsWith("\n")).length).toBe(1);   // the second waits for the first "ok"
    for (let t = 0; t < 20 && s.running; t++) { h.g.tick(); while (h.g.out.length) s.receive(h.g.out.shift()!); }
    expect(writes.filter((w) => w.endsWith("\n")).length).toBe(3);
    expect(s.running).toBe(false);
  });
});

describe("resuming from a line", () => {
  it("rises clear, goes inside, turns, drops, stops for the thread, then winds the rest", () => {
    const k = 137;
    // wherever the board happens to be: θ is only known within whole turns
    for (const theta of [0, 37.25, -1234.5, 7201.5]) {
      const rp = resumeProgram(seq, plan, c, k, theta);
      const text = rp.map((l) => l.text).join("\n");
      const back = readBack(text, c, { X: NaN, Y: 4, Z: 6 });
      expect(back.nails).toEqual(Array.from(seq.slice(k)));
      expect(back.offGap).toBe(0);
      expect(back.badWidth).toBe(0);
      expect(back.order.slice(0, 4)).toEqual(["Z", "Y", "X", "Z"]);
      expect(rp.find((l) => l.pause === "tieOn")!.text).toContain(`nail ${seq[k - 1]}`);
      // the first turn starts within half a turn of where the board is
      const firstX = Number(/X(-?[\d.]+)/.exec(rp.find((l) => /^G1 X/.test(l.text))!.text)![1]);
      expect(Math.abs(firstX - (((theta + 180) % 360 + 360) % 360 - 180))).toBeLessThanOrEqual(180 + 1e-6);
    }
    expect(() => resumeProgram(seq, plan, c, 0, 0)).toThrow();
  });
});
