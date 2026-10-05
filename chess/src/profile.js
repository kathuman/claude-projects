/*
 * profile.js — the learner profile shared by the play app, the puzzles and the "My training" page.
 * Browser + Node. Stored in localStorage under "chess-profile-v1" (the puzzle rating stays with the puzzles,
 * "chess-puzzles-v1"; course progress with the course, "chess-course-progress").
 *
 *   results  puzzle attempts            { t, id, themes, ok, src: "rated" | "theme" | "daily" | "review" }
 *   games    reviewed games vs Stockfish { t, side, result, accuracy, startFen, moves, mistakes[], coach }
 *   srs      spaced repetition: puzzles you missed and your own game mistakes, by id { p, box, due, own }
 *   coach    the coach's level and how often it had to step in
 *   plan     this week's plan            { week, items[], made }
 *
 * Spaced repetition is a Leitner system: a card you solve moves up a box and comes back after 1, 3, 7, 16
 * and 35 days; one you miss goes back to box 0 (tomorrow); solved from the last box, it's learned.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.ChessProfile = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var KEY = "chess-profile-v1", DAY = 86400000, INTERVALS = [1, 3, 7, 16, 35];

  function fresh() { return { v: 1, results: [], games: [], srs: {}, coach: { level: "full", history: [] }, plan: null }; }
  function load(storage) {
    try { var p = JSON.parse(storage.getItem(KEY)); if (p && p.v === 1) return Object.assign(fresh(), p); } catch (e) {}
    return fresh();
  }
  function save(storage, prof) { try { storage.setItem(KEY, JSON.stringify(prof)); } catch (e) {} }

  // ---- logging
  function logPuzzle(prof, puzzle, ok, src, now) {
    prof.results.push({ t: now, id: puzzle[0], themes: puzzle[4].split(" ").filter(Boolean), ok: !!ok, src: src });
    if (prof.results.length > 3000) prof.results.splice(0, prof.results.length - 3000);
  }
  function logGame(prof, game) {
    prof.games.push(game);
    if (prof.games.length > 120) prof.games.splice(0, prof.games.length - 120);
  }

  // ---- spaced repetition
  function srsAdd(prof, puzzle, now, own) {
    prof.srs[puzzle[0]] = { p: puzzle, box: 0, due: now + DAY, own: !!own, added: now };
  }
  // returns "up" (next box), "learned" (removed) or "again" (back to box 0)
  function srsResult(prof, id, ok, now) {
    var c = prof.srs[id];
    if (!c) return null;
    if (!ok) { c.box = 0; c.due = now + DAY; return "again"; }
    if (c.box >= INTERVALS.length - 1) { delete prof.srs[id]; return "learned"; }
    c.box++;
    c.due = now + INTERVALS[c.box] * DAY;
    return "up";
  }
  function srsDue(prof, now) {
    return Object.keys(prof.srs).map(function (k) { return prof.srs[k]; })
      .filter(function (c) { return c.due <= now; }).sort(function (a, b) { return a.due - b.due; });
  }
  function srsUpcoming(prof, now, days) {
    var out = [];
    for (var d = 0; d < days; d++) out.push(0);
    Object.keys(prof.srs).forEach(function (k) {
      var i = Math.floor(prof.srs[k].due / DAY) - Math.floor(now / DAY); // calendar days (UTC), not 24-hour blocks
      if (i < 0) i = 0;
      if (i < days) out[i]++;
    });
    return out;
  }

  // ---- mistakes from a reviewed game, as themes
  // rv: { positions, evals, best, kinds } (kinds: the review's grade per move); side: the learner's colour.
  // "allowed": the tactic in the opponent's best reply; "missed": the tactic in the learner's best move.
  function gameMistakes(R, M, rv, uciMoves, side) {
    var out = [];
    rv.kinds.forEach(function (kind, i) {
      var pos = rv.positions[i];
      if (pos.turn !== side || (kind !== "mistake" && kind !== "blunder")) return;
      var allowed = [], missed = [];
      var after = rv.positions[i + 1], reply = rv.best[i + 1], ev1 = rv.evals[i + 1], ev0 = rv.evals[i];
      var sign = side === "w" ? 1 : -1;
      if (after && reply && reply !== "(none)") {
        var rm = R.fromUCI(after, reply);
        if (rm) allowed = M.detect(R, after, rm);
      }
      if (ev1 && ev1.mate != null && ev1.mate * sign < 0 && allowed.indexOf("mateIn1") < 0) allowed.push(M.mateTheme(ev1.mate));
      if (rv.best[i] && rv.best[i] !== uciMoves[i]) {
        var bm = R.fromUCI(pos, rv.best[i]);
        if (bm) missed = M.detect(R, pos, bm);
      }
      if (ev0 && ev0.mate != null && ev0.mate * sign > 0 && missed.indexOf("mateIn1") < 0) missed.push(M.mateTheme(ev0.mate));
      out.push({ ply: i, kind: kind, allowed: allowed, missed: missed });
    });
    return out;
  }
  // a game mistake as a puzzle (Lichess format): the opponent's previous move, then the move you should
  // have played. Not possible for a mistake on the game's first move.
  function mistakePuzzle(R, rv, uciMoves, m, rating) {
    if (m.ply < 1 || !rv.best[m.ply]) return null;
    var fen = R.toFEN(rv.positions[m.ply - 1]), moves = uciMoves[m.ply - 1] + " " + rv.best[m.ply];
    var h = 0, s = fen + moves;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var themes = m.missed.length ? m.missed : ["yourGame"];
    return ["g" + h.toString(36), fen, moves, Math.round(rating || 1500), themes.concat(["yourGame"]).filter(function (t, j, a) { return a.indexOf(t) === j; }).join(" ")];
  }

  // ---- strengths and weaknesses
  // Ideas only (not length, phase or source tags). Puzzle success uses a prior of 75%, so one miss doesn't
  // make a weakness; game mistakes from the last 30 days add to it.
  var IDEAS = /^(fork|pin|skewer|discoveredAttack|discoveredCheck|doubleCheck|deflection|attraction|capturingDefender|hangingPiece|trappedPiece|sacrifice|xRayAttack|intermezzo|clearance|interference|quietMove|defensiveMove|zugzwang|exposedKing|kingsideAttack|queensideAttack|advancedPawn|promotion|underPromotion|enPassant|attackingF2F7|mateIn[1-5]|backRankMate|smotheredMate|[a-z]+Mate|rookEndgame|pawnEndgame|queenEndgame|bishopEndgame|knightEndgame)$/;
  function themeStats(prof, puzzleStore, now) {
    var st = {};
    function get(t) { return st[t] || (st[t] = { theme: t, ok: 0, n: 0, allowed: 0, missed: 0 }); }
    var pt = (puzzleStore && puzzleStore.themes) || {};
    Object.keys(pt).forEach(function (t) { if (IDEAS.test(t)) { var e = get(t); e.ok = pt[t][0]; e.n = pt[t][1]; } });
    prof.games.forEach(function (g) {
      if (now - g.t > 30 * DAY) return;
      (g.mistakes || []).forEach(function (m) {
        m.allowed.forEach(function (t) { if (IDEAS.test(t)) get(t).allowed++; });
        m.missed.forEach(function (t) { if (IDEAS.test(t)) get(t).missed++; });
      });
    });
    return Object.keys(st).map(function (t) {
      var e = st[t], rate = (e.ok + 1.5) / (e.n + 2);
      e.rate = e.n ? e.ok / e.n : null;
      e.score = Math.max(0, 0.8 - rate) * Math.min(1, e.n / 4) + 0.15 * Math.min(4, e.allowed + e.missed);
      e.strong = e.n >= 5 && rate >= 0.8 && !e.allowed && !e.missed;
      return e;
    }).sort(function (a, b) { return b.score - a.score; });
  }

  // ---- the weekly plan
  var LESSON_FOR = { fork: "forks", pin: "pins", skewer: "skewers", discoveredAttack: "discovered", discoveredCheck: "discovered",
    backRankMate: "backrank", mateIn1: "mates", mateIn2: "mates", smotheredMate: "mates", hangingPiece: "values", capturingDefender: "defender",
    promotion: "promotion", pawnEndgame: "kingpawn", rookEndgame: "lucena", enPassant: "enpassant" };
  function weekKey(t) {
    var d = new Date(t), day = (d.getUTCDay() + 6) % 7;            // Monday = 0
    d.setUTCDate(d.getUTCDate() - day + 3);                        // the week's Thursday decides its year
    var y = d.getUTCFullYear(), jan4 = new Date(Date.UTC(y, 0, 4));
    var w = 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
    return y + "-W" + (w < 10 ? "0" : "") + w;
  }
  function weekStart(t) { var d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY; }
  // lessons: the course's lesson ids in order; done: { lessonId: true }
  function makePlan(prof, puzzleStore, lessons, done, now) {
    var stats = themeStats(prof, puzzleStore, now).filter(function (e) { return e.score >= 0.12; }).slice(0, 3), items = [];
    stats.forEach(function (e) {
      var why = [];
      if (e.allowed) why.push("you allowed " + e.allowed + " in your games");
      if (e.missed) why.push("you missed " + e.missed + " in your games");
      if (e.n) why.push("you solve " + Math.round(100 * e.ok / e.n) + "% of these puzzles");
      items.push({ kind: "puzzles", theme: e.theme, target: 10, why: why.join("; ") });
    });
    var lesson = null;
    stats.some(function (e) { var l = LESSON_FOR[e.theme]; if (l && !done[l]) { lesson = l; return true; } return false; });
    if (!lesson) lesson = (lessons || []).filter(function (l) { return !done[l]; })[0] || null;
    if (lesson) items.push({ kind: "lesson", lesson: lesson, target: 1, why: stats.length && LESSON_FOR[stats[0].theme] === lesson ? "the lesson behind your weakest theme" : "the next lesson in the course" });
    var cards = Object.keys(prof.srs).length;
    if (cards) items.push({ kind: "review", target: Math.min(15, cards), why: "puzzles and game mistakes due again" });
    if (!stats.length) {
      items.unshift({ kind: "rated", target: 15, why: "to find your level and your weak themes" });
      items.push({ kind: "daily", target: 5, why: "a puzzle a day" });
    }
    items.push({ kind: "games", target: 3, why: "play Stockfish with the coach on, then read the review" });
    return { week: weekKey(now), made: now, items: items };
  }
  function planProgress(prof, plan, done, now) {
    var from = weekStart(now);
    var week = prof.results.filter(function (r) { return r.t >= from; });
    return plan.items.map(function (it) {
      var n = 0;
      if (it.kind === "puzzles") n = week.filter(function (r) { return r.ok && r.themes.indexOf(it.theme) >= 0 && r.src !== "review"; }).length;
      else if (it.kind === "rated") n = week.filter(function (r) { return r.src === "rated"; }).length;
      else if (it.kind === "daily") n = week.filter(function (r) { return r.src === "daily"; }).length;
      else if (it.kind === "review") n = week.filter(function (r) { return r.src === "review"; }).length;
      else if (it.kind === "games") n = prof.games.filter(function (g) { return g.t >= from; }).length;
      else if (it.kind === "lesson") n = done[it.lesson] ? 1 : 0;
      return Math.min(it.target, n);
    });
  }

  // ---- coach: steps back after three calm games, steps in again after a rough one
  var LEVELS = ["full", "light", "off"];
  function coachAfterGame(prof, warnings) {
    var c = prof.coach;
    c.history.push(warnings);
    if (c.history.length > 30) c.history.shift();
    var last = c.history.slice(-3);
    if (c.level === "full" && last.length === 3 && last.every(function (w) { return w <= 1; })) { c.level = "light"; c.history = []; return "light"; }
    if (c.level === "light" && warnings >= 4) { c.level = "full"; c.history = []; return "full"; }
    return null;
  }

  return { KEY: KEY, fresh: fresh, load: load, save: save, logPuzzle: logPuzzle, logGame: logGame,
    srsAdd: srsAdd, srsResult: srsResult, srsDue: srsDue, srsUpcoming: srsUpcoming, INTERVALS: INTERVALS,
    gameMistakes: gameMistakes, mistakePuzzle: mistakePuzzle, themeStats: themeStats,
    weekKey: weekKey, weekStart: weekStart, makePlan: makePlan, planProgress: planProgress, LESSON_FOR: LESSON_FOR,
    coachAfterGame: coachAfterGame, LEVELS: LEVELS, DAY: DAY };
});
