// Epicycles checks — run with: node epicycles/tests/fourier.test.js
// A circle needs exactly one circle per side; the full series rebuilds the path; the error falls as circles are
// added and matches the measured distance; the tour visits every point once and 2-opt never lengthens it; the
// resampling is even; and a drawn picture comes back as a closed line along its outline.
const E = require("../src/fourier.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const TAU = Math.PI * 2;

// ---- a circle is one circle per side, turning once per cycle
{
  const M = 256, pts = [];
  for (let j = 0; j < M; j++) pts.push([0.3 + 0.8 * Math.cos(TAU * j / M + 0.4), -0.2 + 0.8 * Math.sin(TAU * j / M + 0.4)]);
  const s = E.series(pts, 20);
  check("a circle: x has one circle of its radius at k = 1", near(s.x.r[1], 0.8, 1e-12) && s.x.r.slice(2).every((r) => r < 1e-12), s.x.r[1]);
  check("…and so has y", near(s.y.r[1], 0.8, 1e-12) && s.y.r.slice(2).every((r) => r < 1e-12), s.y.r[1]);
  check("…the centre is the constant term", near(s.x.a0, 0.3, 1e-12) && near(s.y.a0, -0.2, 1e-12));
  check("…and the phase puts the pen where it started", near(E.evalAxis(s.x, [1], 1, 0), pts[0][0], 1e-12) && near(E.evalAxis(s.y, [1], 1, 0), pts[0][1], 1e-12));
  const ox = E.circleOrder(s.x, "frequency"), oy = E.circleOrder(s.y, "frequency");
  check("…so one circle per side leaves no error", E.relativeError(s, ox, oy, 1) < 1e-9);
}

// ---- term k turns k times per cycle: a pure third harmonic repeats three times
{
  const M = 128, pts = [];
  for (let j = 0; j < M; j++) pts.push([Math.cos(3 * TAU * j / M), Math.sin(5 * TAU * j / M)]);
  const s = E.series(pts, 10);
  check("x = cos 3t lands on k = 3 only, y = sin 5t on k = 5 only", near(s.x.r[3], 1, 1e-12) && near(s.y.r[5], 1, 1e-12) &&
    s.x.r.every((r, k) => k === 3 || r < 1e-12) && s.y.r.every((r, k) => k === 5 || r < 1e-12));
  check("…and sin 5t is cos(5t − π/2)", near(s.y.phi[5], -Math.PI / 2, 1e-12));
}

// ---- a square: the full series rebuilds it, and fewer circles get closer as they are added
{
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], path = [];
  corners.forEach((c, i) => { const d = corners[(i + 1) % 4]; for (let s = 0; s < 64; s++) path.push([c[0] + (d[0] - c[0]) * s / 64, c[1] + (d[1] - c[1]) * s / 64]); });
  const pts = E.resample(path, 256), s = E.series(pts);
  check("K defaults to M/2 − 1", s.K === 127, s.K);
  const ox = E.circleOrder(s.x, "frequency"), oy = E.circleOrder(s.y, "frequency");
  // the Nyquist term (k = M/2) is left out, so the rebuild is exact up to it; measure against the series itself
  let worst = 0;
  pts.forEach((p, j) => { const t = TAU * j / 256; worst = Math.max(worst, Math.hypot(E.evalAxis(s.x, ox, s.K, t) - p[0], E.evalAxis(s.y, oy, s.K, t) - p[1])); });
  check("all the circles rebuild the square to within the left-out Nyquist term", worst < 0.02, worst.toExponential(2));
  const errs = [1, 2, 3, 5, 10, 20, 50, 127].map((n) => E.relativeError(s, ox, oy, n));
  check("the error never grows as circles are added", errs.every((e, i) => i === 0 || e <= errs[i - 1] + 1e-15), errs.map((e) => e.toFixed(3)).join(" "));
  check("…and with every circle it is zero", errs[errs.length - 1] < 1e-9);
  // the Parseval error equals the RMS distance to the full series, measured point by point
  for (const N of [1, 3, 10]) {
    let num = 0, den = 0;
    pts.forEach((p, j) => {
      const t = TAU * j / 256, fx = E.evalAxis(s.x, ox, s.K, t), fy = E.evalAxis(s.y, oy, s.K, t);
      num += (E.evalAxis(s.x, ox, N, t) - fx) ** 2 + (E.evalAxis(s.y, oy, N, t) - fy) ** 2;
      den += (fx - s.x.a0) ** 2 + (fy - s.y.a0) ** 2;
    });
    check("the reported error with " + N + " circles is the measured RMS distance", near(E.relativeError(s, ox, oy, N), Math.sqrt(num / den), 1e-9));
  }
  const sx = E.circleOrder(s.x, "size"), sy = E.circleOrder(s.y, "size");
  check("largest-first is never worse than series order at the same count", [1, 2, 3, 5, 10].every((n) => E.relativeError(s, sx, sy, n) <= E.relativeError(s, ox, oy, n) + 1e-12));
  check("largest-first lists every harmonic once", sx.length === s.K && new Set(sx).size === s.K);
}

