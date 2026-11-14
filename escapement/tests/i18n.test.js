// Escapement language checks — run with: node escapement/tests/i18n.test.js
// Every page key (data-i18n, data-i18n-attr) and every message the script passes to T() has a Spanish and a Danish
// translation, with nothing left over; placeholders are kept; and each translation keeps the English HTML tags.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
global.self = {};
require("../i18n-es.js"); require("../i18n-da.js");
const DICTS = { es: self.ESC_ES, da: self.ESC_DA };
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

// ---- page keys, with the English content of each element
const english = {};
for (const file of ["index.html", "about.html", "gears.html"]) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) english[m[3]] = m[5];
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((pair) => { english[pair.split("=")[1]] = ""; });
}
const pageKeys = Object.keys(english);
check("the pages have translatable text", pageKeys.length > 40, pageKeys.length + " keys");

// ---- the script's messages: every string literal inside a T( … ) call, including both sides of a ternary
const app = ["app.js", "gears-page.js"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join(";\n"), msgs = new Set();
for (let i = app.indexOf("T("); i >= 0; i = app.indexOf("T(", i + 2)) {
  if (/[\w.$]/.test(app[i - 1] || "")) continue;
  let depth = 0, j = i + 1, inVars = 0, args = [];
  for (; j < app.length; j++) {
    const c = app[j];
    if (c === '"') { const end = app.indexOf('"', j + 1); if (!inVars) args.push(app.slice(j + 1, end)); j = end; continue; }
    if (c === "{") inVars++; else if (c === "}") inVars--;
    else if (c === "(") depth++; else if (c === ")" && --depth === 0) break;
  }
  args.forEach((a) => msgs.add(a));
}
check("the script sends its messages through T()", msgs.size > 70, msgs.size + " messages");

const tags = (s) => (String(s).match(/<\/?[a-z0-9]+/gi) || []).map((t) => t.toLowerCase()).sort().join(" ");
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(" ");

for (const [lang, D] of Object.entries(DICTS)) {
  const missingH = pageKeys.filter((k) => !(k in D.H)), extraH = Object.keys(D.H).filter((k) => !(k in english));
  check(lang + ": every page key is translated", !missingH.length, missingH.join(", "));
  check(lang + ": no page translation is left over", !extraH.length, extraH.join(", "));
  const missingT = [...msgs].filter((m) => !(m in D.T)), extraT = Object.keys(D.T).filter((m) => !msgs.has(m));
  check(lang + ": every script message is translated", !missingT.length, missingT.join(" | "));
  check(lang + ": no script translation is left over", !extraT.length, extraT.join(" | "));
  const badHoles = Object.keys(D.T).filter((m) => holes(m) !== holes(D.T[m]));
  check(lang + ": placeholders are kept", !badHoles.length, badHoles.join(" | "));
  const badTags = pageKeys.filter((k) => english[k] && k in D.H && tags(english[k]) !== tags(D.H[k]));
  check(lang + ": translations keep the English HTML tags", !badTags.length, badTags.join(", "));
  const empty = Object.entries(D.H).concat(Object.entries(D.T)).filter(([, v]) => !String(v).trim());
  check(lang + ": no translation is empty", !empty.length, empty.map((e) => e[0]).join(", "));
}

// ---- the parts: name, role and explanation for every part, and every group's name, in both languages
const PA = require("../src/parts.js");
for (const [lang, D] of Object.entries(DICTS)) {
  const keys = Object.keys(PA.PARTS), P = D.P || {}, G = D.G || {};
  const missing = keys.filter((k) => !(P[k] && P[k][0] && P[k][1] && P[k][2])), extra = Object.keys(P).filter((k) => !PA.PARTS[k]);
  check(lang + ": every part has a translated name, role and explanation", !missing.length, missing.join(", "));
  check(lang + ": no part translation is left over", !extra.length, extra.join(", "));
  check(lang + ": part explanations are translated, not copied", keys.every((k) => !P[k] || (P[k][1] !== PA.PARTS[k].role && P[k][2] !== PA.PARTS[k].text)));
  const GE = require("../src/gears.js"), ids = GE.list().map((g) => g.id), N = D.N || {};
  const nm = ids.filter((k) => !N[k]), nx = Object.keys(N).filter((k) => !ids.includes(k));
  check(lang + ": every gear has a translated name", !nm.length && !nx.length, nm.concat(nx).join(", "));
  const gm = PA.GROUPS.filter((g) => !G[g.id]).map((g) => g.id), gx = Object.keys(G).filter((k) => !PA.GROUPS.some((g) => g.id === k));
  check(lang + ": every group name is translated", !gm.length && !gx.length, gm.concat(gx).join(", "));
}

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
