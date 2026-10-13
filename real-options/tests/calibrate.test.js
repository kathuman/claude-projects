// Calibration checks — run with: node real-options/tests/calibrate.test.js
// Parsing the formats people paste; frequency detection; estimates on synthetic histories with known parameters
// (unbiased on average, 90% intervals that cover the truth about 90% of the time); removing the season; demand today;
// the warnings; the samples.
const C = require("../src/calibrate.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f3 = (x) => x.toFixed(3);

// ---- parsing
{
  const a = C.parse("date,demand\n2024-01,100\n2024-02,110\n2024-03,105\n");
  check("CSV with a header and ISO months", a.values.join() === "100,110,105" && a.dates.length === 3 && C.detectFrequency(a.dates) === 12);
  const b = C.parse("2024-01-01;10\n2024-01-08;11\n2024-01-15;12\n2024-01-22;13");
  check("semicolons and weekly dates", b.values.length === 4 && C.detectFrequency(b.dates) === 52);
  const c = C.parse("2019\t500\n2020\t520\n2021\t560\n2022\t540");
  check("tabs and yearly dates", c.values.length === 4 && C.detectFrequency(c.dates) === 1);
  const d = C.parse("2023 Q1,7\n2023 Q2,8\n2023 Q3,9\n2023 Q4,9.5");
  check("quarters written as 2023 Q1", d.values.length === 4 && C.detectFrequency(d.dates) === 4);
  const e = C.parse("120\n130\n\n125\n140\n");
  check("plain numbers, blank lines ignored, no dates", e.values.join() === "120,130,125,140" && e.dates === null);
  const g = C.parse("100\nabc\n110\n120");
  check("an unreadable line is skipped and reported", g.values.length === 3 && /skipped/.test(g.warnings[0]));
}

// ---- estimates against known parameters
{
  const truth = { f: 12, years: 8, start: 1000, g: 0.05, sigma: 0.25 };
  let sg = 0, gg = 0, covS = 0, covG = 0; const R = 400;
  for (let s = 1; s <= R; s++) {
    const est = C.estimate(C.synthetic(Object.assign({ seed: s }, truth)), 12);
    sg += est.sigma; gg += est.g;
    if (est.ciSigma[0] <= truth.sigma && truth.sigma <= est.ciSigma[1]) covS++;
    if (est.ciG[0] <= truth.g && truth.g <= est.ciG[1]) covG++;
  }
  check("volatility is estimated without bias on average (" + R + " synthetic histories)", near(sg / R, truth.sigma, 0.005), f3(sg / R));
  check("growth is estimated without bias on average", near(gg / R, truth.g, 0.015), f3(gg / R));
  check("the 90% interval for volatility covers the truth about 90% of the time", covS / R > 0.85 && covS / R < 0.95, (100 * covS / R).toFixed(1) + "%");
  check("the 90% interval for growth covers the truth about 90% of the time", covG / R > 0.85 && covG / R < 0.95, (100 * covG / R).toFixed(1) + "%");
  const short = C.estimate(C.synthetic({ f: 52, years: 2, start: 100, g: 0.05, sigma: 0.25, seed: 3 }), 52), long = C.estimate(C.synthetic({ f: 1, years: 30, start: 100, g: 0.05, sigma: 0.25, seed: 3 }), 1);
  check("growth uncertainty depends on the span of history, not the sampling: 2 years weekly is far less certain than 30 years yearly", short.seG > 2 * long.seG && short.seSigma < long.seSigma, f3(short.seG) + " vs " + f3(long.seG));
  const exact = C.estimate([100, 110, 121, 133.1], 1);
  check("a steady 10% a year gives growth ln(1.1), no volatility", near(exact.g, Math.log(1.1), 1e-9) && near(exact.sigma, 0, 1e-9));
}

// ---- seasons
{
  const o = { f: 12, years: 6, start: 1000, g: 0.03, sigma: 0.1, season: 0.15, seed: 9 }, v = C.synthetic(o);
  const raw = C.estimate(v, 12), ds = C.estimate(v, 12, { deseason: true });
  check("a seasonal history overstates volatility unless the season is removed", raw.sigma > 1.5 * ds.sigma && near(ds.sigma, 0.1, 0.03), f3(raw.sigma) + " → " + f3(ds.sigma));
  check("…the page is told the data look seasonal, and the removal does not shift growth much", raw.warnings.some((w) => /seasonal/.test(w)) && near(ds.g, raw.g, 0.03));
  check("removing the season needs two years of data", C.estimate(v.slice(0, 18), 12, { deseason: true }).warnings.some((w) => /two years/.test(w)));
}

// ---- demand today, errors and warnings
{
  const m = C.estimate([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12], 12, { units: "period", scale: 1000 });
  check("demand today is the last year's average as an annual rate, in thousand units", near(m.D0, 12 * 12 / 1000, 1e-12), m.D0);
  check("…or the last year's average itself when values are annual rates", near(C.estimate([100, 120, 130, 150], 1, { units: "year" }).D0, 150, 1e-12));
  let threw = 0;
  try { C.estimate([1, 0, 2], 12); } catch (e) { threw++; }
  try { C.estimate([1, 2], 12); } catch (e) { threw++; }
  check("zero or negative values, or too few, are refused with a reason", threw === 2);
  const rev = []; let x = 100; for (let k = 0; k < 120; k++) { rev.push(x); x = k % 2 ? x * 1.2 : x / 1.2; }
  check("strongly mean-reverting changes are flagged", C.estimate(rev, 12).warnings.some((w) => /autocorrelated/.test(w)));
  check("a short history is flagged", C.estimate([100, 105, 103, 110, 112], 4).warnings.some((w) => /three years/.test(w)));
}

// ---- the samples parse and recover their parameters roughly
for (const name of Object.keys(C.SAMPLES)) {
  const o = C.SAMPLES[name], p = C.parse(C.sampleText(o)), f = C.detectFrequency(p.dates), est = C.estimate(p.values, f, { deseason: !!o.season });
  check("sample \"" + name + "\": frequency detected and parameters inside their intervals", f === o.f && est.ciSigma[0] <= o.sigma && o.sigma <= est.ciSigma[1] && est.ciG[0] - 0.02 <= o.g && o.g <= est.ciG[1] + 0.02,
    "σ " + f3(est.sigma) + " g " + f3(est.g));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
