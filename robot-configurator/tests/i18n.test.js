// Every text the page and the engine can show is in every language, with the same placeholders; and running the
// engine in each language asks for no text a dictionary lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allKeys } from '../tools/i18n-keys.js';
import { DICTS, setLang, t, num, missing, guessLang } from '../src/i18n.js';
import { solve } from '../src/solver.js';
import { buildGuide } from '../src/guide.js';
import { wiring, signalDiagram, powerDiagram } from '../src/wiring.js';

const keys = allKeys();
const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();

test('the key scan finds the page and the engine texts', () => {
  assert.ok(keys.length > 400, `${keys.length} keys`);
  for (const k of ['Find designs', 'Top speed on the flat', 'Check the delivery', 'Ground rail', 'Cost against headroom']) {
    assert.ok(keys.includes(k), k);
  }
});

for (const [lang, dict] of Object.entries(DICTS)) {
  test(`${lang}: every text translated, placeholders kept, no stale entries`, () => {
    const lacking = keys.filter((k) => !(k in dict));
    assert.deepEqual(lacking, [], `${lang} lacks ${lacking.length}`);
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(v && v.trim(), `${lang}: empty translation for ${k}`);
      assert.equal(ph(v), ph(k), `${lang}: placeholders differ in ${k}`);
    }
    const stale = Object.keys(dict).filter((k) => !keys.includes(k));
    assert.deepEqual(stale, [], `${lang} has entries nothing uses`);
  });
}

test('the engine, the guide and the wiring ask only for translated texts, in every language', () => {
  const reqs = [
    { region: 'DK', type: 'rover', rover: { behaviours: ['remote', 'obstacle', 'line', 'odometry'] } },
    { region: 'SE', type: 'rover', rover: { terrain: 'outdoor-grass', payload: 2, slope: 15, speed: 0.8, runtime: 90 } },
    { region: 'NO', type: 'arm', arm: { reach: 0.3, payload: 0.1, axes: 4, wireless: false } },
    { region: 'SE', type: 'mobile', arm: { reach: 0.25, payload: 0.05, axes: 4 } },
    { region: 'DK', type: 'arm', controller: 'avr', printer: true, arm: { reach: 0.35, axes: 5 } },
    { region: 'SE', type: 'rover', rover: { payload: 30, slope: 30 } }, // infeasible: the explanation
    { region: 'SE', type: 'rover', budget: 10 }, // over budget
  ];
  for (const lang of Object.keys(DICTS)) {
    setLang(lang);
    missing.clear();
    for (const req of reqs) {
      const r = solve(req);
      for (const p of r.proposals ?? []) {
        buildGuide(p.design, r.req);
        wiring(p.design);
        signalDiagram(p.design);
        powerDiagram(p.design);
      }
    }
    assert.deepEqual([...missing], [], `${lang}: asked for untranslated texts`);
  }
  setLang('en');
});

test('placeholders are filled and numbers follow the language', () => {
  setLang('da');
  assert.equal(t('{n} motors', { n: 4 }), '4 motorer');
  assert.equal(num(4.84, 2), '4,84');
  setLang('sv');
  assert.equal(num(0.5, 1), '0,5');
  setLang('es'); // Latin American Spanish (es-419) writes a decimal point
  assert.equal(num(0.5, 1), '0.5');
  setLang('en');
  assert.equal(num(4.84, 2), '4.84');
  assert.equal(t('Unknown text stays as it is'), 'Unknown text stays as it is');
});

test('the browser language picks ours, Norwegian in any of its forms', () => {
  assert.equal(guessLang(['nn-NO']), 'nb');
  assert.equal(guessLang(['no']), 'nb');
  assert.equal(guessLang(['sv-SE', 'en']), 'sv');
  assert.equal(guessLang(['fr-FR', 'es-CL']), 'es');
  assert.equal(guessLang(['fr-FR']), 'en');
});
