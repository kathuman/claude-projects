/*
 * app.js — "Chess for kids": the world map, the levels, Sir Hop's voice, stars and trophies.
 * Level logic: ../src/kids.js; levels: levels.js; words: i18n.js. Progress: localStorage "chess-kids-v1".
 */
(function () {
  "use strict";
  // 1.0.0 launch: eight worlds (the six pieces, captures, checkmate), stars, trophies, pawn wars, read aloud
  var VERSION = "1.0.0";
  var R = window.ChessRules, K = window.ChessKids, W = window.CHESS_KIDS.worlds, I18N = window.CHESS_KIDS_I18N;
  var LANGS = [["en", "English"], ["es", "Español"], ["af", "Afrikaans"], ["de", "Deutsch"], ["da", "Dansk"], ["nl", "Nederlands"]];
  function $(id) { return document.getElementById(id); }
  function readLS(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  $("ver").textContent = "v" + VERSION; $("verFoot").textContent = "v" + VERSION;

  // ---- theme (shared with the other chess pages; dark by default)
  document.documentElement.setAttribute("data-theme", readLS("chess-theme", "dark") === "light" ? "light" : "dark");
  $("themeToggle").addEventListener("click", function () {
    var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next); writeLS("chess-theme", next);
  });

  // ---- progress
  var KEY = "chess-kids-v1";
  var store = (function () { try { var s = JSON.parse(readLS(KEY, "null")); if (s && s.stars) return s; } catch (e) {} return { stars: {}, read: true, sound: true }; })();
  function save() { writeLS(KEY, JSON.stringify(store)); }
  function starsOf(id) { return store.stars[id] || 0; }
  function worldDone(w) { return w.levels.every(function (l) { return starsOf(l.id) > 0; }); }
  function worldOpen(i) { return i === 0 || worldDone(W[i - 1]); }

  // ---- language: the address, then the course's choice, then the browser's
  var params = new URLSearchParams(location.search);
  var lang = (function () {
    var want = [params.get("lang"), readLS("chess-course-lang", ""), (navigator.language || "en").slice(0, 2)];
    for (var i = 0; i < want.length; i++) if (want[i] && I18N[want[i]]) return want[i];
    return "en";
  })();
  function T(k, vars) {
    var s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(vars[v]); });
    return s;
  }
  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i]").forEach(function (el) { el.textContent = T(el.getAttribute("data-i")); });
    document.title = T("ui.title");
  }
  $("langSel").innerHTML = LANGS.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("");
  $("langSel").value = lang;
  $("langSel").addEventListener("change", function () {
    lang = this.value; writeLS("chess-course-lang", lang);
    try { var u = new URL(location.href); u.searchParams.set("lang", lang); history.replaceState(null, "", u); } catch (e) {}
    applyStatic(); if (S.level) renderLevel(true, true); else renderMap(); // and Sir Hop says it again in the new language
  });

  // ---- Sir Hop's voice (the same care for phones as the course: unlock on the first tap, late voices, chunks)
  var synth = window.speechSynthesis || null, unlocked = false, spoken = [], sayToken = 0, lastSaid = "";
  function unlock() {
    if (unlocked || !synth) return;
    unlocked = true;
    try { var u = new SpeechSynthesisUtterance(" "); u.volume = 0; spoken = [u]; synth.speak(u); } catch (e) {}
  }
  document.addEventListener("pointerdown", unlock, true);
  function voiceFor(code) {
    if (!synth) return null;
    var vs = synth.getVoices(), full = code.toLowerCase(), pre = full.split("-")[0];
    function n(v) { return v.lang.toLowerCase().replace("_", "-"); }
    return vs.filter(function (v) { return n(v) === full; })[0] || vs.filter(function (v) { return n(v).split("-")[0] === pre; })[0] || null;
  }
  function say(text, force) {
    $("bubbleText").textContent = text;
    lastSaid = text;
    if (!synth || (!store.read && !force)) return;
    var code = T("meta.speech"), v = voiceFor(code), tok = ++sayToken;
    if (!v && synth.getVoices().length) return; // no voice for this language on this device: the bubble still shows it
    var parts = text.replace(/([.!?])\s+/g, "$1\u0001").split("\u0001");
    function go() {
      if (tok !== sayToken) return;
      spoken = parts.map(function (t) { var u = new SpeechSynthesisUtterance(t); if (v) u.voice = v; u.lang = v ? v.lang.replace("_", "-") : code; u.rate = 0.92; u.pitch = 1.1; return u; });
      spoken.forEach(function (u) { synth.speak(u); });
    }
    if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(go, 150); } else go();
  }
  $("sayAgain").addEventListener("click", function () { say(lastSaid, true); });
  function setToggles() {
    $("readBtn").setAttribute("aria-pressed", String(!!store.read));
    $("soundBtn").setAttribute("aria-pressed", String(!!store.sound));
  }
  $("readBtn").addEventListener("click", function () { store.read = !store.read; save(); setToggles(); if (!store.read && synth) synth.cancel(); else say(lastSaid); });
  $("soundBtn").addEventListener("click", function () { store.sound = !store.sound; save(); setToggles(); if (store.sound) beep("star"); });

  // ---- little sounds (Web Audio, nothing to download)
  var ac = null;
  function beep(kind) {
    if (!store.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var notes = { star: [880, 1320], win: [523, 659, 784, 1047], nope: [220, 180], move: [440] }[kind] || [440];
      notes.forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.11;
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.2);
      });
    } catch (e) {}
  }
  // ---- confetti (skipped when the device asks for less motion)
  function confetti() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var c = document.createElement("canvas"); c.className = "confetti"; document.body.appendChild(c);
    var w = c.width = innerWidth, h = c.height = innerHeight, g = c.getContext("2d"), cols = ["#ffcf3f", "#7dd3fc", "#3ddc97", "#ff6b5c", "#c084fc"];
    var bits = []; for (var i = 0; i < 120; i++) bits.push({ x: w / 2, y: h / 3, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 12 - 3, s: 5 + Math.random() * 6, c: cols[i % cols.length], r: Math.random() * 6 });
    var t0 = performance.now();
    (function frame(t) {
      g.clearRect(0, 0, w, h);
      bits.forEach(function (b) { b.vy += 0.35; b.x += b.vx; b.y += b.vy; b.r += 0.1; g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); g.restore(); });
      if (t - t0 < 2200) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ---- the map
  function renderMap() {
    S.level = null;
    $("mapView").hidden = false; $("levelView").hidden = true;
    var have = 0, max = 0;
    W.forEach(function (w) { w.levels.forEach(function (l) { have += starsOf(l.id); max += 3; }); });
    $("total").textContent = "⭐ " + have + " / " + max;
    $("worlds").innerHTML = W.map(function (w, i) {
      var open = worldOpen(i), done = worldDone(w), got = w.levels.reduce(function (a, l) { return a + starsOf(l.id); }, 0);
      return '<button class="world" type="button" data-w="' + i + '"' + (open ? "" : " disabled") + ' title="' + (open ? "" : T("ui.locked")) + '">' +
        '<img src="../pieces/cburnett/w' + w.piece + '.svg" alt="">' +
        '<span class="name">' + T("world." + w.id) + '</span><span class="wstars">⭐ ' + got + " / " + w.levels.length * 3 +
        (done ? ' <span class="trophy" title="' + T("ui.trophy", { world: T("world." + w.id) }) + '">🏆</span>' : "") + "</span>" +
        '<div class="dots">' + w.levels.map(function (l) { return '<i class="s' + starsOf(l.id) + '"></i>'; }).join("") + "</div>" +
        (open ? "" : '<span class="lock">🔒</span>') + "</button>";
    }).join("");
    var all = W.every(worldDone);
    say(all ? T("ui.allDone") : T("ui.hello"));
  }
  $("worlds").addEventListener("click", function (e) {
    var b = e.target.closest("[data-w]");
    if (!b || b.disabled) return;
    var w = W[+b.dataset.w], li = w.levels.findIndex(function (l) { return !starsOf(l.id); });
    openLevel(+b.dataset.w, li < 0 ? 0 : li, true);
  });

  // ---- a level
  var S = { level: null, wi: 0, li: 0, pos: null, hero: null, starsLeft: [], moves: 0, wrong: 0, sel: null, help: null, busy: false, done: false, last: null, token: 0 };
  function lv() { return W[S.wi].levels[S.li]; }
  function openLevel(wi, li, intro) {
    S.wi = wi; S.li = li; S.level = lv();
    $("mapView").hidden = true; $("levelView").hidden = false;
    resetLevel();
    renderLevel(false, intro);
    window.scrollTo(0, 0);
  }
  function resetLevel() {
    var L = lv();
    S.token++; S.moves = 0; S.wrong = 0; S.sel = null; S.help = null; S.busy = false; S.done = false; S.last = null;
    if (L.type === "mate" || L.type === "pawnwars") { S.pos = R.fromFEN(L.fen); S.hero = null; S.starsLeft = []; }
    else { S.pos = K.position(R, L); S.hero = R.parseSquare(L.from); S.starsLeft = K.squares(L.stars); }
    $("win").hidden = true;
  }
  function instruction() {
    var L = lv(), t = T("lvl." + L.type, { piece: T("piece." + (L.piece || "P")) });
    return S.li === 0 && L.type !== "mate" ? T("world." + W[S.wi].id + ".intro") + " " + t : t;
  }
  function renderLevel(keep, intro) {
    var L = lv(), w = W[S.wi];
    $("worldName").textContent = T("world." + w.id);
    $("ldots").innerHTML = w.levels.map(function (l, i) { return '<i class="' + (i === S.li ? "now" : "") + '" title="' + starsOf(l.id) + '★"></i>'; }).join("");
    var goal = L.par ? "<small>" + T("ui.goal", { n: L.par }) + "</small>" : "";
    $("count").innerHTML = (L.type === "mate" || L.type === "pawnwars" ? "" : T("ui.moves", { n: S.moves })) + goal;
    $("helpBtn").hidden = L.type === "pawnwars";
    draw();
    if (!keep || intro) say(instruction());
  }
  var boardEl = $("board"), cells = [];
  (function build() {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "sq" + ((r + c) % 2 ? " d" : "");
      b.dataset.r = r; b.dataset.c = c;
      b.setAttribute("aria-label", R.squareName(r, c));
      b.addEventListener("click", onSquare);
      boardEl.insertBefore(b, $("win")); cells.push(b);
    }
  })();
  var STAR = '<svg class="star" viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="#ffcf3f" stroke="#b8860b" stroke-width="1"/></svg>';
  var ROCK = '<svg class="rock" viewBox="0 0 24 24"><path d="M4 18l2-7 5-4 6 2 3 6-2 4z" fill="#8b8f94" stroke="#5b5f63" stroke-width="1.2"/><path d="M8 12l3-2 4 1" fill="none" stroke="#b5b9bd" stroke-width="1.2"/></svg>';
  var FLAG = '<svg class="flag" viewBox="0 0 24 24"><path d="M6 21V3" stroke="#5b4a2a" stroke-width="2"/><path d="M6 4h12l-3 4 3 4H6z" fill="#ff6b5c"/></svg>';
  function heroTargets() {
    var L = lv();
    if (L.type === "mate" || L.type === "pawnwars") {
      if (!S.sel) return [];
      return R.legalMoves(S.pos).filter(function (m) { return m[0] === S.sel[0] && m[1] === S.sel[1]; });
    }
    return K.heroMoves(R, S.pos, S.hero);
  }
  function guarded(r, c) { return lv().type === "escape" && R.attackedBy(S.pos.board, r, c, "b"); }
  function draw() {
    var L = lv(), targets = S.done || S.busy ? [] : heroTargets(), rocks = K.squares(L.rocks);
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var el = cells[r * 8 + c], name = R.squareName(r, c), p = S.pos.board[r][c];
      el.querySelectorAll("img, svg").forEach(function (n) { n.remove(); });
      var isRock = rocks.indexOf(name) >= 0 && p === "P";
      if (isRock) el.insertAdjacentHTML("beforeend", ROCK);
      else if (p) el.insertAdjacentHTML("beforeend", '<img class="pc" src="../pieces/cburnett/' + R.colorOf(p) + p.toUpperCase() + '.svg" alt="">');
      if (!p && S.starsLeft.indexOf(name) >= 0) el.insertAdjacentHTML("beforeend", STAR);
      if (!p && L.flag === name) el.insertAdjacentHTML("beforeend", FLAG);
      var t = targets.filter(function (m) { return m[2] === r && m[3] === c; })[0];
      el.classList.toggle("go", !!t);
      el.classList.toggle("cap", !!t && !!p);
      el.classList.toggle("hero", !!S.hero && S.hero[0] === r && S.hero[1] === c);
      el.classList.toggle("sel", !!S.sel && S.sel[0] === r && S.sel[1] === c);
      el.classList.toggle("mine", (L.type === "mate" || L.type === "pawnwars") && !!p && R.colorOf(p) === "w" && !S.busy && !S.done);
      el.classList.toggle("last", !!S.last && ((S.last[0] === r && S.last[1] === c) || (S.last[2] === r && S.last[3] === c)));
      el.classList.toggle("guard", !p && guarded(r, c));
      el.classList.toggle("help", !!S.help && S.help[0] === r && S.help[1] === c);
      el.setAttribute("aria-label", name + (p ? ", " + T("piece." + p.toUpperCase()) : S.starsLeft.indexOf(name) >= 0 ? ", ⭐" : ""));
    }
  }
  function nope(el, msg) { el.classList.remove("nope"); void el.offsetWidth; el.classList.add("nope"); beep("nope"); if (msg) say(msg); }
  function onSquare(e) {
    if (S.busy || S.done) return;
    var el = e.currentTarget, r = +el.dataset.r, c = +el.dataset.c, L = lv();
    S.help = null;
    if (L.type === "mate" || L.type === "pawnwars") return onGameSquare(el, r, c);
    var m = heroTargets().filter(function (x) { return x[2] === r && x[3] === c; })[0];
    if (!m) {
      if (S.hero[0] === r && S.hero[1] === c) return;
      return nope(el, guarded(r, c) ? T("ui.guarded") : T("ui.notThere"));
    }
    var name = R.squareName(r, c), wasStar = S.starsLeft.indexOf(name) >= 0, wasCapture = !!S.pos.board[r][c];
    if (m[4] === "promo") m = R.legalMoves(S.pos).filter(function (x) { return x[0] === m[0] && x[1] === m[1] && x[2] === r && x[3] === c && x[5] === "Q"; })[0];
    S.pos = K.move(R, S.pos, m); S.hero = [r, c]; S.moves++; S.last = m;
    if (wasStar) S.starsLeft = S.starsLeft.filter(function (s) { return s !== name; });
    beep(wasStar || wasCapture ? "star" : "move");
    renderLevel(true);
    if (K.finished(R, L, S.pos, S.hero, S.starsLeft)) finish(K.stars(L.par, S.moves), L.type === "promote" ? T("ui.promoted") + " " : "");
  }
  // mate puzzles and pawn wars: pick a piece, then a square
  function onGameSquare(el, r, c) {
    var L = lv(), p = S.pos.board[r][c], had = !!S.sel;
    if (S.sel) {
      var m = R.legalMoves(S.pos).filter(function (x) { return x[0] === S.sel[0] && x[1] === S.sel[1] && x[2] === r && x[3] === c && (x[4] !== "promo" || x[5] === "Q"); })[0];
      if (m) { S.sel = null; return L.type === "mate" ? mateMove(m) : pawnMove(m); }
    }
    if (p && R.colorOf(p) === "w") { S.sel = [r, c]; beep("move"); draw(); return; }
    S.sel = null; draw();
    nope(el, T(had ? "ui.notThere" : "ui.tapPiece"));
  }
  function mateMove(m) {
    var L = lv(), before = S.pos, after = R.play(before, m), tok = S.token;
    S.pos = after; S.last = m; draw();
    if (R.isMate(after)) { finish(S.wrong === 0 ? 3 : S.wrong === 1 ? 2 : 1); return; }
    S.wrong++; S.busy = true; beep("nope"); say(T("ui.mateNo"));
    setTimeout(function () { if (tok !== S.token) return; S.pos = before; S.last = null; S.busy = false; draw(); }, 1200);
  }
  function pawnMove(m) {
    var tok = S.token;
    S.pos = R.play(S.pos, m); S.last = m; beep("move"); draw();
    var w = K.pawnWinner(R, S.pos);
    if (w) return pawnOver(w);
    S.busy = true; draw(); say(T("ui.thinking"));
    setTimeout(function () {
      if (tok !== S.token) return;
      var reply = K.pawnAI(R, S.pos, "easy");
      if (reply) { S.pos = R.play(S.pos, reply); S.last = reply; }
      S.busy = false; draw();
      var w2 = K.pawnWinner(R, S.pos);
      if (w2) pawnOver(w2); else say(T("ui.yourTurn"));
    }, 700);
  }
  function pawnOver(winner) {
    if (winner === "w") { finish(3); return; }
    S.done = true; beep("nope"); draw(); say(T("ui.pawnLose"));
    $("winStars").querySelectorAll("span").forEach(function (s) { s.className = ""; });
    $("winText").textContent = T("ui.pawnLose"); $("nextBtn").hidden = true; $("win").hidden = false;
  }
  function finish(n, prefix) {
    var L = lv(), w = W[S.wi], wasDone = worldDone(w);
    S.done = true;
    if (n > starsOf(L.id)) { store.stars[L.id] = n; save(); }
    beep("win"); confetti(); draw();
    var text = (prefix || "") + (L.type === "mate" ? T("ui.mateYes") + " " : L.type === "pawnwars" ? T("ui.pawnWin") + " " : "") +
      (L.par ? T(n === 3 ? "ui.stars3" : n === 2 ? "ui.stars2" : "ui.stars1", { n: L.par }) : T("ui.stars3"));
    if (!wasDone && worldDone(w)) text += " " + T("ui.trophy", { world: T("world." + w.id) }) + " 🏆";
    $("winStars").querySelectorAll("span").forEach(function (s, i) { s.className = i < n ? "on" : ""; });
    $("winText").textContent = text;
    $("nextBtn").hidden = false;
    $("win").hidden = false;
    say(text.replace("🏆", ""));
  }
  function nextLevel() {
    var w = W[S.wi];
    if (S.li + 1 < w.levels.length) openLevel(S.wi, S.li + 1, true);
    else renderMap();
  }
  $("nextBtn").addEventListener("click", nextLevel);
  $("againBtn").addEventListener("click", function () { resetLevel(); renderLevel(false); });
  $("againBtn2").addEventListener("click", function () { resetLevel(); renderLevel(false); });
  $("mapBtn").addEventListener("click", renderMap);
  // Help: the next square on a shortest way (or, in a mate puzzle, the piece that mates)
  $("helpBtn").addEventListener("click", function () {
    if (S.done || S.busy) return;
    var L = lv();
    if (L.type === "mate") { var f = R.parseSquare(L.solution.slice(0, 2)); S.help = f; draw(); say(T("ui.tapPiece")); return; }
    var m = K.nextMove(R, L, S.pos, S.hero, S.starsLeft);
    if (m) { S.help = [m[2], m[3]]; draw(); say(T("ui.helpStars")); }
  });
  $("resetBtn").addEventListener("click", function () { if (confirm(T("ui.resetAsk"))) { store.stars = {}; save(); renderMap(); } });

  // ---- start: ?world=knight opens a world directly
  applyStatic(); setToggles();
  var wq = W.findIndex(function (w) { return w.id === params.get("world"); });
  if (wq >= 0 && worldOpen(wq)) openLevel(wq, 0, true); else renderMap();
  window.chessKids = { version: VERSION, state: S, store: function () { return store; }, open: openLevel, map: renderMap };
})();
