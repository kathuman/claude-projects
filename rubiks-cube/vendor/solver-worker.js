// Web Worker: runs the Kociemba two-phase solver off the main thread.
// cube.js + solve.js are the cubejs library (MIT) — see LICENSE-cubejs.
//   init      build the solver's tables (about a second), then reply "ready"
//   solve     { facelets } → { algorithm, ms }
//   scramble  a random-position scramble: draw a position uniformly at random, solve it, and return the inverse of
//             the solution (the moves that make that position from a solved cube) → { algorithm, facelets }
importScripts("cube.js", "solve.js");

var ready = false;

self.onmessage = function (e) {
  var msg = e.data || {};

  if (msg.cmd === "init") {
    if (!ready) {
      Cube.initSolver();
      ready = true;
    }
    self.postMessage({ cmd: "ready" });
    return;
  }

  try {
    if (msg.cmd === "solve") {
      var cube = Cube.fromString(msg.facelets);
      var t0 = Date.now();
      var algorithm = cube.solve();
      self.postMessage({ cmd: "solved", algorithm: algorithm, ms: Date.now() - t0 });
    } else if (msg.cmd === "scramble") {
      var c = Cube.random();
      self.postMessage({ cmd: "scrambled", algorithm: Cube.inverse(c.solve()), facelets: c.asString() });
    }
  } catch (err) {
    self.postMessage({ cmd: "error", message: String((err && err.message) || err) });
  }
};
