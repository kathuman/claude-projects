// Importing order lines — run with:  node warehouse-compare/tests/dataimport.test.js
const path = require("path");
const fs = require("fs");
const di = require("../src/dataimport.js");
const demand = require("../src/demand.js");
const scenario = require("../src/scenario.js");
const { check, near, summary } = require("./harness.js");

// ---------------------------------------------------------------- a file small enough to check by hand
{
  // orders: O1 = {A, B}, O2 = {A}, O3 = {A, C, B}, O4 = {D}; A appears twice in O1 → counted once
  const csv = "order,sku,date\nO1,A,2026-01-05\nO1,B,2026-01-05\nO1,A,2026-01-05\nO2,A,2026-01-05\nO3,A,2026-01-06\nO3,C,2026-01-06\nO3,B,2026-01-06\nO4,D,2026-01-06\n";
  const r = di.analyse(csv);
  check("hand file: read", r.ok);
  check("hand file: 4 orders, 7 lines (a repeated SKU in an order is one line)", r.orders === 4 && r.lines === 7, r.orders + " / " + r.lines);
  check("hand file: 4 SKUs, shares A 3/7, B 2/7, then C, D 1/7", r.skus === 4 && near(r.weights[0], 3 / 7) && near(r.weights[1], 2 / 7) && near(r.weights[2], 1 / 7) && near(r.weights[3], 1 / 7));
  check("hand file: 1.75 lines per order, largest order 3", near(r.linesPerOrder, 7 / 4) && r.maxLines === 3);
  check("hand file: 2 days → 3.5 lines a day", r.days === 2 && near(r.linesPerDay, 3.5));
  // top 20% of 4 SKUs = 1 SKU (A) = 3/7 of lines
  check("hand file: skew = share of the top 20% of SKUs", near(r.skew, 100 * 3 / 7));
}

// ---------------------------------------------------------------- formats and languages
{
  const es = di.analyse("fecha;pedido;artículo;cantidad\n2026-01-05;P1;X;2\n2026-01-05;P1;Y;1\n2026-01-05;P2;X;5\n");
  check("Spanish headers, semicolons", es.ok && es.orders === 2 && es.skus === 2 && es.days === 1);
  const da = di.analyse("ordrenr\tvarenr\tdato\nA1\tV1\t2026-02-01\nA2\tV1\t2026-02-02\n");
  check("Danish headers, tabs", da.ok && da.orders === 2 && da.skus === 1 && da.days === 2);
  const q = di.analyse('Order ID,Item,Note\n"1001","S,1","a, b"\n"1001","S2",""\n');
  check("quoted fields with commas, header case and spaces", q.ok && q.orders === 1 && q.skus === 2, JSON.stringify(q.messages));
  const bom = di.analyse("﻿sku,order\nZ,1\n");
  check("a byte-order mark and any column order", bom.ok && bom.skus === 1);
  const nodate = di.analyse("order,sku\n1,A\n2,B\n");
  check("no date column: lines per day not set, and said so", nodate.ok && nodate.linesPerDay === null && nodate.messages.some((m) => /date/.test(m)));
  const gaps = di.analyse("order,sku\n1,A\n,B\n2,\n2,C\n");
  check("rows missing an order or a SKU are skipped and counted", gaps.ok && gaps.rows === 2 && gaps.messages.some((m) => /^2 rows/.test(m)));
}

// ---------------------------------------------------------------- bad files
{
  check("empty file refused", !di.analyse("").ok && !di.analyse("order,sku\n").ok);
  const bad = di.analyse("customer,qty\nx,1\n");
  check("no order/SKU columns refused, naming the header it found", !bad.ok && /customer, qty/.test(bad.messages[0]));
}

// ---------------------------------------------------------------- the sample file and the comparison on it
{
  const txt = fs.readFileSync(path.join(__dirname, "../data/sample-orders.csv"), "utf8");
  const r = di.analyse(txt);
  check("sample: read (" + r.orders + " orders, " + r.lines + " lines, " + r.skus + " SKUs)", r.ok && r.orders === 3000 && r.lines > 8000);
  check("sample: shares sum to 1 and never rise", near(r.weights.reduce((a, b) => a + b, 0), 1, 1e-9) && r.weights.every((v, i) => i === 0 || v <= r.weights[i - 1]));
  check("sample: about 3 lines per order", Math.abs(r.linesPerOrder - 3) < 0.15, r.linesPerOrder);

  const J = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/scenario.json"), "utf8"));
  const WM = JSON.parse(fs.readFileSync(path.join(__dirname, "../../warehouse-model/data/parameters.json"), "utf8"));
  const inputs = scenario.resolve(J, WM), sc = inputs.sc;
  Object.assign(sc, { demand_curve: "data", data_weights: r.weights, skus: r.skus, lines_per_order: Math.round(r.linesPerOrder * 10) / 10, max_lines: r.maxLines, target_locations: Math.ceil(r.skus / 0.85 / 100) * 100 });
  // the order stream follows the data's shares
  const w = demand.skuWeights(sc.skus, sc.demand_skew, "data", r.weights);
  check("data curve: the data's own shares", w.every((v, i) => near(v, r.weights[i], 1e-12)));
  const st = demand.orderStream(Object.assign({}, sc, { lines_per_order: 1, max_lines: 1 }), 3);
  let top = 0; const N = 20000; for (let o = 0; o < N; o++) if (st.next()[0] === 0) top++;
  check("data curve: orders draw the top SKU at its share (" + (top / N).toFixed(4) + " vs " + r.weights[0].toFixed(4) + ")", Math.abs(top / N - r.weights[0]) < 0.006);
  const pad = demand.skuWeights(r.skus + 500, 80, "data", r.weights);
  check("more SKUs than the data: the extra ones are never ordered", pad.slice(r.skus).every((v) => v === 0) && near(pad.reduce((a, b) => a + b, 0), 1, 1e-9));
  const res = scenario.run(inputs);
  check("the comparison runs on imported demand", ["A", "B", "C"].every((id) => res[id] && !res[id].infeasible && isFinite(res[id].kpi.costPer1000Lines)));
  console.log("  sample data: pickers A " + res.A.kpi.pickersNeeded + " · B " + res.B.kpi.pickersNeeded + " · C " + res.C.kpi.pickersNeeded + "; per 1,000 lines A $" + res.A.kpi.costPer1000Lines.toFixed(0) + " · B $" + res.B.kpi.costPer1000Lines.toFixed(0) + " · C $" + res.C.kpi.costPer1000Lines.toFixed(0));
}

summary("dataimport");
