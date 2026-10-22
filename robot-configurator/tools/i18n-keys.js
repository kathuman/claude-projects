// Every text the page and the engine can show, found by reading the sources: the literals inside t(…) calls, the
// elements of index.html and about.html marked data-i18n (and their data-i18n-attr attributes), and the labels kept
// in data tables (vendor modes, surfaces, regions, swap slots…) that are translated where they are shown.
//   node tools/i18n-keys.js            print the keys, one per line
//   node tools/i18n-keys.js --missing  print what each dictionary lacks
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODE_LABEL } from '../src/pricing.js';
import { TERRAIN } from '../src/physics.js';
import { REGIONS, PARTS } from '../src/catalog.js';
import { SLOT_LABEL, BEHAVIOURS } from '../src/solver.js';

const ROOT = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const SOURCES = ['app.js', 'src/solver.js', 'src/guide.js', 'src/wiring.js'];

// the string literals in the first argument of every t( … ) call
function tCalls(src) {
  const out = [];
  const re = /\bt\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/[\w$.]/.test(src[m.index - 1] ?? '')) continue; // part of another name (e.g. alert(, x.t()
    let i = m.index + 2;
    let depth = 0;
    let arg = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"') {
        let j = i + 1;
        while (src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        arg += src.slice(i, j + 1);
        i = j;
        continue;
      }
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      if (c === ',' && depth === 0) break;
      arg += c;
    }
    // literals that are only compared or searched for (s === 'L', id.includes('clone')) are not texts
    arg = arg.replace(/(?:[!=]==\s*|\.includes\(\s*)('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, '');
    for (const lit of arg.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
      out.push((lit[1] ?? lit[2]).replace(/\\(.)/g, '$1'));
    }
  }
  return out;
}

function htmlKeys(src) {
  const out = [];
  for (const m of src.matchAll(/<(\w+)[^>]*\sdata-i18n(?:=""|)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/g)) {
    out.push(m[2].replace(/\s+/g, ' ').trim());
  }
  for (const m of src.matchAll(/<[^>]*data-i18n-attr="([^"]+)"[^>]*>/g)) {
    for (const a of m[1].split(',')) {
      const v = m[0].match(new RegExp(`\\s${a}="([^"]*)"`));
      if (v) out.push(v[1]);
    }
  }
  return out;
}

export function allKeys() {
  const keys = new Set();
  for (const f of SOURCES) for (const k of tCalls(read(f))) keys.add(k);
  for (const f of ['index.html', 'about.html']) for (const k of htmlKeys(read(f))) keys.add(k);
  const add = (list) => list.forEach((k) => keys.add(k));
  add(Object.values(MODE_LABEL));
  add(Object.values(TERRAIN).map((x) => x.label));
  add(Object.values(REGIONS).flatMap((r) => [r.name, r.note]));
  add(Object.values(SLOT_LABEL));
  add(Object.values(BEHAVIOURS));
  add(['Lowest cost', 'Most headroom', 'Quickest delivery', 'Your pick']); // app.js KIND
  add(['red', 'black', 'blue', 'yellow', 'jumper']); // wire colours
  add(['Power', 'Motors', 'Servos', 'Signals']); // wiring groups
  add(['Payload', 'Top speed', 'Slope', 'Runtime', 'Arm payload', 'Arm reach']); // explain(): relaxed requirements
  add([...new Set(PARTS.filter((p) => p.cat === 'frame').flatMap((p) => p.joints)), 'gripper']); // joint names
  add(['Remove the 5V-EN jumper and the ENA/ENB jumpers; the enable pins take PWM from the controller.']); // wiring.js
  keys.delete('');
  return [...keys].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const keys = allKeys();
  if (process.argv.includes('--missing')) {
    const { DICTS } = await import('../src/i18n.js');
    for (const [l, d] of Object.entries(DICTS)) {
      const miss = keys.filter((k) => !(k in d));
      console.log(`${l}: ${miss.length} missing`);
      if (process.argv.includes('-v')) for (const k of miss) console.log('  ' + k);
    }
  } else {
    for (const k of keys) console.log(k);
  }
}
