// Tierwise — the tutorial player (window.TWTour). It shows one step at a time in a card, highlights the element the step
// is about, sets the page up through window.Tierwise.setup, and asks the step's question. The tutorial runs on the
// example network; a loaded network stays available in the scenario list. Progress is kept in this browser only.
(function () {
  "use strict";
  var CONTENT = window.TWTourContent, APP = window.Tierwise;
  if (!CONTENT || !APP) return;
  var I18 = window.TWi18n, T = I18.T;
  // in Spanish or Danish, each level and step takes its words from tour-content-es.js / -da.js (same ids, same setups)
  var TR = I18.lang === "es" ? window.TWTourContentES : I18.lang === "da" ? window.TWTourContentDA : null;
  if (TR) CONTENT = { TOKENS: CONTENT.TOKENS, LEVELS: CONTENT.LEVELS.map(function (l) {
    var lt = TR.levels[l.id] || {};
    return Object.assign({}, l, { title: lt.title || l.title, blurb: lt.blurb || l.blurb, steps: l.steps.map(function (st) {
      var e = TR.steps[st.id]; if (!e) return st;
      var out = Object.assign({}, st, { title: e.title, body: e.body });
      if (st.quiz && e.quiz) out.quiz = Object.assign({}, st.quiz, { q: e.quiz.q, options: e.quiz.options, explain: e.quiz.explain });
      return out;
    }) });
  }) };
  var KEY = "tw-tour-v1", level = null, idx = 0, card = null, menu = null, lit = null;
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage blocked: progress is just not remembered */ } }
  function levelById(id) { return CONTENT.LEVELS.filter(function (l) { return l.id === id; })[0]; }

  // ---- the launcher menu
  var btn = document.getElementById("tourBtn");
  if (btn) btn.addEventListener("click", function (ev) { ev.stopPropagation(); if (menu) closeMenu(); else openMenu(); });
  function openMenu() {
    closeMenu(); var prog = load();
    menu = document.createElement("div"); menu.className = "tour-menu"; menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", T("Tutorial levels"));
    menu.innerHTML = "<p class='tour-menu-h'>" + T("Tutorial") + "</p>" + CONTENT.LEVELS.map(function (l) {
      var pr = prog[l.id] || {}, st = pr.done ? T("done ✓") : pr.step ? T("step {k} of {n}", { k: pr.step + 1, n: l.steps.length }) : T("{n} steps · {m} min", { n: l.steps.length, m: l.minutes });
      return "<button type='button' class='tour-level' data-level='" + l.id + "'><b>" + l.title + "</b><span>" + l.blurb + "</span><em>" + st + "</em></button>";
    }).join("");
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + "px"; menu.style.right = Math.max(8, innerWidth - r.right) + "px";
    menu.querySelectorAll("[data-level]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-level"), pr = load()[id] || {}; closeMenu(); start(id, pr.done ? 0 : pr.step || 0); }); });
    setTimeout(function () { document.addEventListener("click", outside); }, 0);
  }
  function outside(ev) { if (menu && !menu.contains(ev.target)) closeMenu(); }
  function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener("click", outside); } }

  // ---- playing a level
  function start(id, step) { level = levelById(id); if (!level) return; go(Math.max(0, Math.min(level.steps.length - 1, step || 0))); }
  function go(k) {
    var st = level.steps[k];
    var prog = load(); prog[level.id] = { step: k, done: (prog[level.id] || {}).done || false }; save(prog);
    idx = k;
    APP.setup(st.setup || {});
    show(st);
  }
  function fill(text) {
    var V = APP.tokens();
    return String(text).replace(/\{\{(\w+)\}\}/g, function (m, t) { return V[t] != null ? V[t] : m; });
  }
  function show(st) {
    if (!card) {
      card = document.createElement("div"); card.className = "tour-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-live", "polite");
      document.body.appendChild(card); document.addEventListener("keydown", keys);
    }
    var n = level.steps.length;
    card.innerHTML = "<div class='tour-top'><span>" + level.title + " · " + T("step {k} of {n}", { k: idx + 1, n: n }) + "</span><button type='button' class='tour-x' aria-label='" + T("Leave the tutorial") + "'>×</button></div>" +
      "<div class='tour-bar'><i style='width:" + Math.round(100 * (idx + 1) / n) + "%'></i></div>" +
      "<h3>" + st.title + "</h3><div class='tour-body'>" + fill(st.body) + "</div>" +
      (st.quiz ? "<div class='tour-quiz'><p>" + st.quiz.q + "</p>" + st.quiz.options.map(function (o, j) { return "<button type='button' data-opt='" + j + "'>" + o + "</button>"; }).join("") + "<div class='tour-fb' hidden></div></div>" : "") +
      "<div class='tour-nav'><button type='button' class='tour-back'" + (idx === 0 ? " disabled" : "") + ">" + T("Back") + "</button><button type='button' class='tour-next'>" + (idx === n - 1 ? T("Finish") : T("Next")) + "</button></div>";
    card.querySelector(".tour-x").addEventListener("click", stop);
    card.querySelector(".tour-back").addEventListener("click", function () { if (idx > 0) go(idx - 1); });
    card.querySelector(".tour-next").addEventListener("click", next);
    card.querySelectorAll("[data-opt]").forEach(function (b) {
      b.addEventListener("click", function () {
        var j = +b.getAttribute("data-opt"), ok = j === st.quiz.answer, fb = card.querySelector(".tour-fb");
        card.querySelectorAll("[data-opt]").forEach(function (o) { o.disabled = true; o.classList.toggle("right", +o.getAttribute("data-opt") === st.quiz.answer); });
        if (!ok) b.classList.add("wrong");
        fb.hidden = false; fb.innerHTML = "<b>" + (ok ? T("Right.") : T("Not quite.")) + "</b> " + fill(st.quiz.explain);
      });
    });
    highlight(st.target);
  }
  function highlight(sel) {
    if (lit) lit.classList.remove("tour-hl");
    lit = sel ? document.querySelector(sel) : null;
    if (!lit) return;
    var d = lit.closest("details"); if (d && !d.open) d.open = true;
    lit.classList.add("tour-hl");
    var wide = innerWidth > 980, r = lit.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - (wide ? 20 : 280)) lit.scrollIntoView({ block: wide && r.height < innerHeight * 0.7 ? "center" : "start", behavior: "smooth" });
  }
  function next() {
    if (idx < level.steps.length - 1) { go(idx + 1); return; }
    var prog = load(); prog[level.id] = { step: 0, done: true }; save(prog);
    var nextLevel = CONTENT.LEVELS[CONTENT.LEVELS.indexOf(level) + 1];
    card.innerHTML = "<div class='tour-top'><span>" + T("{level} complete", { level: level.title }) + "</span><button type='button' class='tour-x' aria-label='" + T("Close") + "'>×</button></div><h3>" + T("Well done") + "</h3><div class='tour-body'>" + T("You finished the {level} level.", { level: level.title.toLowerCase() }) + " " +
      (nextLevel ? T("Ready for <b>{next}</b>?", { next: nextLevel.title.toLowerCase() }) + " " + nextLevel.blurb : T("That is the whole tutorial.")) + "</div><div class='tour-nav'>" + (nextLevel ? "<button type='button' class='tour-next'>" + T("Start {next}", { next: nextLevel.title.toLowerCase() }) + "</button>" : "") + "<button type='button' class='tour-back'>" + T("Close") + "</button></div>";
    card.querySelector(".tour-x").addEventListener("click", stop);
    card.querySelector(".tour-back").addEventListener("click", stop);
    var nb = card.querySelector(".tour-next"); if (nb) nb.addEventListener("click", function () { start(nextLevel.id, 0); });
    if (lit) { lit.classList.remove("tour-hl"); lit = null; }
  }
  function stop() {
    if (card) { card.remove(); card = null; } if (lit) { lit.classList.remove("tour-hl"); lit = null; }
    document.removeEventListener("keydown", keys); level = null;
  }
  function keys(ev) {
    if (!card || !level) return;
    var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (ev.key === "Escape") stop();
    else if (ev.key === "ArrowRight" && !typing) next();
    else if (ev.key === "ArrowLeft" && !typing && idx > 0) go(idx - 1);
  }
  // ?tour=beginner opens a level directly (and &step=3 a step)
  var q = new URLSearchParams(location.search), t = q.get("tour");
  if (t && levelById(t)) setTimeout(function () { start(t, +q.get("step") || 0); }, 80);
  window.TWTour = { start: start, stop: stop, levels: CONTENT.LEVELS, current: function () { return level ? { level: level.id, step: idx, id: level.steps[idx].id } : null; } };
})();
