// Thread tension: the working shown on the build page (capstan friction, payout, spool inertia, sag, nail bending,
// thread strength), checked against hand calculation, and the machine page's tension check.
import { describe, expect, it } from "vitest";
import { DEFAULT_MACHINE } from "../src/machine/config";
import { machineChecks } from "../src/machine/checks";
import { planToolpath } from "../src/machine/toolpath";
import { diameterOf, meanInward, tension, texOf, yieldMoment, MIN_THREAD_MM } from "../src/hardware/tension";
import { randomSeq } from "./gcode-reader";

describe("tension working", () => {
  const r = tension();
  it("friction along the thread path multiplies the tension by about 2.7", () => {
    expect(r.K).toBeCloseTo(Math.exp(0.25 * 1.5708) * Math.exp(0.1 * 3) * Math.exp(0.2 * 1.5708), 9);
    expect(r.K).toBeCloseTo(2.74, 2);
    expect(r.brake).toBeCloseTo(0.25 / r.K, 9);
  });
  it("payout speed and acceleration follow the rim", () => {
    expect(r.speed.v).toBeCloseTo(0.3 * (60 * Math.PI) / 180, 9);
    expect(r.speed.a).toBeCloseTo(0.3 * (120 * Math.PI) / 180, 9);
  });
  it("a turning spool adds inertia and grows 2.5 times harder as it empties; a standing cone does not", () => {
    expect(r.inertia.pinFull).toBeCloseTo((0.5 * 0.125 * (0.025 ** 2 + 0.01 ** 2) * r.speed.a) / 0.025 ** 2, 9);
    expect(r.inertia.pinFull).toBeCloseTo(0.046, 3);
    expect(r.inertia.cone).toBeLessThan(1e-4);
    expect(r.emptying).toBe(2.5);
    expect(r.peak.pin).toBeCloseTo(0.94, 2);
    expect(r.peak.cone).toBeCloseTo(0.37, 2);
  });
  it("sag sets the lower limit, the busiest nail the upper", () => {
    expect(r.thread.tex).toBeCloseTo(40.6, 1);
    expect(r.sag.minT).toBeCloseTo(0.18, 2);
    expect(meanInward(240, 20)).toBeCloseTo((Math.cos(Math.PI / 12) - Math.cos((11 * Math.PI) / 12)) / ((10 * Math.PI) / 12), 9);
    expect(r.nail.h).toBeCloseTo(3 + 0.3 * 12 + 1.5, 9);
    expect(yieldMoment(1.5, 400)).toBeCloseTo((400 * Math.PI * 3.375) / 32, 9);
    expect(r.nailLimit).toBeCloseTo(0.30, 2);
    const two = r.nailLimits.find((x) => x.d === 2 && x.n === 25)!;
    expect(two.soft).toBeCloseTo(0.70, 2);
    // the window is open for the default: straight lines, unbent nails
    expect(r.sag.minT).toBeLessThan(DEFAULT_MACHINE.tensionN);
    expect(DEFAULT_MACHINE.tensionN).toBeLessThanOrEqual(r.nailLimit);
  });
  it("needs about 0.09 mm polyester with a standing cone, 0.14 mm with a turning spool", () => {
    expect(r.required.cone).toBeCloseTo((3 * r.peak.cone) / 0.55, 9);
    const pol = r.minimum.find((m) => m.fibre === "polyester")!;
    expect(pol.cone.d).toBeCloseTo(0.09, 2);
    expect(pol.pin.d).toBeCloseTo(0.14, 2);
    expect(diameterOf(texOf(0.25, 1380, 0.6), 1380, 0.6)).toBeCloseTo(0.25, 9);
    expect(MIN_THREAD_MM).toBeGreaterThanOrEqual(Math.max(...r.minimum.map((m) => m.cone.d)));
    expect(r.safetyOfThread.cone).toBeGreaterThan(15);
  });
  it("adds little load to the turntable motor", () => {
    expect(r.turntable.atTarget).toBeCloseTo((0.25 * 0.3) / 8, 9);
  });
});

describe("the machine page's tension check", () => {
  const seq = randomSeq(3000, 240, 20, 4);
  const check = (over: Partial<typeof DEFAULT_MACHINE>) => {
    const c = { ...DEFAULT_MACHINE, ...over };
    return machineChecks(seq, c, planToolpath(seq, c)).find((x) => x.code === "tension")!;
  };
  it("passes the defaults and uses this piece's busiest nail", () => {
    const ch = check({});
    expect(ch.level).toBe("ok");
    expect(ch.v.n).toBe(planToolpath(seq, DEFAULT_MACHINE).maxWraps);
  });
  it("warns when the tension would bend nails or let lines sag, and refuses a thread that would break", () => {
    expect(check({ tensionN: 1.2 }).v.bends).toBe(1);
    expect(check({ tensionN: 1.2 }).level).toBe("warn");
    expect(check({ nailMm: 2.0, tensionN: 0.5 }).v.bends).toBe(0);
    expect(check({ tensionN: 0.1 }).v.sags).toBe(1);
    expect(check({ threadMm: 0.08 }).v.weak).toBe(1);
    expect(check({ threadMm: 0.05, tensionN: 1.5 }).level).toBe("error");
  });
});
