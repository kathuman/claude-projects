/*
 * app.js — "My training": the learner profile (../src/profile.js) as a page. Reads the profile, the puzzle
 * statistics (chess-puzzles-v1) and course progress (chess-course-progress) from this browser; makes the
 * weekly plan and shows spaced repetition, strengths and weaknesses, recent games and the coach.
 */
(function () {
  "use strict";
  // 1.0.0 launch: weekly plan, spaced repetition, themes from puzzles and reviewed games, recent games, coach
  // 1.1.0 Cobot Lab blueprint theme (../theme.css)
  var VERSION = "1.1.0";
  var F = window.ChessProfile, EN = (window.CHESS_I18N || {}).en || {};
  function $(id) { return document.getElementById(id); }
  $("ver").textContent = "v" + VERSION; $("verFoot").textContent = "v" + VERSION;
  try { var th = localStorage.getItem("chess-theme"); document.documentElement.setAttribute("data-theme", th === "light" ? "light" : "dark"); } catch (e) { document.documentElement.setAttribute("data-theme", "dark"); }
  $("themeToggle").addEventListener("click", function () {
    var root = document.documentElement, pd = matchMedia("(prefers-color-scheme: dark)").matches;
    var next = (root.getAttribute("data-theme") || (pd ? "dark" : "light")) === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("chess-theme", next); } catch (e) {}
  });
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function readJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v || d; } catch (e) { return d; } }

  var NAMES = {
    fork: "Forks", pin: "Pins", skewer: "Skewers", discoveredAttack: "Discovered attacks", discoveredCheck: "Discovered checks",
    doubleCheck: "Double checks", deflection: "Deflection", attraction: "Attraction", capturingDefender: "Capturing the defender",
    hangingPiece: "Loose pieces", trappedPiece: "Trapped pieces", sacrifice: "Sacrifices", xRayAttack: "X-ray attacks", intermezzo: "In-between moves",
    clearance: "Clearance", interference: "Interference", quietMove: "Quiet moves", defensiveMove: "Defensive moves", zugzwang: "Zugzwang",
    exposedKing: "Exposed king", kingsideAttack: "Kingside attacks", queensideAttack: "Queenside attacks", advancedPawn: "Advanced pawns",
    promotion: "Promotion", underPromotion: "Underpromotion", enPassant: "En passant", attackingF2F7: "Attacking f2/f7",
    mateIn1: "Mate in 1", mateIn2: "Mate in 2", mateIn3: "Mate in 3", mateIn4: "Mate in 4", mateIn5: "Long mates", backRankMate: "Back-rank mates",
    smotheredMate: "Smothered mates", rookEndgame: "Rook endgames", pawnEndgame: "Pawn endgames", queenEndgame: "Queen endgames",
    bishopEndgame: "Bishop endgames", knightEndgame: "Knight endgames"
  };
  function themeName(t) { return NAMES[t] || t.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function lessonName(id) { return EN["lesson." + id] || id; }

  var now = Date.now();
  var prof = F.load(localStorage);
  var puzzles = readJSON("chess-puzzles-v1", { themes: {}, rating: null });
  var done = readJSON("chess-course-progress", {});
  var lessons = [];
  ((window.CHESS_COURSE || {}).levels || []).forEach(function (lv) { lv.lessons.forEach(function (l) { lessons.push(l.id); }); });

  // ---- the plan: one per ISO week, made on the first visit of the week
  if (!prof.plan || prof.plan.week !== F.weekKey(now)) { prof.plan = F.makePlan(prof, puzzles, lessons, done, now); F.save(localStorage, prof); }
  function renderPlan() {
    var plan = prof.plan, prog = F.planProgress(prof, plan, done, now), total = 0, have = 0;
    $("plan").innerHTML = plan.items.map(function (it, i) {
      var n = prog[i], full = n >= it.target, what, href;
      total += it.target; have += n;
      if (it.kind === "puzzles") { what = it.target + " puzzles on " + themeName(it.theme).toLowerCase(); href = "../puzzles/?theme=" + encodeURIComponent(it.theme); }
      else if (it.kind === "rated") { what = it.target + " rated puzzles"; href = "../puzzles/"; }
      else if (it.kind === "daily") { what = "The daily puzzle, " + it.target + " days"; href = "../puzzles/?mode=daily"; }
      else if (it.kind === "review") { what = "Review " + it.target + (it.target === 1 ? " puzzle" : " puzzles"); href = "../puzzles/?mode=review"; }
      else if (it.kind === "lesson") { what = "Lesson: " + lessonName(it.lesson); href = "../course/?lesson=" + encodeURIComponent(it.lesson); }
      else { what = it.target + " games against Stockfish"; href = "../?opponent=engine"; }
      return '<li class="' + (full ? "done" : "") + '"><span class="tick">' + (full ? "✓" : "") + "</span>" +
        '<div><div class="what">' + esc(what) + '</div><div class="why">' + esc(it.why || "") + "</div></div>" +
        '<div class="prog"><span class="bar"><i style="width:' + Math.round(100 * n / it.target) + '%"></i></span>' + n + "/" + it.target +
        ' <a class="btn mini" href="' + href + '">' + (full ? "More" : "Go") + "</a></div></li>";
    }).join("");
    var mon = new Date(F.weekStart(now));
    $("planSub").textContent = "Week of " + mon.toLocaleDateString("en", { day: "numeric", month: "long", timeZone: "UTC" }) + " · " +
      Math.round(100 * have / Math.max(1, total)) + "% done" + (prof.games.length || Object.keys(puzzles.themes || {}).length ? "" : " · a starter plan until there are results to go on");
  }
  $("newPlan").addEventListener("click", function () {
    puzzles = readJSON("chess-puzzles-v1", { themes: {} }); done = readJSON("chess-course-progress", {});
    prof.plan = F.makePlan(prof, puzzles, lessons, done, Date.now()); F.save(localStorage, prof); renderPlan();
  });

  // ---- spaced repetition
  function renderSRS() {
    var due = F.srsDue(prof, now).length, up = F.srsUpcoming(prof, now, 7), total = Object.keys(prof.srs).length, max = Math.max(1, Math.max.apply(null, up));
    var own = Object.keys(prof.srs).filter(function (k) { return prof.srs[k].own; }).length;
    $("dueNum").textContent = due;
    $("dueText").textContent = due === 1 ? "puzzle due today" : "puzzles due today";
    $("reviewLink").hidden = !due;
    $("srsTotal").textContent = total ? total + " in rotation" + (own ? ", " + own + " from your games" : "") : "Missed puzzles and game mistakes will collect here.";
    var names = ["today"].concat([1, 2, 3, 4, 5, 6].map(function (d) { return new Date(now + d * F.DAY).toLocaleDateString("en", { weekday: "short" }); }));
    $("days").innerHTML = up.map(function (n, i) { return '<div title="' + n + " due " + names[i] + '"><i style="height:' + Math.round(48 * n / max) + 'px"></i>' + names[i] + "</div>"; }).join("");
  }

  // ---- strengths and weaknesses
  function renderThemes() {
    var st = F.themeStats(prof, puzzles, now).filter(function (e) { return e.n >= 2 || e.allowed || e.missed; });
    if (!st.length) { $("themes").innerHTML = '<p class="empty">Solve some <a href="../puzzles/">puzzles</a> and review a game against Stockfish — your strong and weak themes will appear here.</p>'; return; }
    var weak = st.filter(function (e) { return e.score >= 0.12; }), strong = st.filter(function (e) { return e.strong; });
    var rows = weak.concat(st.filter(function (e) { return e.score < 0.12 && !e.strong; }).slice(0, 4)).concat(strong.slice(0, 5)).slice(0, 14);
    $("themes").innerHTML = '<table class="th"><thead><tr><th>Theme</th><th>Puzzles</th><th>In your games</th><th></th></tr></thead><tbody>' +
      rows.map(function (e) {
        var v = e.score >= 0.12 ? ["weak", "Practise"] : e.strong ? ["strong", "Strong"] : ["ok", "OK"];
        var games = [e.allowed ? "allowed " + e.allowed : "", e.missed ? "missed " + e.missed : ""].filter(Boolean).join(", ") || "—";
        return "<tr><td><a href=\"../puzzles/?theme=" + encodeURIComponent(e.theme) + '">' + esc(themeName(e.theme)) + "</a></td>" +
          "<td>" + (e.n ? '<span class="meter"><i style="width:' + Math.round(100 * e.ok / e.n) + '%"></i></span>' + e.ok + "/" + e.n : "—") + "</td>" +
          "<td>" + games + '</td><td><span class="verdict ' + v[0] + '">' + v[1] + "</span></td></tr>";
      }).join("") + "</tbody></table>";
  }

  // ---- recent games
  function renderGames() {
    var gs = prof.games.slice(-6).reverse();
    if (!gs.length) { $("games").innerHTML = '<li class="empty">Play Stockfish and let the review run (it starts by itself when the game ends): the game and its lessons land here.</li>'; return; }
    $("games").innerHTML = gs.map(function (g) {
      var mine = g.result === "1/2-1/2" ? "draw" : (g.result === "1-0") === (g.side === "w") ? "win" : g.result === "*" ? "unfinished" : "loss";
      var tags = [];
      (g.mistakes || []).forEach(function (m) {
        m.allowed.forEach(function (t) { tags.push("allowed " + themeName(t).toLowerCase()); });
        m.missed.forEach(function (t) { tags.push("missed " + themeName(t).toLowerCase()); });
      });
      var uniq = tags.filter(function (t, i) { return tags.indexOf(t) === i; }).slice(0, 5);
      var link = "../?" + (g.startFen && g.startFen.indexOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w") !== 0 ? "fen=" + encodeURIComponent(g.startFen) + "&" : "") + "moves=" + encodeURIComponent(g.moves);
      return '<li><div class="top"><span class="res">' + mine + "</span> as " + (g.side === "w" ? "White" : "Black") + " · level " + (g.level || "?") +
        (g.accuracy != null ? " · " + Math.round(g.accuracy) + "% accuracy" : "") +
        ' · <span class="muted">' + new Date(g.t).toLocaleDateString("en", { day: "numeric", month: "short" }) + "</span>" +
        ' · <a href="' + link + '">replay</a></div>' +
        (g.opening ? '<div class="muted">' + esc(g.opening) + "</div>" : "") +
        (uniq.length ? uniq.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") : '<span class="muted">' + ((g.mistakes || []).length ? (g.mistakes.length + " mistakes") : "No mistakes or blunders") + "</span>") +
        (g.coach && g.coach.level !== "off" ? ' <span class="muted">· coach warned ' + g.coach.warnings + "×</span>" : "") + "</li>";
    }).join("");
  }

  function renderCoach() {
    var c = prof.coach, h = c.history.slice(-3);
    var text = { full: "The coach is on: it warns before mistakes and gives hints.", light: "The coach is on Light: it warns only before blunders, with 3 hints a game.", off: "The coach is off." }[c.level];
    if (c.level === "full") text += " After three games where it hardly has to step in (once or less), it steps back to Light." + (h.length ? " Last games: " + h.join(", ") + " warnings." : "");
    if (c.level === "light") text += " A game with four or more warnings brings it back fully.";
    $("coachText").innerHTML = esc(text) + ' Change it under Opponent in the <a href="../">play app</a>.';
  }

  $("resetAll").addEventListener("click", function () {
    if (!confirm("Clear your training profile (games, reviews, plan, coach history) in this browser?")) return;
    prof = F.fresh(); F.save(localStorage, prof); location.reload();
  });

  renderPlan(); renderSRS(); renderThemes(); renderGames(); renderCoach();
  window.chessTrain = { version: VERSION, profile: function () { return prof; } };
})();