// ---- the chains: the x chain's tip gives x, the y chain's tip gives y
{
  const pts = [];
  for (let j = 0; j < 200; j++) { const t = TAU * j / 200; pts.push([Math.cos(t) + 0.4 * Math.cos(3 * t + 1), Math.sin(2 * t) - 0.3 * Math.sin(t)]); }
  const s = E.series(pts, 30), ox = E.circleOrder(s.x, "size"), oy = E.circleOrder(s.y, "size");
  let ok = true;
  for (const t of [0, 0.7, 2, 4.4]) {
    const cx = E.chain(s.x, ox, 6, t, [s.x.a0, -3], "x"), cy = E.chain(s.y, oy, 6, t, [-3, s.y.a0], "y");
    ok = ok && near(cx[cx.length - 1][0], E.evalAxis(s.x, ox, 6, t), 1e-12) && near(cy[cy.length - 1][1], E.evalAxis(s.y, oy, 6, t), 1e-12) && cx.length === 7;
  }
  check("chain tips equal the truncated series on each side", ok);
  check("the radius sum bounds how far a chain reaches", near(E.radiusSum(s.x, ox, 2), s.x.r[1] + s.x.r[3], 1e-12));
}

// ---- tours
{
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = []; for (let i = 0; i < 600; i++) pts.push([rnd() * 100, rnd() * 60]);
  const nn = E.nearestNeighbourTour(pts), opt = E.twoOpt(nn);
  check("nearest neighbour visits every point exactly once", nn.length === pts.length && new Set(nn).size === pts.length);
  check("2-opt keeps every point", opt.length === pts.length && new Set(opt).size === pts.length);
  check("2-opt never lengthens the cycle", E.tourLength(opt) <= E.tourLength(nn) + 1e-9, E.tourLength(nn).toFixed(1) + " → " + E.tourLength(opt).toFixed(1));
  // points on a circle, shuffled: the best cycle is the circle itself
  const ring = []; for (let i = 0; i < 80; i++) ring.push([Math.cos(TAU * i / 80), Math.sin(TAU * i / 80)]);
  const shuffled = ring.slice().sort(() => rnd() - 0.5), best = 80 * 2 * Math.sin(Math.PI / 80);
  check("points on a circle are joined in circle order", near(E.tourLength(E.twoOpt(E.nearestNeighbourTour(shuffled))), best, 1e-9));
}

// ---- resampling and thinning
{
  const path = [[0, 0], [10, 0], [10, 1], [0, 1]], r = E.resample(path, 22);
  const gaps = r.map((p, i) => Math.hypot(r[(i + 1) % 22][0] - p[0], r[(i + 1) % 22][1] - p[1]));
  check("resampled points are evenly spaced along the line", gaps.every((g) => near(g, 1, 1e-9)), Math.min(...gaps) + " … " + Math.max(...gaps));
  const n = E.normalise([[10, 20], [30, 20], [30, 60]]);
  check("normalise fits the longer side to [−1, 1]", near(n.path[2][1], 1, 1e-12) && near(n.path[0][1], -1, 1e-12) && near(n.path[0][0], -0.5, 1e-12));
  const many = []; for (let x = 0; x < 100; x++) for (let y = 0; y < 100; y++) many.push([x, y]);
  const th = E.thin(many, 500);
  check("thinning keeps no more than asked and spreads what it keeps", th.length <= 500 && th.length > 300 && Math.max(...th.map((p) => p[0])) > 80, th.length);
  check("stages run 1, 2, 3 … and end at the largest count", E.stages(500).slice(0, 4).join() === "1,2,3,4" && E.stages(500).at(-1) === 500 && E.stages(37).at(-1) === 37);
}

