/*
 * replay.js — who is where, second by second: the timelines behind the
 * side-by-side animation.
 *
 *   WH-B, WH-C  pickers(res, sc, opts): the layout's peak picker crew works the
 *               peak order stream first come, first served. Each order: set up at
 *               a picking point, walk the shortest tour (routing.js, the same
 *               tour the KPIs use), stop to pick, walk back. Positions follow
 *               the travel network's real paths, arcs included.
 *   WH-A        robots(resA, sc, A, opts): re-runs the WH-A simulation with a
 *               movement trace (rmfs.js) — every robot's empty and loaded legs.
 *
 * Both return { movers: [{ legs: [{ t0, t1, pts, cum, kind }], start: [x, y] }],
 * picks: [{ t, n }] } with times in seconds from the start of the window, and
 * at(mover, t) gives a mover's position and state.
 *
 * Pure, no DOM: window.WC.replay in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./demand.js"), require("./routing.js"), require("./slotting.js"), require("./kpi.js"), require("./rmfs.js"));
  else { root.WC = root.WC || {}; root.WC.replay = factory(root.WC.demand, root.WC.routing, root.WC.slotting, root.WC.kpi, root.WC.rmfs); }
})(typeof self !== "undefined" ? self : this, function (demand, routing, slotting, kpi, rmfs) {
  "use strict";

  // The points of a shortest path between two graph nodes, arcs sampled.
  function pathPts(g, a, b) {
    const p = g.path(a, b), pts = [[g.x[p[0]], g.y[p[0]]]];
    for (let j = 1; j < p.length; j++) {
      const sh = g.shapeOf(p[j - 1], p[j]);
      if (sh) {
        const n = Math.max(2, Math.ceil(Math.abs(sh.t1 - sh.t0) * sh.r / 0.5));
        for (let k = 1; k <= n; k++) { const t = sh.t0 + (sh.t1 - sh.t0) * k / n; pts.push([sh.cx + sh.r * Math.cos(t), sh.cy + sh.r * Math.sin(t)]); }
      } else pts.push([g.x[p[j]], g.y[p[j]]]);
    }
    return pts;
  }
  function cumulative(pts) {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return c;
  }
  function makeLeg(t0, t1, pts, kind) { return { t0: t0, t1: t1, pts: pts, cum: cumulative(pts), kind: kind }; }

  // A mover's position at time t: inside a leg, interpolated along its path at
  // constant speed; between legs, where the last one ended.
  function at(m, t) {
    let lo = 0, hi = m.legs.length - 1, k = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (m.legs[mid].t0 <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    if (k < 0) return { x: m.start[0], y: m.start[1], moving: false, kind: m.startKind || "idle" };
    const L = m.legs[k];
    if (t >= L.t1) { const e = L.pts[L.pts.length - 1]; return { x: e[0], y: e[1], moving: false, kind: L.kind === "toStation" ? "atStation" : L.kind === "walk" ? "picking" : "idle" }; }
    const total = L.cum[L.cum.length - 1], d = total * (t - L.t0) / Math.max(1e-9, L.t1 - L.t0);
    let i = 1; while (i < L.cum.length - 1 && L.cum[i] < d) i++;
    const a = L.pts[i - 1], b = L.pts[i], seg = L.cum[i] - L.cum[i - 1], f = seg > 0 ? (d - L.cum[i - 1]) / seg : 1;
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, moving: true, kind: L.kind };
  }

  // ---------------------------------------------------------------- WH-B / WH-C pickers
  // opts: { warmup (s, default 600), window (s, default 1200), seed }
  function pickers(res, sc, opts) {
    opts = opts || {};
    const warm = opts.warmup === undefined ? 600 : opts.warmup, Tw = opts.window || 1200, T = warm + Tw;
    const Lay = res.layout, g = Lay.graph, M = Lay.M, seed = opts.seed === undefined ? sc.seed : opts.seed;
    const stream = demand.orderStream(sc, seed), rnd = demand.mulberry32((seed ^ 0x7f4a7c15) >>> 0);
    const meanL = demand.meanLines(sc), rate = sc.lines_per_day / sc.operating_hours_per_day * sc.peak_hour_factor / meanL / 3600;
    const N = res.kpi.pickersNeeded, depots = Lay.depots;
    const crew = [];
    for (let i = 0; i < N; i++) crew.push({ free: 0, key: depots[i % depots.length], legs: [], start: null });
    const picks = [];
    const keep = function (t0, t1) { return t1 >= warm && t0 <= T; };
    let t = 0;
    for (;;) {
      t += -Math.log(1 - rnd()) / rate;
      if (t > T) break;
      const order = stream.next(), locs = kpi.orderLocations(order, res.slotModel, res.skuLoc, rnd);
      // the earliest-free picker takes it
      let p = crew[0]; for (let i = 1; i < N; i++) if (crew[i].free < p.free) p = crew[i];
      let now = Math.max(t, p.free);
      const keys = locs.map(function (l) { return Lay.locations.key[l]; });
      const r = routing.route(M, depots, keys);
      const lines = new Map(), reach = new Map();
      locs.forEach(function (l, i) { const k = keys[i]; lines.set(k, (lines.get(k) || 0) + 1); reach.set(k, (reach.get(k) || 0) + slotting.reachTime(Lay.locations.z[l], sc)); });
      const walk = function (fromKey, toKey) {
        if (fromKey === toKey) return;
        const pts = pathPts(g, g.keys[fromKey], g.keys[toKey]), len = M.at(fromKey, toKey), t1 = now + len / sc.picker_speed;
        if (keep(now, t1)) p.legs.push(makeLeg(now - warm, t1 - warm, pts, "walk"));
        now = t1;
      };
      walk(p.key, r.depot);                                    // to the tour's picking point, if not already there
      now += sc.order_setup_time;
      let at_ = r.depot;
      r.order.forEach(function (k) {
        walk(at_, k); at_ = k;
        now += lines.get(k) * sc.pick_time_per_line + reach.get(k);
        if (now >= warm && now <= T) picks.push({ t: now - warm, n: lines.get(k) });
      });
      // lines picked at the picking point itself (a location right there)
      if (lines.has(r.depot) && r.order.indexOf(r.depot) < 0) {
        now += lines.get(r.depot) * sc.pick_time_per_line + reach.get(r.depot);
        if (now >= warm && now <= T) picks.push({ t: now - warm, n: lines.get(r.depot) });
      }
      walk(at_, r.depot);
      p.key = r.depot; p.free = now;
    }
    crew.forEach(function (p, i) {
      p.legs.sort(function (a, b) { return a.t0 - b.t0; });
      // start: where the picker was when the window opened — the end of its last leg before it, else its picking point
      const k0 = depots[i % depots.length];
      p.start = [g.x[g.keys[k0]], g.y[g.keys[k0]]];
    });
    // a picker's position before its first leg in the window is where that leg starts
    crew.forEach(function (p) { if (p.legs.length && p.legs[0].t0 > 0) p.start = p.legs[0].pts[0]; });
    picks.sort(function (a, b) { return a.t - b.t; });
    return { movers: crew.map(function (p) { return { legs: p.legs, start: p.start }; }), picks: picks, window: Tw, kind: "picker" };
  }

  // ---------------------------------------------------------------- WH-A robots
  function robots(resA, sc, A, opts) {
    opts = opts || {};
    const Tw = opts.window || 1200, warm = A.warmup_hours * 3600;
    const z = resA.sizing;
    const r = rmfs.simulate(z.layout, sc, A, { robots: z.robotsActive, warmup_h: A.warmup_hours, measure_h: Tw / 3600 + 0.01, trace: { from: warm, to: warm + Tw } });
    const tr = r.trace, R = z.robotsActive;
    const movers = [];
    for (let i = 0; i < R; i++) movers.push({ legs: [], start: tr.start[i] ? [tr.start[i][0], tr.start[i][1]] : [0, 0] });
    tr.legs.forEach(function (l) { movers[l.r].legs.push(makeLeg(l.t0 - warm, l.t1 - warm, l.pts, l.kind)); });
    movers.forEach(function (m) {
      m.legs.sort(function (a, b) { return a.t0 - b.t0; });
      if (m.legs.length && m.legs[0].t0 < 0) m.start = m.legs[0].pts[0];
    });
    const picks = tr.picks.map(function (p) { return { t: p.t - warm, n: p.n }; }).filter(function (p) { return p.t >= 0 && p.t <= Tw; }).sort(function (a, b) { return a.t - b.t; });
    return { movers: movers, picks: picks, window: Tw, kind: "robot" };
  }

  // Lines picked by time t (picks sorted by time).
  function linesBy(rep, t) {
    let n = 0;
    for (let i = 0; i < rep.picks.length && rep.picks[i].t <= t; i++) n += rep.picks[i].n;
    return n;
  }

  return { pathPts, cumulative, at, pickers, robots, linesBy };
});
