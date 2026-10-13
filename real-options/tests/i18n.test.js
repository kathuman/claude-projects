// Spanish translation checks — run with: node real-options/tests/i18n.test.js
// Every string the scripts translate, every element the pages mark, every tutorial step and every message the engines
// produce has a Spanish version, with the same placeholders, tokens and markup; nothing in the dictionary is unused.
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..") + path.sep;
const ES = require("../i18n-es.js"), TE = require("../tour-content.js"), TES = require("../tour-content-es.js");
const M = require("../src/model.js"), N = require("../src/network.js"), C = require("../src/calibrate.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const tokens = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");

// ---- strings used by the scripts
const files = ["specs.js", "app.js", "network-app.js", "calib-ui.js", "report.js", "tour.js", "illustrations.js"];
const used = new Set();
for (const f of files) for (const m of fs.readFileSync(R + f, "utf8").matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) used.add(JSON.parse('"' + m[1] + '"'));
// labels that reach T() as variables: diagram labels, preset and sample names
globalThis.ROi18n = { T: (s) => { used.add(String(s)); return String(s); } };
const I = require("../illustrations.js"); I.LIST.forEach((k) => I.svg(k));
delete globalThis.ROi18n;
const S = require("../specs.js");
Object.keys(S.single.PRESETS).concat(Object.keys(S.network.PRESETS), Object.keys(C.SAMPLES)).forEach((k) => used.add(k));
[...used].filter((s) => /: capacity over time against demand$|: the network$/.test(s) && !/^\{name\}/.test(s)).forEach((s) => used.delete(s));
const missing = [...used].filter((s) => ES.T[s] == null);
check("every string the scripts translate has a Spanish version (" + used.size + " strings)", missing.length === 0, missing.slice(0, 8).map((s) => JSON.stringify(s)).join(" | "));
const badPh = [...used].filter((s) => ES.T[s] != null && ph(s) !== ph(ES.T[s]));
check("…with the same {placeholders}", badPh.length === 0, badPh.slice(0, 5).join(" | "));
const badTags = [...used].filter((s) => ES.T[s] != null && tags(s) !== tags(ES.T[s]));
check("…and the same markup", badTags.length === 0, badTags.slice(0, 5).join(" | "));
const unusedT = Object.keys(ES.T).filter((k) => !used.has(k));
check("nothing in the dictionary is unused", unusedT.length === 0, unusedT.slice(0, 8).join(" | "));
const same = Object.keys(ES.T).filter((k) => ES.T[k] === k && /[a-z]{4,} [a-z]{3,}/i.test(k));
check("no phrase is left in English", same.length === 0, same.join(" | "));