// ---- a picture: a black ring on white comes back as a closed line along its outline
{
  const w = 120, h = 100, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 60, y - 50), ink = d < 35 && d > 25, i = (y * w + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = ink ? 0 : 255; rgba[i + 3] = 255;
  }
  check("Otsu splits black and white between them", (() => { const t = E.otsu(E.grayscale(rgba, w, h)); return t > 0 && t <= 1; })());
  for (const mode of ["outline", "edges"]) {
    const tr = E.traceImage(rgba, w, h, { mode, maxPoints: 400, timeBudgetMs: 2000 });
    const onRing = tr.tour.every((p) => { const d = Math.hypot(p[0] - 60, p[1] - 50); return d > 22 && d < 38; });
    check(mode + ": every point of the line lies on the ring's edges", tr && onRing && tr.points <= 400, tr && tr.points + " points from " + tr.pixels + " pixels");
    const s = E.series(E.normalise(E.resample(tr.tour, 512)).path);
    const ox = E.circleOrder(s.x, "size"), oy = E.circleOrder(s.y, "size");
    check(mode + ": thirty circles per side draw it to within 15 %", E.relativeError(s, ox, oy, 30) < 0.15, (100 * E.relativeError(s, ox, oy, 30)).toFixed(1) + " %");
  }
  const a = E.analyse(rgba, w, h);
  check("a black ring on white is two-tone on a light background", a.twoTone && !a.darkBackground, a.separability.toFixed(3));
  const neg = rgba.map((v, i) => (i % 4 === 3 ? v : 255 - v)), an = E.analyse(neg, w, h);
  check("…its negative is two-tone on a dark background", an.twoTone && an.darkBackground);
  const tr = E.traceImage(neg, w, h, { mode: "outline", invert: true, maxPoints: 400 });
  check("…and traced as light shapes it lies on the same ring", tr && tr.tour.every((p) => { const d = Math.hypot(p[0] - 60, p[1] - 50); return d > 22 && d < 38; }));
  let s2 = 3; const noise = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
  const photo = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, v = 255 * (0.5 + 0.3 * Math.sin(x / 9) * Math.cos(y / 13)) + 40 * (noise() - 0.5); photo[i] = photo[i + 1] = photo[i + 2] = v; photo[i + 3] = 255; }
  check("a picture of smooth shading and noise (a photo) is not two-tone", !E.analyse(photo, w, h).twoTone, E.analyse(photo, w, h).separability.toFixed(3));
  // a grainy photo of a dark disk on a shaded background: the edges are the disk's rim, not the grain
  const W2 = 240, H2 = 180, grainy = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = (y * W2 + x) * 4, inDisk = Math.hypot(x - 110, y - 90) < 50;
    const v = (inDisk ? 70 : 150 + 60 * x / W2) + 60 * (noise() - 0.5);
    grainy[i] = grainy[i + 1] = grainy[i + 2] = v; grainy[i + 3] = 255;
  }
  const ep = E.edgePixels(E.grayscale(grainy, W2, H2), W2, H2, 0.5);
  const onRim = ep.filter((p) => Math.abs(Math.hypot(p[0] - 110, p[1] - 90) - 50) <= 3).length;
  check("edges of a grainy photo lie on the real contour, not the grain", ep.length > 200 && onRim / ep.length > 0.9, onRim + " of " + ep.length + " on the rim");
  const around = new Set(ep.filter((p) => Math.abs(Math.hypot(p[0] - 110, p[1] - 90) - 50) <= 3).map((p) => Math.round(Math.atan2(p[1] - 90, p[0] - 110) * 18 / Math.PI)));
  check("…and they go all the way round it", around.size >= 34, around.size + " of 36 ten-degree sectors");
  // a clean picture with a strong edge (dark disk) and a faint one (a square a little darker than the paper)
  const clean = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = (y * W2 + x) * 4, v = Math.hypot(x - 70, y - 90) < 40 ? 40 : (x > 150 && x < 210 && y > 60 && y < 120 ? 205 : 235);
    clean[i] = clean[i + 1] = clean[i + 2] = v; clean[i + 3] = 255;
  }
  const cg = E.grayscale(clean, W2, H2), ce = E.edgePixels(cg, W2, H2, 0.5);
  const onSquare = ce.filter((p) => p[0] > 145 && p[0] < 215 && p[1] > 55 && p[1] < 125).length;
  check("a clean picture keeps a faint edge beside a strong one", onSquare > 150 && ce.length - onSquare > 150, onSquare + " on the faint square, " + (ce.length - onSquare) + " on the disk");
  const c0 = E.edgePixels(cg, W2, H2, 0);
  check("…the lowest detail still keeps the strong edge", c0.filter((p) => p[0] < 145).length > 150, c0.length);
  check("…and more detail never keeps fewer edge pixels", E.edgePixels(cg, W2, H2, 1).length >= ce.length && ce.length >= c0.length);
  const blank = new Uint8ClampedArray(w * h * 4).fill(255);
  check("a blank picture gives no line", E.traceImage(blank, w, h, { mode: "edges" }) === null);
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
