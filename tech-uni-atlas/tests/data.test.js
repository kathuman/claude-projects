// Tech University Atlas data checks — run with: node tech-uni-atlas/tests/data.test.js
// Every university has a rank, a name, a country, coordinates on Earth, a precision and a reason for being included;
// no university appears twice; each reason matches its name test; every country is drawn on the map; and the counts
// the about page states are the data's.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..");
const load = (f, name) => new Function(fs.readFileSync(path.join(dir, "data", f), "utf8") + "; return " + name + ";")();
const UNIS = load("universities.js", "UNIS"), GEO = load("countries.js", "COUNTRIES_GEOJSON");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const bad = (f) => UNIS.filter((u) => !f(u)).map((u) => u.name).slice(0, 5).join("; ");

check("there are universities", UNIS.length > 200, UNIS.length);
check("every one has a rank as QS publishes it (a number, a band or =n)", UNIS.every((u) => /^=?\d+(\+|[-–]\d+)?$/.test(String(u.rank).trim())), bad((u) => /^=?\d+(\+|[-–]\d+)?$/.test(String(u.rank).trim())));
check("every one has a name and a country", UNIS.every((u) => u.name && u.name.trim() && u.country && u.country.trim()));
check("every one sits on Earth", UNIS.every((u) => Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180 && !(u.lat === 0 && u.lng === 0)), bad((u) => Math.abs(u.lat) <= 90 && Math.abs(u.lng) <= 180));
check("every precision is campus or city", UNIS.every((u) => u.prec === "Campus" || u.prec === "City"));
check("every reason is tech, tec or status, with an explanation", UNIS.every((u) => ["tech", "tec", "status"].includes(u.match) && u.basis));
check("no university appears twice", new Set(UNIS.map((u) => u.name)).size === UNIS.length);
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
check("every “tech” match has “tech” in its name", UNIS.filter((u) => u.match === "tech").every((u) => /tech/i.test(u.name)), bad((u) => u.match !== "tech" || /tech/i.test(u.name)));
check("every “tec” match has “tec” (accents ignored) and not “tech” in its name", UNIS.filter((u) => u.match === "tec").every((u) => fold(u.name).includes("tec") && !/tech/i.test(u.name)));
// “architecture” contains the letters but is not a “tec” name
const tecName = (u) => fold(u.name).replace(/architec/g, "").includes("tec");
check("every “status” match has neither in its name", UNIS.filter((u) => u.match === "status").every((u) => !tecName(u)), bad((u) => u.match !== "status" || !tecName(u)));

// countries on the map: the data's country names, with those the outlines spell differently; places too small for the
// simplified outlines still get their points, just no shape under them
const ALIAS = { "United States": "United States of America", "Czechia": "Czech Republic", "Türkiye": "Turkey" };
const TOO_SMALL = ["Singapore", "Hong Kong", "Macau", "Palestine"];
const names = new Set(GEO.features.map((f) => f.properties.name));
const missing = [...new Set(UNIS.map((u) => u.country))].filter((c) => !names.has(c) && !names.has(ALIAS[c] || ""));
check("the map has an outline for every country except the four too small for it", missing.every((c) => TOO_SMALL.includes(c)), missing.join(", ") || "all");

// the about page's numbers
const r = (u) => +(String(u.rank).match(/\d+/) || [1500])[0];
const tier = (u) => (r(u) <= 100 ? 1 : r(u) <= 300 ? 2 : r(u) <= 600 ? 3 : r(u) <= 1000 ? 4 : 5);
const about = fs.readFileSync(path.join(dir, "about.html"), "utf8");
const counts = [1, 2, 3, 4, 5].map((t) => UNIS.filter((u) => tier(u) === t).length);
const stated = [...about.matchAll(/<li><span class="sw"[^>]*><\/span>[^<]*<span class="n">(\d+)<\/span><\/li>/g)].map((m) => +m[1]);
check("the about page's tier counts are the data's", stated.join() === counts.join(), stated.join() + " vs " + counts.join());
const by = (m) => UNIS.filter((u) => u.match === m).length;
check("…and so are the counts for each reason", ["tech", "tec", "status"].every((m) => about.includes('<span class="n">' + by(m) + "</span></b>")), ["tech", "tec", "status"].map(by).join(", "));
check("…the totals", about.includes("The rankings do not") && about.includes(UNIS.length + " technical universities") && about.includes(new Set(UNIS.map((u) => u.country)).size + " countries"));
const city = UNIS.filter((u) => u.prec === "City").length;
check("…and the campus and city-level counts", about.includes((UNIS.length - city) + " points sit on the main campus") && about.includes("for " + city + " only the city"));

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
