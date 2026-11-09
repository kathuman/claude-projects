// Tierwise — the job runner for the page (window.TWJobs). Each kind of job has its own Web Worker, so a long solve never
// blocks the page. A newer job of the same kind replaces one still running (its promise is rejected with `superseded`),
// and finished results are cached by their input, so asking again for the same thing is instant.
(function (root) {
  "use strict";
  var SCRIPTS = { solve: "src/solve-worker.js", invest: "src/invest-worker.js", priorities: "src/priorities-worker.js", stress: "src/stress-worker.js", scan: "src/stress-worker.js", worst: "src/stress-worker.js" }, CACHE = 8;
  function runner(scripts) {
    scripts = scripts || SCRIPTS;
    var workers = {}, live = {}, seq = 0, cache = [];
    function hit(key) { for (var i = 0; i < cache.length; i++) if (cache[i].key === key) return cache[i].result; return null; }
    function keep(key, result) { cache = cache.filter(function (c) { return c.key !== key; }); cache.unshift({ key: key, result: result }); if (cache.length > CACHE) cache.length = CACHE; }
    function worker(kind) {
      if (workers[kind]) return workers[kind];
      var w = new Worker(scripts[kind]);
      w.onmessage = function (e) {
        var d = e.data, job = live[kind]; if (!job || d.id !== job.id) return;
        if (d.progress != null) { job.progress(d.progress); return; }
        delete live[kind];
        if (d.result && d.result.ok) keep(job.key, d.result);
        job.ok(d.result);
      };
      w.onerror = function () { var job = live[kind]; delete live[kind]; workers[kind] = null; if (job) job.ok({ ok: false, errors: ["The solver could not be loaded."] }); };
      return (workers[kind] = w);
    }
    function run(kind, payload, progress) {
      if (!scripts[kind]) return Promise.reject(new Error("unknown job: " + kind));
      var key = kind + JSON.stringify(payload), cached = hit(key);
      if (cached) return Promise.resolve(cached);
      var old = live[kind];
      if (old) { if (old.key === key) return old.promise; workers[kind].terminate(); workers[kind] = null; delete live[kind]; old.no({ superseded: true }); }
      var job = { id: ++seq, key: key, progress: progress || function () {} };
      job.promise = new Promise(function (ok, no) { job.ok = ok; job.no = no; });
      live[kind] = job;
      worker(kind).postMessage({ id: job.id, net: payload.net, opts: payload.opts });
      return job.promise;
    }
    run.busy = function (kind) { return !!live[kind]; };
    return run;
  }
  root.TWJobs = { runner: runner, SCRIPTS: SCRIPTS };
})(typeof self !== "undefined" ? self : this);
