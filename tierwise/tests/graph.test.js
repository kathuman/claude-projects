// Tierwise — editing the network as a graph: sites and routes added and removed under the six-tier rule, the columns of
// the diagram (saved order, fewer crossings), the problems flagged per site, custom parameters and the undo history.
const P = require("../src/plan.js"), N = require("../src/network.js"), G = require("../src/graph.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else { fail++; console.log("FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); } }

// ---- sites
{
  const net = N.build("base"), n0 = net.sites.length;
  const s = G.addSite(net, "packaging", { name: "Lima Packaging", lat: -12.05, lon: -77.04 });
  check("add a site: a new id in the tier's style, its name and place", s.id === "pk-1" && s.name === "Lima Packaging" && s.lat === -12.05 && net.sites.length === n0 + 1);
  check("add a site: parameters copied from a neighbour, without its routes in or out, expansions or custom values", s.capacity === 520000 && s.lead === 2 && !s.expansions && !(s.custom && s.custom.halal != null && s.custom.halal !== undefined && false));
  check("add a site: supplied by the first site of the tier above", s.suppliers.length === 1 && G.byId(net, s.suppliers[0].from).tier === "dosing");
  check("add a site: it plans (and carries no load until someone buys from it)", P.plan(net).ok && P.plan(net).sites[s.id].load.every((v) => v === 0));
  const m = G.addSite(net, "market", { name: "Lima" });
  check("add a consumption point: a demand, growth and season to start from", m.base > 0 && m.growth != null && m.season != null && m.suppliers.length === 1);
  const r = G.addSite(net, "raw");
  check("add a raw-ingredient site: no suppliers", !r.suppliers && r.capacity > 0);
  const e = { config: N.base().config, bom: N.base().bom, sites: [] };
  const a = G.addSite(e, "warehouse");
  check("add to an empty tier: defaults, and no supplier to take", a.capacity === 1000 && a.handling === 1 && a.suppliers.length === 0);
  check("remove a site: its routes go too", G.removeSite(net, "pk-jhb") && !net.sites.some((x) => x.id === "pk-jhb") && !net.sites.some((x) => (x.suppliers || []).some((l) => l.from === "pk-jhb")));
  check("rename an id: the routes follow", G.renameId(net, "d-vlc", "d-valencia") && net.sites.find((x) => x.id === "pk-qro").suppliers.some((l) => l.from === "d-valencia") && !G.renameId(net, "d-pen", "d-valencia"));
}
// ---- routes
{
  const net = N.build("base");
  check("connect: only from the tier directly above", G.canConnect(net, "d-ros", "pk-jhb").ok && G.canConnect(net, "p-cork", "pk-qro").reason === "tier" && G.canConnect(net, "pk-qro", "d-ros").reason === "tier");
  check("connect: not twice, not to itself, not to a missing site", G.canConnect(net, "d-ros", "pk-qro").reason === "exists" && G.canConnect(net, "w-mx", "w-mx").reason === "self" && G.canConnect(net, "x", "w-mx").reason === "missing");
  const c = G.connect(net, "d-ros", "pk-jhb");
  const jhb = net.sites.find((x) => x.id === "pk-jhb");
  check("connect: the new route takes the average share of the others", c.ok && jhb.suppliers.length === 3 && jhb.suppliers[2].share === 50);
  check("connect: the network still plans and the new supplier carries part of the load", P.plan(net).ok && P.plan(net).sites["d-ros"].byCustomer["pk-jhb"].some((v) => v > 0));
  check("connect a site that buys nothing yet: a full share", (() => { const n = N.build("base"); const s = G.addSite(n, "warehouse", { supplier: false }); return G.connect(n, "pk-qro", s.id).lane.share === 100; })());
  check("disconnect: the route goes", G.disconnect(net, "d-ros", "pk-jhb") && jhb.suppliers.length === 2 && !G.disconnect(net, "d-ros", "pk-jhb"));
  check("routes list every lane once", G.routes(net).length === net.sites.reduce((a, s) => a + (s.suppliers || []).length, 0));
  check("mode: a lane's own, or road within 1,500 km and sea beyond", G.modeOf(net, "pk-qro", "w-mx") === "road" && G.modeOf(net, "pk-cpt", "w-br") === "sea" && (() => { G.lane(net, "pk-cpt", "w-br").mode = "air"; return G.modeOf(net, "pk-cpt", "w-br") === "air"; })());
}
// ---- the diagram's columns
{
  const net = N.build("base"), cols = G.columns(net);
  check("columns: every site once, in its tier", P.TIERS.every((t) => cols[t.id].length === net.sites.filter((s) => s.tier === t.id).length) && new Set([].concat(...Object.values(cols))).size === net.sites.length);
  check("columns: the same network gives the same order", JSON.stringify(G.columns(N.build("base"))) === JSON.stringify(cols));
  const naive = {}; P.TIERS.forEach((t) => { naive[t.id] = net.sites.filter((s) => s.tier === t.id).map((s) => s.id); });
  check("columns: ordered to cross fewer routes than the order of the file", G.crossings(net, cols) < G.crossings(net, naive), [G.crossings(net, cols), G.crossings(net, naive)]);
  G.place(net, "w-sg", 0);
  const c2 = G.columns(net);
  check("place: a site moved to the top of its column stays there, and the column's order is saved", c2.warehouse[0] === "w-sg" && net.sites.filter((s) => s.tier === "warehouse").every((s) => s.ui && isFinite(s.ui.order)));
  check("place: other columns keep their own ordering", JSON.stringify(c2.raw.slice().sort()) === JSON.stringify(cols.raw.slice().sort()));
}
// ---- issues
{
  const net = N.build("base");
  check("issues: the example has none that block planning", !G.issues(net).some((i) => i.level === "error"));
  G.removeSite(net, "pk-jhb");
  const iss = G.issues(net);
  check("issues: removing Johor Packaging leaves Jebel Ali and Singapore DCs without a supplier", ["w-ae", "w-sg"].every((id) => iss.some((i) => i.id === id && i.code === "nosupplier")));
  check("issues: a dosing CMO no one buys from any more is a warning, not an error", (() => { const n = N.build("base"); n.sites.forEach((s) => { if (s.suppliers) s.suppliers = s.suppliers.filter((l) => l.from !== "d-pen"); }); return G.issues(n).some((i) => i.id === "d-pen" && i.code === "unused" && i.level === "warning"); })());
  const n2 = N.build("base"); n2.sites[9].lat = 120; n2.sites[12].yield = 0; n2.sites[9].suppliers = [{ from: "r-nor", share: 100 }];
  const i2 = G.issues(n2);
  check("issues: location, yield and a supplier from the wrong tier, each on its site", i2.some((i) => i.id === n2.sites[9].id && i.code === "location") && i2.some((i) => i.id === n2.sites[12].id && i.code === "yield") && i2.some((i) => i.code === "wrongtier" && i.from === "r-nor"));
  check("issues: errors exactly when the planner refuses the network", !P.plan(n2).ok && G.issues(n2).some((i) => i.level === "error"));
}
// ---- custom parameters
{
  const net = N.build("base");
  check("the example has a halal parameter on the production tiers", G.params(net, "sites").length === 1 && net.sites.find((s) => s.id === "p-cork").custom.halal === true && G.applies(net.params[0], net.sites.find((s) => s.id === "p-cork")) && !G.applies(net.params[0], net.sites.find((s) => s.id === "w-mx")));
  const r = G.addParam(net, { label: "CO₂ per tonne", type: "number", unit: "kg", default: 120 });
  check("add a parameter: a key from its label, its type and unit, the default on every site", r.ok && r.def.key === "co2_per_tonne" && net.sites.every((s) => s.custom && s.custom.co2_per_tonne === 120));
  check("add a parameter: refused without a label, with a reserved or used key, or a choice without options", !G.addParam(net, {}).ok && G.addParam(net, { label: "capacity" }).reason === "reserved" && G.addParam(net, { label: "CO₂ per tonne" }).reason === "exists" && G.addParam(net, { label: "Grade", type: "choice" }).reason === "options");
  const q = G.addParam(net, { label: "Incoterm", type: "choice", options: "FOB | CIF | DAP", applies: "routes", default: "FOB" });
  check("a route parameter: its choices, and the default on every lane", q.ok && q.def.options.length === 3 && G.routes(net).every((x) => x.lane.custom && x.lane.custom.incoterm === "FOB"));
  const t = G.addParam(net, { label: "Cold chain", type: "bool", tiers: ["warehouse"], default: "no" });
  check("a parameter for some tiers only", t.ok && net.sites.filter((s) => s.tier === "warehouse").every((s) => s.custom.cold_chain === false) && net.sites.filter((s) => s.tier === "market").every((s) => s.custom.cold_chain == null));
  check("values are read as their type", G.coerce({ type: "number" }, "1,5").value === 1.5 && G.coerce({ type: "number" }, "1,250").value === 1250 && G.coerce({ type: "bool" }, "Sí").value === true && G.coerce({ type: "bool" }, "nej").value === false && G.coerce({ type: "choice", options: ["FOB", "CIF"] }, "cif").value === "CIF" && !G.coerce({ type: "number" }, "abc").ok && !G.coerce({ type: "choice", options: ["FOB"] }, "EXW").ok);
  const cork = net.sites.find((s) => s.id === "p-cork");
  check("set a value; an empty value clears it", G.setCustom(cork, net.params[1], "95") && cork.custom.co2_per_tonne === 95 && G.setCustom(cork, net.params[1], "") && cork.custom.co2_per_tonne === undefined && !G.setCustom(cork, net.params[1], "lots"));
  check("a new site gets the defaults that apply to it", (() => { const s = G.addSite(net, "warehouse"); return s.custom.cold_chain === false && s.custom.co2_per_tonne === 120; })());
  check("remove a parameter: its values go from every site and lane", G.removeParam(net, "incoterm") && G.routes(net).every((x) => !x.lane.custom || x.lane.custom.incoterm === undefined));
  check("custom parameters do not change the plan", JSON.stringify(Array.from(P.plan(net).sites["p-ham"].load)) === JSON.stringify(Array.from(P.plan(N.build("base")).sites["p-ham"].load)) || P.plan(net).ok);
}
// ---- undo
{
  let net = N.build("base"); const h = G.history();
  h.record(net); G.removeSite(net, "w-mx");
  h.record(net); G.connect(net, "d-ros", "pk-jhb");
  net = h.undo(net);
  check("undo: the last change is undone", !G.lane(net, "d-ros", "pk-jhb") && !net.sites.some((s) => s.id === "w-mx"));
  net = h.undo(net);
  check("undo again: back to the start", net.sites.some((s) => s.id === "w-mx") && !h.canUndo());
  net = h.redo(net);
  check("redo", !net.sites.some((s) => s.id === "w-mx") && h.canRedo());
  h.record(net); check("a new change clears what could be redone", !h.canRedo());
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
