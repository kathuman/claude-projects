// Runs the solver off the main thread: the mobile-manipulator search checks tens of thousands of combinations.
import { solve } from './solver.js';

self.onmessage = (e) => {
  const t0 = performance.now();
  try {
    const result = solve(e.data);
    // trim what the page doesn't need before it is copied across
    if (result.proposals) {
      for (const p of result.proposals) {
        delete p.design.combo;
        if (p.design.arm) delete p.design.arm.torques;
      }
    }
    self.postMessage({ ok: true, result, ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err?.stack ?? err) });
  }
};
