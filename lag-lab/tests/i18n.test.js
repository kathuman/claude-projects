// Lag Lab Spanish translation checks — run with: node lag-lab/tests/i18n.test.js
// Every string the scripts translate, every element the pages mark and every validation message has a Spanish
// version with the same placeholders and markup; the equations' overlay names every variable and parameter and keeps
// exactly the same {references} (so the diagram's arrows and parameter lists are unchanged), for every policy.
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..") + path.sep;
const ES = require("../i18n-es.js"), L = require("../src/model.js"), EQ = require("../src/equations.js"), Dc = require("../src/decompose.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const refs = (s) => [...String(s).matchAll(/\{(p:[a-zA-Z.]+|[a-zA-Z]+)\}/g)].map((m) => m[1]).sort().join(",");

// ---- strings
const used = new Set();
for (const f of ["app.js", "diagram.js"]) for (const m of fs.readFileSync(R + f, "utf8").matchAll(/\bT\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) used.add(m[1] === '"' ? JSON.parse('"' + m[2] + '"') : m[2].replace(/\\'/g, "'"));
Dc.LAYERS.forEach((l) => { used.add(l.name); used.add(l.remedy); });   // translated where they are shown
const missing = [...used].filter((s) => ES.T[s] == null);
check("every string the scripts translate has a Spanish version (" + used.size + " strings)", missing.length === 0, missing.map((s) => JSON.stringify(s)).join(" | "));
check("…with the same {placeholders} and markup", [...used].every((s) => ES.T[s] == null || (ph(s) === ph(ES.T[s]) && tags(s) === tags(ES.T[s]))), [...used].filter((s) => ES.T[s] != null && (ph(s) !== ph(ES.T[s]) || tags(s) !== tags(ES.T[s]))).join(" | "));
const unused = Object.keys(ES.T).filter((k) => !used.has(k));
check("nothing in the dictionary is unused", unused.length === 0, unused.join(" | "));

// ---- page text
const keys = new Set();
for (const f of ["index.html", "about.html"]) {
  const h = fs.readFileSync(R + f, "utf8");
  for (const m of h.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of h.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => keys.add(p.split("=")[1]));
  check(f + " loads the Spanish dictionary and the switch, and has the language button", /<script src="i18n-es\.js"><\/script>\s*<script src="i18n\.js"><\/script>/.test(h) && h.includes('id="langBtn"'));
}
check("every marked element has a Spanish version (" + keys.size + " keys)", [...keys].every((k) => ES.H[k] != null), [...keys].filter((k) => ES.H[k] == null).join(" "));
check("every Spanish page text is used", Object.keys(ES.H).every((k) => keys.has(k)), Object.keys(ES.H).filter((k) => !keys.has(k)).join(" "));
check("translated text keeps the ids the scripts fill in", ES.H["foot.consult"].includes('id="ver-foot"'));

// ---- the equations
check("every variable has a Spanish name, units and meaning", EQ.VARS.every((v) => { const o = ES.EQ.vars[v.id]; return o && o.name && o.units && o.about && o.eq != null; }), EQ.VARS.filter((v) => !ES.EQ.vars[v.id]).map((v) => v.id).join(" "));
check("no Spanish entry for a variable that does not exist", Object.keys(ES.EQ.vars).every((id) => EQ.BY_ID[id]));
check("every parameter has a Spanish name and units", EQ.PARAMS.every((q) => ES.EQ.params[q[0]] && ES.EQ.params[q[0]].length === 2) && Object.keys(ES.EQ.labels).every((k) => EQ.PARAM_LABEL[k] != null));
const policies = [];
for (const hiringDriver of ["inventory", "capacity"]) for (const forecast of ["smooth", "perfect"]) for (const capacity of ["workforce", "unconstrained"]) policies.push(L.merge({ hiringDriver, forecast, capacity }));
const bad = [];
for (const p of policies) for (const v of EQ.VARS) {
  const o = ES.EQ.vars[v.id], en = (f) => (typeof f === "function" ? f(p) : f || ""), es = en;
  [["eq", v.eq, o.eq], ["init", v.init, o.init], ["about", v.about, o.about], ["alt", v.alt, o.alt]].forEach(([k, a, b]) => { if (refs(en(a)) !== refs(es(b))) bad.push(v.id + "." + k + " " + JSON.stringify(p.hiringDriver + "/" + p.forecast + "/" + p.capacity)); });
}
check("every Spanish equation, initial value, meaning and alternative names exactly the same variables and parameters, for every policy", bad.length === 0, bad.slice(0, 6).join(" | "));

// ---- the model's validation messages
const msgs = new Set();
const bads = [{ productionLeadTime: -1 }, { inventoryCoverage: 0.1, minProcessingTime: 1 }, { uMin: 2 }, { rookieProductivity: 2 }, { wSL: 2 }, { forecast: "x" }, { hiringDriver: "x" }, { capacity: "x" }, { dt: 5 }];
bads.forEach((o) => L.validate(L.merge(o)).forEach((m) => msgs.add(m)));
const tw = (m) => ES.P.reduce((s, p) => s.replace(new RegExp(p[0], "g"), p[1]), m);
const left = [...msgs].filter((m) => tw(m) === m || /\b(must|need|is too|or the)\b/.test(tw(m)));
check("every validation message is translated (" + msgs.size + " messages)", msgs.size >= 8 && left.length === 0, left.join(" | "));

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
