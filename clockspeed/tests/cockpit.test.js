// Clockspeed cockpit checks — run with: node clockspeed/tests/cockpit.test.js (needs jsdom: npm install --no-save jsdom@24)
// The page itself, in a simulated DOM: the briefing, take-off, advancing a quarter and a year, undo, playing a flight
// to the end through the cockpit's own decisions, the landing card and its debrief (bars and timeline checked against
// the model), refusing a bad flight file, resuming an autosaved flight, and no script errors throughout.
// jsdom has no layout, so the canvas charts are not drawn here; their data path still runs.
const fs = require("fs"), path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const dir = path.join(__dirname, "..");
const C = require(path.join(dir, "src", "model.js"));
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }

const html = fs.readFileSync(path.join(dir, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, "");
const code = ["src/model.js", "app.js"].map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
const errors = [];
function page(storage) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  vc.on("error", (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.test/clockspeed/", virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => {};
  if (storage) Object.keys(storage).forEach((k) => w.localStorage.setItem(k, storage[k]));
  code.forEach((c) => w.eval(c));
  return w;
}
const $ = (w, id) => w.document.getElementById(id);
const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

// ---- briefing and take-off
const w = page();
check("briefing offers the six weathers", w.document.querySelectorAll(".scn").length === 6);
click(w, w.document.querySelector('.scn[data-k="promisewar"]'));
click(w, $(w, "btn-takeoff"));
check("take-off opens the cockpit in the chosen weather", !$(w, "cockpit").hidden && $(w, "briefing").hidden && w.clockspeed.game().scenario === "promisewar");
check("the yoke shows the levers", w.document.querySelectorAll("#yoke input").length >= 10, w.document.querySelectorAll("#yoke input").length + " controls");

// ---- advance and undo
click(w, $(w, "btn-advance"));
check("advance moves one quarter", w.clockspeed.sim().state.q === 1);
click(w, $(w, "btn-advance4"));
check("+ 1 year moves four quarters", w.clockspeed.sim().state.q === 5);
click(w, $(w, "btn-undo"));
check("undo takes back exactly one quarter", w.clockspeed.sim().state.q === 4);

// ---- fly the paced response to the promise war through the cockpit's own decisions
const prep = (d) => { d.product.coverage.I = 5.5; d.product.flex.I = 0.18; d.product.coverage.F = 3.6; };
const match = (d) => { d.commercial.promise.I = 1.25; d.commercial.promise.F = 1.25; };
while (w.clockspeed.sim().state.q < 12) click(w, $(w, "btn-advance"));
prep(w.clockspeed.cur()); click(w, $(w, "btn-advance"));
while (w.clockspeed.sim().state.q < 16) click(w, $(w, "btn-advance"));
match(w.clockspeed.cur());
const t0 = Date.now();
click(w, $(w, "btn-toend"));
const landMs = Date.now() - t0;
check("fly to the end reaches quarter 80", w.clockspeed.sim().done());
const card = $(w, "endcard");
check("the landing card shows, with its comparison to the starting course", !card.hidden && /Landed after 20 years/.test(card.textContent));
const b = C.debrief({}, "promisewar", w.clockspeed.game().decisions);
check("the cockpit's flight matches the same decisions run in the model", Math.abs(b.profit - w.clockspeed.sim().totals.profit) < 1e-6, Math.round(b.profit));
const rows = card.querySelectorAll(".db-row");
check("the debrief shows each level alone, moving together, and the total", rows.length === 5);
const shown = Array.from(rows).map((r) => r.querySelector("b").textContent);
const fmt = (x) => { const a = Math.abs(x); return (x < 0 ? "−" : "+") + (a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "k" : a.toFixed(0)); };
const expect = [b.alone.commercial, b.alone.product, b.alone.network, b.interaction, b.gap].map(fmt);
check("debrief figures match the model's debrief", JSON.stringify(shown) === JSON.stringify(expect), shown.join(" "));
check("the verdict says the levels pulled together", /pulled together/.test(card.textContent));
check("the timeline draws one decision mark per timeline entry", card.querySelectorAll(".db-timeline circle").length === b.timeline.length, b.timeline.length + " decisions");
check("landing and debrief render in under 5 s", landMs < 5000, landMs + " ms");

// ---- a flight that holds the course has nothing to attribute
const w2 = page();
click(w2, $(w2, "btn-takeoff"));
click(w2, $(w2, "btn-toend"));
check("holding the starting course lands with a debrief that says there is nothing to attribute", /nothing to attribute/.test($(w2, "endcard").textContent));

// ---- a bad flight file is refused with a message, and the flight is kept
(async () => {
  const input = $(w, "in-load"), before = w.clockspeed.game().decisions.length;
  const file = new w.File(["{\"not\":\"a flight\"}"], "bad.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await new Promise((r) => setTimeout(r, 50));
  check("a file that is not a flight is refused with a message and the flight is kept", /Could not load that file/.test($(w, "advisories").textContent) && w.clockspeed.game().decisions.length === before);

  // ---- autosave and resume
  const saved = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); saved[k] = w.localStorage.getItem(k); }
  const w3 = page(saved);
  check("a saved flight is offered for resuming", !$(w3, "resume").hidden);
  click(w3, $(w3, "btn-resume"));
  check("resuming replays the saved flight to the same profit", w3.clockspeed.sim().done() && Math.abs(w3.clockspeed.sim().totals.profit - w.clockspeed.sim().totals.profit) < 1e-6);

  check("no script errors in any of the above", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
