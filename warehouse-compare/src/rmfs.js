/*
 * rmfs.js — WH-A in operation: a discrete-event simulation of a robotic mobile
 * fulfilment system, and the sizing of its stations and robot fleet.
 *
 * What happens:
 *   - Orders arrive at the peak rate (Poisson; the same order stream as WH-B
 *     and WH-C) and wait in a backlog until a station has a free order slot.
 *   - A station keeps up to `order_slots` orders open (a put wall). While
 *     fewer than `pipeline` pods are on their way to it, it claims the free
 *     pod that holds the most of its still-unassigned open lines.
 *   - The nearest idle robot drives empty to that pod (Manhattan, under the
 *     parked pods), lifts it, carries it through the aisles to the station
 *     and queues.
 *   - The picker takes every open line of the station's orders that is on the
 *     pod ("pile-on"): pod_switch_time + lines × pick time + order_setup_time
 *     for each order this completes.
 *   - A robot carries the pod back to a slot chosen by the put-away policy:
 *       fixed      its home slot (the initial placement never changes)
 *       random     any free slot
 *       nearest    the free slot closest to the station it just left — popular
 *                  pods come back often, so they gather near the stations
 *       frequency  the free slot whose distance rank best matches the pod's
 *                  popularity rank, from exponentially smoothed visit counts
 *
 * One SKU, one location: each SKU is in exactly one pod. pod_fill decides
 * which: "by_popularity" fills pods with SKUs of similar popularity (hot and
 * cold pods), "random" spreads them.
 *
 * Not modelled: robot congestion and blocking (robot_speed is an effective
 * speed), battery charging (robot_availability), pods sent from station to
 * station without going home.
 *
 * Pure, no DOM: window.WC.rmfs in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./demand.js"), require("./layouts/wha.js"), require("./t.js"));
  else { root.WC = root.WC || {}; root.WC.rmfs = factory(root.WC.demand, root.WC.layouts.A, root.WC.t); }
})(typeof self !== "undefined" ? self : this, function (demand, wha, tr) {
  "use strict";

  // ---------------------------------------------------------------- event heap
  // Ordered by time, then by when the event was scheduled — so events at the
  // same instant always run in the same order, whatever else is scheduled.
  function Heap() { this.t = []; this.q = []; this.e = []; this.n = 0; }
  Heap.prototype.less = function (t1, q1, t2, q2) { return t1 < t2 || (t1 === t2 && q1 < q2); };
  Heap.prototype.push = function (t, ev) {
    const q = this.n++;
    let i = this.t.length; this.t.push(t); this.q.push(q); this.e.push(ev);
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(t, q, this.t[p], this.q[p])) break; this.t[i] = this.t[p]; this.q[i] = this.q[p]; this.e[i] = this.e[p]; i = p; }
    this.t[i] = t; this.q[i] = q; this.e[i] = ev;
  };
  Heap.prototype.pop = function () {
    const top = { t: this.t[0], e: this.e[0] }, lt = this.t.pop(), lq = this.q.pop(), le = this.e.pop(), m = this.t.length;
    if (m > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= m) break;
        if (c + 1 < m && this.less(this.t[c + 1], this.q[c + 1], this.t[c], this.q[c])) c++;
        if (!this.less(this.t[c], this.q[c], lt, lq)) break;
        this.t[i] = this.t[c]; this.q[i] = this.q[c]; this.e[i] = this.e[c]; i = c;
      }
      this.t[i] = lt; this.q[i] = lq; this.e[i] = le;
    }
    return top;
  };
  Heap.prototype.size = function () { return this.t.length; };

  // ---------------------------------------------------------------- setup
  // SKU → pod, and each pod's share of order lines.
  function fillPods(nSku, nPods, weights, mode, rnd) {
    const order = Array.from({ length: nSku }, function (_, i) { return i; });
    if (mode === "random") for (let i = nSku - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    const skuPod = new Int32Array(nSku), podW = new Float64Array(nPods);
    order.forEach(function (s, i) { const p = Math.floor(i * nPods / nSku); skuPod[s] = p; podW[p] += weights[s]; });
    return { skuPod: skuPod, podW: podW };
  }

  // Slots ranked by loaded distance to the nearest station.
  function slotRank(L) {
    const near = L.toStation.map(function (d) { return Math.min.apply(null, d); });
    const byNear = near.map(function (_, i) { return i; }).sort(function (a, b) { return near[a] - near[b] || a - b; });
    const rank = new Int32Array(near.length); byNear.forEach(function (s, r) { rank[s] = r; });
    return { near: near, byNear: byNear, rank: rank };
  }

  // Initial placement follows the shared slotting policy, applied to pods by popularity.
  function placePods(L, podW, policy, rnd, sr) {
    const P = podW.length, S = L.slots.length;
    const byPop = Array.from({ length: P }, function (_, i) { return i; }).sort(function (a, b) { return podW[b] - podW[a] || a - b; });
    const podSlot = new Int32Array(P);
    const shuffle = function (a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    if (policy === "ranked") byPop.forEach(function (p, r) { podSlot[p] = sr.byNear[r]; });
    else if (policy === "abc") {
      // classes over the slots and over the pods, 20/30/50%, random within each
      const cls = function (u) { return u < 0.2 ? 0 : u < 0.5 ? 1 : 2; };
      const sl = [[], [], []], pd = [[], [], []];
      sr.byNear.forEach(function (s, r) { sl[cls((r + 0.5) / S)].push(s); });
      byPop.forEach(function (p, r) { pd[cls((r + 0.5) / P)].push(p); });
      let spill = [];
      for (let c = 0; c < 3; c++) { const s = shuffle(sl[c].slice()), ps = spill.concat(pd[c]); spill = []; ps.forEach(function (p, i) { if (i < s.length) podSlot[p] = s[i]; else spill.push(p); }); }
    } else {
      const s = shuffle(Array.from({ length: S }, function (_, i) { return i; }));
      for (let p = 0; p < P; p++) podSlot[p] = s[p];
    }
    return podSlot;
  }

  // ---------------------------------------------------------------- simulation
  // opts: { stations (in L), robots, seed, warmup_h, measure_h, mode: "peak" | "saturated",
  //         shock: { at_h, shift } (move popularity along the SKU order mid-run), history: seconds between snapshots }
  function simulate(L, sc, A, opts) {
    const seed = opts.seed === undefined ? sc.seed : opts.seed;
    const v = A.robot_speed, lift = A.lift_time, S = L.depots.length, R = Math.max(1, Math.round(opts.robots));
    const warm = (opts.warmup_h === undefined ? A.warmup_hours : opts.warmup_h) * 3600, Tend = warm + (opts.measure_h === undefined ? A.measure_hours : opts.measure_h) * 3600;
    const stream = demand.orderStream(sc, seed), rnd = demand.mulberry32((seed ^ 0x51ed27) >>> 0);
    const P = L.pods, NS = L.slots.length;
    let fill = fillPods(sc.skus, P, stream.weights, A.pod_fill, rnd);
    const sr = slotRank(L);
    const podSlot = placePods(L, fill.podW, sc.slotting, rnd, sr);
    const home = Int32Array.from(podSlot);
    const slotOcc = new Int32Array(NS).fill(-1), reserved = new Uint8Array(NS);
    for (let p = 0; p < P; p++) { slotOcc[podSlot[p]] = p; if (A.put_away === "fixed") reserved[podSlot[p]] = 1; }
    const claim = new Int32Array(P).fill(-1);                // station that claimed the pod, -1 free in its slot
    const score = new Float64Array(P), scoreT = new Float64Array(P), halfLife = (A.frequency_half_life_h || 2) * 3600;

    const robots = [];
    for (let r = 0; r < R; r++) { const sl = L.slots[sr.byNear[Math.floor(r * NS / R)]]; robots.push({ x: sl.x, y: sl.y, px: sl.x, py: sl.y, busy: false, pod: -1, st: -1, t0: 0 }); }   // px/py: where its latest move ends
    const stations = [];
    for (let s = 0; s < S; s++) stations.push({ orders: [], pipe: 0, queue: [], busy: false });
    const backlog = [], pending = [];
    const H = new Heap();
    const meanL = demand.meanLines(sc), peakLines = sc.lines_per_day / sc.operating_hours_per_day * sc.peak_hour_factor;
    const orderRate = peakLines / meanL / 3600;              // orders per second
    let orderId = 0;

    // stats over the measured window
    const st = { lines: 0, visits: 0, workerBusy: new Float64Array(S), empty: 0, loaded: 0, robotBusy: 0, orders: 0, cycle: 0, wait: 0, started: 0,
      queueWait: 0, queued: 0, podDist: 0, podDistN: 0 };
    const history = [];
    const measuring = function (t) { return t >= warm; };
    // running totals from time 0 (for the history), and the movement trace for the animation
    const tot = { lines: 0, dist: 0, wait: 0, started: 0, visits: 0 };
    const tr = opts.trace ? { from: opts.trace.from, to: opts.trace.to, legs: [], picks: [], start: [] } : null;
    const tracing = function (t) { return tr && t >= tr.from && t <= tr.to; };
    function leg(r, t0, t1, kind, pts) { if (tr && t1 >= tr.from && t0 <= tr.to) tr.legs.push({ r: r, t0: t0, t1: t1, kind: kind, pts: pts }); }
    function loadedPts(slot, s, toStation) {
      // slot centre → its aisle → shortest path → station (or reversed)
      const sl = L.slots[slot], g = L.graph, path = g.path(g.keys[sl.key], g.keys[L.depots[s]]);
      const pts = [[sl.x, sl.y]].concat(path.map(function (n) { return [g.x[n], g.y[n]]; }));
      return toStation ? pts : pts.reverse();
    }

    function newOrder(t) {
      const skus = stream.next();
      return { id: orderId++, arr: t, start: -1, lines: skus.map(function (k) { return { sku: k, pod: fill.skuPod[k], picked: false, assigned: false }; }), left: skus.length };
    }
    function openOrder(s, o, t) {
      o.start = t; stations[s].orders.push(o);
      if (measuring(t)) { st.wait += t - o.arr; st.started++; }
      tot.wait += t - o.arr; tot.started++;
    }
    function assignOrders(t) {
      for (;;) {
        let best = -1;
        for (let s = 0; s < S; s++) if (stations[s].orders.length < A.order_slots && (best < 0 || stations[s].orders.length < stations[best].orders.length)) best = s;
        if (best < 0) return;
        if (opts.mode === "saturated") openOrder(best, newOrder(t), t);
        else if (backlog.length) openOrder(best, backlog.shift(), t);
        else return;
        requestPods(best, t);
      }
    }

    function requestPods(s, t) {
      const stn = stations[s];
      while (stn.pipe < A.pipeline) {
        const cnt = new Map();
        stn.orders.forEach(function (o) { o.lines.forEach(function (l) { if (!l.picked && !l.assigned && claim[l.pod] < 0) cnt.set(l.pod, (cnt.get(l.pod) || 0) + 1); }); });
        let bp = -1, bc = 0, bd = Infinity;
        cnt.forEach(function (c, p) { const d = L.toStation[podSlot[p]][s]; if (c > bc || (c === bc && d < bd)) { bp = p; bc = c; bd = d; } });
        if (bp < 0) return;
        claim[bp] = s; stn.pipe++;
        stn.orders.forEach(function (o) { o.lines.forEach(function (l) { if (l.pod === bp && !l.picked) l.assigned = true; }); });
        dispatch(s, bp, t);
      }
    }
    function dispatch(s, p, t) {
      const sl = L.slots[podSlot[p]];
      let br = -1, bd = Infinity;
      for (let r = 0; r < R; r++) if (!robots[r].busy) { const d = wha.manhattan(robots[r].x, robots[r].y, sl.x, sl.y); if (d < bd) { bd = d; br = r; } }
      if (br < 0) { pending.push({ s: s, p: p }); return; }
      const rb = robots[br];
      rb.busy = true; rb.pod = p; rb.st = s; rb.t0 = t;
      if (measuring(t)) st.empty += bd;
      tot.dist += bd;
      if (tr) leg(br, t, t + bd / v, "empty", [[rb.x, rb.y], [sl.x, rb.y], [sl.x, sl.y]]);
      rb.px = sl.x; rb.py = sl.y;
      H.push(t + bd / v + lift, { k: "lift", r: br });
    }

    function chooseSlot(p, s, t) {
      if (A.put_away === "fixed") return home[p];
      const free = [];
      for (let i = 0; i < NS; i++) if (slotOcc[i] < 0 && !reserved[i]) free.push(i);
      if (A.put_away === "random") return free[Math.floor(rnd() * free.length)];
      if (A.put_away === "nearest") {
        let b = free[0];
        for (let i = 1; i < free.length; i++) if (L.toStation[free[i]][s] < L.toStation[b][s]) b = free[i];
        return b;
      }
      // frequency: match the pod's popularity rank to a slot's distance rank
      // (scores decayed to now, so a pod that used to be busy loses its rank)
      const now = function (q) { return score[q] * Math.pow(0.5, (t - scoreT[q]) / halfLife); }, mine = now(p);
      let higher = 0;
      for (let q = 0; q < P; q++) { const sq = now(q); if (sq > mine || (sq === mine && q < p)) higher++; }
      const target = higher / P * NS;
      let b = free[0];
      for (let i = 1; i < free.length; i++) if (Math.abs(sr.rank[free[i]] - target) < Math.abs(sr.rank[b] - target)) b = free[i];
      return b;
    }

    function startPresent(s, t) {
      const stn = stations[s], ri = stn.queue.shift(), rb = robots[ri], p = rb.pod;
      if (measuring(t)) { st.queueWait += t - rb.tq; st.queued++; }
      let n = 0, done = 0;
      stn.orders.forEach(function (o) {
        o.lines.forEach(function (l) { if (!l.picked && l.pod === p) { l.picked = true; l.assigned = false; o.left--; n++; } });
        if (o.left === 0) done++;
      });
      const dur = A.pod_switch_time + n * sc.pick_time_per_line + done * sc.order_setup_time;
      stn.busy = true;
      if (measuring(t)) { st.lines += n; st.visits++; st.workerBusy[s] += dur; }
      tot.lines += n; tot.visits++;
      if (tracing(t)) tr.picks.push({ t: t + dur, s: s, n: n });
      // frequency score: exponentially smoothed visit count
      score[p] = score[p] * Math.pow(0.5, (t - scoreT[p]) / halfLife) + 1; scoreT[p] = t;
      H.push(t + dur, { k: "done", s: s, r: ri });
    }

    H.push(0, { k: "start" });
    if (opts.mode !== "saturated") H.push(-Math.log(1 - rnd()) / orderRate, { k: "arrive" });
    if (opts.shock) H.push(opts.shock.at_h * 3600, { k: "shock" });
    if (opts.history) H.push(0, { k: "snap" });
    if (tr) H.push(tr.from, { k: "traceStart" });

    let t = 0;
    while (H.size()) {
      const ev = H.pop(); t = ev.t; const e = ev.e;
      if (t > Tend) break;
      if (e.k === "start") assignOrders(t);
      else if (e.k === "arrive") {
        backlog.push(newOrder(t)); assignOrders(t);
        H.push(t - Math.log(1 - rnd()) / orderRate, { k: "arrive" });
      } else if (e.k === "lift") {
        const rb = robots[e.r], sl = podSlot[rb.pod];
        slotOcc[sl] = -1;                                    // the slot is free once the pod is lifted (fixed: still reserved)
        const d = L.toStation[sl][rb.st];
        if (measuring(t)) st.loaded += d;
        tot.dist += d;
        if (tr) leg(e.r, t, t + d / v, "toStation", loadedPts(sl, rb.st, true));
        rb.px = L.stations[rb.st][0]; rb.py = L.stations[rb.st][1];
        H.push(t + d / v, { k: "atStation", r: e.r });
      } else if (e.k === "atStation") {
        const rb = robots[e.r], stn = stations[rb.st];
        rb.tq = t; stn.queue.push(e.r);
        if (!stn.busy) startPresent(rb.st, t);
      } else if (e.k === "done") {
        const stn = stations[e.s], rb = robots[e.r], p = rb.pod;
        stn.busy = false; stn.pipe--;
        // completed orders leave; the slots refill
        stn.orders = stn.orders.filter(function (o) {
          if (o.left > 0) return true;
          if (measuring(t)) { st.orders++; st.cycle += t - o.arr; }
          return false;
        });
        const to = chooseSlot(p, e.s, t);
        if (A.put_away !== "fixed") reserved[to] = 1;
        rb.to = to;
        const d = L.toStation[to][e.s];
        if (measuring(t)) st.loaded += d;
        tot.dist += d;
        if (tr) leg(e.r, t, t + d / v, "toSlot", loadedPts(to, e.s, false));
        rb.px = L.slots[to].x; rb.py = L.slots[to].y;
        H.push(t + d / v + lift, { k: "drop", r: e.r });
        if (stn.queue.length) startPresent(e.s, t);
        assignOrders(t);
        requestPods(e.s, t);
      } else if (e.k === "drop") {
        const rb = robots[e.r], p = rb.pod, to = rb.to;
        if (A.put_away !== "fixed") reserved[to] = 0;
        slotOcc[to] = p; podSlot[p] = to; claim[p] = -1;
        rb.x = L.slots[to].x; rb.y = L.slots[to].y; rb.busy = false; rb.pod = -1;
        if (measuring(t)) st.robotBusy += t - Math.max(rb.t0, warm);
        if (pending.length) { const q = pending.shift(); dispatch(q.s, q.p, t); }
        for (let s = 0; s < S; s++) requestPods(s, t);
      } else if (e.k === "shock") {
        const nw = demand.shifted(stream.weights, opts.shock.shift);
        stream.reweight(nw);
      } else if (e.k === "traceStart") {
        // where every robot stands when the animation window opens (a robot on
        // its way somewhere is covered by its leg)
        tr.start = robots.map(function (rb) { return [rb.px, rb.py, rb.busy && rb.pod >= 0 && rb.st >= 0 ? 1 : 0]; });
      } else if (e.k === "snap") {
        let wd = 0; const pw = podWeights();
        for (let p = 0; p < P; p++) wd += pw[p] * sr.near[podSlot[p]];
        history.push({ t: t, podDist: wd, lines: tot.lines, dist: tot.dist, wait: tot.wait, started: tot.started, visits: tot.visits, backlog: backlog.length });
        if (t + opts.history <= Tend) H.push(t + opts.history, { k: "snap" });
      }
    }
    function podWeights() {
      const pw = new Float64Array(P), w = stream.weights;
      for (let k = 0; k < w.length; k++) pw[fill.skuPod[k]] += w[k];
      return pw;
    }

    const T = Tend - warm, pw = podWeights();
    let wd = 0; for (let p = 0; p < P; p++) wd += pw[p] * sr.near[podSlot[p]];
    const lines = Math.max(1, st.lines);
    return {
      T: T, lines: st.lines, visits: st.visits, pileOn: st.lines / Math.max(1, st.visits),
      linesPerHour: st.lines / T * 3600, workerUtil: Array.from(st.workerBusy, function (b) { return b / T; }),
      timePerLine: st.workerBusy.reduce(function (a, b) { return a + b; }, 0) / lines,
      robotTravelPerLine: (st.empty + st.loaded) / lines, emptyPerLine: st.empty / lines, loadedPerLine: st.loaded / lines,
      robotUtil: st.robotBusy / (R * T), robots: R,
      orders: st.orders, orderCycle: st.orders ? st.cycle / st.orders : Infinity,
      backlogWait: st.started ? st.wait / st.started : Infinity, backlogEnd: backlog.length,
      queueWait: st.queued ? st.queueWait / st.queued : 0,
      podDistance: wd,                                        // popularity-weighted loaded distance of pods to their nearest station, at the end
      podSlot: podSlot, skuPod: fill.skuPod, podW: pw, history: history, trace: tr,
      _state: { slotOcc: slotOcc, claim: claim, stations: stations, robots: robots, backlog: backlog }
    };
  }

  // ---------------------------------------------------------------- sizing
  // Stations: one picker each, as many as the peak needs (the same staffing
  // rule as WH-B and WH-C: peak lines/h × time per line ÷ efficiency).
  // Robots: the smallest fleet that keeps up — mean wait for a station
  // ≤ max_order_wait and the backlog not left growing.
  function keepsUp(r, A, S) { return r.backlogWait <= A.max_order_wait && r.backlogEnd <= S * A.order_slots; }

  function size(sc, A, target, opts) {
    opts = opts || {};
    const meanL = demand.meanLines(sc), peakLines = sc.lines_per_day / sc.operating_hours_per_day * sc.peak_hour_factor;
    const est = sc.pick_time_per_line + sc.order_setup_time / meanL + A.pod_switch_time / 1.5;
    let S = Math.max(1, Math.ceil(peakLines * est / 3600 / sc.picker_efficiency)), L, r, need;
    const seen = new Set();
    const ample = function () { L = wha.build(A, target, S); r = simulate(L, sc, A, Object.assign({}, opts, { robots: S * A.pipeline })); need = Math.max(1, Math.ceil(peakLines * r.timePerLine / 3600 / sc.picker_efficiency - 1e-9)); };
    // move S to the stations the simulated time per line asks for; stop when it
    // agrees, or when going down would revisit a count already tried
    for (let it = 0; it < 8; it++) {
      ample();
      if (need === S || (need < S && seen.has(need))) break;
      seen.add(S); S = need;
    }
    if (need > S) { S = need; ample(); }
    // robots: the smallest fleet that keeps up (bisection; the same seed in every
    // run, so runs differ only in the fleet)
    const maxR = S * A.pipeline;
    let best = keepsUp(r, A, S) ? r : null;
    if (best) {
      let lo = 1, hi = maxR;
      while (lo < hi) {
        const m = (lo + hi) >> 1, rm = simulate(L, sc, A, Object.assign({}, opts, { robots: m }));
        if (keepsUp(rm, A, S)) { hi = m; best = rm; } else lo = m + 1;
      }
    }
    return { layout: L, stations: S, run: best || r, keepsUp: !!best, robotsActive: best ? best.robots : maxR, robotsNeeded: Math.ceil((best ? best.robots : maxR) / A.robot_availability), peakLines: peakLines };
  }

  // ---------------------------------------------------------------- the KPI contract
  // WH-A in the same shape as kpi.evaluate() gives WH-B and WH-C. Pickers stand
  // at stations, so their travel is zero; robots carry the travel instead.
  function evaluate(sc, A, opts) {
    opts = opts || {};
    const target = sc.target_locations;
    const z = size(sc, A, target, opts), r = z.run, L = z.layout, fmt = function (v, d) { return tr.fx(v, d === undefined ? 1 : d); }, T = tr.T, int = tr.int;
    const warnings = L.warnings.slice();
    if (!z.keepsUp) warnings.push({ level: "critical", text: T("Even {n} robots (every station's pipeline full) don't keep up — raise the pipeline or the order slots.", { n: z.stations * A.pipeline }) });
    if (sc.skus > L.locations.n) warnings.push({ level: "critical", text: T("Only {n} storage locations for {s} SKUs.", { n: int(L.locations.n), s: int(sc.skus) }) });
    const k = {
      locations: L.locations.n, footprint: L.footprint, density: L.locations.n / L.footprint,
      travelPerOrder: 0, travelPerLine: 0, timePerLine: r.timePerLine, linesPerHour: 3600 / r.timePerLine,
      pickersNeeded: z.stations, travelShare: 0,
      robotsNeeded: z.robotsNeeded, robotTravelPerLine: r.robotTravelPerLine, pileOn: r.pileOn
    };
    // plan colours: each slot by its distance (cost) and by the popularity class of the pod in it (pop)
    const sr = slotRank(L), P = L.pods, NS = L.slots.length;
    const byPop = Array.from({ length: P }, function (_, i) { return i; }).sort(function (a, b) { return r.podW[b] - r.podW[a] || a - b; });
    const cls = new Float64Array(P); byPop.forEach(function (p, i) { const u = (i + 0.5) / P; cls[p] = u < 0.2 ? 0 : u < 0.5 ? 0.5 : 1; });
    // who is in each slot at the end: the simulation's own slot table (a pod still
    // travelling keeps the number of the slot it left, which may hold another pod by now)
    const occ = r._state.slotOcc;
    const mx = Math.max.apply(null, sr.near), mn = Math.min.apply(null, sr.near);
    const bayColors = {
      cost: L.slots.map(function (_, i) { return occ[i] < 0 ? NaN : (sr.near[i] - mn) / Math.max(1e-9, mx - mn); }),
      pop: L.slots.map(function (_, i) { return occ[i] < 0 ? NaN : cls[occ[i]]; })
    };
    const labels = { fixed: T("fixed home slot"), random: T("random free slot"), nearest: T("nearest free slot to the station"), frequency: T("slot rank matched to popularity rank") };
    const firsts = { ranked: T("most popular closest"), abc: T("ABC classes"), random: T("random") };
    const trace = L.trace.concat([
      { label: T("Simulated"), expr: T("{w} h to settle, then {m} h measured at the peak rate; same orders as WH-B and WH-C", { w: fmt(A.warmup_hours, 1), m: fmt(A.measure_hours, 1) }), value: T("{o} orders, {l} lines, {v} pod visits", { o: int(r.orders), l: int(r.lines), v: int(r.visits) }) },
      { label: T("Put-away"), expr: labels[A.put_away] + "; " + (A.pod_fill === "random" ? T("pods filled at random") : T("pods filled with SKUs of similar popularity")) + "; " + T("first placement: {p}", { p: firsts[sc.slotting] }), value: T("popularity-weighted pod distance at the end {d} m", { d: fmt(r.podDistance) }) },
      { label: T("Lines per pod visit"), expr: T("lines picked ÷ pod visits ({n} orders open per station)", { n: A.order_slots }), value: fmt(r.pileOn, 2) },
      { label: T("Picker time per line"), expr: T("(pod switch + lines × pick time + orders × setup) ÷ lines"), value: T("{t} s → {n} lines per picker-hour", { t: fmt(r.timePerLine), n: fmt(3600 / r.timePerLine, 0) }) },
      { label: T("Stations (one picker each)"), expr: T("ceil(peak lines/h × time per line ÷ efficiency), re-simulated until it agrees"), value: T("{l} lines/h → {s} stations, busy {u}% at most", { l: fmt(z.peakLines, 0), s: z.stations, u: Math.round(100 * Math.max.apply(null, r.workerUtil)) }) },
      { label: T("Robots"), expr: T("smallest fleet with mean wait for a station ≤ {w} s, ÷ availability {a}", { w: A.max_order_wait, a: fmt(A.robot_availability, 2) }), value: T("{a} working → {n} robots; {t} m per line ({e} empty + {l} loaded)", { a: z.robotsActive, n: z.robotsNeeded, t: fmt(r.robotTravelPerLine), e: fmt(r.emptyPerLine), l: fmt(r.loadedPerLine) }) },
      { label: T("Order cycle"), expr: T("arrival → last line picked"), value: T("{m} min on average; robots wait {q} s in station queues", { m: fmt(r.orderCycle / 60, 1), q: fmt(r.queueWait, 0) }) }
    ]);
    return { layout: L, kpi: k, run: r, sizing: z, bayColors: bayColors, warnings: warnings, trace: trace, skuPod: r.skuPod, podSlot: r.podSlot };
  }

  return { Heap, fillPods, slotRank, placePods, simulate, size, keepsUp, evaluate };
});
