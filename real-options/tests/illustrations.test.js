// Illustration checks — run with: node real-options/tests/illustrations.test.js
// Every diagram renders as well-formed SVG with an accessible label, in the page's colour tokens; every diagram the
// pages, the report and the tutorial ask for exists; pattern ids are unique per render.
const fs = require("fs"), path = require("path");
const I = require("../illustrations.js"), T = require("../tour-content.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
function balanced(s) {
  const st = [], re = /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g; let m;
  while ((m = re.exec(s))) { if (m[1]) { if (st.pop() !== m[2]) return false; } else if (!m[4]) st.push(m[2]); }
  return st.length === 0;
}
const bad = [], unlabelled = [], hard = [];
for (const k of I.LIST) {
  const s = I.svg(k);
  if (!s.startsWith("<svg") || !balanced(s)) bad.push(k);
  if (!/aria-label='[^']{8,}'/.test(s) || !/role='img'/.test(s)) unlabelled.push(k);
  // colours come from the theme tokens, so the diagrams follow the palette (no hard-coded hex colours)
  if (/#[0-9a-fA-F]{3,6}\b/.test(s.replace(/url\(#\w+\)|id='\w+'/g, ""))) hard.push(k);
}
check("every diagram is well-formed SVG (" + I.LIST.length + " diagrams)", bad.length === 0, bad.join(" "));
check("every diagram has an accessible label", unlabelled.length === 0, unlabelled.join(" "));
check("every diagram draws in the theme's colour tokens, not hard-coded colours", hard.length === 0, hard.join(" "));
check("an unknown key gives nothing rather than an error", I.svg("nope") === "" && I.svg("strategy:nope") === "");
const a = I.svg("strategy:stage"), b = I.svg("strategy:stage");
check("pattern ids are unique per render, so several diagrams can share a page", (a.match(/id='(\w+)'/) || [])[1] !== (b.match(/id='(\w+)'/) || [])[1]);
// every reference exists
const pages = ["index.html", "network.html"].map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const refs = pages.flatMap((h) => [...h.matchAll(/data-illus="([^"]+)"/g)].map((m) => m[1]));
check("every diagram the pages ask for exists (" + refs.length + " references)", refs.length >= 15 && refs.every((r) => I.LIST.includes(r)), refs.filter((r) => !I.LIST.includes(r)).join(" "));
check("both pages and the report load the illustrations", pages.every((h) => h.includes("illustrations.js")) && fs.readFileSync(path.join(__dirname, "../report.html"), "utf8").includes("illustrations.js"));
const steps = T.LEVELS.flatMap((l) => l.steps), withIl = steps.filter((s) => s.illus);
check("every diagram a tutorial step shows exists", withIl.every((s) => I.LIST.includes(s.illus)), withIl.filter((s) => !I.LIST.includes(s.illus)).map((s) => s.id).join(" "));
check("most tutorial steps are illustrated", withIl.length >= 0.75 * steps.length, withIl.length + " of " + steps.length);
check("the five strategies and the four network strategies each have a diagram", ["full", "best", "defer", "stage", "lease"].every((k) => I.LIST.includes("strategy:" + k)) && ["central", "two", "pilot", "wait"].every((k) => I.LIST.includes("net:" + k)));
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
