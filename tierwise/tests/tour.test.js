// Tierwise — the tutorial: every level and step is complete in English, Spanish and Danish, points at an element that
// exists, quotes only known numbers, and every answer it calls right is true of the plan.
const fs = require("fs"), path = require("path");
const P = require("../src/plan.js"), N = require("../src/network.js");
const C = require("../tour-content.js"), ES = require("../tour-content-es.js"), DA = require("../tour-content-da.js");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } }
const sum = (s, a, b) => { let t = 0; for (let i = a; i < b; i++) t += s[i]; return t; };
const first = (r) => { let b = Infinity, id = null; Object.values(r.sites).forEach((o) => { if (o.firstOver >= 0 && o.firstOver < b) { b = o.firstOver; id = o.site.id; } }); return { m: b, id: id }; };

// ---- structure
const ids = new Set(), steps = [];
C.LEVELS.forEach((l) => l.steps.forEach((s) => { check("unique step id " + s.id, !ids.has(s.id)); ids.add(s.id); steps.push(s); }));
check("four levels: beginner, intermediate, advanced, expert", C.LEVELS.map((l) => l.id).join() === "beginner,intermediate,advanced,expert");
check("each level has 8–12 steps", C.LEVELS.every((l) => l.steps.length >= 8 && l.steps.length <= 12));
steps.forEach((s) => {
  const id = (s.target.match(/^#([\w-]+)$/) || [])[1];
  check("step " + s.id + " points at an element of the page", id && new RegExp('id="' + id + '"').test(html), s.target);
  const sc = (s.setup || {}).scenario; check("step " + s.id + " uses a known scenario", !sc || !!N.SCENARIOS[sc]);
  const toks = (s.body + (s.quiz ? s.quiz.explain : "")).match(/\{\{(\w+)\}\}/g) || [];
  check("step " + s.id + " quotes known numbers only", toks.every((t) => C.TOKENS.indexOf(t.slice(2, -2)) >= 0), toks);
  if (s.quiz) check("step " + s.id + " has a question with a claim and a valid answer", s.quiz.claim && s.quiz.answer >= 0 && s.quiz.answer < s.quiz.options.length);
});
for (const [lang, TR] of [["es", ES], ["da", DA]]) {
  C.LEVELS.forEach((l) => check(lang + ": level " + l.id + " translated", TR.levels[l.id] && TR.levels[l.id].title && TR.levels[l.id].blurb));
  const missing = steps.filter((s) => !TR.steps[s.id] || !TR.steps[s.id].title || !TR.steps[s.id].body).map((s) => s.id);
  check(lang + ": every step translated", !missing.length, missing);
  check(lang + ": no extra steps", Object.keys(TR.steps).every((k) => ids.has(k)));
  steps.forEach((s) => {
    const t = TR.steps[s.id]; if (!t) return;
    const tk = (x) => (String(x).match(/\{\{\w+\}\}/g) || []).sort().join();
    check(lang + ": " + s.id + " quotes the same numbers", tk(s.body) === tk(t.body) && (!s.quiz || tk(s.quiz.explain) === tk(t.quiz && t.quiz.explain)));
    if (s.quiz) check(lang + ": " + s.id + " question translated with the same options", t.quiz && t.quiz.q && t.quiz.explain && t.quiz.options.length === s.quiz.options.length);
    const tags = (x) => (String(x).match(/<\/?[a-z]+/gi) || []).sort().join();
    check(lang + ": " + s.id + " keeps its emphasis", tags(s.body) === tags(t.body));
  });
}

// ---- the claims behind the right answers
const base = N.build("base"), rb = P.plan(base);
const CLAIMS = {
  "peak-hidden": () => base.sites.some((s) => s.tier !== "market" && rb.sites[s.id].periods.some((q, i) => i >= 36 && q.util <= 1 && q.peak > 1)),
  "south-peak": () => { const d = Array.from(rb.sites["m-jnb"].demand).slice(0, 12); return d.indexOf(Math.max(...d)) === 4; },
  "release-shift": () => {
    const n = N.build("base"); n.sites.find((s) => s.id === "p-ham").release = 28; const r2 = P.plan(n);
    const a = rb.sites["p-ham"].load, b = r2.sites["p-ham"].load, sh = 14 / P.DAYS_PER_MONTH;
    for (let m = 2; m < 140; m++) if (Math.abs(b[m] - P.at(a, m + sh)) > 0.005 * a[m]) return false;
    return Math.abs(sum(a, 12, 120) - sum(b, 12, 120)) / sum(a, 12, 120) < 0.02;
  },
  "tier-spare": () => { const ts = P.tierSummary(rb, base, "dosing"), i = rb.periods.findIndex((p) => p.year === 2030 && p.kind === "year"); return ts[i].util < 1 && base.sites.some((s) => s.tier === "dosing" && rb.sites[s.id].periods[i].util > 1); },
  "raw-south-nov": () => { const c = Array.from(rb.sites["r-wai"].capacity).slice(0, 12); return c.indexOf(Math.max(...c)) === 10 && c.indexOf(Math.min(...c)) === 4; },
  "peg-dhaka": () => { const a = rb.sites["w-ae"].byMarket; return sum(a["m-dac"], 36, 156) > sum(a["m-cai"], 36, 156) && sum(a["m-dac"], 0, 12) < sum(a["m-cai"], 0, 12); },
  "expand-ham": () => { const re = P.plan(N.build("expand")); return rb.sites["p-ham"].periods.every((q, i) => rb.periods[i].from < 31 || re.sites["p-ham"].periods[i].peak < q.peak - 1e-9); },
  "resource-dosing": () => {
    const rs = P.plan(N.build("resource")), d = base.sites.filter((s) => s.tier === "dosing");
    const tot = (r) => d.reduce((a, s) => a + sum(r.sites[s.id].load, 0, P.MONTHS), 0);
    const ros = rs.sites["d-ros"].firstOver, others = d.filter((s) => s.id !== "d-ros").map((s) => rs.sites[s.id].firstOver);
    return Math.abs(tot(rs) / tot(rb) - 1) < 0.01 && ros >= 0 && ros < rb.sites["d-ros"].firstOver - 12 && others.every((o) => o < 0 || o > ros);
  }
};
// claims about the plan within capacity (c-…) need the solver: tests/constrained.test.js checks them by name
const ctest = fs.readFileSync(path.join(__dirname, "constrained.test.js"), "utf8");
steps.filter((s) => s.quiz).forEach((s) => {
  if (/^c-/.test(s.quiz.claim)) check("claim " + s.quiz.claim + " (" + s.id + ") is checked by the constrained tests", ctest.indexOf('check("' + s.quiz.claim + ":") >= 0);
  else check("claim " + s.quiz.claim + " (" + s.id + ") holds", CLAIMS[s.quiz.claim] && CLAIMS[s.quiz.claim]());
});
steps.filter((s) => s.setup && s.setup.cap).forEach((s) => check("step " + s.id + " plans within capacity with a valid rule", ["fixed", "qualified", "any"].indexOf(s.setup.cap.mode) >= 0 && s.setup.cap.hold >= 0));
// …and what the bodies say about the numbers they quote
{
  const fd = first(P.plan(N.build("drought"))), fb = first(rb);
  check("i-drought: the dry year brings the first shortfall forward, to a New Zealand or Australian co-op", fd.m < fb.m && ["r-wai", "r-gip"].indexOf(fd.id) >= 0);
  const n13 = N.build("base"); n13.config.demandScale = 1.3;
  check("i-scale: 130% demand brings the first shortfall forward", first(P.plan(n13)).m < fb.m);
  check("a-compare: the expansion programme moves the first shortfall later", first(P.plan(N.build("expand"))).m > fb.m);
  const q9 = P.requiredCapacity(base, rb, "p-ham", 0.9), q8 = P.requiredCapacity(base, rb, "p-ham", 0.8);
  check("a-target: a stricter target means an earlier first addition and more capacity", q8.firstNeed <= q9.firstNeed && q8.total > q9.total);
  const all = N.build("base"); all.sites.forEach((s) => { if (s.tier === "market") return; const q = P.requiredCapacity(all, rb, s.id, 0.9); s.expansions = (s.expansions || []).concat(q.additions); });
  const ra = P.plan(all);
  check("a-apply: with every addition applied, no site exceeds the 90% target in any month", all.sites.every((s) => s.tier === "market" || Math.max(...Array.from(ra.sites[s.id].util)) <= 0.9 + 1e-9));
  check("i-ladder: the Jakarta chain is about three months", rb.leadChain["m-jkt"].total > 75 && rb.leadChain["m-jkt"].total < 100, rb.leadChain["m-jkt"].total);
  check("i-sourcing: Querétaro buys 70% from Rosario and 30% from Valencia", JSON.stringify(base.sites.find((s) => s.id === "pk-qro").suppliers) === JSON.stringify([{ from: "d-ros", share: 70 }, { from: "d-vlc", share: 30 }]));
  check("a-compare: the programme expands Hamilton in 2029 and 2033", JSON.stringify(N.build("expand").sites.find((s) => s.id === "p-ham").expansions.map((e) => e.from)) === "[30,72]");
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
