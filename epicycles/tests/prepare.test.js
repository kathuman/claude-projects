// Epicycles preparation checks — run with: node epicycles/tests/prepare.test.js
// The bilateral filter removes grain but keeps a step edge; posterize gives the levels asked for; background removal
// clears a shaded background (and clicked patches) but keeps the subject; the tone curve is zero up to the cutoff
// and rises from there; shading puts about as many points as asked, none on white and more where it is darker.
const P = require("../src/prepare.js"), E = require("../src/fourier.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function picture(w, h, f) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, c = f(x, y); px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return px;
}
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

// ---- smoothing: grain goes, the edge stays
{
  const w = 80, h = 40;
  const px = picture(w, h, (x) => { const v = (x < 40 ? 60 : 200) + 50 * (rnd() - 0.5); return [v, v, v]; });
  const c = P.toRGB(px, w, h), sp = P.smoothingParams(6), s = P.bilateral(c, w, h, sp.radius, sp.sigmaR, sp.passes);
  const flat = (img) => { const a = []; for (let y = 5; y < 35; y++) for (let x = 5; x < 30; x++) a.push(img.r[y * w + x]); return a; };
  check("the bilateral filter removes most of the grain", sd(flat(s)) < 0.4 * sd(flat(c)), sd(flat(c)).toFixed(3) + " → " + sd(flat(s)).toFixed(3));
  const step = (img) => { let a = 0, b = 0; for (let y = 5; y < 35; y++) { a += img.r[y * w + 38]; b += img.r[y * w + 41]; } return (b - a) / 30; };
  check("…but keeps the step edge sharp", step(s) > 0.85 * (140 / 255), "contrast across 3 px " + step(s).toFixed(3) + " of " + (140 / 255).toFixed(3));
  check("strength 0 turns smoothing off", P.smoothingParams(0) === null);
}

// ---- posterize
{
  const g = new Float32Array(1000).map((_, i) => i / 999);
  for (const L of [2, 4, 6]) check("posterize to " + L + " levels gives " + L + " tones", new Set(P.posterize(g, L)).size === L);
  check("posterize off leaves the picture as it is", P.posterize(g, 0) === g);
}

// ---- background: a shaded wall with a dark subject, and a stray patch
{
  const w = 120, h = 90;
  const px = picture(w, h, (x, y) => {
    if (Math.hypot(x - 60, y - 45) < 25) return [40, 30, 30];                       // subject
    if (x > 100 && x < 110 && y > 10 && y < 20) return [120, 140, 120];             // a patch not touching the border
    const v = 200 + 40 * x / w + 10 * (rnd() - 0.5); return [v, v, v - 10];          // a gently shaded wall with grain
  });
  const r = P.prepare(px, w, h, { smooth: 4, removeBackground: true, tolerance: 30 });
  const subjectKept = r.mask[45 * w + 60] === 0, wallGone = r.mask[5 * w + 5] === 1 && r.mask[85 * w + 115] === 1;
  check("background removal clears a shaded wall and keeps the subject", subjectKept && wallGone);
  check("…and the removed background is pure white", r.gray[5 * w + 5] === 1 && r.gray[85 * w + 115] === 1);
  check("a patch not touching the border survives the fill", r.mask[15 * w + 105] === 0);
  const clicked = P.prepare(px, w, h, { smooth: 4, removeBackground: true, tolerance: 30, seeds: [[105, 15]] });
  check("…until it is clicked", clicked.mask[15 * w + 105] === 1 && clicked.mask[45 * w + 60] === 0);
  const largest = P.prepare(px, w, h, { smooth: 4, removeBackground: true, tolerance: 30, largest: true });
  check("…or only the largest subject is kept", largest.mask[15 * w + 105] === 1 && largest.mask[45 * w + 60] === 0);
  const unsmoothed = P.prepare(px, w, h, { smooth: 0, removeBackground: true, tolerance: 30 });
  const cleared = Array.from(unsmoothed.mask).filter((v, i) => v && Math.hypot(i % w - 60, Math.floor(i / w) - 45) > 27).length;
  const wall = Array.from({ length: w * h }, (_, i) => i).filter((i) => Math.hypot(i % w - 60, Math.floor(i / w) - 45) > 27 && !(i % w > 100 && i % w < 110 && Math.floor(i / w) > 10 && Math.floor(i / w) < 20)).length;
  check("…even with smoothing off: grain does not stop the fill", cleared / wall > 0.97 && unsmoothed.mask[45 * w + 60] === 0, (100 * cleared / wall).toFixed(1) + " % of the wall");
  const off = P.prepare(px, w, h, { removeBackground: false });
  check("with removal off nothing is masked", off.mask === null && off.gray[5 * w + 5] < 1);
  const inv = P.prepare(picture(40, 40, (x, y) => (Math.hypot(x - 20, y - 20) < 10 ? [250, 250, 250] : [10, 10, 10])), 40, 40, { invert: true });
  check("invert makes a light subject on dark the dark one", inv.gray[20 * 40 + 20] < 0.1 && inv.gray[0] > 0.9);
}

// ---- tone curve
{
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  const d = xs.map((x) => P.toneDensity(x, 0.3, 2));
  check("the tone curve is exactly zero up to the cutoff", d.slice(0, 31).every((v) => v === 0));
  check("…rises from there to 1", d.slice(31).every((v, i, a) => v > 0 && (i === 0 || v >= a[i - 1])) && Math.abs(d[100] - 1) < 1e-12);
  check("…and a gamma above 1 keeps light tones lighter than a straight line", P.toneDensity(0.5, 0.3, 2) < (0.5 - 0.3) / 0.7);
  const r = P.prepare(picture(10, 1, (x) => [255 - 25 * x, 255 - 25 * x, 255 - 25 * x]), 10, 1, { cutoff: 40, gamma: 2 });
  check("prepare turns everything lighter than the cutoff pure white", Array.from(r.gray.slice(0, 4)).every((v) => v === 1) && r.gray[9] < 1);
}

// ---- shading
{
  const w = 200, h = 100, g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x < 50 ? 1 : x < 125 ? 0.75 : 0.25;   // white, light, dark
  const pts = E.stipple(g, w, h, 2000);
  check("shading places about as many points as asked", Math.abs(pts.length - 2000) < 60, pts.length);
  check("…none on pure white", pts.every((p) => p[0] >= 50));
  const light = pts.filter((p) => p[0] < 125).length, dark = pts.length - light;
  check("…and three times as many on a tone three times as dark", Math.abs(dark / light - 3) < 0.25, (dark / light).toFixed(2));
  const tr = E.traceImage(null, w, h, { mode: "shading", gray: g, maxPoints: 800, timeBudgetMs: 2000 });
  check("a shaded picture traces into one closed line through its points", tr && tr.tour.length === tr.points && tr.points <= 800 && tr.tour.every((p) => p[0] >= 50), tr && tr.points);
  check("a white picture has nothing to shade", E.stipple(new Float32Array(100).fill(1), 10, 10, 50).length === 0);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
