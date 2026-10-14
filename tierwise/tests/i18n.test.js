// Tierwise — the translations: every text the scripts pass through T(), every data-i18n key of the pages, the words of
// the example network and every engine message have a Spanish and a Danish version, with the same {placeholders} and
// the same HTML tags. `node tests/i18n.test.js --missing es` lists what a language still lacks.
const fs = require("fs"), path = require("path");
const R = path.join(__dirname, "..") + path.sep;
const P = require("../src/plan.js"), N = require("../src/network.js"), IO = require("../src/io.js");
global.self = global;
require("../i18n-es.js"); require("../i18n-da.js");
const DICTS = { es: global.TW_ES, da: global.TW_DA };
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail).slice(0, 600) : "")); } }

// ---- what must be translated
const keys = new Set();
for (const f of ["app.js", "tour.js"]) {
  const s = fs.readFileSync(R + f, "utf8");
  for (const m of s.matchAll(/\bT\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse('"' + m[1] + '"'));
}
const EDIT_LABELS = ["Base, a month", "Growth % (yrs 1–3)", "Growth % (yrs 4–13)", "Season swing %", "Launch (YYYY-MM)", "Ramp months", "Throughput a month", "Handling days", "Cover weeks", "Capacity a month", "Lead time, days", "Release time, days", "Yield %"];
EDIT_LABELS.forEach((k) => keys.add(k));
P.TIERS.forEach((t) => { keys.add(t.name); keys.add(t.one); keys.add(t.short); keys.add(t.unit); });
["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].forEach((m) => keys.add(m));
Object.values(N.SCENARIOS).forEach((s) => keys.add(s.label));
const net = N.base(); keys.add(net.product);
net.sites.forEach((s) => { keys.add(s.name); keys.add(s.country); });
const html = new Set();
for (const f of ["index.html", "about.html"]) {
  const s = fs.readFileSync(R + f, "utf8");
  for (const m of s.matchAll(/data-i18n="([^"]+)"/g)) html.add(m[1]);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => html.add(p.split("=")[1]));
}
// the engines' messages, produced by breaking things
const msgs = new Set();
const brk = [(n) => { n.sites[1].suppliers = []; }, (n) => { n.sites[9].suppliers = [{ from: "r-nor", share: 100 }]; }, (n) => { n.sites[9].suppliers = [{ from: "zz", share: 100 }]; },
  (n) => { n.sites[9].capacity = -1; }, (n) => { n.sites[15].yield = 120; }, (n) => { n.sites[15].lead = -1; }, (n) => { n.sites[15].release = -1; }, (n) => { n.sites.push(Object.assign({}, n.sites[2])); },
  (n) => { n.sites[2].lat = 99; }, (n) => { n.sites = n.sites.filter((s) => s.tier !== "market"); }, (n) => { n.sites[0].base = -5; }, (n) => { n.bom.packPerUnit = 0; }, (n) => { n.sites[3].tier = "moon"; }, (n) => { delete n.sites[4].id; }, (n) => { n.sites = []; }];
brk.forEach((f) => { const n = N.base(); f(n); P.validate(n).forEach((e) => msgs.add(e)); });
const H = "id,tier,name,lat,lon,base,capacity,suppliers,expansions,outages,launch,colour\n";
["a,b\n1,2", H + "x,planet,X,0,0,1,,,,,,", H + "x,market,X,north,0,1,,,,,,", H + "w,warehouse,W,0,0,,,,,,,", H + 'm,market,M,0,0,1,,"w:many",,,,', H + "w,warehouse,W,0,0,,5,,soon,,,", H + "w,warehouse,W,0,0,,5,,,bad,,",
  H + ",market,M,0,0,1,,,,,,", H + "m,market,M,0,0,1,,,,,later,red", H + "m,market,M,0,0,1,,,,,,\n\nsetting,value\nstartMonth,13\nfoo,1\ncover,abc\n", "id,tier\n"]
  .forEach((t) => { const r = IO.fromCSV(t); (r.errors || []).concat(r.warnings || []).forEach((e) => msgs.add(e)); });
["{\"a\":1}", "not json"].forEach((t) => IO.fromJSON(t).errors.forEach((e) => msgs.add(e)));
IO.load("x.xlsx", new ArrayBuffer(2)).errors.forEach((e) => msgs.add(e));
IO.load("x.xlsx", new ArrayBuffer(2), { read: () => { throw new Error("x"); } }).errors.forEach((e) => msgs.add(e));
IO.fromWorkbook({ SheetNames: [] }, {}).errors.forEach((e) => msgs.add(e));

const arg = process.argv.indexOf("--missing");
if (arg > 0) {
  const D = DICTS[process.argv[arg + 1]];
  console.log(JSON.stringify({ T: [...keys].filter((k) => !D || D.T[k] == null), H: [...html].filter((k) => !D || D.H[k] == null), P: [...msgs].filter((m) => !D || !(D.P || []).some((p) => new RegExp(p[0]).test(m))) }, null, 1));
  process.exit(0);
}
function ph(s) { return (String(s).match(/\{\w+\}/g) || []).sort().join(); }
function tags(s) { return (String(s).match(/<\/?[a-z]+/gi) || []).map((t) => t.toLowerCase()).sort().join(); }
for (const [lang, D] of Object.entries(DICTS)) {
  check(lang + ": the dictionary loads", D && D.T && D.H && D.P);
  if (!D) continue;
  const missT = [...keys].filter((k) => D.T[k] == null);
  check(lang + ": every script text is translated", !missT.length, missT);
  const badPh = [...keys].filter((k) => D.T[k] != null && ph(k) !== ph(D.T[k]));
  check(lang + ": translations keep their {placeholders}", !badPh.length, badPh);
  const badTag = [...keys].filter((k) => D.T[k] != null && tags(k) !== tags(D.T[k]));
  check(lang + ": translations keep their HTML tags", !badTag.length, badTag);
  const missH = [...html].filter((k) => D.H[k] == null);
  check(lang + ": every page text is translated", !missH.length, missH);
  const missP = [...msgs].filter((m) => !(D.P || []).some((p) => new RegExp(p[0]).test(m)));
  check(lang + ": every engine message has a pattern", !missP.length, missP);
  const same = [...msgs].filter((m) => { const p = D.P.find((x) => new RegExp(x[0]).test(m)); return p && m.replace(new RegExp(p[0]), p[1]) === m; });
  check(lang + ": the patterns change the message", !same.length, same);
  const extra = Object.keys(D.T).filter((k) => !keys.has(k));
  check(lang + ": no unused script texts", !extra.length, extra);
  const extraH = Object.keys(D.H).filter((k) => !html.has(k));
  check(lang + ": no unused page keys", !extraH.length, extraH);
}
check("engine messages were collected", msgs.size >= 25, msgs.size);
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
