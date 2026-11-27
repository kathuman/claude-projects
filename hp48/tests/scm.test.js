// The supply chain pack without a ROM: the JavaScript references, the text typed to install it, and the checker.
const SCM = require("../src/scm.js");
const Typer = require("../src/typer.js");
const { check, summary } = require("./harness.js");

const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-12) * Math.max(1, Math.abs(b));
const N = SCM.normal;
check("the normal distribution: Φ(0) = 0.5, Φ(1) and Φ(-2.5) to 1e-13", near(N.cdf(0), 0.5) && near(N.cdf(1), 0.841344746068543, 1e-13) && near(N.cdf(-2.5), 0.00620966532577613, 1e-12));
check("…its tails beyond 2.5σ (continued fraction) meet the series smoothly", near(N.cdf(2.49999), N.cdf(2.50001), 1e-5) && near(N.cdf(4), 0.999968328758167, 1e-13));
check("…and its inverse: z(0.75) = 0.674489750196082, z(0.95) = 1.64485362695147", near(N.inv(0.75), 0.674489750196082, 1e-12) && near(N.inv(0.95), 1.64485362695147, 1e-12));

const P = Object.fromEntries(SCM.PROGRAMS.map((p) => [p.name, p]));
const [Q, Nn, TC] = P.EOQ.ref(12000, 100, 5);
check("EOQ: Q = √(2DS/H) = 692.82, N = D/Q, and at the EOQ ordering cost equals holding cost", near(Q, 692.820323027551) && near(Nn, 12000 / Q) && near(TC, 2 * Q / 2 * 5));
check("SS with no lead-time variation is z·σ·√L", near(P.SS.ref(2, 100, 20, 4, 0)[0], 80));
check("ROP = demand × lead time + safety stock", P.ROP.ref(100, 4, 50)[0] === 450);
check("newsvendor: CR = (p−c)/(p−v); CR 0.5 orders the mean", near(P.NEWS.ref(15, 6, 3, 500, 100)[0], 0.75) && near(P.NEWS.ref(10, 6, 2, 500, 100)[1], 500));
check("fill rate: G(0) = 1/√(2π), so k = 0 loses σ·0.3989 a cycle", near(P.FILL.ref(100, 10, 0)[1], 0.398942280401433) && near(P.FILL.ref(100, 10, 0)[0], 1 - 3.98942280401433 / 100));
check("Little's law fills whichever of the three is 0", P.LITTL.ref(0, 50, 4)[0] === 200 && P.LITTL.ref(200, 0, 4)[0] === 50 && P.LITTL.ref(200, 50, 0)[0] === 4);
check("bullwhip: equal lists give 1", near(P.BULL.ref([1, 2, 3], [1, 2, 3])[0], 1));

// the install text can be typed in full
const install = SCM.installText(), plan = Typer.plan(install, { enter: true });
check("installing types every character (no √ or Σ in the programs)", plan.unsupported.length === 0, plan.unsupported.join(" "));
check("…creates SCM if missing, stores each program and the helper, then shows the menu",
  /^« HOME IF 'SCM' VTYPE -1 == THEN 'SCM' CRDIR END SCM » EVAL/.test(install) && SCM.PROGRAMS.concat(SCM.HELPERS).every((p) => install.includes("'" + p.name + "' STO")) && /\{ EOQ SS ROP NEWS FILL LITTL BULL \} MENU$/.test(install));
check("each example is typeable and runs its program in SCM", SCM.PROGRAMS.every((p) => Typer.plan(SCM.exampleText(p)).unsupported.length === 0 && SCM.exampleText(p).startsWith("« SCM » EVAL ") && SCM.exampleText(p).endsWith(" " + p.name)));

// the checker: results are compared level by level (the last result is level 1)
const lv = (vals) => vals.map((v) => ({ type: "tagged", value: v, tag: "x" }));
const want = P.EOQ.ref.apply(null, P.EOQ.example);
check("check() passes the right results", SCM.check(P.EOQ, lv(want.slice().reverse())).ok);
check("…fails a result off in the 10th digit", !SCM.check(P.EOQ, lv([want[2], want[1], want[0] * (1 + 1e-9)])).ok);
check("…and a missing result", !SCM.check(P.EOQ, lv([want[2], want[1]])).ok);

summary("scm");
