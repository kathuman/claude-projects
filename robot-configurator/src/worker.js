// Runs the solver off the main thread: the mobile-manipulator search checks tens of thousands of combinations.
// It keeps the last search, so a design picked on the chart or a swapped part needs no new search.
//   { cmd: 'solve', req, lang }        → { cmd, ok, result, ms }
//   { cmd: 'pick', idx }               → { cmd, ok, proposal }
//   { cmd: 'swap', idx, slot }         → { cmd, ok, idx, slot, options }
import { solveSession, pickDesign, swapOptions } from './solver.js';
import { setLang } from './i18n.js';

let ctx = null;

// what the page needs of a design, without the search's internals (the kept copy stays whole)
function view(p) {
  if (!p) return p;
  const d = { ...p.design };
  delete d.combo;
  if (d.arm) d.arm = { ...d.arm, torques: undefined };
  return { ...p, design: d };
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.cmd === 'solve') {
      setLang(m.lang);
      const t0 = performance.now();
      const s = solveSession(m.req);
      ctx = s.ctx;
      const result = { ...s.result, proposals: s.result.proposals?.map(view) };
      self.postMessage({ cmd: 'solve', ok: true, result, ms: performance.now() - t0 });
    } else if (m.cmd === 'pick') {
      self.postMessage({ cmd: 'pick', ok: true, proposal: view(ctx && pickDesign(ctx, m.idx)) });
    } else if (m.cmd === 'swap') {
      self.postMessage({ cmd: 'swap', ok: true, idx: m.idx, slot: m.slot, options: ctx ? swapOptions(ctx, m.idx, m.slot) : [] });
    }
  } catch (err) {
    self.postMessage({ cmd: m.cmd, ok: false, error: String(err?.stack ?? err) });
  }
};
