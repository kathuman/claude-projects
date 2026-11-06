// Tierwise — the data layer and the network diff: node tierwise/tests/store.test.js
const S = require("../src/store.js"), N = require("../src/network.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
let t = 0; const clock = () => new Date(Date.UTC(2026, 10, 2, 0, 0, t++)).toISOString();

// ---- records and versions
{
  const be = S.memory(), st = S.open(be, { now: clock }), net = N.build("base");
  const r1 = st.put("scenario", "Plan A", net).record;
  check("a record carries its kind, owner, schema, name, version and a fingerprint of its data", r1.kind === "scenario" && r1.owner === "local" && r1.schema === S.SCHEMA && r1.name === "Plan A" && r1.version === 1 && r1.parent === null && /^[0-9a-f]{16}$/.test(r1.hash));
  const n2 = JSON.parse(JSON.stringify(net)); n2.sites[0].base = 1;
  const r2 = st.put("scenario", "Plan A", n2).record;
  check("saving the same name again adds a version that points to the one before; nothing is overwritten", r2.version === 2 && r2.parent === r1.id && st.get(r1.id).data.sites[0].base === net.sites[0].base && st.versions("scenario", "Plan A").length === 2);
  check("the newest version comes back first", st.latest("scenario", "Plan A").id === r2.id && st.versions("scenario", "Plan A")[1].id === r1.id);
  st.put("scenario", "Plan B", net);
  check("a list shows each name once, newest version first, with its count", JSON.stringify(st.names("scenario").map((x) => [x.name, x.versions])) === JSON.stringify([["Plan B", 1], ["Plan A", 2]]));
  check("records survive a fresh connection to the same storage", S.open(be).versions("scenario", "Plan A").length === 2);
  st.remove("scenario", "Plan A");
  check("deleting a name removes every version of it, and nothing else", st.names("scenario").length === 1 && st.names("scenario")[0].name === "Plan B");
  be.set(S.PREFIX + "rec.junk", "{not json");
  check("an unreadable entry is skipped, not fatal", st.all("scenario").length === 1);
}
// ---- the session
{
  const st = S.open(S.memory(), { now: clock }), net = N.build("base");
  check("no session at first", st.session() === null);
  st.autosave({ net, mode: "plan" });
  check("an autosave comes back as the session", st.session().net.sites.length === net.sites.length && st.session().mode === "plan");
  check("saving the same state again adds nothing", st.autosave({ net, mode: "plan" }).unchanged === true && st.versions("autosave", "session").length === 1);
  for (let i = 0; i < 30; i++) st.autosave({ net, mode: "plan", i });
  check("only the latest " + S.KEEP_AUTOSAVES + " autosaves are kept", st.versions("autosave", "session").length === S.KEEP_AUTOSAVES && st.session().i === 29);
  st.clearSession();
  check("starting afresh clears the session", st.session() === null);
}
// ---- storage that fails
{
  const full = S.memory(); full.set = () => { throw new Error("QuotaExceededError"); };
  const r = S.open(full).put("scenario", "x", {});
  check("a full storage is reported, not thrown", r.ok === false && /storage is full/.test(r.error));
  check("a browser that refuses storage gets no back end, so the page falls back to memory", S.browser({ setItem() { throw new Error("denied"); }, removeItem() {} }) === null);
}
// ---- what changed between two networks
{
  const a = N.build("base"), b = JSON.parse(JSON.stringify(a));
  check("two identical networks: nothing changed", S.diff(a, b).count === 0);
  b.sites.find((s) => s.id === "d-vlc").capacity *= 2;
  b.sites = b.sites.filter((s) => s.id !== "w-ng");
  b.sites.find((s) => s.id === "pk-cpt").suppliers[0].share = 99;
  b.sites.push({ id: "w-new", tier: "warehouse", name: "New", lat: 0, lon: 0, capacity: 1 });
  b.config.holdingRate = 3;
  const d = S.diff(a, b);
  check("a changed field is named with its old and new value", d.sites.changed.some((c) => c.id === "d-vlc" && c.fields.some((f) => f.k === "capacity" && f.to === 2 * f.from)), d.sites.changed);
  check("added and removed sites are listed", d.sites.added.join() === "w-new" && d.sites.removed.join() === "w-ng");
  check("routes: a changed share, and the routes that went with a removed site", d.routes.changed.some((r) => r.fields[0].k === "share" && r.fields[0].to === 99) && d.routes.removed.some((k) => /w-ng$/.test(k) || /^w-ng>/.test(k)), d.routes);
  check("settings are compared too", d.settings.some((s) => s.k === "holdingRate" && s.from === 1.5 && s.to === 3));
}
console.log(pass + "/" + (pass + fail) + " checks passed");
process.exit(fail ? 1 : 0);