// ---- page text
const pages = ["index.html", "network.html", "report.html", "about.html"];
const keys = new Set();
for (const f of pages) {
  const h = fs.readFileSync(R + f, "utf8");
  for (const m of h.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of h.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => keys.add(p.split("=")[1]));
  check(f + " loads the Spanish dictionary and the switch before its other scripts, and has the language button",
    /<script src="i18n-es\.js"><\/script>\s*<script src="i18n\.js"><\/script>/.test(h) && h.indexOf('src="i18n.js"') < h.search(/src="(src\/model|src\/network)\.js"|<\/footer>\s*<script src="i18n-es/) + 1000 && h.includes('id="langBtn"'));
}
const missH = [...keys].filter((k) => ES.H[k] == null);
check("every marked element and attribute has a Spanish version (" + keys.size + " keys)", missH.length === 0, missH.join(" "));
const unusedH = Object.keys(ES.H).filter((k) => !keys.has(k));
check("every Spanish page text is used", unusedH.length === 0, unusedH.join(" "));
check("the pages keep the ids the scripts fill in inside translated text", ES.H["foot.consult"].includes('id="ver-foot"'));

// ---- the tutorial
const steps = TE.LEVELS.flatMap((l) => l.steps);
const missStep = steps.filter((s) => !TES.steps[s.id] || !TES.steps[s.id].title || !TES.steps[s.id].body);
check("every tutorial step has Spanish text (" + steps.length + " steps)", missStep.length === 0, missStep.map((s) => s.id).join(" "));
check("every level has a Spanish title and description", TE.LEVELS.every((l) => TES.levels[l.id] && TES.levels[l.id].title && TES.levels[l.id].blurb));
const badTok = steps.filter((s) => TES.steps[s.id] && (tokens(s.body) !== tokens(TES.steps[s.id].body) || (s.quiz && tokens(s.quiz.explain) !== tokens(TES.steps[s.id].quiz.explain))));
check("…with the same {{tokens}}", badTok.length === 0, badTok.map((s) => s.id).join(" "));
const badQuiz = steps.filter((s) => s.quiz && !(TES.steps[s.id].quiz && TES.steps[s.id].quiz.q && TES.steps[s.id].quiz.explain && TES.steps[s.id].quiz.options.length === s.quiz.options.length));
check("…and every question has its Spanish options, in the same order and number", badQuiz.length === 0, badQuiz.map((s) => s.id).join(" "));
check("no Spanish step for a step that does not exist", Object.keys(TES.steps).every((id) => steps.some((s) => s.id === id)));
// the right answer is the same option: the Spanish options name the same strategies where the English do
const decline = TES.steps["b-decline"].quiz.options[steps.find((s) => s.id === "b-decline").quiz.answer];
check("the right answer stays in place (the declining market: the lease)", decline === ES.T["Lease & break"], decline);

// ---- messages from the engines
const msgs = new Set();
const add = (a) => a.forEach((m) => msgs.add(m));
add(M.lattice(M.merge({ sigma: 0.05, g: 0.12 })).warnings); add(M.lattice(M.merge({ sigma: 0.02, g: 0.12 })).warnings); add(M.lattice(M.merge({ sigma: 0.01, g: 0.12 })).warnings);
add(N.lattice(N.merge({ sigA: 0.05, gA: 0.12 })).warnings);
for (const rho of [-0.9, 0.9]) for (const ga of [-0.06, 0.04]) add(N.lattice(N.merge({ rho, sigA: 0.1, gA: ga, sigB: 0.5, gB: 0.08 })).warnings);
add(C.parse("100\nabc\n110\n120").warnings); add(C.parse("100\nx\ny\n110\n120").warnings);
for (const f of [() => C.estimate([1, 2], 12), () => C.estimate([1, 0, 2], 12), () => C.estimate([1, 2, 3], 0)]) { try { f(); } catch (e) { msgs.add(e.message); } }
add(C.estimate([100, 105, 103, 110, 112], 4, { deseason: true }).warnings);
const rev = [], run = []; let x = 100, y = 100; for (let k = 0; k < 120; k++) { rev.push(x); x = k % 2 ? x * 1.2 : x / 1.2; run.push(y); y *= Math.floor(k / 6) % 2 ? 1.08 : 0.93; }
add(C.estimate(rev, 12).warnings); add(C.estimate(run, 12).warnings);
add(C.estimate(C.synthetic({ f: 12, years: 6, start: 1000, g: 0.03, sigma: 0.1, season: 0.15, seed: 9 }), 12).warnings);
const tw = (m) => ES.P.reduce((s, p) => s.replace(new RegExp(p[0], "g"), p[1]), m);
const kinds = ["monthly steps", "weekly steps", "even weekly", "Region A", "correlation of", "1 line", "2 lines", "three observations", "positive", "Unknown frequency", "season can only", "three years", "twelve changes", "revert", "runs", "look seasonal"];
const found = kinds.filter((k) => [...msgs].some((m) => m.includes(k)));
check("the checks below cover every kind of engine message (" + msgs.size + " messages)", found.length === kinds.length, kinds.filter((k) => !found.includes(k)).join(", "));
const untrans = [...msgs].filter((m) => tw(m) === m || /\b(the|is|are|with|cannot|growth|demand)\b/.test(tw(m)));
check("every engine message is translated, numbers kept", untrans.length === 0, untrans.join(" | "));
check("…for example", tw("Region A: growth of 12.0%/yr is too strong for a volatility of 5% on this lattice; 8.5%/yr is used. Raise the volatility to use your growth.") === "Región A: un crecimiento de 12.0%/año es demasiado alto para una volatilidad de 5% en este árbol; se usa 8.5%/año. Aumente la volatilidad para usar su crecimiento.");

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
