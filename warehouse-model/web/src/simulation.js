/*
 * simulation.js — a discrete-event simulation of one operating day.
 *
 * The analytic model (calculations.js) gives averages and a steady-state
 * queueing formula. This simulates what actually happens hour by hour:
 *
 *   - Inbound and outbound trucks arrive at random (a Poisson process whose
 *     rate follows an hourly profile with the given peak-hour factor), queue in
 *     the yard for a free door, and occupy it for a random turn time (gamma,
 *     coefficient of variation 0.5 — the same variability the analytic queue
 *     correction assumes).
 *   - An inbound truck's pallets come off one by one during unloading, each
 *     becoming a putaway task in staging.
 *     A docked outbound truck needs its pallets fetched: it can't leave before
 *     its turn time is up AND the lift trucks have brought all of them.
 *   - The lift-truck fleet takes tasks first-come first-served (retrievals
 *     first, since a truck is waiting on them), pairing a putaway with a
 *     retrieval on a dual-command trip for the given share of moves. Every task
 *     draws its storage cell from the storage policy's move weights and takes
 *     that cell's own cycle time from calculations.js (divided by the truck
 *     efficiency) — so the simulation and the analytic model share one set of
 *     travel formulas.
 *
 * Pure functions, no DOM: window.WH.sim in the browser, module.exports in Node
 * (tests/simulation.test.js).
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory(require("./calculations.js"));
  else { root.WH = root.WH || {}; root.WH.sim = factory(root.WH.calc); }
})(typeof self !== "undefined" ? self : this, function (calc) {
  "use strict";

  const TURN_CV2 = calc.TURN_CS2;          // squared CV of turn times (0.25 → CV 0.5)
  const REPLICATIONS = 30;

  // ---------------------------------------------------------------------
  // Hourly arrival profile: mean exactly 1, highest hour exactly the peak
  // factor, no hour below 5% — a single bell over the operating day
  // (von Mises shape, sharpened only as much as a high peak factor needs).
  // ---------------------------------------------------------------------
  function hourlyProfile(hours, peak) {
    const H = Math.max(1, Math.round(hours));
    if (peak <= 1 + 1e-9 || H === 1) return new Array(H).fill(1);
    const shape = function (kappa) {
      const g = [];
      for (let h = 0; h < H; h++) g.push(Math.exp(kappa * Math.cos(2 * Math.PI * ((h + 0.5) / H - 0.45))));
      const m = g.reduce(function (a, b) { return a + b; }, 0) / H, mx = Math.max.apply(null, g);
      return g.map(function (v) { return 1 + (peak - 1) * (v - m) / (mx - m); });
    };
    let lo = 0.01, hi = 60, f = shape(lo);
    if (Math.min.apply(null, f) >= 0.05) return f;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2, g = shape(mid);
      if (Math.min.apply(null, g) >= 0.05) { hi = mid; f = g; } else lo = mid;
    }
    return shape(hi);
  }

  // ---------------------------------------------------------------------
  // Small building blocks
  // ---------------------------------------------------------------------
  function Heap() { this.a = []; this.seq = 0; }
  Heap.prototype.push = function (t, type, data) {
    const a = this.a, e = { t: t, s: this.seq++, type: type, data: data };
    a.push(e);
    let i = a.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (less(a[j], a[i])) break; const x = a[i]; a[i] = a[j]; a[j] = x; i = j; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        const x = a[i]; a[i] = a[m]; a[m] = x; i = m;
      }
    }
    return top;
  };
  function less(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }
  // gamma with integer shape k = 1/CV² (4 for CV 0.5): a sum of k exponentials
  function gammaSample(rng, mean) {
    const k = Math.max(1, Math.round(1 / TURN_CV2));
    let prod = 1;
    for (let i = 0; i < k; i++) prod *= 1 - rng();
    return -Math.log(prod) * mean / k;
  }
  function percentile(sorted, q) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[i];
  }

  // ---------------------------------------------------------------------
  // One simulated day
  // ---------------------------------------------------------------------
  // opts: { seed, liftTrucks (0/undefined = the analytic fleet size), log (record events for playback) }
  function simulateDay(p, results, opts) {
    opts = opts || {};
    const rng = calc.mulberry32(opts.seed || 1);
    const L = results.layout, grid = results.slots.grid, W = results.slots.weights.w;
    const H = Math.max(1, Math.round(p.operating_hours_per_day)), close = H * 3600;
    const prof = hourlyProfile(H, p.peak_hour_factor);
    const lifts = Math.max(1, Math.round(opts.liftTrucks || results.travel.forkliftsNeeded || 1));
    const eff = p.truck_efficiency, share = Math.max(0, Math.min(1, (p.dual_command_share || 0) / 100));
    const turn = p.truck_turn_time * 60, ppt = Math.max(1, Math.round(p.pallets_per_truck));
    const canStore = grid.n > 0;
    const pick = canStore ? calc.sampler(W) : null, ctx = canStore ? calc.dcContext(p, L, grid) : null;
    const log = opts.log ? { trucks: [], tasks: [], lifts: lifts, close: close } : null;

    const ev = new Heap();
    // truck arrivals: a Poisson process with a piecewise-constant hourly rate
    const trucksPerDay = p.daily_throughput_pallets / 2 / ppt;
    ["in", "out"].forEach(function (side) {
      for (let h = 0; h < H; h++) {
        const rate = trucksPerDay / H * prof[h] / 3600;     // per second
        if (rate <= 0) continue;
        let t = h * 3600;
        for (;;) { t += -Math.log(1 - rng()) / rate; if (t >= (h + 1) * 3600) break; ev.push(t, "arrive", side); }
      }
    });

    const S = {
      in: { doors: p.num_receiving_docks, free: [], yard: [], waits: [], busy: 0 },
      out: { doors: p.num_shipping_docks, free: [], yard: [], waits: [], busy: 0 }
    };
    ["in", "out"].forEach(function (k) { for (let d = S[k].doors - 1; d >= 0; d--) S[k].free.push(d); });
    const putaways = [], retrievals = [];
    const idle = []; for (let i = lifts - 1; i >= 0; i--) idle.push(i);
    let liftBusy = 0, moves = 0, dcMoves = 0, lastDone = 0, trucks = 0, maxYard = 0, maxStaging = 0, truckSeq = 0;

    // time-weighted hourly statistics
    const hourly = [];
    const bin = function (h) { while (hourly.length <= h) hourly.push({ arrIn: 0, arrOut: 0, yardIn: 0, yardOut: 0, doorsIn: 0, doorsOut: 0, lifts: 0, staging: 0 }); return hourly[h]; };
    let lastT = 0;
    const advance = function (t) {
      while (lastT < t) {
        const h = Math.floor(lastT / 3600), end = Math.min(t, (h + 1) * 3600), dt = (end - lastT) / 3600, b = bin(h);
        b.yardIn += S.in.yard.length * dt; b.yardOut += S.out.yard.length * dt;
        b.doorsIn += (S.in.doors - S.in.free.length) * dt; b.doorsOut += (S.out.doors - S.out.free.length) * dt;
        b.lifts += (lifts - idle.length) * dt; b.staging += putaways.length * dt;
        if (lastT < close) {
          const dtc = (Math.min(end, close) - lastT);
          S.in.busy += (S.in.doors - S.in.free.length) * dtc; S.out.busy += (S.out.doors - S.out.free.length) * dtc;
          liftBusy += (lifts - idle.length) * dtc;
        }
        lastT = end;
      }
    };

    function dock(side, truck, t) {
      const s = S[side], door = s.free.pop();
      truck.door = door; truck.docked = t;
      s.waits.push((t - truck.arrived) / 60);
      if (log) truck.rec.docked = t, truck.rec.door = door;
      const service = gammaSample(rng, turn);
      if (side === "in") {
        // pallets come off one by one through the unloading, each becoming a putaway task
        for (let i = 1; i <= ppt; i++) ev.push(t + service * i / (ppt + 1), "staged", truck);
        ev.push(t + service, "unloaded", truck);
      }
      else {
        truck.pending = ppt; truck.minRelease = t + service;
        for (let i = 0; i < ppt; i++) retrievals.push(truck);
        ev.push(truck.minRelease, "turnDone", truck);
      }
    }
    function release(side, truck, t) {
      const s = S[side];
      s.free.push(truck.door);
      if (log) truck.rec.left = t;
      if (s.yard.length) dock(side, s.yard.shift(), t);
    }
    function dispatch(t) {
      while (idle.length && (putaways.length || retrievals.length)) {
        const lift = idle.pop();
        let dur, task;
        if (!canStore) {                                    // nowhere to store: move straight through staging
          dur = p.forklift_cycle_overhead / eff;
          task = retrievals.length ? { kind: "R", truck: retrievals.shift() } : { kind: "P", n: putaways.shift() };
        } else if (share > 0 && putaways.length && retrievals.length && rng() < share) {
          const a = pick(rng()), b = pick(rng());
          putaways.shift();
          task = { kind: "D", truck: retrievals.shift(), a: a, b: b };
          dur = calc.dcPair(p, L, grid, ctx, a, b).time / eff;
        } else if (retrievals.length) {
          const b = pick(rng());
          task = { kind: "R", truck: retrievals.shift(), b: b };
          dur = grid.tOut[b] / eff;
        } else {
          const a = pick(rng());
          putaways.shift();
          task = { kind: "P", a: a };
          dur = grid.tIn[a] / eff;
        }
        task.lift = lift;
        if (log) log.tasks.push({ lift: lift, kind: task.kind, t0: t, t1: t + dur, a: task.a, b: task.b, door: task.truck ? task.truck.door : null });
        ev.push(t + dur, "taskDone", task);
      }
    }

    const CAP = close * 3;                                  // stop runaway days (e.g. no doors) — reported as backlog
    let backlogAtClose = null;
    while (ev.a.length) {
      const e = ev.pop();
      if (e.t > CAP) break;
      if (backlogAtClose === null && e.t >= close) {
        advance(close);
        backlogAtClose = { putaways: putaways.length, retrievals: retrievals.length, yard: S.in.yard.length + S.out.yard.length };
      }
      advance(e.t);
      const t = e.t;
      if (e.type === "arrive") {
        const side = e.data, truck = { side: side, arrived: t, id: truckSeq++ };
        trucks++;
        bin(Math.floor(t / 3600))[side === "in" ? "arrIn" : "arrOut"]++;
        if (log) { truck.rec = { id: truck.id, side: side, arrived: t }; log.trucks.push(truck.rec); }
        if (S[side].free.length) dock(side, truck, t);
        else if (S[side].doors > 0) { S[side].yard.push(truck); maxYard = Math.max(maxYard, S.in.yard.length + S.out.yard.length); }
      } else if (e.type === "staged") {
        putaways.push(t);
        maxStaging = Math.max(maxStaging, putaways.length);
      } else if (e.type === "unloaded") {
        release("in", e.data, t);
      } else if (e.type === "turnDone") {
        const tr = e.data;
        if (tr.pending === 0 && !tr.gone) { tr.gone = true; release("out", tr, t); }
      } else if (e.type === "taskDone") {
        const task = e.data;
        idle.push(task.lift);
        moves += task.kind === "D" ? 2 : 1;
        if (task.kind === "D") dcMoves += 2;
        lastDone = t;
        if (task.truck) {
          const tr = task.truck;
          tr.pending--;
          if (tr.pending === 0 && t >= tr.minRelease && !tr.gone) { tr.gone = true; release("out", tr, t); }
        }
      }
      dispatch(t);
    }
    if (backlogAtClose === null) backlogAtClose = { putaways: 0, retrievals: 0, yard: 0 };
    const unfinished = putaways.length + retrievals.length + S.in.yard.length + S.out.yard.length;

    const waits = S.in.waits.concat(S.out.waits).sort(function (a, b) { return a - b; });
    let worstHourWait = 0;          // mean yard queue ÷ arrivals in the busiest hour ≈ that hour's mean wait (Little)
    hourly.forEach(function (b, h) {
      const arr = b.arrIn + b.arrOut;
      if (h < H && arr > 0) worstHourWait = Math.max(worstHourWait, (b.yardIn + b.yardOut) * 60 / arr);
    });
    // wait in the profile's peak hour (Little's law: mean queue ÷ arrival rate) — the hour the analytic formula describes
    let hp = 0; prof.forEach(function (v, h) { if (v > prof[hp]) hp = h; });
    const pk = hourly[hp], pkArr = pk ? pk.arrIn + pk.arrOut : 0;
    const peakHourWait = pkArr > 0 ? (pk.yardIn + pk.yardOut) * 60 / pkArr : 0;
    return {
      seed: opts.seed || 1, lifts: lifts, trucks: trucks, moves: moves, peakHour: hp, peakHourWait: peakHourWait,
      // a putaway and a retrieval can only be paired when both are waiting at the same moment
      dualShareAchieved: moves ? dcMoves / moves : 0,
      meanWait: waits.length ? waits.reduce(function (a, b) { return a + b; }, 0) / waits.length : 0,
      meanWaitIn: S.in.waits.length ? S.in.waits.reduce(function (a, b) { return a + b; }, 0) / S.in.waits.length : 0,
      p90Wait: percentile(waits, 0.9), maxWait: waits.length ? waits[waits.length - 1] : 0, worstHourWait: worstHourWait,
      shareWaitingOver30: waits.length ? waits.filter(function (w) { return w > 30; }).length / waits.length : 0,
      maxYard: maxYard, maxStaging: maxStaging,
      doorUtilIn: S.in.doors ? S.in.busy / (S.in.doors * close) : 0,
      doorUtilOut: S.out.doors ? S.out.busy / (S.out.doors * close) : 0,
      liftUtil: liftBusy / (lifts * close),
      backlogAtClose: backlogAtClose.putaways + backlogAtClose.retrievals, yardAtClose: backlogAtClose.yard,
      overtime: Math.max(0, lastDone - close) / 60, unfinished: unfinished,
      hourly: hourly.map(function (b) { return { arrIn: b.arrIn, arrOut: b.arrOut, yard: b.yardIn + b.yardOut, doorsIn: b.doorsIn, doorsOut: b.doorsOut, lifts: b.lifts, staging: b.staging }; }),
      profile: prof, log: log
    };
  }

  // ---------------------------------------------------------------------
  // Many days: mean and the 10th–90th percentile range of each result
  // ---------------------------------------------------------------------
  const METRICS = ["dualShareAchieved", "peakHourWait", "meanWait", "p90Wait", "worstHourWait", "maxWait", "shareWaitingOver30", "maxYard", "maxStaging", "doorUtilIn", "doorUtilOut", "liftUtil", "backlogAtClose", "overtime", "trucks", "moves", "unfinished"];
  function runMonteCarlo(p, results, opts) {
    opts = opts || {};
    const reps = opts.replications || REPLICATIONS, days = [];
    for (let r = 0; r < reps; r++) days.push(simulateDay(p, results, { seed: 1000 + r, liftTrucks: opts.liftTrucks }));
    const summary = {};
    METRICS.forEach(function (m) {
      const v = days.map(function (d) { return d[m]; }).sort(function (a, b) { return a - b; });
      summary[m] = { mean: v.reduce(function (a, b) { return a + b; }, 0) / v.length, p10: percentile(v, 0.1), p90: percentile(v, 0.9) };
    });
    const nh = Math.max.apply(null, days.map(function (d) { return d.hourly.length; }));
    const hourly = [];
    for (let h = 0; h < nh; h++) {
      const o = { arrIn: 0, arrOut: 0, yard: 0, doorsIn: 0, doorsOut: 0, lifts: 0, staging: 0 };
      days.forEach(function (d) { const b = d.hourly[h]; if (b) for (const k in o) o[k] += b[k]; });
      for (const k in o) o[k] /= days.length;
      hourly.push(o);
    }
    return { replications: reps, lifts: days[0].lifts, summary: summary, hourly: hourly, profile: days[0].profile };
  }

  return { hourlyProfile, simulateDay, runMonteCarlo, REPLICATIONS };
});
