// Tierwise — the application API, called the way a tool or an MCP server would (npm install highs@1.15.3 in tierwise/).
const A = require("../src/api.js"), N = require("../src/network.js"), K = require("../src/constrained.js");
let loadHighs; try { loadHighs = require("highs"); } catch (e) { console.log("HiGHS is not installed: npm install highs@1.15.3 (in tierwise/)"); process.exit(1); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
(async () => {
  const highs = await loadHighs({ print: () => {}, printErr: () => {} }), api = A.create(A.direct(highs)), net = N.build("base"), o = { mode: "qualified", hold: 6 };
  check("the API offers solve, invest, priorities, stress and scan as jobs", A.KINDS.join() === "solve,invest,priorities,stress,scan");
  check("the requirement plan is instant and the same as the engine's", api.plan(net).ok && api.plan(net).sites["d-vlc"].load[0] === require("../src/plan.js").plan(net).sites["d-vlc"].load[0]);
  const s = await api.solve(net, o);
  check("solve: the same plan, the same receipt, as calling the engine itself", s.ok && s.receipt.proved && s.receipt.input === K.solve(highs, net, o).receipt.input && Math.abs(s.fill - 0.8682) < 0.001, s.fill);
  check("solve: the network passed in is left untouched", JSON.stringify(net) === JSON.stringify(N.build("base")));
  const iv = await api.invest(net, { mode: "qualified", hold: 6 });
  check("invest: the package comes back verified month by month", iv.ok && iv.verified && iv.verified.proved && Math.abs(iv.verified.npv - 8.95e6) < 0.05e6, iv.verified && iv.verified.npv);
  const b = JSON.parse(JSON.stringify(net)); b.config.holdingRate = 3;
  check("diff and fingerprint are part of the same API", api.diff(net, b).settings[0].k === "holdingRate" && api.fingerprint(net) !== api.fingerprint(b));
  const st = await api.stress(net, Object.assign({ disruption: { kind: "site", target: "d-vlc", start: 16, months: 6, severity: 1 } }, o));
  check("stress: a disruption comes back solved, proved, with time to survive against time to recover", st.ok && st.result.proved && st.result.lost > 1e6 && st.tts && st.ttr === 6, st.ok && { lost: st.result.lost, tts: st.tts });
  let threw = false; try { await A.direct(highs)("nonsense", {}); } catch (e) { threw = /unknown job/.test(e.message); }
  check("an unknown job is refused", threw);
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})();
