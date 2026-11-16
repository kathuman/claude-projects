// The winding machine: motion timing, the toolpath (read back from its own G-code, it must wrap exactly the nails of
// the sequence, passing only through gaps), the checks and the configuration clean-up.
import { describe, expect, it } from "vitest";
import { DEFAULT_MACHINE, gapMm, pitchDeg, sanitize, xSpeedLimit, type MachineConfig } from "../src/machine/config";
import { moveFraction, moveTime } from "../src/machine/motion";
import { KINDS, nailX, planToolpath, positionAt, wrap180, wrapDir } from "../src/machine/toolpath";
import { lineClearance, machineChecks, safeSkip } from "../src/machine/checks";
import { toGcode } from "../src/machine/gcode";
import { randomSeq, readBack } from "./gcode-reader";

describe("motion profile", () => {
  it("times a trapezoid and a triangle", () => {
    // v = 10, a = 20: reaching v takes 0.5 s and 2.5 mm, so 5 mm is the shortest move with a cruise
    expect(moveTime(20, 10, 20)).toBeCloseTo(20 / 10 + 10 / 20, 12);
    expect(moveTime(-20, 10, 20)).toBeCloseTo(2.5, 12);
    expect(moveTime(1.25, 10, 20)).toBeCloseTo(2 * Math.sqrt(1.25 / 20), 12);
    expect(moveTime(0, 10, 20)).toBe(0);
  });
  it("covers the distance smoothly from 0 to 1", () => {
    for (const d of [0.3, 2, 5, 40]) {
      const T = moveTime(d, 10, 20);
      let prev = 0;
      for (let i = 0; i <= 200; i++) {
        const f = moveFraction((i / 200) * T, d, 10, 20);
        expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(f - prev).toBeLessThan(0.05 + 2 / 200 * 2);   // no jumps
        prev = f;
      }
      expect(prev).toBeCloseTo(1, 9);
      expect(moveFraction(T / 2, d, 10, 20)).toBeCloseTo(0.5, 9);   // symmetric profile
    }
  });
});

describe("toolpath", () => {
  const c = { ...DEFAULT_MACHINE };
  const seq = randomSeq(1500, c.nails, 20, 7);
  const plan = planToolpath(seq, c);

  it("reduces angles to (-180, 180]", () => {
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-180)).toBe(180);
    expect(wrap180(540)).toBe(180);
    expect(wrap180(-10)).toBe(-10);
  });

  it("wraps exactly the nails of the sequence, going in and out only through gaps one nail apart", () => {
    const g = readBack(toGcode(seq, plan, c, { version: "test", date: "today" }), c);
    expect(g.nails).toEqual(Array.from(seq.slice(1)));
    expect(g.offGap).toBe(0);
    expect(g.badWidth).toBe(0);
  });

  it("ends each wrap on the side facing the next nail", () => {
    const p = pitchDeg(c);
    for (let k = 1; k < seq.length - 1; k++) {
      const end = plan.to[plan.lineEnd[k] - 1];                // the wrap move ends here (the last move is "in")
      expect(KINDS[plan.kind[plan.lineEnd[k] - 1]]).toBe("wrap");
      const side = Math.sign(wrap180(end - nailX(seq[k], c)));
      expect(side).toBe(wrapDir(seq[k], seq[k + 1], c));
      expect(Math.abs(wrap180(end - nailX(seq[k], c)))).toBeCloseTo(p / 2, 9);
    }
  });

  it("never turns more than half a turn plus a nail between wraps", () => {
    for (let i = 0; i < plan.axis.length; i++) {
      if (plan.axis[i] === 0) expect(Math.abs(plan.to[i] - plan.from[i])).toBeLessThanOrEqual(180 + pitchDeg(c) + 1e-9);
    }
  });

  it("stacks the wraps on each nail and counts them", () => {
    let sum = 0;
    for (const w of plan.wraps) sum += w;
    expect(sum).toBe(seq.length - 1);
    expect(plan.maxZ).toBeCloseTo(Math.min(c.zStartMm + (plan.maxWraps - 1) * c.layerMm, c.nailHeightMm - 2), 9);
    // the guide only changes height while it waits inside the ring
    let y = 0;
    for (let i = 0; i < plan.axis.length; i++) {
      if (plan.axis[i] === 2 && i > 3) expect(y).toBeLessThan(0);
      if (plan.axis[i] === 1) y = plan.to[i];
    }
  });

  it("knows where the machine is at any time", () => {
    for (const k of [1, 10, 700, seq.length - 1]) {
      const i = plan.lineEnd[k], { pos, move } = positionAt(plan, plan.t0[i] + plan.dur[i] - 1e-9);
      expect(move).toBe(i);
      expect(pos[1]).toBeCloseTo(-c.insideMm, 6);
    }
    const end = positionAt(plan, plan.totalS + 1).pos;
    expect(end[2]).toBeCloseTo(c.nailHeightMm + 2, 9);
    // half-way through a move it is between the ends
    const i = plan.lineEnd[5] - 1, mid = positionAt(plan, plan.t0[i] + plan.dur[i] / 2).pos[plan.axis[i]];
    expect(mid).toBeCloseTo((plan.from[i] + plan.to[i]) / 2, 6);
  });

  it("estimates a plausible winding time", () => {
    // 1,500 lines, average turn ~ 90° at 60 °/s: about 2–3 s a line
    expect(plan.totalS / 1500).toBeGreaterThan(1.5);
    expect(plan.totalS / 1500).toBeLessThan(4);
    const t = plan.dur.reduce((a, b) => a + b, 0);
    expect(plan.totalS).toBeCloseTo(t, 6);
  });
});

