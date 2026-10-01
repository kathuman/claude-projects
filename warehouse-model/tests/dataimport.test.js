// Tests for web/src/dataimport.js — run with:  node warehouse-model/tests/dataimport.test.js
const D = require("../web/src/dataimport.js");

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + detail : "")); }
}
const near = (a, b, t) => Math.abs(a - b) <= t;

// ---------------------------------------------------------------- CSV parsing
{
  const r = D.parseCSV('﻿a,b,c\r\n1,"x, y",3\r\n4,"say ""hi""",6\r\n\r\n');
  check("CSV: BOM, CRLF, quoted comma, escaped quote, blank line", r.length === 3 && r[1][1] === "x, y" && r[2][1] === 'say "hi"', JSON.stringify(r));
  const s = D.parseCSV("SKU;Qty\nA;1,5\nB;2\n");
  check("CSV: semicolon delimiter", s.length === 3 && s[1][0] === "A" && s[1][1] === "1,5");
  const t = D.parseCSV("a\tb\n1\t2");
  check("CSV: tab delimiter, no trailing newline", t.length === 2 && t[1][1] === "2");
}
// ---------------------------------------------------------------- dates, directions
check("dates: ISO with time", JSON.stringify(D.parseWhen("2026-03-02 14:35")) === JSON.stringify({ day: "2026-03-02", hour: 14 }));
check("dates: ISO T form", D.parseWhen("2026-03-02T07:05:00").hour === 7);
check("dates: day/month/year + separate time", JSON.stringify(D.parseWhen("02/03/2026", "09:10")) === JSON.stringify({ day: "2026-03-02", hour: 9 }));
check("dates: date only → no hour", D.parseWhen("2026-03-02").hour === null);
check("dates: garbage → null", D.parseWhen("next tuesday") === null);
check("directions", ["IN", "Inbound", "receipt", "PUTAWAY"].every((x) => D.direction(x) === "in") && ["OUT", "shipment", "Pick", "dispatch"].every((x) => D.direction(x) === "out") && D.direction("") === null);

// ---------------------------------------------------------------- small hand-made data set
{
  // 2 days; A moves 6, B moves 3, C moves 1 pallets; stock A 2, B 3, C 5
  const mv = "Item,Qty,Date,Direction\nA,2,2026-01-05 08:10,in\nA,2,2026-01-05 09:00,out\nB,1,2026-01-05 09:30,in\nA,2,2026-01-06 08:40,out\nB,2,2026-01-06 10:00,out\nC,1,2026-01-06 10:10,in\n";
  const iv = "Article,On hand\nA,2\nB,3\nC,5\n";
  const r = D.analyse(mv, iv);
  check("hand data: totals", r.ok && r.totalPallets === 10 && r.days === 2 && r.dailyPallets === 5 && r.skus === 3);
  check("hand data: in / out split", r.inbound === 4 && r.outbound === 6);
  check("hand data: inventory on hand", r.onHand === 10);
  // ranked by moves per pallet: A 3/pal (2 pal), B 1/pal (3 pal), C 0.2/pal (5 pal). 20% of pallets = 2 pallets = all of A → 6/10 of moves
  check("hand data: skew = share of moves from the fastest 20% of pallets", near(r.skew, 0.6, 1e-9), r.skew);
  // hours 8, 9, 10 active: totals 4+2=… per average day; busiest hour ÷ mean of active hours
  const avg = { 8: 4 / 2, 9: 3 / 2, 10: 3 / 2 }, mean = (2 + 1.5 + 1.5) / 3;
  check("hand data: peak-hour factor and active hours", r.activeHours === 3 && near(r.peakHourFactor, avg[8] / mean, 1e-9), r.peakHourFactor);
  check("hand data: suggestions clamped to the model's ranges", r.suggestions.daily_throughput_pallets === 50 && r.suggestions.current_inventory_pallets === 10 && r.suggestions.operating_hours_per_day === 8);
}
// ---------------------------------------------------------------- errors and fallbacks
{
  check("no SKU column → a clear error", !D.analyse("Date,Qty\n2026-01-01,1\n").ok);
  const r = D.analyse("sku,date\nA,2026-01-01\nA,2026-01-01\nB,2026-01-02\n");
  check("no quantity column → one pallet per row, SKU-based skew, no hourly profile", r.ok && r.totalPallets === 3 && r.skewBasis === "SKUs" && r.peakHourFactor === null && r.notes.length >= 2);
  const bad = D.analyse("sku,qty,date\nA,x,2026-01-01\nB,2,2026-01-01\n,1,2026-01-01\n");
  check("bad rows are skipped and counted", bad.ok && bad.used === 1 && /2 rows skipped/.test(bad.notes.join(" ")));
}
// ---------------------------------------------------------------- sample data set
{
  const s = D.sample(7), r = D.analyse(s.movements, s.inventory);
  check("sample: 20 days × 900 pallet moves", r.ok && r.days === 20 && r.totalPallets === 18000 && r.dailyPallets === 900);
  check("sample: 16 active hours (06:00–22:00)", r.activeHours === 16);
  check("sample: midday peak, roughly 1.3–1.8× the average hour", r.peakHourFactor > 1.3 && r.peakHourFactor < 1.8, r.peakHourFactor);
  check("sample: about half in, half out", near(r.inbound / r.totalPallets, 0.5, 0.03));
  check("sample: skewed demand (fastest 20% of pallets make well over 20% of moves)", r.skew > 0.35 && r.skew < 0.95, r.skew);
  check("sample: Lorenz curve runs (0,0) → (1,1) and is concave", r.curve[0][0] === 0 && near(r.curve[r.curve.length - 1][0], 1, 1e-9) && near(r.curve[r.curve.length - 1][1], 1, 1e-9) &&
    r.curve.every((p, i) => i < 2 || (p[1] - r.curve[i - 1][1]) / Math.max(1e-12, p[0] - r.curve[i - 1][0]) <= (r.curve[i - 1][1] - r.curve[i - 2][1]) / Math.max(1e-12, r.curve[i - 1][0] - r.curve[i - 2][0]) + 1e-9));
  check("sample: deep-lane shares are ordered", r.deep && r.deep.ge4 >= r.deep.ge6 && r.deep.ge6 >= r.deep.ge10);
  check("sample: deterministic", D.sample(7).movements === s.movements && D.sample(8).movements !== s.movements);
}

console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
