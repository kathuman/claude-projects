// Lag Lab — languages (window.ROi18n, the same module as in Real Options). English is written in the pages and scripts; Spanish
// (Latin America) comes from i18n-es.js. The language is chosen by ?lang=es|en, then the viewer's last choice, then
// the browser's language.
//   T(english, vars)   the text in the current language, with {name} placeholders filled from vars
//   tw(message)        messages produced by the engines (with numbers in them), translated by pattern
//   [data-i18n="key"]  elements whose content is replaced; [data-i18n-attr="attr=key,…"] for attributes
// Load i18n-es.js, then this file, before any other script of the page.
(function (root) {
  "use strict";
  var KEY = "ll-lang", ES = root.LL_ES || null;
  function detect() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("lang"); } catch (e) { q = null; }
    if (q === "es" || q === "en") { try { localStorage.setItem(KEY, q); } catch (e) { /* not remembered */ } return q; }
    try { var s = localStorage.getItem(KEY); if (s === "es" || s === "en") return s; } catch (e) { /* storage blocked */ }
    return /^es\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || "") ? "es" : "en";
  }
  var lang = typeof location !== "undefined" ? detect() : "en";
  var D = lang === "es" ? ES : null;
  function fill(s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }) : String(s); }
  function T(s, v) { var tr = D && D.T[s]; return fill(tr != null ? tr : s, v); }
  function tw(msg) {
    if (!D || !msg) return msg;
    var out = String(msg);
    (D.P || []).forEach(function (p) { out = out.replace(new RegExp(p[0], "g"), p[1]); });
    return out;
  }
  function apply(scope) {
    var doc = scope || document;
    document.documentElement.lang = lang === "es" ? "es-419" : "en";
    if (!D) return;
    doc.querySelectorAll("[data-i18n]").forEach(function (el) { var tr = D.H[el.getAttribute("data-i18n")]; if (tr != null) el.innerHTML = tr; });
    doc.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) { var kv = pair.split("="), tr = D.H[kv[1]]; if (tr != null) el.setAttribute(kv[0], tr); });
    });
    var t = document.querySelector("title[data-i18n]"); if (t && D.H[t.getAttribute("data-i18n")]) document.title = D.H[t.getAttribute("data-i18n")];
    // links between the app's pages keep the language even where the choice cannot be stored
    doc.querySelectorAll("a[href]").forEach(function (a) { var h = a.getAttribute("href"); if (/^(index|about)\.html|^\.\/?(#|$)/.test(h)) a.setAttribute("href", withLang(h)); });
  }
  // the switch in the header: reloads in the other language, keeping the scenario
  function other() { return lang === "es" ? "en" : "es"; }
  function hrefFor(l, path) {
    var q = new URLSearchParams(location.search); q.set("lang", l); q.delete("tour"); q.delete("step");
    return (path || location.pathname) + "?" + q.toString() + location.hash;
  }
  function mountSwitch() {
    var b = document.getElementById("langBtn"); if (!b) return;
    b.textContent = lang === "es" ? "English" : "Español";
    b.setAttribute("lang", other()); b.setAttribute("aria-label", lang === "es" ? "Switch to English" : "Cambiar a español");
    b.addEventListener("click", function () { try { localStorage.setItem(KEY, other()); } catch (e) { /* the link carries it */ } location.href = hrefFor(other()); });
  }
  // links between pages carry the language when the viewer's choice cannot be stored
  function withLang(href) { return lang === "es" ? href.replace(/^([^#?]*)(\?[^#]*)?/, function (m, p, q) { var s = new URLSearchParams((q || "").slice(1)); s.set("lang", "es"); return p + "?" + s.toString(); }) : href; }
  root.ROi18n = { lang: lang, T: T, t: T, tw: tw, apply: apply, withLang: withLang, hrefFor: hrefFor };
  if (typeof document !== "undefined") { apply(); mountSwitch(); }
})(typeof self !== "undefined" ? self : this);
