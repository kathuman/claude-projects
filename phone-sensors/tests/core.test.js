// Sensor Deck core checks — run with: node phone-sensors/tests/core.test.js
// Statistics, the step counter and shake detector on known signals, the compass against hand-worked orientations,
// the FFT against pure tones, GPS distances, CSV quoting, the phone→computer message checks and the demo phone.
const C = require("../src/core.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;
const angNear = (a, b, tol) => a != null && Math.abs(((a - b + 540) % 360) - 180) <= tol;

// catalogue
check("13 sensors with unique ids, every plotted channel exists", C.SENSORS.length === 13 && new Set(C.SENSORS.map((s) => s.id)).size === 13 &&
  C.SENSORS.every((s) => s.plot.every((i) => i < s.ch.length) && s.name && s.src && s.about));

// ring buffer
const rb = new C.RingBuffer(3);
[1, 2, 3, 4, 5].forEach((t) => rb.push(t, [t * 10]));
check("ring buffer keeps the newest samples in order", rb.length === 3 && rb.at(0)[0] === 3 && rb.last()[1][0] === 50 && rb.since(4).length === 2);

// stats
const st = C.stats([1, 2, 3, 4, null, NaN]);
check("stats skip missing values", st.n === 4 && st.mean === 2.5 && st.min === 1 && st.max === 4 && near(st.sd, Math.sqrt(1.25), 1e-12) && near(st.rms, Math.sqrt(7.5), 1e-12));
check("stats of nothing", C.stats([]).mean === null);
const rm = new C.RateMeter(2000); for (let t = 0; t <= 1000; t += 20) rm.tick(t);
check("rate meter: a sample every 20 ms is 50 Hz", near(rm.rate(1000), 50, 0.01));

// steps: the demo phone walks at 1.8 steps a second
function walk(seconds, hz, sig) {
  const sc = new C.StepCounter();
  for (let t = 0; t <= seconds * 1000; t += 1000 / hz) sc.add(t, sig(t / 1000));
  return sc;
}
const sc = walk(20, 60, (t) => C.simulate(t).accel[3]);
check("steps: 20 s of walking at 1.8/s counts 36 ± 2", Math.abs(sc.steps - 36) <= 2, sc.steps);
check("steps: cadence about 108 a minute", near(sc.cadence(20000), 108, 6), sc.cadence(20000).toFixed(1));
check("steps: cadence drops to 0 after stopping", sc.cadence(25000) === 0);
check("steps: a phone lying still counts none", walk(10, 60, () => C.G + 0.05 * Math.sin(Math.random())).steps === 0);
check("steps: sensor noise of ±0.4 m/s² counts none", walk(10, 60, (t) => C.G + 0.4 * Math.sin(2 * Math.PI * 7 * t)).steps === 0);
check("steps: same count at 20 Hz sampling", Math.abs(walk(20, 20, (t) => C.simulate(t).accel[3]).steps - 36) <= 3);

// shake
const sh = new C.ShakeDetector(12); let shakes = 0;
for (let t = 0; t < 600; t += 10) if (sh.add(t, 18 * Math.sin(2 * Math.PI * 5 * t / 1000), 0, 0)) shakes++;
check("shake: a hard 5 Hz back-and-forth is one shake", shakes === 1);
const calm = new C.ShakeDetector(12); let none = 0;
for (let t = 0; t < 3000; t += 10) if (calm.add(t, 5 * Math.sin(t / 100), 3, 0)) none++;
check("shake: ordinary handling is not a shake", none === 0);

// compass: flat, the top edge's heading is 360 − alpha
check("compass: flat, alpha 0 → north", angNear(C.compassHeading(0, 0, 0), 0, 1e-9));
check("compass: flat, alpha 90 → west (270)", angNear(C.compassHeading(90, 0, 0), 270, 1e-9));
check("compass: flat, alpha 270 → east (90)", angNear(C.compassHeading(270, 0, 0), 90, 1e-9));
check("compass: tilted 30° toward you keeps the heading", angNear(C.compassHeading(45, 30, 0), 315, 1e-6));
check("compass: upright (β 90), the camera's heading, alpha 0 → north", angNear(C.compassHeading(0, 90, 0), 0, 1e-6));
check("compass: upright, alpha 90 → west", angNear(C.compassHeading(90, 90, 0), 270, 1e-6));
check("compass: unknown alpha → null", C.compassHeading(null, 10, 10) === null);
check("cardinal points", C.cardinal(0) === "N" && C.cardinal(44) === "NE" && C.cardinal(359) === "N" && C.cardinal(200, true) === "SSW" && C.cardinal(null) === "");

// level
const lv = C.level(0, 0, C.G), lv2 = C.level(C.G * Math.sin(Math.PI / 6), 0, C.G * Math.cos(Math.PI / 6));
check("level: flat is 0°, tipped 30° reads 30°", near(lv.tilt, 0, 1e-9) && near(lv2.x, 30, 1e-9) && near(lv2.tilt, 30, 1e-9) && near(lv2.y, 0, 1e-9));

// FFT
const N = 64, re = [], im = [];
for (let i = 0; i < N; i++) { re.push(Math.cos(2 * Math.PI * 5 * i / N)); im.push(0); }
C.fft(re, im);
check("FFT: a cosine at bin 5 lands in bins 5 and 59 only", near(Math.hypot(re[5], im[5]), 32, 1e-9) && near(Math.hypot(re[59], im[59]), 32, 1e-9) &&
  re.every((r, i) => i === 5 || i === 59 || Math.hypot(r, im[i]) < 1e-9));
let threw = false; try { C.fft([1, 2, 3], [0, 0, 0]); } catch (e) { threw = true; }
check("FFT refuses lengths that are not a power of two", threw);
const tone = []; for (let i = 0; i < 512; i++) tone.push(Math.sin(2 * Math.PI * 2.3 * i / 50) + 0.3 * Math.sin(2 * Math.PI * 9 * i / 50));
check("dominant frequency: 2.3 Hz found to within 0.05", near(C.dominantFrequency(tone, 50, 0.5).freq, 2.3, 0.05), C.dominantFrequency(tone, 50, 0.5).freq);
check("dominant frequency of the demo walk's bounce is the step rate", (() => {
  const ts = [], vs = []; for (let t = 0; t < 10000; t += 16.7) { ts.push(t); vs.push(C.simulate(t / 1000).accel[3]); }
  return near(C.dominantFrequency(C.resample(ts, vs, 50), 50, 0.5).freq, 1.8, 0.1);
})());
check("dominant frequency needs at least 16 samples", C.dominantFrequency([1, 2, 3], 10) === null);
// an AnalyserNode-style dB spectrum: a peak between bins 10 and 11
const db = new Array(64).fill(-120); db[9] = -60; db[10] = -20; db[11] = -20; db[12] = -60;
check("peak frequency interpolates between equal bins", near(C.peakFrequency(db, 48000, 128, 0), 10.5 * 48000 / 128, 1));
check("peak frequency of silence is null", C.peakFrequency(new Array(64).fill(-140), 48000, 128, 0) === null);
check("resample: linear interpolation", JSON.stringify(C.resample([0, 100], [0, 10], 20)) === JSON.stringify([0, 5, 10]));
check("dBFS: full-scale sine is −3 dB, silence −100", near(C.dbfs(Array.from({ length: 1000 }, (_, i) => Math.sin(i / 3))), -3.01, 0.05) && C.dbfs(new Array(100).fill(0)) === -100);

// location
check("haversine: Copenhagen to Aarhus is about 157 km", near(C.haversine(55.6761, 12.5683, 56.1629, 10.2039) / 1000, 157, 3));
check("haversine: 0.001° of latitude is about 111 m", near(C.haversine(0, 0, 0.001, 0), 111.2, 0.5));
const tr = new C.Track();
tr.add(0, 55.6761, 12.5683, 5); tr.add(1, 55.67611, 12.5683, 5); tr.add(2, 55.6762, 12.5683, 5); tr.add(3, 55.6800, 12.5683, 200);
check("track ignores jitter and poor fixes", tr.points.length === 2 && near(tr.distance, 11.1, 0.5), tr.points.length + " pts, " + tr.distance.toFixed(1) + " m");

// CSV
const csv = C.toCSV([[1500, "accel", [0.1, -9.81, 0.3333333333, 9.8]], [1600, "geo", [55.1, 12.2, 5, null, 1, 90]]]);
const rows = csv.trim().split("\n");
check("CSV: a header and one row per sample, seconds, blanks for missing", rows.length === 3 && rows[0].startsWith("time_s,sensor,v1") && rows[1].startsWith("1.5,accel,0.1,-9.81,0.333333,9.8") && rows[2].includes("5,,1,90"), rows[2]);
check("CSV quotes commas and quotes", C.csvCell('a,"b"') === '"a,""b"""' && C.csvCell(null) === "" && C.csvCell(NaN) === "");
check("CSV legend names every sensor's columns", C.csvLegend().split("\n").filter(Boolean).length === 14 && C.csvLegend().includes("accel,m/s²"));

// messages
check("message: hello keeps known sensors only and trims strings", (() => {
  const m = C.checkMessage({ type: "hello", protocol: 1, info: { model: "Pixel 8", x: "y".repeat(500) }, sensors: ["accel", "bogus", "geo"] });
  return m && m.sensors.join() === "accel,geo" && m.info.model === "Pixel 8" && m.info.x.length === 200;
})());
check("message: batch drops bad items, keeps good ones", (() => {
  const m = C.checkMessage({ type: "batch", items: [[10, "accel", [1, 2, 3, 4]], [11, "nope", [1]], [12, "accel", ["<script>", 2]], [13, "light", [5, 6, 7]], "x", [null, "light", [1]]] });
  return m && m.items.length === 2 && m.items[1][2].length === 1;
})());
check("message: unknown types and junk are refused", C.checkMessage({ type: "eval", code: "alert(1)" }) === null && C.checkMessage("hi") === null && C.checkMessage(null) === null);
check("message: camera frames must be small JPEG data URLs", C.checkMessage({ type: "frame", jpeg: "data:image/jpeg;base64,AAAA" }) !== null &&
  C.checkMessage({ type: "frame", jpeg: "javascript:alert(1)" }) === null && C.checkMessage({ type: "frame", jpeg: "data:image/svg+xml;base64,AAAA" }) === null);
check("message: status states are limited to the known ones", C.checkMessage({ type: "status", id: "geo", state: "hacked" }).state === "off" && C.checkMessage({ type: "status", id: "geo", state: "denied" }).state === "denied");
check("message: ping/pong carry numbers; the only command is a buzz", C.checkMessage({ type: "ping", n: 3, t: 99.5 }).n === 3 && C.checkMessage({ type: "pong", n: "3", t: 1 }) === null &&
  C.checkMessage({ type: "cmd", name: "vibrate" }) !== null && C.checkMessage({ type: "cmd", name: "camera" }) === null);
const bt = new C.Batcher(50, 20);
bt.add(0, "accel", [1]); bt.add(10, "accel", [2]); bt.add(60, "accel", [3]); bt.add(10, "gyro", [1]);
const b1 = bt.take(100), b2 = bt.take(120);
const jit = new C.Batcher(50, 60); let kept = 0; for (let t = 0; t < 1000; t += 16 + (t % 3)) if (jit.add(t, "accel", [1])) kept++;
check("batcher keeps a jittery 60 Hz stream whole", kept >= 55, kept);
check("batcher thins each sensor to its rate and flushes on time", b1 && b1.items.length === 3 && b2 === null && bt.take(200) === null);
const codes = new Set(); for (let i = 0; i < 500; i++) codes.add(C.pairCode());
check("pairing codes: six readable characters, no 0/O/1/I/L", [...codes].every((c) => C.validCode(c) && !/[01OIL]/.test(c)) && codes.size > 490);
check("pairing codes are normalised from what people type", C.normaliseCode(" ab-c 2d9x ") === "ABC2D9" && C.validCode(C.normaliseCode("abc2d9")) && !C.validCode("ABC0D9"));

// demo phone
const s0 = C.simulate(0), s5 = C.simulate(5);
check("demo phone: every sensor gives a value per channel", C.SENSORS.every((s) => Array.isArray(s0[s.id]) && s0[s.id].length === s.ch.length && s0[s.id].every((v) => typeof v === "number" && isFinite(v))));
check("demo phone: gravity has magnitude g on average", near(C.stats(Array.from({ length: 600 }, (_, i) => C.simulate(i / 60).accel[3])).mean, C.G, 0.6));
check("demo phone: walks about 6.5 m in 5 s", near(C.haversine(s0.geo[0], s0.geo[1], s5.geo[0], s5.geo[1]), 6.5, 0.3));
check("demo phone: the compass agrees with the orientation it reports", angNear(C.compassHeading(s5.orient[3], 0, 0), s5.orient[0], 1e-6));
check("fmt: dashes for missing, no negative zero", C.fmt(null) === "–" && C.fmt(-0.0001, 2) === "0.00" && C.fmt(3.14159, 3) === "3.142");

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
