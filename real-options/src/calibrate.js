// Real Options for Network Design — calibration: volatility and growth from a demand history. Pure functions, run in
// the pages and in the Node tests.
//
// The lattice assumes demand follows geometric Brownian motion: log demand moves by (g − σ²/2)·Δt + σ·√Δt·ε each
// period, so the expected demand grows at g. From n positive observations at f periods a year:
//   r_k = ln(x_k+1 / x_k)        σ = sd(r)·√f        μ = mean(r)·f        g = μ + σ²/2
//   se(μ) = σ/√T (T years of history)   se(σ) ≈ σ/√(2(n−1))   se(g)² ≈ se(μ)² + (σ·se(σ))²
// The growth estimate is far less certain than the volatility estimate: it depends only on the span of the history,
// not on how often it was sampled. Seasonal data inflate the volatility, so with at least two years of weekly, monthly
// or quarterly data the season can be removed first (each season's average deviation from the log trend).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ROCalibrate = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var Z90 = 1.6449;

  // ---- parsing: one observation per line; "date,value", "date;value", "date<TAB>value" or just "value"; a header line
  // and thousands separators are tolerated. Dates (ISO yyyy-mm-dd, yyyy-mm or yyyy) let the frequency be detected.
  function parse(text) {
    var lines = String(text || "").split(/\r?\n/), values = [], dates = [], warnings = [], skipped = 0;
    lines.forEach(function (raw, k) {
      var line = raw.trim(); if (!line) return;
      var parts = line.split(/[;,\t]|\s{2,}/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
      if (parts.length === 0) return;
      var vtxt = parts[parts.length - 1].replace(/[\s_']/g, "");
      // "1,234" style thousands separators survive only when the line had a single field
      var v = parseFloat(vtxt);
      if (!isFinite(v)) { if (values.length === 0 && k < 3) return; skipped++; return; }
      values.push(v);
      dates.push(parts.length > 1 ? parseDate(parts[0]) : null);
    });
    if (skipped) warnings.push(skipped + " line" + (skipped > 1 ? "s" : "") + " could not be read and were skipped.");
    var haveDates = dates.length > 0 && dates.every(function (d) { return d !== null; });
    return { values: values, dates: haveDates ? dates : null, warnings: warnings };
  }
  function parseDate(s) {
    var m = /^(\d{4})(?:[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?)?$/.exec(s.trim());
    if (m) return Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
    m = /^(\d{4})\s*-?\s*Q([1-4])$/i.exec(s.trim());
    if (m) return Date.UTC(+m[1], (+m[2] - 1) * 3, 1);
    var t = Date.parse(s); return isFinite(t) ? t : null;
  }
  // periods per year from the median spacing of the dates: 52, 12, 4 or 1
  function detectFrequency(dates) {
    if (!dates || dates.length < 3) return null;
    var gaps = []; for (var k = 1; k < dates.length; k++) gaps.push((dates[k] - dates[k - 1]) / 86400000);
    gaps.sort(function (a, b) { return a - b; });
    var g = gaps[Math.floor(gaps.length / 2)];
    if (g <= 0) return null;
    if (g < 10) return 52; if (g < 50) return 12; if (g < 150) return 4; return 1;
  }

  // remove the season: subtract each season's average deviation from a straight log trend
  function deseasonalise(logs, f) {
    var n = logs.length, mx = (n - 1) / 2, sx = 0, sxy = 0, my = 0;
    for (var k = 0; k < n; k++) my += logs[k]; my /= n;
    for (k = 0; k < n; k++) { sx += (k - mx) * (k - mx); sxy += (k - mx) * (logs[k] - my); }
    var b = sxy / sx, sum = new Float64Array(f), cnt = new Float64Array(f);
    for (k = 0; k < n; k++) { var r = logs[k] - (my + b * (k - mx)); sum[k % f] += r; cnt[k % f]++; }
    var fac = new Float64Array(f), mean = 0;
    for (var s = 0; s < f; s++) { fac[s] = cnt[s] ? sum[s] / cnt[s] : 0; mean += fac[s]; }
    mean /= f;
    var out = new Float64Array(n);
    for (k = 0; k < n; k++) out[k] = logs[k] - (fac[k % f] - mean);
    return { logs: out, factors: Array.prototype.map.call(fac, function (v) { return v - mean; }) };
  }

  // ---- estimation. units: "period" (each value is demand in its period) or "year" (each value is an annual rate);
  // scale: divide by this to express demand in the model's thousand units (1000 when values are in units)
  function estimate(values, f, opts) {
    opts = opts || {};
    var n = values.length, warnings = [];
    if (n < 3) throw new Error("At least three observations are needed.");
    if (!values.every(function (v) { return v > 0; })) throw new Error("Every value must be positive: demand on a lattice cannot be zero or negative.");
    if (!(f > 0)) throw new Error("Unknown frequency: say how many observations make a year.");
    var logs = values.map(Math.log), seasonal = false, factors = null;
    var canSeason = (f === 4 || f === 12 || f === 52) && n >= 2 * f;
    if (opts.deseason && canSeason) { var d = deseasonalise(logs, f); logs = Array.prototype.slice.call(d.logs); factors = d.factors; seasonal = true; }
    else if (opts.deseason) warnings.push("The season can only be removed with at least two years of weekly, monthly or quarterly data.");
    var r = []; for (var k = 1; k < n; k++) r.push(logs[k] - logs[k - 1]);
    var m = r.length, mr = r.reduce(function (a, b) { return a + b; }, 0) / m;
    var vr = r.reduce(function (a, b) { return a + (b - mr) * (b - mr); }, 0) / Math.max(1, m - 1);
    var sigma = Math.sqrt(vr * f), mu = mr * f, g = mu + sigma * sigma / 2, T = m / f;
    var seSigma = sigma / Math.sqrt(2 * Math.max(1, m - 1)), seMu = sigma / Math.sqrt(T), seG = Math.sqrt(seMu * seMu + Math.pow(sigma * seSigma, 2));
    if (T < 3) warnings.push("Less than three years of history: the growth estimate is very uncertain.");
    if (m < 12) warnings.push("Fewer than twelve changes: the volatility estimate is rough.");
    // first-order autocorrelation of the changes: strong values mean the random-walk assumption is doubtful
    var ac = 0, a0 = 0; for (k = 0; k < m; k++) { a0 += (r[k] - mr) * (r[k] - mr); if (k) ac += (r[k] - mr) * (r[k - 1] - mr); }
    var rho1 = a0 > 0 ? ac / a0 : 0;
    if (m >= 12 && Math.abs(rho1) > 2 / Math.sqrt(m)) warnings.push("The changes are autocorrelated (" + rho1.toFixed(2) + "): demand " + (rho1 < 0 ? "tends to revert after a move, so the volatility over longer horizons is probably lower" : "moves in runs, so the volatility over longer horizons is probably higher") + " than estimated.");
    if (!seasonal && canSeason && seasonStrength(logs, f) > 0.3) warnings.push("The data look seasonal; removing the season gives a more meaningful volatility.");
    // demand today, as an annual rate in the model's units: the average of the last year
    var last = Math.min(n, Math.max(1, Math.round(f))), recent = 0;
    for (k = n - last; k < n; k++) recent += values[k]; recent /= last;
    var D0 = (opts.units === "year" ? recent : recent * f) / (opts.scale || 1);
    return { n: n, f: f, years: T, sigma: sigma, mu: mu, g: g, seSigma: seSigma, seMu: seMu, seG: seG,
      ciSigma: [Math.max(0, sigma - Z90 * seSigma), sigma + Z90 * seSigma], ciG: [g - Z90 * seG, g + Z90 * seG],
      D0: D0, rho1: rho1, seasonal: seasonal, factors: factors, warnings: warnings, logs: logs };
  }
  // share of the variance of detrended logs explained by the season
  function seasonStrength(logs, f) {
    var d = deseasonalise(logs, f), n = logs.length, mx = (n - 1) / 2, my = 0, sx = 0, sxy = 0;
    for (var k = 0; k < n; k++) my += logs[k]; my /= n;
    for (k = 0; k < n; k++) { sx += (k - mx) * (k - mx); sxy += (k - mx) * (logs[k] - my); }
    var b = sxy / sx, tot = 0, res = 0;
    for (k = 0; k < n; k++) { var e = logs[k] - (my + b * (k - mx)); tot += e * e; var e2 = d.logs[k] - (my + b * (k - mx)); res += e2 * e2; }
    return tot > 0 ? 1 - res / tot : 0;
  }

  // ---- synthetic histories (seeded), for the samples and the tests
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function gauss(next) { var u = Math.max(1e-12, next()), v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function synthetic(o) {
    var next = rng(o.seed || 1), f = o.f, n = Math.round(o.years * f) + 1, x = Math.log(o.start), out = [], dt = 1 / f;
    for (var k = 0; k < n; k++) {
      var season = o.season ? o.season * Math.sin(2 * Math.PI * (k % f) / f) : 0;
      out.push(Math.exp(x + season));
      x += (o.g - o.sigma * o.sigma / 2) * dt + o.sigma * Math.sqrt(dt) * gauss(next);
    }
    return out;
  }
  // samples as CSV text with dates, so the expected format is visible
  function sampleText(o) {
    var vals = synthetic(o), y0 = 2026 - Math.ceil(o.years), lines = ["date,demand"];
    vals.forEach(function (v, k) {
      var d;
      if (o.f === 12) d = (y0 + Math.floor(k / 12)) + "-" + pad(k % 12 + 1);
      else if (o.f === 4) d = (y0 + Math.floor(k / 4)) + "-" + pad(3 * (k % 4) + 1);
      else if (o.f === 52) { var t = new Date(Date.UTC(y0, 0, 1) + k * 7 * 86400000); d = t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); }
      else d = String(y0 + k);
      lines.push(d + "," + Math.round(v));
    });
    return lines.join("\n");
  }
  function pad(v) { return v < 10 ? "0" + v : String(v); }
  var SAMPLES = {
    "Grocery staples (monthly, seasonal)": { f: 12, years: 6, start: 40000, g: 0.03, sigma: 0.08, season: 0.12, seed: 109 },
    "E-commerce growth (weekly)": { f: 52, years: 3, start: 6000, g: 0.15, sigma: 0.35, seed: 236 },
    "Legacy product in decline (quarterly)": { f: 4, years: 9, start: 150000, g: -0.05, sigma: 0.14, seed: 377 },
    "Volatile industrial (monthly)": { f: 12, years: 5, start: 45000, g: 0.02, sigma: 0.32, seed: 176 }
  };

  return { parse: parse, detectFrequency: detectFrequency, deseasonalise: deseasonalise, estimate: estimate, seasonStrength: seasonStrength,
    synthetic: synthetic, sampleText: sampleText, SAMPLES: SAMPLES, Z90: Z90 };
});
