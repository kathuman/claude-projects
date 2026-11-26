// Languages — run with:  node warehouse-compare/tests/i18n.test.js
// Every page key (data-i18n, data-i18n-attr), every message a script sends
// through T("…"), every KPI and sweep label and every input in
// data/scenario.json (label, description, choices) has a Spanish and a Danish
// translation, with nothing left over; placeholders and HTML tags are kept.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
const { check, summary } = require("./harness.js");
global.self = global;
require("../i18n-es.js"); require("../i18n-da.js");
const DICTS = { es: self.WC_ES, da: self.WC_DA };
check("both dictionaries load", !!DICTS.es && !!DICTS.da);

// ---- page keys, with the English content of each element
const english = {};
for (const file of ["index.html", "about.html"]) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) english[m[3]] = m[5];
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((pair) => { english[pair.split("=")[1]] = english[pair.split("=")[1]] || ""; });
}
const pageKeys = Object.keys(english);
check("the pages have translatable text (" + pageKeys.length + " keys)", pageKeys.length > 40);

// ---- the scripts' messages: the first string literal of every T( … ) call
const files = ["src/app.js", "src/views.js", "src/charts.js", "src/kpi.js", "src/cost.js", "src/rmfs.js", "src/layouts/wha.js", "src/layouts/whb.js", "src/layouts/whc.js", "src/dataimport.js", "src/frontier.js", "src/techview.js"];
const src = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join(";\n"), msgs = new Set();
for (const m of src.matchAll(/(?<![\w.$])T\(\s*"((?:[^"\\]|\\.)*)"/g)) msgs.add(JSON.parse('"' + m[1] + '"'));
// labels kept as data and translated where shown
require("../src/kpi.js").KPI_DEFS.forEach((d) => msgs.add(d.label));
require("../src/experiments.js").SWEEPS.forEach((s) => msgs.add(s.label));
check("the scripts send their messages through T() (" + msgs.size + " messages)", msgs.size > 120);
// a T( whose first argument isn't a literal can't be checked — only these are allowed
const dynamic = [...src.matchAll(/(?<![\w.$])T\(\s*([^"\s)][^,)]*)/g)].map((m) => m[1].trim()).filter((a) => !/^(d\.label|def\.label|sw\.label|s\.label|s,|d\.unit)$/.test(a) && a !== "s");
check("every other T() call has a literal message", dynamic.length === 0, dynamic.join(" | "));

// ---- the inputs
const sc = JSON.parse(fs.readFileSync(path.join(dir, "data/scenario.json"), "utf8"));
const inputs = {}, choices = {};
[sc.shared, sc.layouts.A, sc.layouts.B].forEach((g) => { for (const k in g) if (k[0] !== "$") { inputs[k] = g[k]; if (g[k].options) g[k].options.forEach((o) => { choices[k + "." + o] = g[k].labels[o]; }); } });
// the technology screen's site inputs (data/archetypes.json), keyed "site.…", and their units
const catalogue = JSON.parse(fs.readFileSync(path.join(dir, "data/archetypes.json"), "utf8"));
for (const k in catalogue.site_inputs) if (k[0] !== "$") {
  const d = catalogue.site_inputs[k]; inputs["site." + k] = d;
  if (d.options) d.options.forEach((o) => { choices["site." + k + "." + o] = d.labels[o]; });
  if (d.unit) msgs.add(d.unit);
}
check("every input has an English label and description", Object.values(inputs).every((d) => d.label && d.description));

const tags = (s) => (String(s).match(/<\/?[a-z0-9]+/gi) || []).map((t) => t.toLowerCase()).sort().join(" ");
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(" ");
for (const [lang, D] of Object.entries(DICTS)) {
  if (!D) continue;
  const missingH = pageKeys.filter((k) => !(k in D.H)), extraH = Object.keys(D.H).filter((k) => !(k in english));
  check(lang + ": every page key is translated", !missingH.length, missingH.join(", "));
  check(lang + ": no page translation is left over", !extraH.length, extraH.join(", "));
  const missingT = [...msgs].filter((m) => !(m in D.T)), extraT = Object.keys(D.T).filter((m) => !msgs.has(m));
  check(lang + ": every script message is translated", !missingT.length, missingT.join("\n    "));
  check(lang + ": no script translation is left over", !extraT.length, extraT.join("\n    "));
  const badHoles = Object.keys(D.T).filter((m) => holes(m) !== holes(D.T[m]));
  check(lang + ": placeholders are kept", !badHoles.length, badHoles.join(" | "));
  const badTags = pageKeys.filter((k) => english[k] && k in D.H && tags(english[k]) !== tags(D.H[k]));
  check(lang + ": translations keep the English HTML tags", !badTags.length, badTags.join(", "));
  const missingP = Object.keys(inputs).filter((k) => !(D.P[k] && D.P[k][0] && D.P[k][1])), extraP = Object.keys(D.P).filter((k) => !(k in inputs));
  check(lang + ": every input's label and description is translated", !missingP.length, missingP.join(", "));
  check(lang + ": no input translation is left over", !extraP.length, extraP.join(", "));
  const missingC = Object.keys(choices).filter((k) => !(k in D.C)), extraC = Object.keys(D.C).filter((k) => !(k in choices));
  check(lang + ": every choice is translated", !missingC.length, missingC.join(", "));
  check(lang + ": no choice translation is left over", !extraC.length, extraC.join(", "));
  const ids = catalogue.archetypes.map((a) => a.id), FIELDS = ["name", "mechanism", "strengths", "weaknesses", "best_fit"];
  const missingA = ids.filter((id) => !(D.A && D.A[id] && FIELDS.every((f) => String(D.A[id][f] || "").trim())));
  check(lang + ": every technology's texts are translated", !missingA.length, missingA.join(", "));
  check(lang + ": no technology translation is left over", Object.keys(D.A || {}).every((id) => ids.indexOf(id) >= 0));
  const empty = [].concat(Object.entries(D.H), Object.entries(D.T), Object.entries(D.C)).filter(([, v]) => !String(v).trim());
  check(lang + ": no translation is empty", !empty.length, empty.map((e) => e[0]).join(", "));
  // words that really are the same in the language; anything else equal to the English is untranslated
  const SAME = { es: ["robot", "Pods", "Robots"], da: ["station", "Pause", "robot", "Status", "Pods", "Exit", "Dimension"] }[lang];
  const same = Object.entries(D.T).filter(([k, v]) => k === v && /[a-z]{4,}/i.test(k) && !/^(WH-|R = |\{)/.test(k) && SAME.indexOf(k) < 0);
  check(lang + ": no message is left in English", same.length === 0, same.map((e) => e[0]).join(" | "));
}

// ---- the About page carries the app's version
const app = fs.readFileSync(path.join(dir, "src/app.js"), "utf8"), about = fs.readFileSync(path.join(dir, "about.html"), "utf8");
const ver = /APP_VERSION = "([\d.]+)"/.exec(app)[1];
check("About shows the app's version (" + ver + ")", about.indexOf('"v' + ver + '"') >= 0);

summary("i18n");
