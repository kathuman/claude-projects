// Web Worker: runs the Kociemba two-phase solver off the main thread.
// cube.js + solve.js are the cubejs library (MIT) — see LICENSE-cubejs.
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

  if (msg.cmd === "solve") {
    try {
      var cube = Cube.fromString(msg.facelets);
      var t0 = Date.now();
      var algorithm = cube.solve();
      self.postMessage({
        cmd: "solved",
        algorithm: algorithm,
        ms: Date.now() - t0,
      });
    } catch (err) {
      self.postMessage({
        cmd: "error",
        message: String((err && err.message) || err),
      });
    }
  }
};
