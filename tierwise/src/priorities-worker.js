// Tierwise — working out the priorities in a Web Worker: many plans are solved, so the page stays free and shows progress.
var HIGHS_URL = "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/";
importScripts("plan.js", "constrained.js", "invest.js", "priorities.js", HIGHS_URL + "highs.js");
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
    try { r = self.TWPriorities.analyse(h, d.net, d.opts, function (n) { self.postMessage({ id: d.id, progress: n }); }); } catch (err) { r = { ok: false, errors: ["The priorities could not be worked out (" + (err && err.message || err) + ")."] }; }
    self.postMessage({ id: d.id, result: r });
  }, function () { ready = null; self.postMessage({ id: d.id, result: { ok: false, errors: ["The solver could not be loaded."] } }); });
};
