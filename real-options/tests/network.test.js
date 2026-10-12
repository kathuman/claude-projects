// Two-region network checks — run with: node real-options/tests/network.test.js
// The joint lattice (exact growth in each region, the correlation, valid branches); fixed designs valued two ways;
// reduction to the single-site engine when one region is empty; separability without cross-region service;
// dominance between strategies; learning, pooling, the window and volatility; Monte Carlo replay of every policy.
const N = require("../src/network.js");
const M = require("../src/model.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const f = (x) => x.toFixed(2);

// ---- the joint lattice
{
  let bad = 0, worstG = 0, worstR = 0, n = 0, clamped = 0;
  for (const sa of [0.1, 0.2, 0.4, 0.6]) for (const sb of [0.1, 0.3, 0.5]) for (const ga of [-0.06, 0, 0.04]) for (const gb of [-0.04, 0.03, 0.08]) for (const rho of [-0.8, -0.3, 0, 0.5, 0.9]) {
    const L = N.lattice(N.merge({ sigA: sa, sigB: sb, gA: ga, gB: gb, rho })); n++;
    if (!L.q.every((x) => x >= -1e-15 && x <= 1) || Math.abs(L.q.reduce((a, b) => a + b, 0) - 1) > 1e-12) bad++;
    const pA = L.q[0] + L.q[1], pB = L.q[0] + L.q[2];
    worstG = Math.max(worstG, Math.abs(Math.log(pA * L.A.u + (1 - pA) * L.A.d) / L.dt - L.A.g), Math.abs(Math.log(pB * L.B.u + (1 - pB) * L.B.d) / L.dt - L.B.g));
    const corr = (L.q[0] - pA * pB) / Math.sqrt(pA * (1 - pA) * pB * (1 - pB));
    if (L.warnings.some((w) => /correlation/.test(w))) clamped++; else worstR = Math.max(worstR, Math.abs(corr - rho));
  }
  check("every branch probability is valid and they sum to one (" + n + " cases)", bad === 0);
  check("each region's expected growth is reproduced exactly", worstG < 1e-12, worstG.toExponential(2));
  check("the correlation of the two regions' moves is the one set (or the page is told it was limited)", worstR < 1e-12, worstR.toExponential(2) + ", " + clamped + " limited");
  check("a growth too strong for its volatility is limited and reported", N.lattice(N.merge({ sigA: 0.05, gA: 0.12 })).warnings.length > 0);
  const L = N.lattice(N.merge({})), w = N.weights2(L, 6);
  const margA = [0, 1, 2, 3, 4, 5, 6].map((a) => [0, 1, 2, 3, 4, 5, 6].reduce((s, b) => s + w[a * 7 + b], 0));
  const binom = (n, k, p) => { let c = 1; for (let x = 0; x < k; x++) c = c * (n - x) / (x + 1); return c * Math.pow(p, k) * Math.pow(1 - p, n - k); };
  check("multi-step joint weights sum to one and their margins are binomial", near(w.reduce((a, b) => a + b, 0), 1, 1e-12) && margA.every((v, a) => near(v, binom(6, a, L.q[0] + L.q[1]), 1e-12)));
}

// ---- fixed designs
{
  const cases = [[700, 0], [450, 300], [0, 400], [600, 250]];
  check("a fixed design valued as an expected sum equals its backward-induction value", cases.every((c) => near(N.fixedNpv({}, c[0], c[1]), N.fixedNpvBackward({}, c[0], c[1]), 1e-9)), cases.map((c) => f(N.fixedNpv({}, c[0], c[1]))).join(" "));
  // with region B empty, the network is the single-site model
  const shared = { margin: 0.02, opcost: 0.006, penalty: 0.01, outMargin: 0.006, outCap: 1, ceiling: 3, life: 20, buildLead: 1.5, wacc: 0.1, fFix: 8, fVar: 0.03 };
  const net = N.fixedNpv(Object.assign({ DA: 500, DB: 1e-9, sigA: 0.25, gA: 0.04 }, shared), 600, 0), one = M.fixedNpv(Object.assign({ D0: 500, sigma: 0.25, g: 0.04, salvF: 0, moth: 0 }, shared), 600);
  check("with region B empty, a hub in A is worth exactly what the single-site engine says", near(net, one, 1e-6), f(net) + " vs " + f(one));
  // with no cross-region service and no learning, the two regions are separate businesses
  const sep = { xcost: 1, learn: 0 }, v = (a, b) => N.fixedNpv(sep, a, b);
  check("with no cross-region service, two hubs are worth the sum of each region's hub on its own", near(v(450, 300) + v(0, 0), v(450, 0) + v(0, 300), 1e-9));
  check("cross-region service never lowers a design's value", [[450, 300], [700, 0], [0, 400]].every((c) => N.fixedNpv({}, c[0], c[1]) >= N.fixedNpv({ xcost: 1 }, c[0], c[1]) - 1e-9) && N.fixedNpv({}, 700, 0) > N.fixedNpv({ xcost: 1 }, 700, 0) + 1);
}

// ---- strategies
const base = N.solve({});
{
  check("waiting is worth at least any commitment it could make now: both hubs, or a pilot in either region", base.wait.npv >= base.both.npv - 1e-9 && base.wait.npv >= base.pilot.npv - 1e-9 && base.wait.npv >= base.pilot.other - 1e-9, f(base.wait.npv));
  check("the optimised designs beat nearby alternatives", N.fixedNpv({}, base.central.K * 1.1, 0) <= base.central.npv + 1e-9 && N.fixedNpv({}, base.central.K * 0.9, 0) <= base.central.npv + 1e-9 &&
    [[1.1, 1], [0.9, 1], [1, 1.1], [1, 0.9]].every((m) => N.fixedNpv({}, base.two.KA * m[0], base.two.KB * m[1]) <= base.two.npv + 1e-6));
  check("the two-hub optimum is at least as good as the planned sizes", base.two.npv >= base.both.npv - 1e-9);
  const L0 = N.solve({ learn: 0 }), L8 = N.solve({ learn: 0.8 });
  check("learning (a cheaper second hub) raises the value of both hubs, the pilot and waiting; the central hub is unaffected",
    L8.both.npv > base.both.npv && base.both.npv > L0.both.npv && L8.pilot.npv > L0.pilot.npv && L8.wait.npv > L0.wait.npv && near(L0.central.npv, L8.central.npv, 1e-9));
  const pool = [-0.6, -0.2, 0.2, 0.6, 0.9].map((rho) => N.fixedNpv({ rho }, 750, 0));
  check("pooling: a central hub is worth more the less correlated the regions are", pool.every((x, i) => i === 0 || x <= pool[i - 1] + 1e-9), pool.map(f).join(" ≥ "));
  const win = [2, 5, 8, 12].map((window) => N.solve({ window }).wait.npv);
  check("a longer decision window never lowers the value of waiting", win.every((x, i) => i === 0 || x >= win[i - 1] - 1e-9), win.map(f).join(" ≤ "));
  const opt = [0.15, 0.25, 0.35, 0.5].map((sigB) => { const s = N.solve({ sigB, basis: "rn", lambda: 0 }); return s.wait.npv - s.both.npv; });
  check("risk-neutral: the value of keeping the network open rises with region B's volatility", opt.every((x, i) => i === 0 || x >= opt[i - 1] - 1e-9), opt.map(f).join(" ≤ "));
  check("a dearer cross-region service lowers the central hub's value", N.solve({ xcost: 0.012 }).central.npv < base.central.npv);
  check("solving takes well under a second", (() => { const t = Date.now(); N.solve({}); return Date.now() - t < 800; })());
}

// ---- the policies, simulated, reproduce the lattice values
for (const o of [{}, { sigB: 0.5, gB: 0.02, rho: -0.3 }]) {
  const s = N.solve(o), sim = N.simulate(s, 5000, 5);
  ["central", "two", "both", "pilot", "wait"].forEach((k) => {
    const xs = sim.map((r) => r[k]), m = xs.reduce((a, b) => a + b, 0) / xs.length, se = Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length / xs.length);
    check("simulated " + k + " policy matches the lattice value within 3 standard errors " + JSON.stringify(o), Math.abs(m - s[k].npv) <= 3 * se + 1e-9, f(m) + " vs " + f(s[k].npv) + " (se " + f(se) + ")");
  });
  if (o.sigB) check("…and on some paths the second hub is opened later, and on others never", sim.some((r) => r.waitSecond !== null && r.waitSecond > 0) && sim.some((r) => r.waitSecond === null));
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
