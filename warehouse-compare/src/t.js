/*
 * t.js — text and numbers in the page's language, for every module.
 *
 *   T(english, vars)  the translation (i18n.js + i18n-es.js / i18n-da.js), with
 *                     {name} placeholders filled; English when no language is
 *                     loaded (Node, the tests)
 *   fx(v, d)          v with d decimals, decimal comma in Danish
 *   int(v)            v rounded, thousands grouped as the language does
 *
 * Every user-facing message goes through T("…") with a literal string, so
 * tests/i18n.test.js can find it and check that it is translated.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.t = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function I() { const g = typeof self !== "undefined" ? self : globalThis; return g.WCi18n; }
  function T(s, v) {
    const i = I();
    if (i) return i.T(s, v);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; });
  }
  function fx(v, d) { const i = I(); return i ? i.fx(v, d) : Number(v).toFixed(d); }
  function int(v) { const i = I(); return Math.round(v).toLocaleString(i ? i.locale : "en-US"); }
  function locale() { const i = I(); return i ? i.locale : "en-US"; }
  return { T: T, fx: fx, int: int, locale: locale };
});
