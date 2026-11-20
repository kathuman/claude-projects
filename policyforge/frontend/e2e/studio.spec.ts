// End to end: the Studio in a real browser against the real API.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
import { applyOps, type Op } from "../src/lib/paths";
import { targetOf } from "../src/lib/targets";
import type { Network } from "../src/lib/types";

const backend = resolve(here, "../../backend");
const json = (p: string) => JSON.parse(readFileSync(resolve(backend, p), "utf-8"));
const FOODNET: Network = json("data/foodnet/network.json");
const BROKEN: { name: string; ops: Op[]; expect: { path: string; message: string } }[] = json("tests/fixtures/broken_networks.json");

async function open(page: Page, view = "diagram") {
  await page.goto(`/app/?view=${view}`);
  await expect(page.getByTestId("api-status")).toContainText("API");
  await expect(page.getByTestId("api-status")).not.toContainText("offline");
}

async function fileMenu(page: Page, item: string | RegExp) {
  await page.getByTestId("file-menu").click();
  await page.getByRole("button", { name: item }).click();
}

async function exported(page: Page, item: RegExp): Promise<string> {
  const dl = page.waitForEvent("download");
  await fileMenu(page, item);
  const d = await dl;
  return readFileSync(await d.path(), "utf-8");
}

async function openJson(page: Page, doc: unknown, name = "network.json") {
  await page.getByTestId("file-input").setInputFiles({ name, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc)) });
}

