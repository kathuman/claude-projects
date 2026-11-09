// Tierwise — the application API (window.TWApi / module.exports). One set of calls for everything that asks the engine
// something: the page, the tests, and later AI tools or an MCP server all use these, so they get the same answers with the
// same receipts. What runs a call is a `run(kind, payload, progress)` function: in the page it hands the work to a Web
// Worker (src/jobs.js); in Node it calls the engine directly with a loaded HiGHS (`direct`). A server can take its place
// later behind the same interface.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./plan.js"), require("./constrained.js"), require("./invest.js"), require("./priorities.js"), require("./store.js"), require("./stress.js"));
  else root.TWApi = factory(root.TWPlan, root.TWConstrained, root.TWInvest, root.TWPriorities, root.TWStore, root.TWStress);
})(typeof self !== "undefined" ? self : this, function (P, K, IV, PR, S, ST) {
  "use strict";
  // what each kind of job does, given a loaded HiGHS: the same functions the workers call
  var KINDS = {
    solve: function (h, d) { return K.solve(h, d.net, d.opts); },
    invest: function (h, d) {
      var r = IV.solve(h, d.net, d.opts);
      if (r.ok) { try { r.verified = IV.verify(h, d.net, r, d.opts); } catch (e) { r.verified = { ok: false, errors: [String(e && e.message || e)] }; } }
      return r;
    },
    priorities: function (h, d, progress) { return PR.analyse(h, d.net, d.opts, progress); },
    stress: function (h, d, progress) { return ST.analyse(h, d.net, d.opts, progress); },
    scan: function (h, d, progress) { return ST.scan(h, d.net, d.opts, progress); },
    worst: function (h, d, progress) { return ST.worst(h, d.net, d.opts, progress); }
  };
  // a runner that calls the engine in this thread: for Node, tests and tools
  function direct(highs) {
    return function (kind, payload, progress) {
      return new Promise(function (ok, no) {
        if (!KINDS[kind]) { no(new Error("unknown job: " + kind)); return; }
        try { ok(KINDS[kind](highs, payload, progress || function () {})); } catch (e) { no(e); }
      });
    };
  }
  function create(run) {
    var clone = function (x) { return JSON.parse(JSON.stringify(x)); };
    return {
      // the requirement plan: unlimited capacity, instant, in this thread
      plan: function (net) { return P.plan(net); },
      // the plan within capacity, with its receipt and the value of capacity
      solve: function (net, opts) { return run("solve", { net: clone(net), opts: opts || {} }); },
      // the investment optimiser, its package verified month by month
      invest: function (net, opts) { return run("invest", { net: clone(net), opts: opts || {} }); },
      // what to do, ranked by the plan
      priorities: function (net, opts, progress) { return run("priorities", { net: clone(net), opts: opts || {} }, progress); },
      // a stress test: one disruption (opts.disruption), solved against the undisturbed plan
      stress: function (net, opts, progress) { return run("stress", { net: clone(net), opts: opts || {} }, progress); },
      // every site and route out in turn for its time to recover: screened, the worst solved
      scan: function (net, opts, progress) { return run("scan", { net: clone(net), opts: Object.assign({}, opts || {}, { scan: true }) }, progress); },
      // the worst combination of up to three failures from one start (greedy, with a pair look-ahead)
      worst: function (net, opts, progress) { return run("worst", { net: clone(net), opts: Object.assign({}, opts || {}, { worst: true }) }, progress); },
      // what changed between two networks
      diff: function (a, b) { return S.diff(a, b); },
      fingerprint: function (net) { return S.hashOf(JSON.stringify(net)); }
    };
  }
  return { create: create, direct: direct, KINDS: Object.keys(KINDS) };
});
