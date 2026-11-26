// The Spanish and Danish dictionaries cover every page text and every message, with the same {placeholders}.
const fs = require("fs");
const path = require("path");
const { check, summary } = require("./harness.js");

const dir = path.join(__dirname, "..");
const root = {};
for (const f of ["i18n-es.js", "i18n-da.js"]) new Function("self", fs.readFileSync(path.join(dir, f), "utf8"))(root);
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

const pageKeys = new Set();
for (const f of ["index.html", "about.html"]) {
  const html = read(f);
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) pageKeys.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(",").forEach((p) => pageKeys.add(p.split("=")[1]));
}
const messages = new Set();
for (const m of read("src/app.js").matchAll(/\bT\("((?:[^"\\]|\\.)*)"/g)) messages.add(JSON.parse('"' + m[1] + '"'));
for (const m of read("src/romfile.js").matchAll(/refuse\("((?:[^"\\]|\\.)*)"/g)) messages.add(JSON.parse('"' + m[1] + '"'));
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

check("the pages have text to translate (" + pageKeys.size + " keys) and the scripts messages (" + messages.size + ")", pageKeys.size > 50 && messages.size > 25);
for (const [name, d] of [["Spanish", root.HP48_ES], ["Danish", root.HP48_DA]]) {
  const missingH = [...pageKeys].filter((k) => d.H[k] == null);
  check(name + ": every page key is translated", missingH.length === 0, missingH.join(" "));
  const missingT = [...messages].filter((s) => d.T[s] == null);
  check(name + ": every message is translated", missingT.length === 0, missingT.join(" | "));
  const badHoles = Object.keys(d.T).filter((s) => holes(s) !== holes(d.T[s]));
  check(name + ": translations keep the same {placeholders}", badHoles.length === 0, badHoles.join(" | "));
  const stale = Object.keys(d.T).filter((s) => !messages.has(s)).concat(Object.keys(d.H).filter((k) => !pageKeys.has(k)));
  check(name + ": no translations left over from text that is gone", stale.length === 0, stale.join(" | "));
}

summary("i18n");
