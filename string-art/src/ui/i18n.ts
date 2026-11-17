// Languages: English is written in the pages and the scripts; Spanish (Latin America) and Danish come from the
// dictionaries. The language is chosen by ?lang=en|es|da, then the viewer's last choice, then the browser's language.
//   T(english, vars)   the text in the current language, {name} placeholders filled from vars
//   fx(value, digits)  a number with fixed decimals in the language's convention (2.25 / 2,25)
//   [data-i18n="key"]  elements whose content is replaced; [data-i18n-attr="attr=key,…"] for attributes

import { ES } from "./i18n-es";
import { DA } from "./i18n-da";

export interface Dict { T: Record<string, string>; H: Record<string, string> }
type Lang = "en" | "es" | "da";

const KEY = "sa-lang";
export const LANGS: Record<Lang, { name: string; html: string; locale: string; label: string }> = {
  en: { name: "English", html: "en", locale: "en-US", label: "Language" },
  es: { name: "Español", html: "es-419", locale: "en-US", label: "Idioma" },
  da: { name: "Dansk", html: "da", locale: "da-DK", label: "Sprog" }
};
const DICTS: Record<Lang, Dict | null> = { en: null, es: ES, da: DA };

const isLang = (l: unknown): l is Lang => l === "en" || l === "es" || l === "da";

function detect(): Lang {
  if (typeof location === "undefined") return "en";
  let q: string | null = null;
  try { q = new URLSearchParams(location.search).get("lang"); } catch { q = null; }
  if (isLang(q)) { try { localStorage.setItem(KEY, q); } catch { /* not remembered */ } return q; }
  try { const s = localStorage.getItem(KEY); if (isLang(s)) return s; } catch { /* storage blocked */ }
  const nav = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "";
  return /^es\b/i.test(nav) ? "es" : /^da\b/i.test(nav) ? "da" : "en";
}

export const lang: Lang = detect();
const D = DICTS[lang];
export const locale = LANGS[lang].locale;

const fill = (s: string, v?: Record<string, string | number>) =>
  v ? s.replace(/\{(\w+)\}/g, (m, k: string) => (v[k] != null ? String(v[k]) : m)) : s;

export function T(s: string, v?: Record<string, string | number>): string {
  const tr = D?.T[s];
  return fill(tr ?? s, v);
}

export function fx(v: number, digits: number): string {
  const s = v.toFixed(digits);
  return lang === "da" ? s.replace(".", ",") : s;
}

/** Thousands-grouped integer in the language's convention. */
export function int(v: number): string { return Math.round(v).toLocaleString(locale); }

function withLang(href: string): string {
  if (lang === "en") return href;
  return href.replace(/^([^#?]*)(\?[^#]*)?/, (_m, p: string, q?: string) => {
    const s = new URLSearchParams((q || "").slice(1)); s.set("lang", lang); return p + "?" + s.toString();
  });
}

export function apply(scope: ParentNode = document): void {
  document.documentElement.lang = LANGS[lang].html;
  if (D) {
    scope.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { const tr = D.H[el.dataset.i18n!]; if (tr != null) el.innerHTML = tr; });
    scope.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
      el.dataset.i18nAttr!.split(",").forEach((pair) => { const [attr, key] = pair.split("="); const tr = D.H[key]; if (tr != null) el.setAttribute(attr, tr); });
    });
    const t = document.querySelector<HTMLTitleElement>("title[data-i18n]");
    if (t && D.H[t.dataset.i18n!]) document.title = D.H[t.dataset.i18n!];
  }
  // links between the app's pages keep the language even where the choice cannot be stored
  scope.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const h = a.getAttribute("href")!;
    if (/^(index|about|machine|build|calculations)\.html/.test(h)) a.setAttribute("href", withLang(h));
  });
}

export function mountSwitch(): void {
  const sel = document.getElementById("langSel") as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = (Object.keys(LANGS) as Lang[]).map((l) => `<option value="${l}" lang="${LANGS[l].html}">${LANGS[l].name}</option>`).join("");
  sel.value = lang;
  sel.setAttribute("aria-label", LANGS[lang].label);
  sel.addEventListener("change", () => {
    const l = sel.value as Lang;
    if (l === lang) return;
    try { localStorage.setItem(KEY, l); } catch { /* the link carries it */ }
    const q = new URLSearchParams(location.search); q.set("lang", l);
    location.href = location.pathname + "?" + q.toString() + location.hash;
  });
}
