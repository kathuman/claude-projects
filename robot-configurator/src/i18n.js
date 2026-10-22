// Translation. The English text is the key: t('Top speed on the flat') returns it in the current language, and
// t('{n} parcels', { n: 3 }) fills the placeholders. A text missing from a dictionary falls back to English;
// tests/i18n.test.js checks that every text the page and the engine can show is in every dictionary.
// The generated Arduino programs stay in English, like the Arduino IDE they are read in.

import da from './lang/da.js';
import sv from './lang/sv.js';
import nb from './lang/nb.js';
import es from './lang/es.js';

export const LANGS = {
  en: { name: 'English', locale: 'en-GB' },
  da: { name: 'Dansk', locale: 'da-DK' },
  sv: { name: 'Svenska', locale: 'sv-SE' },
  nb: { name: 'Norsk', locale: 'nb-NO' },
  es: { name: 'Español', locale: 'es-419' },
};
export const DICTS = { da, sv, nb, es };

let current = 'en';
export const lang = () => current;
export const locale = () => LANGS[current].locale;
export function setLang(l) { current = LANGS[l] ? l : 'en'; }

// The language a visitor gets when they have not picked one: the browser's, if it is one of ours.
export function guessLang(list = []) {
  for (const tag of list) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (base === 'no' || base === 'nn') return 'nb';
    if (LANGS[base]) return base;
  }
  return 'en';
}

// texts asked for in another language that its dictionary lacks (the tests read this)
export const missing = new Set();

export function t(text, vars) {
  if (current !== 'en' && !(text in DICTS[current])) missing.add(text);
  const out = (current !== 'en' && DICTS[current][text]) || text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}

// A number in the current language's format (decimal comma in Danish, Swedish, Norwegian and Spanish).
const nf = new Map();
export function num(v, digits = 2) {
  if (!Number.isFinite(v)) return '–';
  const key = `${current}|${digits}`;
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return nf.get(key).format(v);
}
