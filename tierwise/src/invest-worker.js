// Tierwise — the capacity investment optimiser in a Web Worker, so the page stays responsive while it solves. HiGHS
// (compiled to WebAssembly) is loaded once from jsDelivr; each message carries a network and the options, and the
// answer goes back with the same id.
var HIGHS_URL = "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/";
importScripts("plan.js", "constrained.js", "invest.js", HIGHS_URL + "highs.js");
var ready = null;
function highs() {
  // eslint-disable-next-line no-undef
  if (!ready) ready = Module({ locateFile: function (f) { return HIGHS_URL + f; }, print: function () {}, printErr: function () {} });
  return ready;
}
self.onmessage = function (e) {
  var d = e.data;
  highs().then(function (h) {
    var r;
    try { r = self.TWInvest.solve(h, d.net, d.opts); } catch (err) { r = { ok: false, errors: ["The investment optimiser could not be solved (" + (err && err.message || err) + ")."] }; }
    self.postMessage({ id: d.id, result: r });
  }, function () { ready = null; self.postMessage({ id: d.id, result: { ok: false, errors: ["The solver could not be loaded."] } }); });
};
