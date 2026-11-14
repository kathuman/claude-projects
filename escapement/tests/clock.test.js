// Escapement mechanism checks — run with: node escapement/tests/clock.test.js
// The clock keeps time (pendulum period, the train's ratios, the motion work's 12:1), every pair of gears meshes at
// exactly its centre distance, no wheel touches an arbor it does not drive, the escapement behaves as a deadbeat (the
// escape wheel is still while locked and advances half a tooth per beat), and the spring runs it for two days.
const C = require("../src/clock.js");
const d = C.derive(), S = d.spec;
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TAU = 2 * Math.PI;

// ---- the pendulum
check("a half-second pendulum is 248.4 mm long (T = 2π√(L/g), period 1 s)", near(d.pendulumLength, 248.405, 0.01) && near(TAU * Math.sqrt(d.pendulumLength / 1000 / C.G), S.pendulum.period, 1e-12), d.pendulumLength.toFixed(2) + " mm");

// ---- the train
check("the escape wheel turns once every 30 s (30 teeth, one tooth per swing)", d.escapeTurnSeconds === 30);
check("the centre arbor turns exactly once an hour: 30 s × (72/6) × (80/8)", near(d.centreTurnSeconds, 3600, 1e-9), d.centreTurnSeconds);
check("the barrel turns once every 8 hours (96/12)", near(d.barrelTurnSeconds, 8 * 3600, 1e-6));
check("the motion work divides by 12: (36/12) × (32/8)", d.hourRatio === 12);
check("the mainspring's 6 turns run the clock for 48 hours", near(d.powerReserveHours, 48, 1e-9));

// ---- meshing and clearance
const A = d.arbors;
check("every wheel and pinion pair sits at exactly its centre distance", d.meshes.every((m) => near(dist(A[m.wheel], A[m.pinion]), m.distance, 1e-9)), d.meshes.map((m) => m.distance.toFixed(2)).join(", "));
check("the motion work's two pairs share their centres (cannon/hour wheel coaxial with the minute wheel's arbor)", near(d.motionDistances.cannonToMinuteWheel, d.motionDistances.minutePinionToHourWheel, 1e-12));
check("the escape wheel sits right above the centre arbor, so the anchor is symmetric", near(A.escape.x, A.centre.x, 1e-12) && A.escape.y > A.centre.y);
check("the pallets span 7½ teeth and both lie on the escape wheel's tip circle", near(dist(d.pallets.entry, A.escape), S.escapeTipRadius, 1e-9) && near(dist(d.pallets.exit, A.escape), S.escapeTipRadius, 1e-9) &&
  near(Math.acos(((d.pallets.entry.x - A.escape.x) * (d.pallets.exit.x - A.escape.x) + (d.pallets.entry.y - A.escape.y) * (d.pallets.exit.y - A.escape.y)) / S.escapeTipRadius ** 2), 7.5 * TAU / 30, 1e-9));
// an arbor runs the whole depth between the plates, so a wheel must clear every arbor except the one it drives
const ARBOR = 1.2, tip = (teeth, m, wheel) => C.pitchRadius(teeth, m) + (wheel ? 1.35 : 0.9) * m;
const wheels = [
  { id: "barrel", r: tip(S.train[0].wheel, S.train[0].module, true), drives: "centre" },
  { id: "centre", r: tip(S.train[1].wheel, S.train[1].module, true), drives: "third" },
  { id: "third", r: tip(S.train[2].wheel, S.train[2].module, true), drives: "escape" },
  { id: "escape", r: S.escapeTipRadius, drives: null }
];
const clash = [];
for (const w of wheels) for (const other of ["barrel", "centre", "third", "escape", "pallet"]) {
  if (other === w.id || other === w.drives) continue;
  const gap = dist(A[w.id], A[other]) - w.r - ARBOR;
  if (gap < 0.5) clash.push(w.id + " wheel vs " + other + " arbor: " + gap.toFixed(2) + " mm");
}
check("no wheel touches an arbor it does not drive (at least 0.5 mm clear)", clash.length === 0, clash.join("; ") || "clear");
check("the barrel (radius " + S.mainspring.barrelRadius + ") clears the centre arbor", dist(A.barrel, A.centre) - S.mainspring.barrelRadius - ARBOR > 0.5);

// ---- the escapement in motion
{
  const T = S.pendulum.period, half = Math.PI / 30;
  let still = true, maxStep = 0, monotone = true, prev = C.pose(0, d).escape, amp = 0;
  for (let k = 1; k <= 4000; k++) {
    const t = k * 0.0025, p = C.pose(t, d), x = 2 * t / T, frac = x - Math.round(x);
    if (Math.abs(frac) > C.IMPULSE + 1e-9 && Math.abs(p.escape - prev) > 1e-12) still = false;
    if (p.escape < prev - 1e-12) monotone = false;
    maxStep = Math.max(maxStep, p.escape - prev); prev = p.escape;
    amp = Math.max(amp, Math.abs(p.pendulum));
  }
  check("deadbeat: the escape wheel is still whenever the pendulum is away from the middle (locked on a pallet)", still);
  check("it only ever turns forward, never recoils", monotone);
  check("each beat advances it exactly half a tooth (6°)", near(C.pose(10.5, d).escape - C.pose(9.5, d).escape, 2 * half, 1e-12) && near(C.pose(10.25, d).escape - C.pose(9.75, d).escape, half, 1e-12));
  check("the pendulum swings ±3° and the anchor rocks with it", near(amp, S.pendulum.amplitude, 1e-4) && C.pose(0.37, d).anchor === C.pose(0.37, d).pendulum);
  const imp = S.pendulum.amplitude * Math.sin(Math.PI * C.IMPULSE);
  check("impulse is given only while the pendulum is within " + (imp * 180 / Math.PI).toFixed(2) + "° of the middle", imp < S.pendulum.amplitude / 2);
}

// ---- the hands keep time
{
  const start = C.timeShown(C.pose(0, d)), errs = [];
  for (const t of [1, 59, 600, 3599, 3600, 7200.5, 43200, 86400 + 1234]) {
    const want = ((start + t / 3600) % 12 + 12) % 12, got = C.timeShown(C.pose(t, d));
    let e = Math.abs(got - want); e = Math.min(e, 12 - e);
    errs.push(e * 3600);
  }
  check("the hands show the time to within a beat (0.5 s) at any moment, over a day", errs.every((e) => e <= 0.5 + 1e-6), Math.max(...errs).toFixed(3) + " s worst");
  check("the minute hand turns twelve times for every turn of the hour hand", near((C.pose(43200, d).minuteHand - C.pose(0, d).minuteHand) / (C.pose(43200, d).hourHand - C.pose(0, d).hourHand), 12, 1e-9));
  check("the hands turn clockwise; the third wheel and the barrel turn the other way", C.pose(60, d).minuteHand > C.pose(0, d).minuteHand && C.pose(60, d).third < 0 && C.pose(60, d).barrel < 0 && C.pose(60, d).escape > 0);
  check("the clock starts at 10:08:30", near(start, 10 + 8 / 60 + 30 / 3600, 1e-12));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
