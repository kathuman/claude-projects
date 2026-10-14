// Tierwise — languages (window.TWi18n). English is written in the pages and scripts; Spanish (Latin America) comes from
// i18n-es.js and Danish from i18n-da.js. The language is chosen by ?lang=en|es|da, then the viewer's last choice, then
// the browser's language.
//   T(english, vars)   the text in the current language, with {name} placeholders filled from vars
//   tw(message)        messages from the engines (plan checks, file errors), translated by pattern
//   fx(value, digits)  a number with a fixed number of decimals, in the language's convention (2.25 / 2,25)
//   locale             for grouping thousands with toLocaleString (en-US for English and Spanish, da-DK for Danish)
//   [data-i18n="key"]  elements whose content is replaced; [data-i18n-attr="attr=key,…"] for attributes
// Load the dictionaries, then this file, before any other script of the page.
(function (root) {
  "use strict";
  var KEY = "tw-lang";
  var LANGS = {
    en: { name: "English", html: "en", locale: "en-US", label: "Language" },
    es: { name: "Español", html: "es-419", locale: "en-US", label: "Idioma" },
    da: { name: "Dansk", html: "da", locale: "da-DK", label: "Sprog" }
  };
  var DICTS = { es: root.TW_ES || null, da: root.TW_DA || null };
  function known(l) { return Object.prototype.hasOwnProperty.call(LANGS, l) && (l === "en" || !!DICTS[l]); }
  function detect() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("lang"); } catch (e) { q = null; }
    if (known(q)) { try { localStorage.setItem(KEY, q); } catch (e) { /* not remembered */ } return q; }
    try { var s = localStorage.getItem(KEY); if (known(s)) return s; } catch (e) { /* storage blocked */ }
    var nav = (typeof navigator !== "undefined" && ((navigator.languages && navigator.languages[0]) || navigator.language)) || "";
    return /^es\b/i.test(nav) && known("es") ? "es" : /^da\b/i.test(nav) && known("da") ? "da" : "en";
  }
  var lang = typeof location !== "undefined" ? detect() : "en";
  var D = lang === "en" ? null : DICTS[lang];
  var comma = lang === "da";
  function fill(s, v) { return v ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? v[k] : m; }) : String(s); }
  function T(s, v) { var tr = D && D.T[s]; return fill(tr != null ? tr : s, v); }
  function tw(msg) {
    if (!D || !msg) return msg;
    var out = String(msg);
    for (var i = 0; i < (D.P || []).length; i++) { var p = D.P[i], re = new RegExp(p[0]); if (re.test(out)) { out = out.replace(re, p[1]); break; } }
    return out;
  }
  function fx(v, d) { var s = Number(v).toFixed(d); return comma ? s.replace(".", ",") : s; }
  function apply(scope) {
    var doc = scope || document;
    document.documentElement.lang = LANGS[lang].html;
    if (!D) return;
    doc.querySelectorAll("[data-i18n]").forEach(function (el) { var tr = D.H[el.getAttribute("data-i18n")]; if (tr != null) el.innerHTML = tr; });
    doc.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(",").forEach(function (pair) { var kv = pair.split("="), tr = D.H[kv[1]]; if (tr != null) el.setAttribute(kv[0], tr); });
    });
    var t = document.querySelector("title[data-i18n]"); if (t && D.H[t.getAttribute("data-i18n")]) document.title = D.H[t.getAttribute("data-i18n")];
    doc.querySelectorAll("a[href]").forEach(function (a) { var h = a.getAttribute("href"); if (/^(index|about)\.html|^\.\/?(#|$)/.test(h)) a.setAttribute("href", withLang(h)); });
  }
  function hrefFor(l) {
    var q = new URLSearchParams(location.search); q.set("lang", l); q.delete("tour"); q.delete("step");
    return location.pathname + "?" + q.toString() + location.hash;
  }
  function mountSwitch() {
    var sel = document.getElementById("langSel"); if (!sel) return;
    sel.innerHTML = Object.keys(LANGS).filter(known).map(function (l) { return "<option value='" + l + "' lang='" + LANGS[l].html + "'>" + LANGS[l].name + "</option>"; }).join("");
    sel.value = lang;
    sel.setAttribute("aria-label", LANGS[lang].label);
    sel.addEventListener("change", function () {
      var l = sel.value; if (l === lang) return;
      try { localStorage.setItem(KEY, l); } catch (e) { /* the link carries it */ }
      location.href = hrefFor(l);
    });
  }
  function withLang(href) { return lang !== "en" ? href.replace(/^([^#?]*)(\?[^#]*)?/, function (m, p, q) { var s = new URLSearchParams((q || "").slice(1)); s.set("lang", lang); return p + "?" + s.toString(); }) : href; }
  root.TWi18n = { lang: lang, langs: LANGS, locale: LANGS[lang].locale, T: T, t: T, tw: tw, fx: fx, apply: apply, withLang: withLang, hrefFor: hrefFor };
  if (typeof document !== "undefined") {
    var run = function () { apply(); mountSwitch(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run); else run();
  }
})(typeof self !== "undefined" ? self : this);
