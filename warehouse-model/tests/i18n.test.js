// Warehouse Model Spanish translation checks — run with: node warehouse-model/tests/i18n.test.js
// Every string the scripts translate, every element the pages mark, every parameter, choice and rack type, and every
// data-import message has a Spanish version with the same placeholders and markup.
const fs = require("fs"), path = require("path");
const W = path.join(__dirname, "..", "web") + path.sep;
const ES = require("../web/i18n-es.js"), D = require("../web/src/dataimport.js"), PJ = require("../data/parameters.json");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...String(s).matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]).sort().join(",");
const ids = (s) => [...String(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]).sort().join(",");

// ---- strings
const used = new Set();
for (const f of fs.readdirSync(W + "src")) for (const m of fs.readFileSync(W + "src/" + f, "utf8").matchAll(/\bT\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) used.add(m[1] === '"' ? JSON.parse('"' + m[2] + '"') : m[2].replace(/\\'/g, "'"));
const cats = new Set(Object.values(PJ.parameters).map((p) => p.category));
cats.forEach((c) => used.add(c));   // the rail's headings, translated as T(cat)
const missing = [...used].filter((s) => ES.T[s] == null);
check("every string the scripts translate has a Spanish version (" + used.size + " strings)", missing.length === 0, missing.map((s) => JSON.stringify(s)).join(" | "));
const mism = [...used].filter((s) => ES.T[s] != null && (ph(s) !== ph(ES.T[s]) || tags(s) !== tags(ES.T[s])));
check("…with the same {placeholders} and markup", mism.length === 0, mism.join(" | "));
const unused = Object.keys(ES.T).filter((k) => !used.has(k));
check("nothing in the dictionary is unused", unused.length === 0, unused.join(" | "));

// ---- page text
const keys = new Set();
for (const f of ["index.html", "about.html"]) {
  const h = fs.readFileSync(W + f, "utf8");
  for (const m of h.matchAll(/data-i18n="([^"]+)"/g)) keys.add(m[1]);
  for (const m of h.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => keys.add(p.split("=")[1]));
  check(f + " loads the Spanish dictionary and the switch, and has the language button", /<script src="i18n-es\.js"><\/script>\s*<script src="i18n\.js"><\/script>/.test(h) && h.includes('id="langBtn"'));
  // translated markup keeps every id the original element held (scripts fill them in)
  const lost = [];
  for (const m of h.matchAll(/<([a-z0-9]+)[^>]*\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) if (ES.H[m[2]] != null && ids(m[3]) && !ids(m[3]).split(",").every((i) => ES.H[m[2]].includes('id="' + i + '"'))) lost.push(m[2]);
  check(f + ": translated text keeps the ids the scripts fill in", lost.length === 0, lost.join(" "));
}
check("every marked element has a Spanish version (" + keys.size + " keys)", [...keys].every((k) => ES.H[k] != null), [...keys].filter((k) => ES.H[k] == null).join(" "));
check("every Spanish page text is used", Object.keys(ES.H).every((k) => keys.has(k)), Object.keys(ES.H).filter((k) => !keys.has(k)).join(" "));
check("the footers keep the version slots", ES.H["foot.consult"].includes('id="ver-foot"') && ES.H["a.cite"].includes('id="cite-ver"'));

// ---- parameters, choices, rack types
const names = Object.keys(PJ.parameters);
check("every parameter has a Spanish name and description (" + names.length + ")", names.every((n) => ES.PARAMS[n] && ES.PARAMS[n].label && ES.PARAMS[n].description), names.filter((n) => !ES.PARAMS[n]).join(" "));
check("no Spanish entry for a parameter that does not exist", Object.keys(ES.PARAMS).every((n) => PJ.parameters[n]), Object.keys(ES.PARAMS).filter((n) => !PJ.parameters[n]).join(" "));
const labelled = names.filter((n) => PJ.parameters[n].labels);
check("every choice label is translated", labelled.every((n) => ES.CHOICES[n] && Object.keys(PJ.parameters[n].labels).every((k) => ES.CHOICES[n][k])) && Object.keys(ES.CHOICES).every((n) => labelled.includes(n)));
const racks = Object.keys(PJ.rack_types).filter((k) => k[0] !== "$");
check("every rack type has a Spanish name and truck", racks.every((k) => ES.RACK[k] && ES.RACK[k].label && ES.RACK[k].truck) && Object.keys(ES.RACK).every((k) => racks.includes(k)));

// ---- data-import messages
const msgs = new Set(), add = (r) => (r.errors || []).concat(r.notes || []).forEach((m) => msgs.add(m));
add(D.analyse("Item,Qty\n"));
add(D.analyse("Foo,Bar\n1,2\n"));
add(D.analyse("Item,Qty,Date\nA,x,nonsense\n"));
add(D.analyse("Item,Date\nA,2026-01-05\nB,2026-01-06\n,2026-01-06\n"));
add(D.analyse("Item,Date\nA,2026-01-05\n,2026-01-06\n,2026-01-07\n", "Foo\n1\n"));
add(D.analyse("Item,Qty,Date\nA,9000,2026-01-05 08:00\nB,1,2026-01-05 09:00\n", "Item,Pallets\nA,40000\n"));
add(D.analyse("Item,Qty,Date\nA,1,2026-01-05 08:00\nB,1,2026-01-05 09:00\nC,1,2026-01-05 10:00\n", "Item,Pallets\nA,3\n"));
const s = D.sample(); add(D.analyse(s.movements || s[0], s.inventory || s[1]));
const tw = (m) => ES.P.reduce((x, p) => x.replace(new RegExp(p[0], "g"), p[1]), m);
const left = [...msgs].filter((m) => tw(m) === m);
check("every data-import message is translated (" + msgs.size + " messages)", msgs.size >= 12 && left.length === 0, left.join(" | ") + " [" + msgs.size + "]");

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
