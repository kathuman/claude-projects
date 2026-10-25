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
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(BASE);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  const model = `${BASE}src/model.js`;
  await p.click('#spinToggle'); // keep the view still, so drags land where expected
  const after = (alg, from) => p.evaluate(async ([m, a, f]) => { const M = await import(m); return M.applyAlg(f || M.SOLVED, a); }, [model, alg, from]);
  const settled = () => p.waitForFunction(() => !document.getElementById('btnReset').disabled && !document.querySelector('.cubie.move'));

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
  await p.waitForFunction(() => document.getElementById('rState').textContent === 'not solved', null, { timeout: 15000 });
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
  await p.click('#labelsToggle');

  // ---- 1.1: turning by hand
  await p.click('#btnReset');
  await p.click('[data-move="R"]');
  await settled();
  check((await p.evaluate(READ)).net === await after('R'), 'the R button turns R');
  await p.keyboard.press('u');
  await settled();
  await p.keyboard.press('Shift+U');
  await settled();
  check((await p.evaluate(READ)).net === await after('R'), "keys: u then Shift+U (U then U') cancel");
  check((await p.$$('.move-token')).length === 3, 'every move made by hand is in the move list');
  await p.keyboard.press('Control+z');
  await settled();
  check((await p.evaluate(READ)).net === await after('R U'), 'Ctrl+Z undoes the last move');
  await p.click('#btnRedo');
  await settled();
  check((await p.evaluate(READ)).net === await after('R'), 'Redo makes it again');
  await p.click('#btnUndo'); await settled();
  await p.click('[data-move="F2"]'); await settled();
  check((await p.$$('.move-token')).length === 3 && (await p.evaluate(READ)).net === await after('R U F2'), 'a new move after an undo replaces what came after');

  // ---- typed moves, set-up
  await p.fill('#algInput', 'R Q');
  await p.click('#algForm button[type=submit]');
  check(/Not a move/.test(await p.textContent('#algMsg')), 'a mistyped move is explained');
  await p.click('#btnReset');
  await p.fill('#algInput', "R U R' U'");
  await p.click('#algForm button[type=submit]');
  await settled();
  check((await p.evaluate(READ)).net === await after("R U R' U'"), 'typed moves play');
  await p.fill('#algInput', 'F2 B2 x');
  await p.click('#algSetup');
  check((await p.evaluate(READ)).net === await after('F2 B2 x') && (await p.$$('.move-token')).length === 0, 'Set up starts from those moves already made');

  // ---- a link round trip
  await p.fill('#algInput', "R U' M2");
  await p.click('#algForm button[type=submit]');
  await settled();
  await p.click('#btnLink');
  const url = await p.evaluate(() => navigator.clipboard.readText());
  check(/setup=F2\+B2\+x/.test(url) && /alg=R\+U%27\+M2/.test(url), `the link carries the set-up and the moves (${url})`);
  await p.goto(url);
  check((await p.evaluate(READ)).net === await after('F2 B2 x') && (await p.$$('.move-token')).length === 3, 'the link opens that cube with that move list');
  await p.click('#tpEnd');
  check((await p.evaluate(READ)).net === await after("F2 B2 x R U' M2"), 'and its moves play to the same cube');
  await p.goto(BASE);
  await p.click('#spinToggle');

  // ---- dragging stickers
  const sticker = (pos, dir) => p.evaluate(([pos, dir]) => {
    const el = [...document.querySelectorAll('.cubie')].find((c) => c.style.getPropertyValue('--tx') === `${pos[0] * 64}px` && c.style.getPropertyValue('--ty') === `${pos[1] * 64}px` && c.style.getPropertyValue('--tz') === `${pos[2] * 64}px`).querySelector(`.face.${dir}`);
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, [pos, dir]);
  const drag = async (pos, dir, dx, dy) => {
    const [x, y] = await sticker(pos, dir);
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2); await p.mouse.move(x + dx, y + dy); await p.mouse.up();
    await settled();
  };
  await drag([1, -1, 1], 'pz', -80, 0); // front face, top-right sticker (CSS y is down), dragged left
  check((await p.evaluate(READ)).net === await after('U'), 'dragging the front top row to the left turns U');
  await drag([1, 0, 1], 'pz', 0, -80); // front face, right column, dragged up
  check((await p.evaluate(READ)).net === await after('U R'), 'dragging the right column up turns R');
  await drag([0, 0, 1], 'pz', 0, 80); // front face, middle column, dragged down
  check((await p.evaluate(READ)).net === await after('U R M'), 'dragging the middle column down turns M');

  // ---- solving a cube that was turned as a whole
  await p.click('#btnReset');
  await p.fill('#speed', '100');
  await p.fill('#algInput', "x y R U F'");
  await p.click('#algForm button[type=submit]');
  await settled();
  await p.click('#btnSolve');
  await p.waitForFunction(() => document.getElementById('tlPhase').textContent === 'solved', null, { timeout: 60000 });
  check(/^[xyz]/.test(await p.textContent('#rSolution')), 'the solution first turns the cube back to the standard hold');
  await shot(p, 'hands-on');

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