async function pasteInto(page: Page, testid: string, text: string) {
  await page.getByTestId(testid).evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

/** Python's csv module output (minimal quoting) → rows of cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function center(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test("build FoodNet from scratch with tables, the map and the diagram: the engine loads the shipped network", async ({ page, request }) => {
  const tables: Record<string, string> = (await (await request.post("/networks/to-csv", { data: { network: FOODNET } })).json()).tables;
  const s2 = FOODNET.markets.find((m) => m.id === "MKT_S2")!;

  await open(page, "tables");
  await fileMenu(page, "New empty network");
  await page.getByLabel("Network name").fill("FoodNet");
  for (const t of ["skus", "suppliers", "plants", "dcs", "markets", "lanes"]) {
    let rows = parseCsv(tables[t]);
    if (t === "markets") { // MKT_S2 arrives without coordinates: it is placed on the map below
      const [lat, lon] = [rows[0].indexOf("lat"), rows[0].indexOf("lon")];
      rows = rows.map((r) => (r[0] === "MKT_S2" ? r.map((c, j) => (j === lat || j === lon ? "" : c)) : r));
    }
    if (t === "lanes") rows = rows.filter((r) => r[0] !== "L_DCS_S2"); // drawn in the diagram below
    await page.getByRole("tab", { name: new RegExp(`^${{ skus: "SKUs", suppliers: "Suppliers", plants: "Plants", dcs: "DCs",
      markets: "Markets", lanes: "Lanes" }[t]}`) }).click();
    await page.getByTestId("add-row").click();
    await pasteInto(page, `cell-${t}-0-id`, rows.map((r) => r.join("\t")).join("\n"));
    await expect(page.getByTestId(`table-${t}`).locator("tbody tr")).toHaveCount(rows.length - 1);
  }
  await expect(page.getByTestId("cell-errors")).toHaveCount(0);

  // the map: MKT_S2 is waiting to be placed; click it onto the map, then type its exact position
  await page.getByRole("tab", { name: "Map" }).click();
  await page.getByTestId("unplaced").getByRole("button", { name: "MKT_S2" }).click();
  const m = (await page.getByTestId("map").boundingBox())!;
  await page.mouse.click(m.x + m.width * 0.5, m.y + m.height * 0.8);
  await expect(page.getByTestId("unplaced")).toHaveCount(0);
  await page.getByTestId("mapnode-MKT_S2").click();
  await page.getByLabel("lat", { exact: true }).fill(String(s2.location.lat));
  await page.getByLabel("lon", { exact: true }).fill(String(s2.location.lon));

  // the diagram: draw the last lane by dragging from DC_S to MKT_S2, then set it up in the inspector
  await page.getByRole("tab", { name: "Diagram" }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const a = await center(page, "node-DC_S");
  const b = await center(page, "node-MKT_S2");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("inspector")).toContainText("Lane");
  await page.getByTestId("id-input").fill("L_DCS_S2");
  await page.getByTestId("id-input").press("Enter");
  await page.getByLabel("distribution").selectOption("deterministic");
  await page.getByLabel("value", { exact: true }).fill("1");
  await page.getByLabel("cost_per_unit").fill("0.16");
  await expect(page.getByLabel("distance_km")).toHaveValue("105"); // suggested from the map

  await expect(page.getByTestId("issue-count")).toHaveText("consistent ✓");
  const yaml = await exported(page, /Export YAML/);
  const r = await (await request.post("/networks/from-yaml", { data: { text: yaml } })).json();
  expect(r.errors).toEqual([]);
  expect(r.network).toEqual(FOODNET);
});

test("every broken network in the shared set is rejected, with the message on the right element", async ({ page }) => {
  await open(page);
  for (const c of BROKEN) {
    const doc = applyOps(FOODNET, c.ops);
    await openJson(page, doc, `${c.name}.json`);
    const issues = page.getByTestId("issues");
    await expect(issues, c.name).toContainText(c.expect.message);
    await issues.getByRole("button").filter({ hasText: c.expect.message }).first().click();
    const t = targetOf(doc, c.expect.path);
    const inspector = page.getByTestId("inspector");
    await expect(inspector, c.name).toContainText(c.expect.message);
    if ("id" in t) await expect(inspector.locator("h2 + span"), c.name).toHaveText(t.id);
  }
});

test("undo and redo restore exact states", async ({ page }) => {
  await open(page);
  await fileMenu(page, "Load FoodNet");
  await page.getByTestId("node-SUP_C").click();
  await page.keyboard.press("Delete");
  await page.getByTestId("node-DC_C").click();
  await page.getByTestId("id-input").fill("DC_CENTRE");
  await page.getByTestId("id-input").press("Enter");
  await page.getByTestId("add-plants").click();
  const edited = JSON.parse(await exported(page, /Export JSON/));
  expect(edited.suppliers).toHaveLength(2);
  expect(edited.markets.filter((x: { served_by: string }) => x.served_by === "DC_CENTRE")).toHaveLength(2);
  expect(edited.plants).toHaveLength(3);

  await page.locator("body").click({ position: { x: 1000, y: 800 } });
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
  expect(JSON.parse(await exported(page, /Export JSON/))).toEqual(FOODNET);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Redo" }).click();
  expect(JSON.parse(await exported(page, /Export JSON/))).toEqual(edited);
});

test("quick test, then a saved change flags the tested policy for re-test and the diff shows exactly that change", async ({ page, request }) => {
  const intent = json("tests/fixtures/intents/05-demo-b-to-c-30.json").intent;
  const compiled = await (await request.post("/compile", { data: { intent } })).json();
  const created = await (await request.post("/policies", { data: compiled.policy })).json();
  const ev = await request.post(`/policies/${created.id}/${created.version}/evaluate`,
    { data: { replications: 10, periods: 52, rolling_replications: 2 } });
  expect(ev.ok()).toBe(true);

  await open(page);
  await fileMenu(page, "Load FoodNet");
  await page.getByRole("tab", { name: /Quick test/ }).click();
  await page.getByTestId("run-quick").click();
  await expect(page.getByTestId("quick-fill")).toHaveText(/^9\d\.\d%$/);
  await expect(page.getByLabel("Colour by")).toHaveValue("fill_rate");

  await page.getByRole("tab", { name: "Versions" }).click();
  await expect(page.getByTestId("policies")).toBeVisible();
  await expect(page.getByTestId("retest")).toHaveCount(0);
  await page.getByRole("tab", { name: "Diagram" }).click();
  await page.getByTestId("node-PLANT_N").click();
  await page.getByLabel("capacity_per_period").fill("6500");
  await page.getByRole("tab", { name: "Versions" }).click();
  await page.getByTestId("save-version").click();
  await expect(page.getByRole("status")).toContainText("Saved foodnet version 2");
  await expect(page.getByTestId("retest")).toHaveCount(1);
  await page.getByTestId("compare-latest").click();
  const diff = page.getByTestId("version-diff");
  await expect(diff.locator("tbody tr")).toHaveCount(1);
  await expect(diff).toContainText("plants.0.capacity_per_period");
  await expect(diff).toContainText("6500");
  await expect(page.getByTestId("unsaved-changes")).toContainText("No differences");
});

test("a scenario built in the builder is saved exactly as the Python-checked fixture", async ({ page, request }) => {
  await open(page, "scenarios");
  await page.getByTestId("set-id").fill("north-outage");
  await page.getByLabel("Name", { exact: true }).first().fill("North outage");
  await page.getByTestId("scenario-id").fill("sup-b-outage");
  await page.getByTestId("scenario-name").fill("Supplier B outage");
  await page.getByTestId("add-supplier_outage").click();
  await page.getByTestId("component-form").getByLabel("supplier").selectOption("SUP_B");
  await page.getByTestId("comp-severity").fill("0.8");
  // drag the outage from period 10 to period 20 on the timeline
  const bar = (await page.getByTestId("bar-0").boundingBox())!;
  const tl = (await page.getByTestId("timeline").boundingBox())!;
  const perPeriod = (tl.width - 20) / 104;
  await page.mouse.move(bar.x + 8, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + 8 + 10 * perPeriod, bar.y + bar.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("comp-start")).toHaveValue("20");
  await expect(page.getByTestId("preview")).toContainText("Supplier capacity: SUP_B");
  await page.getByTestId("save-set").click();
  await expect(page.getByRole("status")).toContainText("Saved scenario set north-outage version 1");
  const saved = await (await request.get("/scenario-sets/north-outage")).json();
  expect(saved).toEqual(json("tests/fixtures/studio_scenario_set.json"));
});
