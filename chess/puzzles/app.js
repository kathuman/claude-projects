/*
 * app.js — the chess puzzles page: board, the four training modes, rating and per-theme statistics.
 * Puzzle data: data/*.json (built from the Lichess puzzle database by tests/build-puzzles.js); logic:
 * ../src/puzzles.js; rules: ../src/rules.js. Progress is stored in this browser (localStorage).
 */
(function () {
  "use strict";
  // 1.0.0 launch: rated, themes (linked from the course), daily, timed run; Glicko-2 rating, theme statistics
  var VERSION = "1.0.0";
  var R = window.ChessRules, P = window.ChessPuzzles;
  function $(id) { return document.getElementById(id); }
  $("ver").textContent = "v" + VERSION; $("verFoot").textContent = "v" + VERSION;

  // ---------------------------------------------------------------- theme toggle (shared key with the app)
  try { var th = localStorage.getItem("chess-theme"); if (th === "light" || th === "dark") document.documentElement.setAttribute("data-theme", th); } catch (e) {}
  $("themeToggle").addEventListener("click", function () {
    var root = document.documentElement, pd = matchMedia("(prefers-color-scheme: dark)").matches;
    var next = (root.getAttribute("data-theme") || (pd ? "dark" : "light")) === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("chess-theme", next); } catch (e) {}
  });

  // ---------------------------------------------------------------- stored progress
  var KEY = "chess-puzzles-v1";
  function fresh() { return { rating: P.newRating(), history: [], solved: 0, failed: 0, themes: {}, seen: {}, runBest: 0, daily: {} }; }
  var store = (function () {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.rating) return Object.assign(fresh(), s); } catch (e) {}
    return fresh();
  })();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} }

  // ---------------------------------------------------------------- theme names
  var NAMES = {
    fork: "Fork", pin: "Pin", skewer: "Skewer", discoveredAttack: "Discovered attack", discoveredCheck: "Discovered check",
    doubleCheck: "Double check", deflection: "Deflection", attraction: "Attraction", capturingDefender: "Capturing the defender",
    hangingPiece: "Hanging piece", trappedPiece: "Trapped piece", sacrifice: "Sacrifice", xRayAttack: "X-ray attack",
    intermezzo: "Intermezzo (in-between move)", clearance: "Clearance", interference: "Interference", quietMove: "Quiet move",
    defensiveMove: "Defensive move", zugzwang: "Zugzwang", exposedKing: "Exposed king", kingsideAttack: "Kingside attack",
    queensideAttack: "Queenside attack", advancedPawn: "Advanced pawn", promotion: "Promotion", underPromotion: "Underpromotion",
    enPassant: "En passant", castling: "Castling", attackingF2F7: "Attacking f2 / f7", collinearMove: "Collinear move",
    mate: "Checkmate", mateIn1: "Mate in 1", mateIn2: "Mate in 2", mateIn3: "Mate in 3", mateIn4: "Mate in 4", mateIn5: "Mate in 5 or more",
    backRankMate: "Back-rank mate", smotheredMate: "Smothered mate", anastasiaMate: "Anastasia's mate", arabianMate: "Arabian mate",
    bodenMate: "Boden's mate", doubleBishopMate: "Double-bishop mate", dovetailMate: "Dovetail mate", hookMate: "Hook mate",
    killBoxMate: "Kill-box mate", vukovicMate: "Vuković mate", operaMate: "Opera mate", pillsburysMate: "Pillsbury's mate",
    epauletteMate: "Epaulette mate", cornerMate: "Corner mate", blindSwineMate: "Blind swine mate", morphysMate: "Morphy's mate",
    triangleMate: "Triangle mate", swallowstailMate: "Swallow's tail mate", balestraMate: "Balestra mate",
    opening: "Opening", middlegame: "Middlegame", endgame: "Endgame", rookEndgame: "Rook endgame", pawnEndgame: "Pawn endgame",
    queenEndgame: "Queen endgame", bishopEndgame: "Bishop endgame", knightEndgame: "Knight endgame", queenRookEndgame: "Queen and rook endgame",
    oneMove: "One move", short: "Short (2 moves)", long: "Long (3 moves)", veryLong: "Very long (4+ moves)",
    advantage: "Win an advantage", crushing: "Crushing blow", equality: "Save the game",
    master: "From master games", masterVsMaster: "Master vs master", superGM: "Super-GM games"
  };
  var GROUPS = [
    ["Tactics", ["fork", "pin", "skewer", "discoveredAttack", "discoveredCheck", "doubleCheck", "deflection", "attraction", "capturingDefender",
      "hangingPiece", "trappedPiece", "sacrifice", "xRayAttack", "intermezzo", "clearance", "interference", "quietMove", "defensiveMove",
      "zugzwang", "exposedKing", "kingsideAttack", "queensideAttack", "attackingF2F7", "advancedPawn", "promotion", "underPromotion", "enPassant", "castling"]],
    ["Checkmates", ["mateIn1", "mateIn2", "mateIn3", "mateIn4", "mateIn5", "backRankMate", "smotheredMate", "anastasiaMate", "arabianMate", "bodenMate",
      "doubleBishopMate", "dovetailMate", "hookMate", "operaMate", "pillsburysMate", "epauletteMate", "cornerMate", "morphysMate", "killBoxMate", "vukovicMate"]],
    ["Phases and endgames", ["opening", "middlegame", "endgame", "pawnEndgame", "rookEndgame", "bishopEndgame", "knightEndgame", "queenEndgame", "queenRookEndgame"]],
    ["Length and goal", ["oneMove", "short", "long", "veryLong", "advantage", "crushing", "equality"]],
    ["Source", ["master", "masterVsMaster", "superGM"]]
  ];
  function themeName(t) { return NAMES[t] || t.replace(/([A-Z])/g, " $1").replace(/^./, function (c) { return c.toUpperCase(); }); }
  // themes that describe the puzzle rather than its idea are left out of the statistics
  var NOT_IDEAS = /^(short|long|veryLong|oneMove|master|masterVsMaster|superGM|advantage|crushing|equality|middlegame|opening|endgame|mate)$/;

  // ---------------------------------------------------------------- data
  var index = null, bandData = {};
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function loadBand(b) { return bandData[b.file] ? Promise.resolve(bandData[b.file]) : getJSON("data/" + b.file).then(function (d) { bandData[b.file] = d; return d; }); }
  function pool(target, all) {
    var bands = all ? index.bands : P.bandsFor(index, target);
    return Promise.all(bands.map(loadBand)).then(function (lists) { return [].concat.apply([], lists); });
  }

  // ---------------------------------------------------------------- state
  var params = new URLSearchParams(location.search);
  var S = {
    mode: /^(rated|theme|daily|run)$/.test(params.get("mode")) ? params.get("mode") : (params.get("theme") ? "theme" : "rated"),
    theme: params.get("theme") || "fork",
    puzzle: null, s: null, sel: null, targets: [], last: null, hint: null, flash: null,
    status: "loading",   // loading | opponent | playing | solved | failed | idle
    counted: false, mistake: false, delta: null, token: 0,
    run: { active: false, end: 0, solved: 0, marks: [], timer: null }
  };

  // ---------------------------------------------------------------- board
  var boardEl = $("board"), cells = [];
  function buildBoard() {
    boardEl.querySelectorAll(".sq").forEach(function (n) { n.remove(); });
    cells = [];
    var flip = S.s && S.s.side === "b";
    for (var vr = 0; vr < 8; vr++) for (var vc = 0; vc < 8; vc++) {
      var r = flip ? 7 - vr : vr, c = flip ? 7 - vc : vc, d = document.createElement("div");
      d.className = "sq" + ((r + c) % 2 ? " dark" : "");
      d.dataset.r = r; d.dataset.c = c;
      d.setAttribute("role", "gridcell");
      if (vc === 0) d.insertAdjacentHTML("beforeend", '<span class="coord r">' + (8 - r) + "</span>");
      if (vr === 7) d.insertAdjacentHTML("beforeend", '<span class="coord f">' + "abcdefgh"[c] + "</span>");
      d.addEventListener("click", onSquare);
      boardEl.insertBefore(d, $("promo"));
      (cells[r] || (cells[r] = []))[c] = d;
    }
  }
  function draw() {
    if (!S.s) return;
    var pos = S.s.pos, interactive = S.status === "playing", ck = R.inCheck(pos) ? R.kingPos(pos.board, pos.turn) : null;
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var d = cells[r][c], p = pos.board[r][c], key = r + "," + c;
      d.querySelectorAll("img, .dot, .ring").forEach(function (n) { n.remove(); });
      if (p) d.insertAdjacentHTML("afterbegin", '<img src="../pieces/cburnett/' + R.colorOf(p) + p.toUpperCase() + '.svg" alt="">');
      var isLast = S.last && ((S.last[0] === r && S.last[1] === c) || (S.last[2] === r && S.last[3] === c));
      d.classList.toggle("last", !!isLast);
      d.classList.toggle("sel", !!(S.sel && S.sel[0] === r && S.sel[1] === c));
      d.classList.toggle("hint", !!(S.hint && S.hint[0] === r && S.hint[1] === c));
      d.classList.toggle("check", !!(ck && ck[0] === r && ck[1] === c));
      d.classList.toggle("ok", !!(S.flash && S.flash.ok && S.flash.sq === key));
      d.classList.toggle("no", !!(S.flash && !S.flash.ok && S.flash.sq === key));
      d.classList.toggle("mine", interactive && !!p && R.colorOf(p) === pos.turn);
      var t = S.targets.filter(function (m) { return m[2] === r && m[3] === c; })[0];
      if (t) d.insertAdjacentHTML("beforeend", p || t[4] === "ep" ? '<span class="ring"></span>' : '<span class="dot"></span>');
    }
  }
  function onSquare(e) {
    if (S.status !== "playing") return;
    var r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c, pos = S.s.pos, p = pos.board[r][c];
    var opts = S.targets.filter(function (m) { return m[2] === r && m[3] === c; });
    if (opts.length) {
      if (opts[0][4] === "promo") askPromotion(opts, solverMove); else solverMove(opts[0]);
      return;
    }
    if (p && R.colorOf(p) === pos.turn) {
      S.sel = [r, c];
      S.targets = R.legalMoves(pos).filter(function (m) { return m[0] === r && m[1] === c; });
    } else { S.sel = null; S.targets = []; }
    draw();
  }
  function askPromotion(opts, done) {
    var box = $("promoBox"), color = S.s.pos.turn;
    box.innerHTML = "";
    ["Q", "R", "B", "N"].forEach(function (pc) {
      var b = document.createElement("button");
      b.type = "button"; b.setAttribute("aria-label", { Q: "Queen", R: "Rook", B: "Bishop", N: "Knight" }[pc]);
      b.innerHTML = '<img src="../pieces/cburnett/' + color + pc + '.svg" alt="">';
      b.addEventListener("click", function () { $("promo").hidden = true; done(opts.filter(function (m) { return m[5] === pc; })[0]); });
      box.appendChild(b);
    });
    $("promo").hidden = false;
  }

  // ---------------------------------------------------------------- solving
  function feedback(kind, html) { var fb = $("fb"); fb.className = "fb" + (kind ? " " + kind : ""); fb.innerHTML = html || "&nbsp;"; }
  function colorName(c) { return c === "w" ? "White" : "Black"; }
  function setPrompt(text, side) { $("promptText").textContent = text; $("promptChip").className = "chip " + (side || "w"); }

  function showPuzzle(p) {
    var tok = ++S.token;
    S.puzzle = p; S.s = P.start(R, p);
    S.sel = null; S.targets = []; S.last = null; S.hint = null; S.flash = null;
    S.counted = false; S.mistake = false; S.delta = null; S.status = "opponent";
    store.seen[p[0]] = 1;
    buildBoard(); draw();
    setPrompt(colorName(S.s.side) + " to play — the opponent moves first", S.s.side);
    feedback("", "&nbsp;");
    renderControls();
    setTimeout(function () {
      if (tok !== S.token) return;
      var m = P.advance(R, S.s);
      S.last = m; S.status = "playing";
      setPrompt("Find the best move for " + colorName(S.s.side), S.s.side);
      draw(); renderControls();
    }, 650);
  }
  function solverMove(m) {
    var tok = S.token, before = S.s.pos, res = P.tryMove(R, S.s, m), key = m[2] + "," + m[3];
    S.sel = null; S.targets = [];
    if (res === "wrong") {
      S.mistake = true;
      S.last = [m[0], m[1], m[2], m[3]];
      S.flash = { ok: false, sq: key };
      var shown = S.s.pos; S.s.pos = R.play(before, m); draw(); S.s.pos = shown;
      if (S.mode === "run") { runMiss(); return; }
      count(0);
      feedback("bad", "That's not it — try again, or see the solution." + deltaHTML());
      S.status = "failed-trying";
      setTimeout(function () { if (tok !== S.token) return; S.s.pos = before; S.flash = null; S.last = null; S.status = "playing"; draw(); renderControls(); }, 800);
      renderControls();
      return;
    }
    S.last = [m[0], m[1], m[2], m[3]];
    S.flash = { ok: true, sq: key };
    if (res === "solved") return solved();
    S.status = "opponent";
    feedback("good", "Good — keep going." + deltaHTML());
    draw(); renderControls();
    setTimeout(function () {
      if (tok !== S.token) return;
      var reply = P.advance(R, S.s);
      S.last = reply; S.flash = null; S.status = "playing";
      draw(); renderControls();
    }, 500);
  }
  function solved() {
    S.status = "solved";
    if (S.mode === "run") { runHit(); return; }
    count(S.mistake || S.hint ? 0 : 1);
    var clean = !S.mistake && !S.hint;
    feedback(clean ? "good" : "", (clean ? "Solved!" : "Solved — but it counts as missed (a wrong move or a hint came first).") + deltaHTML());
    if (S.mode === "daily") { store.daily[todayUTC()] = clean ? "solved" : "missed"; save(); }
    finish();
  }
  function finish() {
    S.sel = null; S.targets = []; S.hint = null;
    setPrompt(S.status === "solved" ? "Puzzle complete" : "The solution", S.s.side);
    draw(); renderControls(); renderMeta(true); renderStats();
  }
  // one rated result per puzzle (not in timed runs)
  function count(score) {
    if (S.counted || S.mode === "run") return;
    S.counted = true;
    var before = store.rating.r;
    store.rating = P.rate(store.rating, S.puzzle[3], score);
    S.delta = Math.round(store.rating.r) - Math.round(before);
    store.history.push([Date.now(), Math.round(store.rating.r)]);
    if (store.history.length > 400) store.history.shift();
    if (score) store.solved++; else store.failed++;
    S.puzzle[4].split(" ").forEach(function (t) {
      if (!t || NOT_IDEAS.test(t)) return;
      var e = store.themes[t] || (store.themes[t] = [0, 0]);
      e[0] += score; e[1]++;
    });
    save();
    renderStats();
  }
  function deltaHTML() {
    if (S.delta == null) return "";
    return '<span class="delta">' + (S.delta >= 0 ? "+" : "−") + Math.abs(S.delta) + "</span>";
  }
  function showSolution() {
    if (!S.s || S.s.done) return;
    count(0);
    var tok = ++S.token;
    S.status = "showing"; S.hint = null; S.sel = null; S.targets = []; S.flash = null;
    feedback("", "The solution:" + deltaHTML());
    renderControls();
    (function step() {
      if (tok !== S.token) return;
      if (S.s.done) { S.status = "failed"; finish(); return; }
      S.last = P.advance(R, S.s); draw();
      setTimeout(step, 700);
    })();
  }
  function hint() {
    if (S.status !== "playing") return;
    var m = R.findMove(S.s.pos, S.s.moves[S.s.ply]);
    S.hint = [m[0], m[1]];
    count(0);
    feedback("", "Move this piece. (A hint means the puzzle counts as missed.)" + deltaHTML());
    draw();
  }

  // ---------------------------------------------------------------- choosing the next puzzle
  function todayUTC() { return new Date().toISOString().slice(0, 10); }
  function next() {
    if (!index) return;
    S.status = "loading"; renderControls();
    var target = Math.round(store.rating.r + (Math.random() * 150 - 50)); // a little above your rating, on average
    var job;
    if (S.mode === "daily") {
      var day = todayUTC(), bands = index.bands.filter(function (b) { return b.from === 1400 || b.from === 1600; });
      job = Promise.all(bands.map(loadBand)).then(function (ls) { var all = [].concat.apply([], ls); return all[P.dailyIndex(day, all.length)]; });
    } else if (S.mode === "theme") {
      var re = new RegExp("(^| )" + S.theme + "( |$)");
      job = pool(target).then(function (list) {
        var p = P.pick(list, target, store.seen, null, function (x) { return re.test(x[4]); });
        // rare themes: look through every band
        return p || pool(target, true).then(function (all) { return P.pick(all, target, store.seen, null, function (x) { return re.test(x[4]); }) || P.pick(all, target, {}, null, function (x) { return re.test(x[4]); }); });
      });
    } else {
      if (S.mode === "run") target = P.runTarget(S.run.solved) + Math.round(Math.random() * 80 - 40);
      job = pool(target).then(function (list) { return P.pick(list, target, store.seen) || P.pick(list, target, {}); });
    }
    job.then(function (p) {
      if (!p) { feedback("bad", "No puzzle found — try another theme."); S.status = "idle"; renderControls(); return; }
      showPuzzle(p);
      renderMeta(false);
    }).catch(function () { feedback("bad", "Couldn't load the puzzles — check your connection."); S.status = "idle"; renderControls(); });
  }

  // ---------------------------------------------------------------- timed run
  var RUN_MS = 180000;
  function startRun() {
    S.run = { active: true, end: Date.now() + RUN_MS, solved: 0, marks: [], timer: setInterval(tickRun, 100) };
    $("runBar").hidden = false;
    tickRun(); next();
  }
  function tickRun() {
    var left = Math.max(0, S.run.end - Date.now()), s = Math.ceil(left / 1000);
    $("runClock").textContent = Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
    $("runClock").classList.toggle("low", left < 20000);
    $("runScore").textContent = S.run.solved;
    $("runMarks").innerHTML = S.run.marks.map(function (ok) { return ok ? '<span class="y">✓</span>' : '<span class="n">✗</span>'; }).reverse().join("");
    if (left <= 0 && S.run.active) endRun();
  }
  function runHit() { S.run.solved++; S.run.marks.push(true); tickRun(); feedback("good", "✓ Solved — next!"); setTimeout(function () { if (S.run.active) next(); }, 350); }
  function runMiss() {
    S.run.marks.push(false); S.run.end -= 10000; tickRun();
    feedback("bad", "✗ Wrong move — minus 10 seconds");
    S.status = "failed";
    setTimeout(function () { if (S.run.active) next(); }, 600);
  }
  function endRun() {
    S.run.active = false; clearInterval(S.run.timer); S.token++;
    var best = S.run.solved > store.runBest;
    if (best) { store.runBest = S.run.solved; save(); }
    S.status = "idle";
    setPrompt("Time's up", S.s ? S.s.side : "w");
    feedback(best ? "good" : "", "Time's up: " + S.run.solved + " solved" + (best ? " — a new personal best!" : " (best: " + store.runBest + ")"));
    renderControls(); renderStats();
  }

  // ---------------------------------------------------------------- panels
  function renderControls() {
    var st = S.status, run = S.mode === "run";
    $("hintBtn").disabled = st !== "playing" || !!S.hint;
    $("solBtn").disabled = !(st === "playing" || st === "failed-trying");
    $("hintBtn").hidden = $("solBtn").hidden = run;
    $("retryBtn").hidden = run || !(st === "solved" || st === "failed");
    $("nextBtn").hidden = run || S.mode === "daily" && !!S.puzzle && !S.s.done;
    $("nextBtn").textContent = S.mode === "daily" ? "Next: a rated puzzle" : "Next puzzle";
    $("nextBtn").disabled = st === "loading" || st === "opponent" || st === "showing";
    $("runBtn").hidden = !run || S.run.active;
    $("runBtn").textContent = S.run.marks.length ? "Start another run" : "Start a run";
    $("moveInput").disabled = st !== "playing";
    document.querySelectorAll(".modes button").forEach(function (b) { b.classList.toggle("on", b.dataset.mode === S.mode); b.disabled = S.run.active; });
    $("themeField").hidden = S.mode !== "theme";
    $("runBar").hidden = !run;
    $("modeNote").textContent = {
      rated: "Puzzles near your rating. Each one moves your rating up or down.",
      theme: "Puzzles of one theme near your rating — rated too. Your weakest themes are listed below.",
      daily: store.daily[todayUTC()] ? "Today's puzzle: " + store.daily[todayUTC()] + ". A new one tomorrow." : "The same puzzle for everyone today. It counts towards your rating.",
      run: "Three minutes. Puzzles get harder as you go; a wrong move costs 10 seconds. Not rated."
    }[S.mode];
  }
  function renderMeta(reveal) {
    var p = S.puzzle;
    if (!p) { $("meta").textContent = ""; $("afterLinks").hidden = true; return; }
    var head = (S.mode === "daily" ? "Daily puzzle · " : "") + "Puzzle rating " + p[3];
    var tags = reveal ? p[4].split(" ").filter(Boolean).map(function (t) { return '<span class="tag">' + themeName(t) + "</span>"; }).join("") : "";
    $("meta").innerHTML = head + (reveal ? "<br>" + tags : " · themes are shown once it's done");
    $("afterLinks").hidden = !reveal || S.mode === "run";
    if (reveal) {
      $("analyseLink").href = "../index.html?fen=" + encodeURIComponent(p[1]) + "&moves=" + encodeURIComponent(p[2]);
      $("lichessLink").href = "https://lichess.org/training/" + encodeURIComponent(p[0]);
    }
  }
  function renderStats() {
    var rt = store.rating;
    $("ratingNum").textContent = Math.round(rt.r);
    $("ratingRd").textContent = "± " + Math.round(rt.rd * 2) + (rt.rd > 110 ? " · provisional" : "");
    $("stSolved").textContent = store.solved;
    $("stFailed").textContent = store.failed;
    $("stRun").textContent = store.runBest;
    // rating history: the last 60 results
    var h = store.history.slice(-60).map(function (x) { return x[1]; }), sp = $("spark");
    if (h.length < 2) sp.innerHTML = "";
    else {
      var lo = Math.min.apply(null, h) - 10, hi = Math.max.apply(null, h) + 10, W = 300, H = 56;
      var pts = h.map(function (v, i) { return (i / (h.length - 1) * W).toFixed(1) + "," + (H - (v - lo) / (hi - lo) * (H - 4) - 2).toFixed(1); });
      sp.innerHTML = '<path class="area" d="M0,' + H + " L" + pts.join(" L") + " L" + W + "," + H + ' Z"/><path d="M' + pts.join(" L") + '"/>';
    }
    // themes with at least three results, weakest first
    var rows = Object.keys(store.themes).map(function (t) { var e = store.themes[t]; return [t, e[0], e[1]]; })
      .filter(function (x) { return x[2] >= 3; }).sort(function (a, b) { return a[1] / a[2] - b[1] / b[2] || b[2] - a[2]; }).slice(0, 8);
    $("themesNote").hidden = rows.length > 0;
    $("themesList").innerHTML = rows.map(function (x) {
      var pct = Math.round(100 * x[1] / x[2]);
      return '<li><button type="button" data-theme="' + x[0] + '" title="Practise ' + themeName(x[0]) + '">' + themeName(x[0]) + "</button>" +
        '<span class="bar"><i style="width:' + pct + '%"></i></span><span class="pct">' + x[1] + "/" + x[2] + "</span></li>";
    }).join("");
  }
  function buildThemeSelect() {
    var sel = $("themeSel"), have = index.themes;
    sel.innerHTML = GROUPS.map(function (g) {
      return '<optgroup label="' + g[0] + '">' + g[1].filter(function (t) { return have[t]; }).map(function (t) {
        return '<option value="' + t + '">' + themeName(t) + " (" + have[t].toLocaleString("en") + ")</option>";
      }).join("") + "</optgroup>";
    }).join("");
    if (!have[S.theme]) S.theme = "fork";
    sel.value = S.theme;
  }
  function syncURL() {
    var q = S.mode === "theme" ? "?theme=" + S.theme : S.mode === "rated" ? "" : "?mode=" + S.mode;
    try { history.replaceState(null, "", location.pathname + q); } catch (e) {}
  }

  // ---------------------------------------------------------------- controls
  document.querySelectorAll(".modes button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (S.run.active) return;
      S.mode = b.dataset.mode; syncURL();
      S.token++;
      if (S.mode === "run") { S.status = "idle"; S.puzzle = null; renderMeta(false); setPrompt("Ready when you are", "w"); feedback("", "Press “Start a run”."); renderControls(); return; }
      next();
    });
  });
  $("themeSel").addEventListener("change", function () { S.theme = this.value; syncURL(); next(); });
  $("themesList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-theme]");
    if (!b || S.run.active) return;
    S.mode = "theme"; S.theme = b.dataset.theme; $("themeSel").value = S.theme; syncURL(); next();
  });
  $("nextBtn").addEventListener("click", function () { if (S.mode === "daily") { S.mode = "rated"; syncURL(); } next(); });
  $("hintBtn").addEventListener("click", hint);
  $("solBtn").addEventListener("click", showSolution);
  $("retryBtn").addEventListener("click", function () { var p = S.puzzle, c = S.counted, d = S.delta; showPuzzle(p); S.counted = c; S.delta = d; renderMeta(false); });
  $("runBtn").addEventListener("click", startRun);
  $("resetBtn").addEventListener("click", function () {
    if (!confirm("Reset your puzzle rating, history and statistics in this browser?")) return;
    store = fresh(); save(); renderStats(); renderControls();
  });
  $("moveForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var t = $("moveInput").value.trim();
    if (!t || S.status !== "playing") return;
    var m = R.parseMove(S.s.pos, t);
    if (!m && /^[a-h](x?[a-h])?[18]$/i.test(t)) m = R.parseMove(S.s.pos, t + "=Q");
    if (!m) { feedback("bad", "“" + t + "” isn't a legal move here."); return; }
    $("moveInput").value = "";
    solverMove(m);
  });

  // ---------------------------------------------------------------- start
  renderStats(); renderControls();
  getJSON("data/index.json").then(function (ix) {
    index = ix;
    buildThemeSelect();
    if (S.mode === "run") { S.status = "idle"; setPrompt("Ready when you are", "w"); feedback("", "Press “Start a run”."); renderControls(); }
    else next();
  }).catch(function () {
    setPrompt("Couldn't load the puzzles", "w");
    feedback("bad", location.protocol === "file:" ? "Open this page over http (a browser won't load the puzzle files from a local file)." : "Check your connection and reload.");
  });

  // for tests and the curious
  window.chessPuzzles = { version: VERSION, state: S, store: function () { return store; }, next: next };
})();
