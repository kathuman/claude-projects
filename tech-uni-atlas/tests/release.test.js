// Tech University Atlas release checks — run with: node tech-uni-atlas/tests/release.test.js
// Every local script and stylesheet carries ?v=<the app's version>, so a browser never runs a new page with an old
// cached file (GitHub Pages lets browsers keep files for about ten minutes); every file it loads exists; and the
// version on the about page is the app's version.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

const version = fs.readFileSync(path.join(dir, "app.js"), "utf8").match(/const VERSION = "([^"]+)"/)[1];
check("the app has a version", /^\d+\.\d+\.\d+$/.test(version), version);

const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const local = [...html.matchAll(/<script src="([^"]+)"/g), ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
  .map((m) => m[1]).filter((u) => !/^(https?:)?\/\//.test(u));
const stale = local.filter((u) => !u.endsWith("?v=" + version));
check("index.html: every local file carries ?v=" + version, local.length >= 4 && !stale.length, stale.join(", ") || local.length + " files");
const absent = local.map((u) => u.split("?")[0]).filter((f) => !fs.existsSync(path.join(dir, f)));
check("index.html: every file it loads exists", !absent.length, absent.join(", "));

const about = fs.readFileSync(path.join(dir, "about.html"), "utf8");
const shown = [...about.matchAll(/(?:v|version )(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
check("every version on the about page is " + version, shown.length >= 2 && shown.every((v) => v === version), shown.join(", "));
check("both pages link to each other and back to the projects", html.includes('href="about.html"') && about.includes('href="./"') && html.includes('href="../"') && about.includes('href="../"'));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
