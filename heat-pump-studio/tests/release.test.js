// Heat Pump Studio release checks — run with: node heat-pump-studio/tests/release.test.js
// Every local script on both pages carries ?v=<the app's version>, so a browser never runs a new page with an old
// cached script (GitHub Pages lets browsers keep files for about ten minutes); and every version shown on the about
// page, in every language, is the app's version.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

const version = fs.readFileSync(path.join(dir, "app.js"), "utf8").match(/var VERSION = "([^"]+)"/)[1];
check("the app has a version", /^\d+\.\d+\.\d+$/.test(version), version);

for (const file of ["index.html", "about.html", "learn.html", "toy.html"]) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  const local = [...html.matchAll(/<script src="([^"]+)"/g), ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)]
    .map((m) => m[1]).filter((u) => !/^(https?:)?\/\//.test(u));
  const stale = local.filter((u) => !u.endsWith("?v=" + version));
  check(file + ": every local script carries ?v=" + version, local.length > 0 && !stale.length, stale.join(", ") || local.length + " scripts");
  const files = local.map((u) => u.split("?")[0]).filter((f) => !fs.existsSync(path.join(dir, f)));
  check(file + ": every script it loads exists", !files.length, files.join(", "));
}

const shown = [fs.readFileSync(path.join(dir, "about.html"), "utf8"), fs.readFileSync(path.join(dir, "i18n-es.js"), "utf8"), fs.readFileSync(path.join(dir, "i18n-da.js"), "utf8")]
  .flatMap((t) => [...t.matchAll(/(?:v|versión |version )(\d+\.\d+\.\d+)/g)].map((m) => m[1]));
check("every version on the about page is " + version, shown.length >= 3 && shown.every((v) => v === version), shown.join(", "));

// charts read their height once (data-h); reading the height attribute back after setting the pixel size grows them
const appSrc = fs.readFileSync(path.join(dir, "app.js"), "utf8");
check("charts keep their height in data-h", /if \(!cv\.dataset\.h\) cv\.dataset\.h = cv\.getAttribute\("height"\)/.test(appSrc) && (appSrc.match(/getAttribute\("height"\)/g) || []).length === 1);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
