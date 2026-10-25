// Drives Cube Studio in a real browser: the look and theme, the solver starting, a random-position scramble whose
// net and 3D stickers match the model, a solution that plays to a solved cube, stepping, keys, views and the phone
// layout.
//   python -m http.server 8766   (from the repository root)
//   PW=<path to playwright or playwright-core> [CHROME=<chrome.exe>] [URL=…] [OUT=<folder for screenshots>] node rubiks-cube/tools/browser-check.cjs
const { chromium } = require(process.env.PW || 'playwright');

const BASE = process.env.URL || 'http://localhost:8766/rubiks-cube/';
const OUT = process.env.OUT;
let pass = 0;
const fails = [];
const check = (ok, what) => { if (ok) pass++; else fails.push(what); };
const shot = (p, name) => (OUT ? p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }) : null);

// the cube as the page shows it: read the net's colours and the 3D stickers' colours back into letters
const READ = () => {
  const name = { '--cube-W': 'U', '--cube-R': 'R', '--cube-G': 'F', '--cube-Y': 'D', '--cube-O': 'L', '--cube-B': 'B' };
  const letter = (el, prop) => name[(el.style.getPropertyValue(prop).match(/--cube-[A-Z]/) || [])[0]] || '?';
  const net = {};
  for (const g of document.querySelectorAll('#net .face-grid')) net[g.className.match(/slot-(\w)/)[1]] = [...g.children].map((c) => letter(c, '--cellColor')).join('');
  const stickers = [...document.querySelectorAll('.cubie .sticker')].filter((s) => s.style.opacity === '1').map((s) => letter(s, '--stickerColor'));
  return { net: 'URFDLB'.split('').map((f) => net[f]).join(''), count3d: stickers.length, colours3d: stickers.sort().join('') };
};

(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const model = `${BASE}src/model.js`;

  // ---- look and facts
  check(/^v\d+\.\d+\.\d+$/.test(await p.textContent('#ver')), 'version badge');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgb(10, 47, 82)', `dark blueprint theme by default (${bg})`);
  const facts = await p.textContent('.facts');
  check(/20 face turns/.test(facts) && /26 quarter turns/.test(facts), "God's number stated in both metrics");
  check(!/≤ 20\s*quarter/.test(await p.textContent('body')), 'the old wrong claim is gone');
  await p.click('#theme');
  check((await p.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'theme toggles to light');
  await p.click('#theme');
  check((await p.$$('.cubie')).length === 26, '26 cubies');
  const solvedView = await p.evaluate(READ);
  check(solvedView.net === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', 'the net shows a solved cube');
  check(solvedView.count3d === 54, `54 stickers in 3D (${solvedView.count3d})`);

  // ---- solver, scramble
  await p.waitForFunction(() => /ready/.test(document.getElementById('statusPill').textContent), null, { timeout: 30000 });
  check(!(await p.isDisabled('#btnScramble')), 'scramble is available once the solver is ready');
  check(await p.isDisabled('#btnSolve'), 'solve is off for a solved cube');
  await p.click('#btnScramble');
  await p.waitForFunction(() => document.getElementById('rState').textContent === 'scrambled', null, { timeout: 15000 });
  const scramble = await p.textContent('#rScramble');
  check(scramble.split(' ').length >= 15, `a scramble of a random position (${scramble.split(' ').length} moves)`);
  const view = await p.evaluate(READ);
  const expected = await p.evaluate(async ([m, s]) => { const M = await import(m); return M.applyAlg(M.SOLVED, s); }, [model, scramble]);
  check(view.net === expected, 'the net shows exactly the scrambled position');
  check(view.colours3d === expected.split('').sort().join(''), 'the 3D cube shows the same 54 colours');
  check((await p.$$('.move-token.scramble')).length === scramble.split(' ').length, 'the scramble is listed move by move');
  await shot(p, 'scrambled');

  // ---- step through the scramble from the start
  await p.click('#tpStart');
  check((await p.evaluate(READ)).net === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', 'to start: solved again');
  await p.click('#tpFwd');
  await p.waitForFunction(() => !document.getElementById('tpBack').disabled);
  const one = await p.evaluate(async ([m, s]) => { const M = await import(m); return M.applyMove(M.SOLVED, s.split(' ')[0]); }, [model, scramble]);
  check((await p.evaluate(READ)).net === one, 'one step forward applies the first move');
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction(() => document.getElementById('tpCount').textContent.startsWith('0 /'));
  check((await p.evaluate(READ)).net.startsWith('UUUUUUUUU'), 'the left arrow steps back');
  await p.click('#tpEnd');

  // ---- solve and play to the end
  await p.fill('#speed', '100');
  await p.click('#btnSolve');
  await p.waitForFunction(() => /moves \(/.test(document.getElementById('rLen').textContent), null, { timeout: 15000 });
  check(/\d+ moves \(\d+ quarter turns\)/.test(await p.textContent('#rLen')), 'the solution length in both metrics');
  const sol = await p.textContent('#rSolution');
  const solves = await p.evaluate(async ([m, s, t]) => { const M = await import(m); return M.isSolved(M.applyAlg(t, s)); }, [model, sol, expected]);
  check(solves, 'the solution solves the scrambled position (checked by the model)');
  await p.waitForFunction(() => document.getElementById('tlPhase').textContent === 'solved', null, { timeout: 60000 });
  check((await p.evaluate(READ)).net === 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB', 'played to the end, the cube is solved');
  const heard = await p.waitForFunction(() => /Solved/.test(document.getElementById('announce').textContent), null, { timeout: 3000 }).then(() => true, () => false);
  check(heard, 'screen readers hear that it is solved');
  await shot(p, 'solved');

  // ---- views and labels
  await p.click('#view2d');
  check(await p.evaluate(() => document.querySelector('#stageSlot #net') !== null), 'the net moves to the main stage');
  await p.click('#labelsToggle');
  check((await p.textContent('#net .slot-F .cell')) === 'F', 'labels show the face letters');
  await p.click('#view3d');
  await p.keyboard.press('s');
  await p.waitForFunction(() => document.getElementById('rState').textContent === 'scrambled', null, { timeout: 15000 });
  check(true, 'the S key scrambles');

  // ---- about page and phone
  await p.goto(`${BASE}about.html`);
  check(/Rokicki/.test(await p.textContent('body')), 'the about page cites the God\'s number proofs');
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(BASE);
  check((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll at phone width');
  await shot(m, 'phone');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3)})`);
  await b.close();
  console.log(`${pass}/${pass + fails.length} browser checks passed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
})();
