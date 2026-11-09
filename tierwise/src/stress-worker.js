// Tierwise — stress tests in a Web Worker: a disruption, or a scan of every site and route, solves many plans, so the page
// stays free and shows progress. opts.scan chooses the scan, opts.worst the worst combination.
var HIGHS_URL = "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/";
importScripts("plan.js", "constrained.js", "stress.js", HIGHS_URL + "highs.js");
var ready = null;
function highs() {
  // eslint-disable-next-line no-undef
  if (!ready) ready = Module({ locateFile: function (f) { return HIGHS_URL + f; }, print: function () {}, printErr: function () {} });
  return ready;
}
self.onmessage = function (e) {
  var d = e.data;
  highs().then(function (h) {
    var r, say = function (n) { self.postMessage({ id: d.id, progress: n }); };
    try { var o = d.opts || {}; r = o.scan ? self.TWStress.scan(h, d.net, o, say) : o.worst ? self.TWStress.worst(h, d.net, o, say) : self.TWStress.analyse(h, d.net, o, say); } catch (err) { r = { ok: false, errors: ["The stress test could not be worked out (" + (err && err.message || err) + ")."] }; }
    self.postMessage({ id: d.id, result: r });
  }, function () { ready = null; self.postMessage({ id: d.id, result: { ok: false, errors: ["The solver could not be loaded."] } }); });
};
