// Tierwise — loading and saving supply chains: CSV (comma and semicolon, decimal commas, quotes), spreadsheets, JSON,
// the exact round trip of the example, readable errors with row numbers, and small custom chains that plan.
const P = require("../src/plan.js"), N = require("../src/network.js"), IO = require("../src/io.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } }
function samePlan(a, b) {
  const ra = P.plan(a), rb = P.plan(b); if (!ra.ok || !rb.ok) return false;
  return Object.keys(ra.sites).every((id) => { const x = ra.sites[id], y = rb.sites[id]; if (!y) return false; const s1 = x.load || x.demand, s2 = y.load || y.demand; return s1.every((v, m) => Math.abs(v - s2[m]) <= 1e-9 * Math.max(1, Math.abs(v))); });
}
// ---- the example survives a round trip through every format
for (const id of Object.keys(N.SCENARIOS)) {
  const net = N.build(id), csv = IO.toCSV(net), back = IO.fromCSV(csv);
  check("CSV round trip of scenario " + id, back.ok && samePlan(net, back.net), back.errors);
}
{
  const net = N.build("expand"), j = IO.fromJSON(IO.toJSON(net));
  check("JSON round trip", j.ok && samePlan(net, j.net) && j.net.sites.length === net.sites.length);
  const csv = IO.toCSV(net);
  check("the template writes dates as YYYY-MM", /p-ham,.*2029-07:\+90 \| 2033-01:\+120/.test(csv), csv.split("\n").find((l) => l.startsWith("p-ham")));
  check("the template has a settings table after the sites", /\r\nsetting,value\r\nproduct,/.test(csv) && /tier\.dosing\.name,/.test(csv));
  // a fake SheetJS: the same rows in two sheets
  const r = IO.toRows(net), sheets = { Sites: r.sites, Settings: r.settings };
  const XLSX = { utils: { sheet_to_json: (ws) => ws } };
  const wb = { SheetNames: ["Sites", "Settings"], Sheets: sheets };
  const w = IO.fromWorkbook(wb, XLSX);
  check("spreadsheet (Sites + Settings sheets) round trip", w.ok && samePlan(net, w.net), w.errors);
  const one = IO.fromWorkbook({ SheetNames: ["Data"], Sheets: { Data: r.sites.concat([[]], r.settings) } }, XLSX);
  check("spreadsheet with both tables on one sheet", one.ok && samePlan(net, one.net), one.errors);
}
// ---- reading numbers and cells
check("numbers: point decimals and comma thousands", IO.number("1,250.5", false) === 1250.5 && IO.number("0.025", false) === 0.025 && IO.number("-3", false) === -3 && IO.number("+90", false) === 90);
check("numbers: semicolon files read decimal commas and point thousands", IO.number("1.250,5", true) === 1250.5 && IO.number("0,025", true) === 0.025 && IO.number("1.000", true) === 1000 && IO.number("2.5", true) === 2.5);
check("numbers: a percent sign and spaces are ignored; text is not a number", IO.number(" 98.5 % ", false) === 98.5 && isNaN(IO.number("abc", false)) && IO.number("", false) === null);
check("quoted cells keep commas, quotes and line breaks", JSON.stringify(IO.splitCSV('a,"b, c","say ""hi""","x\ny"\r\n1,2,3,4').rows) === JSON.stringify([["a", "b, c", 'say "hi"', "x\ny"], ["1", "2", "3", "4"]]));
check("months: YYYY-MM and month numbers", IO.monthIndex("2029-07", { startYear: 2027, startMonth: 0 }) === 30 && IO.monthIndex("30", { startYear: 2027, startMonth: 0 }) === 30 && IO.monthIndex("2027-03", { startYear: 2026, startMonth: 6 }) === 8);

// ---- a small custom chain, written by hand, semicolons and decimal commas, other words for the tiers
const SMALL = [
  "Id;Tier;Name;Country;Latitude;Longitude;Base demand;Growth;Season;Capacity;Lead time;Release time;Yield;Sourcing",
  "oslo;Consumption point;Oslo;Norway;59,91;10,75;10.000;3;20;;;;;dc",
  "perth;customer;Perth;Australia;-31,95;115,86;8.000;4;15;;;;;dc",
  "dc;DC;Rotterdam DC;Netherlands;51,92;4,48;;;;30.000;;;;pk:100",
  "pk;packer;Packer;Germany;53,55;9,99;;;;40.000;2;3;99,5;fill",
  "fill;filling;Filler;Poland;52,23;21,01;;;;900.000;3;7;98,5;mfg1:60 | mfg2:40:12",
  "mfg1;manufacturing;Plant A;Denmark;56,16;10,2;;;;300;7;14;97;milk",
  "mfg2;manufacturing;Plant B;Ireland;52,66;-8,63;;;;200;7;14;97;milk",
  "milk;raw ingredient;Dairy;Denmark;55,4;10,4;;;;400;10;7;99;",
  "",
  "setting;value",
  "product;Drinking yoghurt",
  "startYear;2028",
  "startMonth;4",
  "packPerUnit;6",
  "kgPerSachet;0,2",
  "tier.dosing.name;Filling CMOs",
  "tier.dosing.unit;bottles"
].join("\n");
{
  const r = IO.fromCSV(SMALL);
  check("custom chain: a hand-written semicolon file loads", r.ok, r.errors);
  if (r.ok) {
    const n = r.net, pl = P.plan(n);
    check("custom chain: headers and tier words are recognised", n.sites.length === 8 && n.sites[0].tier === "market" && n.sites[2].tier === "warehouse" && n.sites[4].tier === "dosing" && n.sites[7].tier === "raw");
    check("custom chain: decimal commas and point thousands", n.sites[0].lat === 59.91 && n.sites[0].base === 10000 && n.sites[2].capacity === 30000 && n.sites[3].yield === 99.5);
    check("custom chain: lanes with shares and a transit override", JSON.stringify(n.sites[4].suppliers) === JSON.stringify([{ from: "mfg1", share: 60 }, { from: "mfg2", share: 40, days: 12 }]) && pl.transit["mfg2>fill"] === 12);
    check("custom chain: settings set the calendar, the bill of materials and the tier names", n.config.startYear === 2028 && n.config.startMonth === 3 && n.bom.packPerUnit === 6 && n.bom.kgPerSachet === 0.2 && n.product === "Drinking yoghurt" && pl.tiers[3].name === "Filling CMOs" && pl.tiers[3].unit === "bottles");
    check("custom chain: it plans, with one site per tier where it has one", pl.ok && pl.periods[0].label === "Apr 28" && pl.sites.dc.load[0] > 0 && pl.sites.milk.load[0] > 0, [pl.ok, pl.periods && pl.periods[0].label]);
    check("custom chain: defaults fill what is left out (no handling, no cover → plan cover)", n.sites[2].handling == null && pl.sites.dc.ss[0] > 0);
  }
}
// ---- the reasons a file is refused
function errs(text) { const r = IO.fromCSV(text); return r.ok ? [] : r.errors; }
const HEAD = "id,tier,name,lat,lon,base,capacity,suppliers\n";
check("refused: no header row", errs("a,b,c\n1,2,3")[0] === "No header row with the columns id and tier was found.");
check("refused: an unknown tier, with its row", errs(HEAD + "x,planet,X,0,0,1,,\n")[0] === "Row 2: unknown tier “planet” for x.");
check("refused: a word where a number belongs", errs(HEAD + "x,market,X,north,0,1,,\n")[0] === "Row 2: “north” is not a number (lat).");
check("refused: a CMO without capacity", errs(HEAD + "m,market,M,0,0,1,,w\nw,warehouse,W,0,0,,,\n").some((e) => e === "Row 3: w needs a capacity."));
check("refused: an unreadable supplier", errs(HEAD + 'm,market,M,0,0,1,,"w:many"\n').some((e) => e === "Row 2: cannot read the supplier “w:many”."));
check("refused: an unreadable expansion", errs("id,tier,name,lat,lon,capacity,expansions\nw,warehouse,W,0,0,5,soon\n").some((e) => /^Row 2: cannot read the expansion “soon”/.test(e)));
check("refused: a missing id", errs(HEAD + ",market,M,0,0,1,,\n")[0] === "Row 2: the site has no id.");
check("refused: the plan's own checks (supplier from the wrong tier)", errs(HEAD + "m,market,M,0,0,1,,r\nr,raw,R,0,0,,5,\n").some((e) => /must be supplied from the tier directly above/.test(e)));
check("refused: a settings month out of range", errs(HEAD + "m,market,M,0,0,1,,\n\nsetting,value\nstartMonth,13\n").some((e) => e === "Setting “startMonth” must be a month from 1 to 12."));
check("refused: JSON that is not a network", !IO.fromJSON("{\"a\":1}").ok && !IO.fromJSON("not json").ok);
{
  const r = IO.fromCSV(HEAD.replace("suppliers", "suppliers,colour") + "m,market,M,0,0,1,,,red\n");
  check("an unused column is a warning, not an error", r.warnings.some((w) => w === "Column “colour” is not used."));
}
check("load picks the reader by file name and content", IO.load("n.json", IO.toJSON(N.build("base"))).ok && IO.load("n.csv", IO.toCSV(N.build("base"))).ok && IO.load("n.txt", IO.toJSON(N.build("base"))).ok && !IO.load("n.xlsx", new ArrayBuffer(4)).ok);

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
