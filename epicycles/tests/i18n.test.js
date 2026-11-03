// Epicycles language checks — run with: node epicycles/tests/i18n.test.js
// Every page key (data-i18n, data-i18n-attr) and every message the script passes to T() has a Spanish and a Danish
// translation, with nothing left over; placeholders are kept; and each translation keeps the English HTML tags.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
global.self = {};
require("../i18n-es.js"); require("../i18n-da.js");
const DICTS = { es: self.EP_ES, da: self.EP_DA };
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

// ---- page keys, with the English content of each element
const english = {};
for (const file of ["index.html", "about.html"]) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  for (const m of html.matchAll(/<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) english[m[3]] = m[5];
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((pair) => { english[pair.split("=")[1]] = ""; });
}
const pageKeys = Object.keys(english);
check("the pages have translatable text", pageKeys.length > 80, pageKeys.length + " keys");

// ---- the script's messages: every string literal inside a T( … ) call, including both sides of a ternary
const app = fs.readFileSync(path.join(dir, "app.js"), "utf8"), msgs = new Set();
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
check("the script sends its messages through T()", msgs.size > 25, msgs.size + " messages");

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

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