describe("G-code", () => {
  it("keeps X within a few turns when the board keeps turning one way", () => {
    const c = { ...DEFAULT_MACHINE }, L = 1000, seq = new Uint16Array(L + 1);
    for (let k = 0; k <= L; k++) seq[k] = (k * 101) % 240;          // always the same way round
    const plan = planToolpath(seq, c);
    expect(plan.turnDeg).toBeGreaterThan(100000);
    const r = readBack(toGcode(seq, plan, c, { version: "t", date: "d" }), c);
    expect(r.nails).toEqual(Array.from(seq.slice(1)));
    expect(r.offGap).toBe(0);
    expect(r.badWidth).toBe(0);
    expect(r.maxX).toBeLessThan(3600 + 360);
  });
  const c = { ...DEFAULT_MACHINE, pauseEvery: 100 };
  const seq = randomSeq(450, c.nails, 20, 3);
  const g = toGcode(seq, planToolpath(seq, c), c, { version: "1.1.0", date: "2026-11-16" });
  it("pauses for the tie-on, every 100 lines and at the end, and labels every line", () => {
    expect(readBack(g, c).m0).toBe(1 + 4 + 1);
    expect(g.match(/^; line \d+ of 450:/gm)!.length).toBe(450);
    expect(g).toContain(`tie the thread to nail ${seq[0]}`);
    expect(g).toContain(`tie the thread off at nail ${seq[450]}`);
    expect(g).toContain("$100=71.111");
  });
  it("is plain ASCII", () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(g)).toBe(true);
  });
});

describe("checks", () => {
  const seq = randomSeq(300, 240, 20, 5);
  const run = (over: Partial<MachineConfig>, s: ArrayLike<number> = seq) => {
    const c = { ...DEFAULT_MACHINE, ...over };
    return Object.fromEntries(machineChecks(s, c, planToolpath(s, c)).map((x) => [x.code, x]));
  };
  it("passes the recommended machine with a normal sequence", () => {
    const r = run({});
    for (const k of ["gap", "inside", "outside", "height", "tight"]) expect(r[k].level).toBe("ok");
    expect(gapMm(DEFAULT_MACHINE)).toBeCloseTo(600 * Math.sin(Math.PI / 240) - 1.5, 9);
  });
  it("refuses a guide too thick for the gap and a guide that waits too close to the nails", () => {
    expect(run({ guideMm: 6 }).gap.level).toBe("error");
    expect(run({ guideMm: 5 }).gap.level).toBe("warn");
    expect(run({ insideMm: 1.5 }).inside.level).toBe("error");
    expect(run({ outsideMm: 1.5 }).outside.level).toBe("error");
  });
  it("warns when wraps would rise above the nails", () => {
    expect(run({ nailHeightMm: 6, layerMm: 1 }).height.level).toBe("warn");
    expect(run({ nailHeightMm: 4 }).height.level).toBe("error");
  });
  it("finds lines that rub the neighbouring nail", () => {
    const s = safeSkip(DEFAULT_MACHINE);
    expect(s).toBeGreaterThan(5);
    expect(s).toBeLessThan(20);
    expect(lineClearance(0, s, DEFAULT_MACHINE)).toBeGreaterThanOrEqual(0);
    expect(lineClearance(0, s - 1, DEFAULT_MACHINE)).toBeLessThan(0);
    expect(run({}, randomSeq(300, 240, 3, 9)).tight.level).toBe("warn");
  });
  it("caps the board's turning speed by the thread speed", () => {
    expect(xSpeedLimit({ ...DEFAULT_MACHINE, threadSpeed: 100 })).toBeCloseTo((100 / 300) * (180 / Math.PI), 9);
    expect(xSpeedLimit(DEFAULT_MACHINE)).toBe(60);
  });
});

describe("configuration", () => {
  it("keeps good numbers and drops bad ones", () => {
    const c = sanitize({ nailMm: 2, guideMm: -1, insideMm: NaN, pauseEvery: 0, xSpeed: "9" as unknown as number });
    expect(c.nailMm).toBe(2);
    expect(c.guideMm).toBe(DEFAULT_MACHINE.guideMm);
    expect(c.insideMm).toBe(DEFAULT_MACHINE.insideMm);
    expect(c.pauseEvery).toBe(0);
    expect(c.xSpeed).toBe(DEFAULT_MACHINE.xSpeed);
  });
});
