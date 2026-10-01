/*
 * validation-worker.js — runs the validation suite (validation.js) off the page's thread.
 *   in:  {only: [case ids] | null}
 *   out: {type:"progress", title, frac}, {type:"case", result}, {type:"done"}
 */
importScripts("lbm.js", "validation.js");
onmessage = function (e) {
  TF.validation.run(TF, {
    only: e.data.only || null,
    progress: function (title, frac) { postMessage({ type: "progress", title: title, frac: frac }); },
    onCase: function (c) { postMessage({ type: "case", result: c }); }
  });
  postMessage({ type: "done" });
};
