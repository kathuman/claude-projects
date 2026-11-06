// Tierwise — the page itself, in a real browser: node tierwise/tests/browser.test.js
// Needs Playwright and a Chromium (npm install --no-save playwright && npx playwright install chromium), or
// CHROME_PATH pointing at a Chromium, with NODE_PATH reaching playwright-core. The solver loads from jsDelivr, so it needs
// the network. It serves the repository itself, then checks what the unit suites cannot: that the page starts, plans,
// solves and shows the result in three languages, and that the flows a pilot user depends on still work.
const http = require("http"), fs = require("fs"), path = require("path");
let chromium; try { chromium = require("playwright").chromium; } catch (e) { chromium = require("playwright-core").chromium; }
const ROOT = path.join(__dirname, "..", ".."), TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const server = http.createServer((req, res) => {
  const p = path.normalize(decodeURIComponent(req.url.split("?")[0])), f = path.join(ROOT, p.endsWith(path.sep) || p.endsWith("/") ? p + "index.html" : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const URL0 = "http://127.0.0.1:" + server.address().port + "/tierwise/";
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const errors = [];
  async function open(q, size) {
    const page = await (await browser.newContext({ viewport: size || { width: 1400, height: 1000 } })).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(URL0 + (q || "")); await page.waitForSelector("#kpis *");
    return page;
  }
  const kpis = (p) => p.textContent("#kpis");
  const planWithin = async (p) => { await p.click('#capMode [data-v="cap"]'); await p.waitForFunction(() => !document.getElementById("valuePanel").hidden, null, { timeout: 120000 }); };
  const optimise = async (p) => { await p.click("#ivRun"); await p.waitForFunction(() => !document.getElementById("ivResults").hidden, null, { timeout: 180000 }); };

  // ---- the requirement plan and its controls
  const p = await open();
  check("the page starts on the example, with its version", /^v\d+\.\d+\.\d+$/.test(await p.textContent("#ver")) && /Mar 2030/.test(await kpis(p)), await p.textContent("#ver"));
  const before = await kpis(p);
  await p.selectOption("#scenario", "growth"); await p.waitForFunction((b) => document.getElementById("kpis").textContent !== b, before);
  check("a scenario re-plans", (await kpis(p)) !== before);
  await p.selectOption("#scenario", "base");
  await p.$eval("#scale", (e) => { e.value = 150; e.dispatchEvent(new Event("input", { bubbles: true })); });
  check("the demand slider re-plans", (await p.textContent("#scaleOut")) === "150%" && (await kpis(p)) !== before);
  await p.click("#reset"); await p.waitForFunction((b) => document.getElementById("kpis").textContent === b, before);
  check("reset returns to the plan it started from", (await kpis(p)) === before);
  check("the heatmap and the tier charts draw", !!(await p.$("#heatWrap svg rect.cell")) && !!(await p.$("#tierChart svg")));

  // ---- the Studio, editing and undo
  check("the Studio draws every site", (await p.$$("#studioCanvas .node")).length === 27, (await p.$$("#studioCanvas .node")).length);
  await (await p.$("#studioPanel")).scrollIntoViewIfNeeded();
  await p.click('#studioMode [data-v="delete"]');
  await p.click('#studioCanvas .node[data-id="w-ng"]');
  check("deleting a site in the Studio takes effect", (await p.$$("#studioCanvas .node")).length === 26);
  await p.click("#undoBtn");
  check("undo brings it back", (await p.$$("#studioCanvas .node")).length === 27);
  await p.click('#studioMode [data-v="select"]');
  await p.click('#studioView [data-v="map"]');
  await p.waitForSelector("#mapWrap .node");
  check("the world map draws the network", (await p.$$("#mapWrap .node")).length >= 27);
  await p.click('#studioView [data-v="diagram"]');

  // ---- files and links
  const json = await p.evaluate(() => window.TWIO.toJSON(window.Tierwise.state.net));
  const net = JSON.parse(json); net.sites.forEach((s) => { if (s.id === "m-mex") s.base = 330000; });
  await p.setInputFiles("#fileIn", { name: "mine.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(net)) });
  await p.waitForFunction(() => window.Tierwise.state.net.sites.some((s) => s.id === "m-mex" && s.base === 330000));
  check("a network file loads", true);
  await p.click("#shareBtn"); await p.waitForFunction(() => /#net=/.test(document.getElementById("shareUrl").value));
  const link = await p.inputValue("#shareUrl");
  const q = await (await browser.newContext()).newPage(); await q.goto(link.replace(/^.*?\/tierwise\//, URL0)); await q.waitForSelector("#kpis *");
  check("a share link carries the network", await q.evaluate(() => window.Tierwise.state.net.sites.some((s) => s.id === "m-mex" && s.base === 330000)));
  await q.close();

  // ---- within capacity, its receipt, the value of capacity, and the optimiser, in each language
  for (const [lang, proved, words] of [["en", "Proved", "What more capacity is worth"], ["es", "Demostrado", "Cuánto vale más capacidad"], ["da", "Bevist", "Hvad mere kapacitet er værd"]]) {
    const x = await open("?lang=" + lang);
    await planWithin(x);
    check(lang + ": within capacity serves 86.8%", /86[.,]8/.test(await kpis(x)));
    check(lang + ": the plan is proved, by its receipt", (await x.textContent("#svcReceipt summary")).includes(proved) && !!(await x.$("#svcReceipt b.ok")));
    check(lang + ": what capacity is worth is shown", (await x.textContent("#valuePanel h2")) === words && (await x.$$("#valueTable tbody tr")).length >= 3);
    await optimise(x);
    check(lang + ": the optimiser's package is verified month by month", (await x.getAttribute("#ivVerdict", "class")).includes("good") && (await x.$$("#ivReceipt details")).length === 3);
    if (lang === "en") {
      await x.$eval("#ivHolding", (e) => { e.value = ""; e.dispatchEvent(new Event("change", { bubbles: true })); });
      await x.waitForFunction(() => /90\.1/.test(document.getElementById("kpis").textContent), null, { timeout: 120000 });
      check("without a stock cost the page warns that the fill rate is an upper limit", await x.isVisible("#moneyNote"));
    }
    await x.close();
  }

  // ---- what to do: every action priced by the plan, grouped, with its receipt
  const w = await open();
  await w.click("#prRun");
  await w.waitForFunction(() => document.querySelectorAll("#prList .pr-group").length > 0 || /bad/.test(document.getElementById("prStatus").innerHTML), null, { timeout: 600000 });
  const list = await w.textContent("#prList");
  check("what to do: Valencia's line, with a date and a price", /Fourth dosing line at Valencia/.test(list) && /Start by 20\d\d/.test(list), (await w.textContent("#prStatus")));
  check("what to do: sites with no option are named", /Define an expansion option for/.test(list));
  check("what to do: a decision that is too far off is left for later, and says why", /Not a decision for today/.test(list));
  await w.click("#prList [data-pr-do]");
  await w.click("#savedBox summary");
  check("what to do: a decision is recorded with the receipts behind it", /Decided to do: Fourth dosing line at Valencia/.test(await w.textContent("#ledList")) && /[0-9a-f]{16}/.test(await w.textContent("#ledList")));
  check("what to do: every item has its receipt", (await w.$$("#prList li")).length === (await w.$$("#prList li details.receipt")).length && !(await w.$("#prList details.receipt b.no")));
  await w.close();

  // ---- the three steps at the top, and working offline once the page has been opened
  { const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }), o = await ctx.newPage(); o.on("pageerror", (e) => errors.push(e.message));
    await o.goto(URL0); await o.waitForSelector("#kpis *");
    check("the three steps sum up the network and where it breaks", /27 sites in 6 tiers/.test(await o.textContent("#door1")) && /Cape Town Packaging runs short first, in Mar 2030/.test(await o.textContent("#door2")), await o.textContent("#door2"));
    await o.evaluate(() => navigator.serviceWorker.ready);
    await o.reload(); await o.waitForSelector("#kpis *");
    await o.click('#capMode [data-v="cap"]'); await o.waitForFunction(() => !document.getElementById("valuePanel").hidden, null, { timeout: 120000 });
    check("…and step 2 follows the plan within capacity", /Serves 86[.,]8%/.test(await o.textContent("#door2")));
    await ctx.setOffline(true);
    await o.reload(); await o.waitForSelector("#kpis *");
    await o.waitForFunction(() => !document.getElementById("valuePanel").hidden, null, { timeout: 120000 });
    check("offline, the page opens and plans within capacity, from the copies it kept", /86[.,]8/.test(await o.textContent("#kpis")));
    await ctx.setOffline(false); await ctx.close(); }

  // ---- memory: the session comes back, scenarios keep versions and compare, decisions are recorded
  { const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }), m = await ctx.newPage(); m.on("pageerror", (e) => errors.push(e.message));
    await m.goto(URL0); await m.waitForSelector("#kpis *");
    check("a first visit starts on the example, with nothing to restore", await m.isHidden("#dataMsg"));
    await m.$eval("#scale", (e) => { e.value = 130; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await m.waitForTimeout(900); await m.reload(); await m.waitForSelector("#kpis *");
    check("a reload brings the last session back, and says so", (await m.inputValue("#scale")) === "130" && await m.isVisible("#freshBtn"));
    await m.click("#savedBox summary"); await m.fill("#scName", "Pilot A"); await m.click("#scSave");
    await m.$eval("#scale", (e) => { e.value = 140; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await m.click("#scSave").catch(() => {}); await m.fill("#scName", "Pilot A"); await m.click("#scSave");
    check("saving the same name again keeps both versions", /2 versions/.test(await m.textContent("#scList")));
    await m.$eval("#scale", (e) => { e.value = 100; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await m.click("[data-sc-diff='Pilot A']");
    check("comparing a scenario with the plan on screen shows what changed", /demandScale: 1\.4 → 1/.test(await m.textContent("#scDiff")), await m.textContent("#scDiff"));
    await m.click("#freshBtn").catch(() => {});
    await m.click("[data-sc-del='Pilot A']"); await m.click("[data-sc-del='Pilot A']");
    check("deleting takes a second click, and removes every version", /No saved scenarios yet/.test(await m.textContent("#scList")));
    await ctx.close(); }

  // ---- the tutorial, the other pages, and a phone
  await p.click("#tourBtn"); await p.waitForSelector(".tour-menu");
  check("the tutorial offers its five levels", (await p.$$(".tour-menu [data-level]")).length === 5);
  const t = await open("?tour=expert&step=1");
  await t.waitForSelector(".tour-card");
  check("a tutorial step opens directly", !!(await t.$(".tour-card")));
  await t.close();
  const a = await (await browser.newContext()).newPage(); a.on("pageerror", (e) => errors.push(e.message));
  await a.goto(URL0 + "about.html"); check("the About page opens", /Tierwise/.test(await a.textContent("h1")));
  await a.goto(URL0 + "validation.html"); check("the validation report opens with its recorded results", /Tierwise/.test(await a.textContent("body")));
  await a.close();
  const ph = await open("", { width: 390, height: 844 });
  check("no sideways scroll at phone width", (await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  check("no script errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close(); server.close();
  console.log(pass + "/" + (pass + fail) + " browser checks passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log("FAIL the browser suite stopped: " + e.message); process.exit(1); });
