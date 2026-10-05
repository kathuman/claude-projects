/*
 * app.js — the chess course page: board, lessons, exercises, progress, languages and speech.
 *
 * Languages: English plus bundled translations (i18n/<code>.js, loaded on demand). Any other language
 * is translated on the device with the browser's built-in Translator API where available (Chrome),
 * cached in this browser; otherwise the page opens through Google Translate.
 * Speech: the Web Speech API reads each step aloud with a voice for the chosen language; moves written
 * with piece symbols are spoken with that language's piece names.
 */
(function () {
  "use strict";
  // 1.0.0 launch · 1.1.0 "Play this position against Stockfish" on move exercises (opens the play app)
  // 1.1.1 speech on phones: unlock on the first tap, late-loading voices, cancel/speak race, sentence chunks
  // 1.2.0 lessons on tactics and endings link to puzzles of their theme (../puzzles/)
  // 1.3.0 link to My training (../train/)
  var VERSION = "1.3.0";
  var R = window.ChessRules, C = window.CHESS_COURSE, I18N = window.CHESS_I18N, EN = I18N.en;
  var START = R.START_FEN;
  var BUNDLED = [["en", "English"], ["es", "Español"], ["af", "Afrikaans"], ["de", "Deutsch"], ["da", "Dansk"], ["nl", "Nederlands"]];
  var OTHER = [["fr", "Français"], ["pt", "Português"], ["it", "Italiano"], ["sv", "Svenska"], ["nb", "Norsk"], ["fi", "Suomi"], ["is", "Íslenska"],
    ["pl", "Polski"], ["cs", "Čeština"], ["hu", "Magyar"], ["ro", "Română"], ["el", "Ελληνικά"], ["tr", "Türkçe"], ["ru", "Русский"], ["uk", "Українська"],
    ["zu", "isiZulu"], ["xh", "isiXhosa"], ["sw", "Kiswahili"], ["ar", "العربية"], ["hi", "हिन्दी"], ["zh", "中文"], ["ja", "日本語"], ["ko", "한국어"]];
  var $ = function (id) { return document.getElementById(id); };
  function readLS(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  $("ver").textContent = "v" + VERSION; $("verFoot").textContent = "v" + VERSION;

  // ---------------------------------------------------------------- theme (shared with the chess app)
  (function () { var s = readLS("chess-theme", null); if (s === "light" || s === "dark") document.documentElement.setAttribute("data-theme", s); })();
  $("themeToggle").addEventListener("click", function () {
    var root = document.documentElement, pd = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var next = (root.getAttribute("data-theme") || (pd ? "dark" : "light")) === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next); writeLS("chess-theme", next);
  });

  // ---------------------------------------------------------------- course index
  var LESSONS = [];   // flat list: { level, lesson, li, gi }
  C.levels.forEach(function (lv) { lv.lessons.forEach(function (ls, li) { LESSONS.push({ level: lv, lesson: ls, li: li, gi: LESSONS.length }); }); });
  var progress = {};
  try { progress = JSON.parse(readLS("chess-course-progress", "{}")) || {}; } catch (e) { progress = {}; }
  function saveProgress() { writeLS("chess-course-progress", JSON.stringify(progress)); }

  // ---------------------------------------------------------------- languages
  var lang = "en", machine = null;   // machine: { code, name, strings } when translated on the device
  function T(key, vars) {
    var s = machine ? (machine.strings[key] != null ? machine.strings[key] : EN[key])
      : (I18N[lang] && I18N[lang][key] != null ? I18N[lang][key] : EN[key]);
    if (s == null) s = key;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(vars[v]); });
    return s;
  }
  function speechCode() { return machine ? machine.code : T("meta.speech"); }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function setLanguage(code) {
    machine = null;
    if (code === "en" || I18N[code]) { lang = code; afterLanguage(); return Promise.resolve(); }
    return loadScript("i18n/" + code + ".js").then(function () { lang = I18N[code] ? code : "en"; afterLanguage(); }, function () { lang = "en"; afterLanguage(); });
  }
  function afterLanguage() {
    document.documentElement.lang = machine ? machine.code : lang;
    writeLS("chess-course-lang", machine ? "x-" + machine.code : lang);
    // keep the address in step, so a reload or a shared link opens in the same language
    try { var u = new URL(location.href); u.searchParams.set("lang", machine ? "x-" + machine.code : lang); history.replaceState(null, "", u); } catch (e) {}
    var note = $("langNote");
    if (machine) { note.hidden = false; note.textContent = T("ui.machineNote"); }
    else if (lang !== "en") { note.hidden = false; note.textContent = T("ui.translatorNote"); }
    else note.hidden = true;
    applyStatic(); buildLangSelect(); buildNav(); renderStep(true); updateVoiceNote();
  }
  function applyStatic() {
    document.querySelectorAll("[data-i]").forEach(function (el) { el.textContent = T(el.getAttribute("data-i")); });
    document.querySelectorAll("[data-i-title]").forEach(function (el) { el.title = T(el.getAttribute("data-i-title")); el.setAttribute("aria-label", el.title); });
    document.title = T("ui.title");
  }
  function buildLangSelect() {
    var sel = $("langSel");
    sel.innerHTML = BUNDLED.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("") +
      (machine ? '<option value="x-' + machine.code + '">' + machine.name + " (auto)</option>" : "") +
      '<option value="other">' + T("ui.otherLanguage") + "</option>";
    sel.value = machine ? "x-" + machine.code : lang;
    sel.setAttribute("aria-label", T("ui.language"));
    $("otherLang").innerHTML = OTHER.map(function (l) { return '<option value="' + l[0] + '">' + l[1] + "</option>"; }).join("");
  }
  $("langSel").addEventListener("change", function () {
    var v = this.value;
    if (v === "other") { $("translateBox").hidden = false; this.value = machine ? "x-" + machine.code : lang; return; }
    $("translateBox").hidden = true;
    if (v.indexOf("x-") === 0) return;
    setLanguage(v);
  });
  // Any other language: translate every English string on the device, then keep it in this browser.
  $("translateGo").addEventListener("click", function () {
    var code = $("otherLang").value, name = OTHER.filter(function (l) { return l[0] === code; })[0][1];
    machineTranslate(code, name);
  });
  function machineTranslate(code, name) {
    var cached = null;
    try { cached = JSON.parse(readLS("chess-course-mt-" + code, "null")); } catch (e) { cached = null; }
    if (cached && cached.v === Object.keys(EN).length) { machine = { code: code, name: name, strings: cached.s }; $("translateBox").hidden = true; afterLanguage(); return; }
    if (!("Translator" in self)) { openWebTranslate(code); return; }
    var note = $("langNote"); note.hidden = false; note.textContent = T("ui.translating");
    self.Translator.availability({ sourceLanguage: "en", targetLanguage: code }).then(function (a) {
      if (a === "unavailable") { openWebTranslate(code); return null; }
      return self.Translator.create({ sourceLanguage: "en", targetLanguage: code });
    }).then(function (tr) {
      if (!tr) return;
      var keys = Object.keys(EN).filter(function (k) { return k.indexOf("meta.") !== 0; }), out = {}, i = 0;
      function nextKey() {
        if (i >= keys.length) {
          writeLS("chess-course-mt-" + code, JSON.stringify({ v: Object.keys(EN).length, s: out }));
          machine = { code: code, name: name, strings: out }; $("translateBox").hidden = true; afterLanguage(); return;
        }
        var k = keys[i++];
        note.textContent = T("ui.translating") + " " + Math.round(i / keys.length * 100) + "%";
        return tr.translate(EN[k]).then(function (t) {
          // keep English where a placeholder did not survive translation
          var ph = (EN[k].match(/\{\w+\}/g) || []);
          out[k] = ph.every(function (p) { return t.indexOf(p) >= 0; }) ? t : EN[k];
          return nextKey();
        });
      }
      return nextKey();
    }).catch(function () { openWebTranslate(code); });
  }
  function openWebTranslate(code) {
    var note = $("langNote"); note.hidden = false; note.textContent = T("ui.noTranslator");
    var url = location.hostname === "kathuman.github.io"
      ? "https://kathuman-github-io.translate.goog" + location.pathname + "?_x_tr_sl=en&_x_tr_tl=" + code + "&_x_tr_hl=" + code
      : "https://translate.google.com/translate?sl=en&tl=" + code + "&u=" + encodeURIComponent(location.href);
    setTimeout(function () { window.open(url, "_blank", "noopener"); }, 600);
  }

  // ---------------------------------------------------------------- speech
  var synth = window.speechSynthesis || null, rate = +readLS("chess-course-rate", "1"), autoRead = readLS("chess-course-autoread", "0") === "1";
  $("rate").value = rate; $("autoRead").checked = autoRead; $("audioBtn").setAttribute("aria-pressed", String(autoRead));
  function voiceFor(code) {
    if (!synth) return null;
    var vs = synth.getVoices(), full = String(code).toLowerCase(), pre = full.split("-")[0];
    var norm = function (v) { return v.lang.toLowerCase().replace("_", "-"); };
    return vs.filter(function (v) { return norm(v) === full; })[0] || vs.filter(function (v) { return norm(v).split("-")[0] === pre; })[0] || null;
  }
  function updateVoiceNote() {
    var n = $("voiceNote");
    if (!synth) { n.hidden = false; n.textContent = T("ui.noSpeech"); return; }
    var has = !!voiceFor(speechCode());
    n.hidden = has || !synth.getVoices().length; n.textContent = T("ui.noVoice");
  }
  if (synth && "onvoiceschanged" in synth) synth.addEventListener("voiceschanged", updateVoiceNote);
  // moves and symbols spoken as words in the current language
  function speakable(text) {
    var names = { "♔": "K", "♕": "Q", "♖": "R", "♗": "B", "♘": "N", "♚": "K", "♛": "Q", "♜": "R", "♝": "B", "♞": "N" };
    return String(text)
      .replace(/O-O-O/g, T("speech.OOO")).replace(/O-O/g, T("speech.OO"))
      .replace(/([♔♕♖♗♘♚♛♜♝♞])(x?)([a-h][1-8])?([+#]?)/g, function (m, p, x, sq, chk) {
        if (!sq) return "";   // a symbol on its own ("the knight ♘ moves…") follows the piece's name: stay silent
        return T("piece." + names[p]) + (x ? " " + T("speech.takes") : "") + (sq ? " " + sq : "") + (chk === "#" ? " " + T("speech.mate") : chk === "+" ? " " + T("speech.check") : "");
      })
      .replace(/–/g, " ").replace(/\s+/g, " ");
  }
  // Phones need more care than desktops:
  // - iOS (and some Android browsers) only start speech from a tap; one silent utterance during the first
  //   tap unlocks it, so automatic reading after a scripted reply or on Next works later too;
  // - voices load late (getVoices() is empty at first, and iOS may never fire voiceschanged), so with no
  //   list yet we speak with just the language set and let the device pick its voice;
  // - speak() straight after cancel() is often dropped, so a new text waits a moment after a cancel;
  // - utterances that nothing references can be garbage-collected mid-sentence, and long ones are cut
  //   off, so the text goes out in sentence-sized pieces that are kept until they finish.
  var spoken = [], speakToken = 0, unlocked = false, reading = false;
  function unlockSpeech() {
    if (unlocked || !synth) return;
    unlocked = true;
    try { var u = new SpeechSynthesisUtterance(" "); u.volume = 0; spoken = [u]; synth.speak(u); } catch (e) {}
  }
  document.addEventListener("pointerdown", unlockSpeech, true);
  document.addEventListener("keydown", unlockSpeech, true);
  function chunks(text) {
    var out = [], cur = "";
    text.replace(/([.!?:;])\s+/g, "$1\u0001").split("\u0001").forEach(function (s) {
      if (cur && (cur + " " + s).length > 180) { out.push(cur); cur = s; } else cur = cur ? cur + " " + s : s;
    });
    if (cur.trim()) out.push(cur);
    return out;
  }
  function speak(text) {
    if (!synth) return;
    var code = speechCode(), v = voiceFor(code), n = $("voiceNote");
    // the list is loaded and has nothing for this language: say so rather than read it in a wrong accent
    if (!v && synth.getVoices().length) { n.hidden = false; n.textContent = T("ui.noVoice"); return; }
    var tok = ++speakToken, parts = chunks(speakable(text));
    function start() {
      if (tok !== speakToken) return;
      if (synth.paused) synth.resume(); // Chrome on Android can be left paused
      spoken = parts.map(function (t) {
        var u = new SpeechSynthesisUtterance(t);
        if (v) u.voice = v;
        u.lang = v ? v.lang.replace("_", "-") : code;
        u.rate = rate;
        return u;
      });
      reading = true;
      var last = spoken[spoken.length - 1];
      last.onend = last.onerror = function () { if (tok === speakToken) reading = false; };
      spoken.forEach(function (u) { synth.speak(u); });
    }
    if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(start, 150); } else start();
  }
  function stopSpeech() { speakToken++; reading = false; if (synth) synth.cancel(); }
  function setAutoRead(on) {
    autoRead = on; writeLS("chess-course-autoread", on ? "1" : "0");
    $("autoRead").checked = on; $("audioBtn").setAttribute("aria-pressed", String(on));
    if (on) speak(currentSpeech()); else stopSpeech();
  }
  $("autoRead").addEventListener("change", function () { setAutoRead(this.checked); });
  $("audioBtn").addEventListener("click", function () { setAutoRead(!autoRead); });
  $("rate").addEventListener("input", function () { rate = +this.value; writeLS("chess-course-rate", String(rate)); });
  $("listenBtn").addEventListener("click", function () {
    if (reading) { stopSpeech(); return; }
    speak(currentSpeech());
  });

  // ---------------------------------------------------------------- board
  var boardEl = $("board"), cells = [];
  for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "sq " + ((r + c) % 2 ? "d" : "l");
    b.dataset.r = r; b.dataset.c = c; b.setAttribute("role", "gridcell");
    if (r === 7) b.insertAdjacentHTML("beforeend", '<span class="coord f">' + "abcdefgh"[c] + "</span>");
    if (c === 0) b.insertAdjacentHTML("beforeend", '<span class="coord r">' + (8 - r) + "</span>");
    b.addEventListener("click", onSquare);
    boardEl.appendChild(b); cells.push(b);
  }
  function cell(r, c) { return cells[r * 8 + c]; }
  function pieceName(p) { return (R.colorOf(p) === "w" ? T("ui.white") : T("ui.black")) + " " + T("piece." + p.toUpperCase()); }
  function drawBoard() {
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
      var el = cell(r, c), p = S.pos.board[r][c], key = r + "," + c, img = el.querySelector("img");
      if (img) img.remove();
      if (p) el.insertAdjacentHTML("beforeend", '<img src="../pieces/cburnett/' + R.colorOf(p) + p.toUpperCase() + '.svg" alt="">');
      el.classList.toggle("mark", !!S.marks[key]);
      el.classList.toggle("sel", !!S.sel && S.sel[0] === r && S.sel[1] === c);
      el.classList.toggle("last", !!S.last && ((S.last[0] === r && S.last[1] === c) || (S.last[2] === r && S.last[3] === c)));
      el.classList.toggle("found", !!S.found[key]);
      el.classList.toggle("miss", S.miss === key);
      var tgt = S.targets.filter(function (m) { return m[2] === r && m[3] === c; })[0];
      el.classList.toggle("target", !!tgt);
      el.classList.toggle("cap", !!tgt && (p != null || tgt[4] === "ep"));
      el.setAttribute("aria-label", R.squareName(r, c) + ", " + (p ? pieceName(p) : T("ui.empty")));
    }
    drawArrows();
    var t = $("turn");
    t.innerHTML = '<span class="dot" style="background:' + (S.pos.turn === "w" ? "#fff" : "#222") + '"></span>' + T(S.pos.turn === "w" ? "ui.whiteToMove" : "ui.blackToMove");
  }
  function drawArrows() {
    var svg = $("arrows"), out = '<defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(224,112,40,.85)"/></marker></defs>';
    S.arrows.forEach(function (a) {
      var f = R.parseSquare(a.slice(0, 2)), t = R.parseSquare(a.slice(2, 4));
      var x1 = f[1] * 100 + 50, y1 = f[0] * 100 + 50, x2 = t[1] * 100 + 50, y2 = t[0] * 100 + 50;
      var len = Math.hypot(x2 - x1, y2 - y1), k = (len - 32) / len;
      out += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + (x1 + (x2 - x1) * k) + '" y2="' + (y1 + (y2 - y1) * k) + '" stroke="rgba(224,112,40,.85)" stroke-width="16" stroke-linecap="round" marker-end="url(#ah)"/>';
    });
    svg.innerHTML = out;
  }

  // ---------------------------------------------------------------- lesson state
  var S = { gi: 0, si: 0, pos: R.fromFEN(START), marks: {}, arrows: [], sel: null, targets: [], found: {}, miss: null, last: null,
            solved: false, ply: 0, busy: false, token: 0, feedback: null, picked: null };
  function cur() { return LESSONS[S.gi]; }
  function step() { return cur().lesson.steps[S.si]; }
  function setFeedback(kind, text) { S.feedback = text ? { kind: kind, text: text } : null; showFeedback(); if (text && autoRead && kind !== "bad") speak(text); }
  function showFeedback() {
    var fb = $("fb");
    if (!S.feedback) { fb.hidden = true; return; }
    fb.hidden = false; fb.className = "fb " + S.feedback.kind; fb.textContent = S.feedback.text;
  }
  function okText(st) { return EN[st.k + ".ok"] != null ? T(st.k + ".ok") : T("ui.correct"); }
  function currentSpeech() {
    var st = step(), t = T(st.k);
    if (st.type === "quiz") for (var i = 1; i <= st.options; i++) t += " " + i + ". " + T(st.k + ".o" + i) + ".";
    return t;
  }
  function goTo(gi, si) {
    S.gi = Math.max(0, Math.min(LESSONS.length - 1, gi)); S.si = si || 0;
    writeLS("chess-course-last", JSON.stringify([LESSONS[S.gi].lesson.id, S.si]));
    renderStep(false); buildNav();
    if (window.innerWidth <= 820) $("side").classList.add("collapsed");
  }
  function resetStepState() {
    var st = step();
    S.token++; S.busy = false;
    S.pos = R.fromFEN(st.fen || START);
    S.marks = {}; (st.marks || "").split(/\s+/).filter(Boolean).forEach(function (m) { var q = R.parseSquare(m); S.marks[q[0] + "," + q[1]] = true; });
    S.arrows = (st.arrows || "").split(/\s+/).filter(Boolean);
    S.sel = null; S.targets = []; S.found = {}; S.miss = null; S.last = null; S.ply = 0; S.picked = null;
    S.solved = st.type === "explain"; S.feedback = null;
    if (st.type === "squares") {
      var f = R.parseSquare(st.from);
      S.sel = f; S.marks = {};
      S.need = {}; R.legalMoves(S.pos).forEach(function (m) { if (m[0] === f[0] && m[1] === f[1]) S.need[m[2] + "," + m[3]] = true; });
    }
  }
  function renderStep(keepState) {
    var st = step(), ls = cur();
    if (!keepState) resetStepState();
    $("crumb").textContent = T("level." + ls.level.id) + " · " + T("lesson." + ls.lesson.id);
    $("lessonTitle").textContent = T("lesson." + ls.lesson.id);
    $("stepNo").textContent = T("ui.step", { n: S.si + 1, m: ls.lesson.steps.length });
    $("dots").innerHTML = ls.lesson.steps.map(function (_, i) { return '<i class="' + (i < S.si ? "past" : i === S.si ? "now" : "") + '"></i>'; }).join("");
    $("text").textContent = T(st.k);
    // quiz options
    var opts = $("opts");
    if (st.type === "quiz") {
      opts.hidden = false; opts.innerHTML = "";
      for (var i = 0; i < st.options; i++) {
        var o = document.createElement("button");
        o.type = "button"; o.className = "opt" + (S.picked === i ? (i === st.answer ? " right" : " wrong") : "") + (S.solved && i === st.answer ? " right" : "");
        o.textContent = T(st.k + ".o" + (i + 1)); o.dataset.i = i;
        o.addEventListener("click", onOption);
        opts.appendChild(o);
      }
    } else opts.hidden = true;
    if (st.type === "squares" && !S.feedback) S.feedback = { kind: "info", text: T("ui.found", { n: count(S.found), m: count(S.need) }) };
    showFeedback();
    var interactive = st.type === "move" || st.type === "click" || st.type === "squares";
    $("hintBtn").hidden = !(EN[st.k + ".hint"] != null) || S.solved;
    $("solBtn").hidden = st.type !== "move" || S.solved;
    $("retryBtn").hidden = !(interactive && S.solved && st.type === "move");
    $("backBtn").disabled = S.gi === 0 && S.si === 0;
    var last = S.si === ls.lesson.steps.length - 1;
    $("nextBtn").textContent = last ? (S.gi === LESSONS.length - 1 ? T("ui.done") : T("ui.nextLesson")) : (S.solved ? T("ui.next") : T("ui.next"));
    $("nextBtn").disabled = !S.solved || (last && S.gi === LESSONS.length - 1 && progress[ls.lesson.id]);
    var link = $("linkBtn");
    if (st.link) { link.hidden = false; link.href = st.link; link.textContent = T(st.k + ".link"); } else link.hidden = true;
    // a move exercise from a legal game position can be played out against the engine in the play app
    var play = $("playBtn"), playable = st.type === "move" && st.fen && !R.loadFEN(st.fen).error;
    play.hidden = !playable;
    if (playable) play.href = "../index.html?fen=" + encodeURIComponent(st.fen) + "&opponent=engine";
    // lessons on a tactic or an ending link to puzzles of that theme at the learner's level
    var pr = $("practiseBtn");
    pr.hidden = !ls.lesson.practice;
    if (ls.lesson.practice) pr.href = "../puzzles/?theme=" + encodeURIComponent(ls.lesson.practice);
    drawBoard();
    if (!keepState && autoRead) speak(currentSpeech());
  }
  function count(o) { return Object.keys(o || {}).length; }

  // ---------------------------------------------------------------- interaction
  function onOption(e) {
    var st = step(), i = +e.currentTarget.dataset.i;
    if (S.solved) return;
    S.picked = i;
    if (i === st.answer) { S.solved = true; setFeedback("ok", okText(st)); }
    else setFeedback("bad", T("ui.wrong"));
    renderStep(true);
  }
  function onSquare(e) {
    var st = step(), r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c, key = r + "," + c;
    if (S.busy) return;
    if (st.type === "click") {
      if (S.solved) return;
      if (R.squareName(r, c) === st.target) { S.found[key] = true; S.solved = true; setFeedback("ok", okText(st)); }
      else flashMiss(key, T("ui.wrong"));
      renderStep(true); return;
    }
    if (st.type === "squares") {
      if (S.solved) return;
      if (S.need[key]) {
        S.found[key] = true;
        if (count(S.found) === count(S.need)) { S.solved = true; setFeedback("ok", EN[st.k + ".ok"] != null ? T(st.k + ".ok") : T("ui.allFound")); }
        else S.feedback = { kind: "info", text: T("ui.found", { n: count(S.found), m: count(S.need) }) };
      } else if (!(S.sel && S.sel[0] === r && S.sel[1] === c)) flashMiss(key, T("ui.notReachable"));
      renderStep(true); return;
    }
    if (st.type !== "move" || S.solved) return;
    var p = S.pos.board[r][c];
    if (p && R.colorOf(p) === S.pos.turn) {
      S.sel = [r, c];
      S.targets = R.legalMoves(S.pos).filter(function (m) { return m[0] === r && m[1] === c; });
      drawBoard(); return;
    }
    if (!S.sel) { setFeedback("info", T("ui.clickSquare")); return; }
    var options = S.targets.filter(function (m) { return m[2] === r && m[3] === c; });
    if (!options.length) { S.sel = null; S.targets = []; drawBoard(); return; }
    if (options[0][4] === "promo") askPromotion(options, tryMove); else tryMove(options[0]);
  }
  function flashMiss(key, msg) {
    S.miss = key; setFeedback("bad", msg);
    var tok = S.token;
    setTimeout(function () { if (tok === S.token && S.miss === key) { S.miss = null; drawBoard(); } }, 700);
  }
  function askPromotion(options, done) {
    var box = $("promoBtns"), color = S.pos.turn;
    box.innerHTML = "";
    ["Q", "R", "B", "N"].forEach(function (pc) {
      var bt = document.createElement("button");
      bt.type = "button"; bt.title = T("piece." + pc); bt.setAttribute("aria-label", T("piece." + pc));
      bt.innerHTML = '<img src="../pieces/cburnett/' + color + pc + '.svg" alt="">';
      bt.addEventListener("click", function () { $("promo").hidden = true; done(options.filter(function (m) { return m[5] === pc; })[0]); });
      box.appendChild(bt);
    });
    $("promo").hidden = false;
  }
  function isCorrect(st, move, before) {
    var after = R.play(before, move), lastTurn = S.ply >= st.solution.length - 1;
    if (st.goal === "any") return true;
    if (st.goal === "mate" && lastTurn && R.isMate(after)) return true;
    var san = R.toSAN(before, move).replace(/[+#]$/, ""), want = st.solution[S.ply].replace(/[+#]$/, "");
    if (san === want) return true;
    return S.ply === 0 && (st.accept || []).some(function (a) { return a.replace(/[+#]$/, "") === san; });
  }
  function tryMove(move) {
    var st = step(), before = S.pos, after = R.play(before, move), tok = S.token;
    S.sel = null; S.targets = [];
    S.pos = after; S.last = move; drawBoard();
    if (isCorrect(st, move, before)) {
      if (S.ply + 1 < st.solution.length) {
        S.busy = true;
        setFeedback("ok", T("ui.correct"));
        setTimeout(function () {
          if (tok !== S.token) return;
          var reply = R.findMove(S.pos, st.solution[S.ply + 1]), mover = S.pos.turn, replySan = R.toSAN(S.pos, reply);
          S.pos = R.play(S.pos, reply); S.last = reply; S.ply += 2; S.busy = false;
          setFeedback("info", T("ui.theirMove") + " " + figurine(replySan, mover) + " · " + T("ui.yourMove"));
          drawBoard(); renderStep(true);
        }, 650);
        return;
      }
      S.solved = true; markDoneIfLast(); setFeedback("ok", okText(st)); renderStep(true);
      return;
    }
    var stale = R.status(after).stalemate;
    setFeedback("bad", stale ? T("ui.stalemate") : T("ui.wrong"));
    S.busy = true;
    setTimeout(function () { if (tok !== S.token) return; S.pos = before; S.last = null; S.busy = false; drawBoard(); }, 900);
  }
  function figurine(san, color) {
    var w = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" }, b = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" };
    return san.replace(/^[KQRBN]/, function (p) { return (color === "b" ? b : w)[p]; });
  }
  function showSolution() {
    var st = step(), tok = ++S.token;
    S.pos = R.fromFEN(st.fen); S.ply = 0; S.sel = null; S.targets = []; S.busy = true;
    var i = 0;
    (function next() {
      if (tok !== S.token) return;
      if (i >= st.solution.length) { S.busy = false; S.solved = true; markDoneIfLast(); setFeedback("info", st.solution.map(function (s, j) { return figurine(s, j % 2 ? "b" : "w"); }).join("  ")); renderStep(true); return; }
      var m = R.findMove(S.pos, st.solution[i++]);
      S.pos = R.play(S.pos, m); S.last = m; drawBoard();
      setTimeout(next, 750);
    })();
  }
  function markDoneIfLast() {
    var ls = cur();
    if (S.si === ls.lesson.steps.length - 1) { progress[ls.lesson.id] = true; saveProgress(); buildNav(); }
  }
  $("hintBtn").addEventListener("click", function () { setFeedback("info", T(step().k + ".hint")); });
  $("solBtn").addEventListener("click", showSolution);
  $("retryBtn").addEventListener("click", function () { renderStep(false); });
  $("backBtn").addEventListener("click", function () {
    if (S.si > 0) goTo(S.gi, S.si - 1);
    else if (S.gi > 0) goTo(S.gi - 1, LESSONS[S.gi - 1].lesson.steps.length - 1);
  });
  $("nextBtn").addEventListener("click", function () {
    var ls = cur();
    if (S.si < ls.lesson.steps.length - 1) { goTo(S.gi, S.si + 1); return; }
    progress[ls.lesson.id] = true; saveProgress();
    if (S.gi < LESSONS.length - 1) {
      var levelDone = LESSONS[S.gi + 1].level !== ls.level;
      goTo(S.gi + 1, 0);
      setFeedback("ok", T(levelDone ? "ui.levelDone" : "ui.lessonDone"));
    } else { setFeedback("ok", T("ui.courseDone")); buildNav(); renderStep(true); }
  });

  // ---------------------------------------------------------------- navigation
  function buildNav() {
    var done = LESSONS.filter(function (l) { return progress[l.lesson.id]; }).length;
    $("progText").textContent = T("ui.progress", { n: done, m: LESSONS.length });
    $("progBar").style.width = (done / LESSONS.length * 100) + "%";
    var html = "";
    C.levels.forEach(function (lv) {
      var n = lv.lessons.filter(function (l) { return progress[l.id]; }).length;
      html += '<div class="lvl"><button type="button" data-first="' + lv.lessons[0].id + '"><div class="lvl-name">' + T("level." + lv.id) + "<small>" + n + "/" + lv.lessons.length + '</small></div><div class="lvl-desc">' + T("level." + lv.id + ".desc") + '</div></button><ul class="lessons">';
      lv.lessons.forEach(function (l) {
        var g = LESSONS.filter(function (x) { return x.lesson === l; })[0].gi;
        html += '<li><button type="button" data-gi="' + g + '" class="' + (g === S.gi ? "current" : "") + '"' + (g === S.gi ? ' aria-current="true"' : "") + '><span class="tick' + (progress[l.id] ? " done" : "") + '">' + (progress[l.id] ? "✓" : "") + "</span>" + T("lesson." + l.id) + "</button></li>";
      });
      html += "</ul></div>";
    });
    $("levels").innerHTML = html;
    $("levels").querySelectorAll("[data-gi]").forEach(function (b) { b.addEventListener("click", function () { goTo(+b.dataset.gi, 0); }); });
    $("levels").querySelectorAll("[data-first]").forEach(function (b) {
      b.addEventListener("click", function () { goTo(LESSONS.filter(function (x) { return x.lesson.id === b.dataset.first; })[0].gi, 0); });
    });
  }
  $("menuToggle").addEventListener("click", function () { $("side").classList.toggle("collapsed"); });
  $("resetProg").addEventListener("click", function () {
    if (!window.confirm(T("ui.resetConfirm"))) return;
    progress = {}; saveProgress(); buildNav();
  });

  // ---------------------------------------------------------------- start
  (function start() {
    var params = new URLSearchParams(location.search);
    try {
      var last = JSON.parse(readLS("chess-course-last", "null"));
      if (last) { var hit = LESSONS.filter(function (x) { return x.lesson.id === last[0]; })[0]; if (hit) { S.gi = hit.gi; S.si = Math.min(last[1] || 0, hit.lesson.steps.length - 1); } }
    } catch (e) {}
    if (params.get("lesson")) { var h = LESSONS.filter(function (x) { return x.lesson.id === params.get("lesson"); })[0]; if (h) { S.gi = h.gi; S.si = 0; } }
    resetStepState();
    var want = params.get("lang") || readLS("chess-course-lang", null) || (navigator.language || "en").slice(0, 2).toLowerCase();
    if (want.indexOf("x-") === 0) {
      var code = want.slice(2), name = (OTHER.filter(function (l) { return l[0] === code; })[0] || [code, code])[1];
      var cached = null; try { cached = JSON.parse(readLS("chess-course-mt-" + code, "null")); } catch (e) {}
      if (cached) { machine = { code: code, name: name, strings: cached.s }; afterLanguage(); return; }
      want = "en";
    }
    setLanguage(BUNDLED.some(function (l) { return l[0] === want; }) ? want : "en");
  })();

  window.chessCourse = { state: S, lessons: LESSONS, T: T, speakable: speakable, goTo: goTo, setLanguage: setLanguage, version: VERSION };
})();
