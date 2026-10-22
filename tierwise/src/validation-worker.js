// Tierwise — runs the validation suite (src/validation.js) off the page's thread. HiGHS (compiled to WebAssembly)
// is loaded once from jsDelivr.
//   in:  {only: [case ids] | null}
//   out: {type:"progress", title, frac}, {type:"case", result}, {type:"done"}
var HIGHS_URL = "https://cdn.jsdelivr.net/npm/highs@1.15.3/build/";
importScripts("plan.js", "network.js", "constrained.js", "invest.js", "validation.js", HIGHS_URL + "highs.js");
var ready = null;
function highs() {
  // eslint-disable-next-line no-undef
  if (!ready) ready = Module({ locateFile: function (f) { return HIGHS_URL + f; }, print: function () {}, printErr: function () {} });
  return ready;
}
self.onmessage = function (e) {
  highs().then(function (h) {
    var ctx = { P: self.TWPlan, N: self.TWNetwork, K: self.TWConstrained, I: self.TWInvest, highs: h };
    self.TWValidation.run(ctx, {
      only: e.data.only || null,
      progress: function (title, frac) { postMessage({ type: "progress", title: title, frac: frac }); },
      onCase: function (c) { postMessage({ type: "case", result: c }); }
    }).then(function () { postMessage({ type: "done" }); });
  }, function () { ready = null; postMessage({ type: "done" }); });
};
