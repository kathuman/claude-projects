// Real Options for Network Design — the tutorial player (window.ROTour). It shows one step at a time in a card,
// highlights the element the step is about, sets up the scenario through the page's interface (window.ROApp or
// window.RONet), asks the step's question, and moves between the two pages when a level needs both. Progress is kept
// in this browser for convenience only.
(function () {
  "use strict";
  var CONTENT = window.ROTourContent;
  if (!CONTENT) return;
  var PAGE = window.RONet ? "network" : "index", KEY = "ro-tour-v1";
  var level = null, idx = 0, card = null, menu = null, lit = null;
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* storage blocked: progress is just not remembered */ } }
  function levelById(id) { return CONTENT.LEVELS.filter(function (l) { return l.id === id; })[0]; }
  function api() { return PAGE === "network" ? window.RONet : window.ROApp; }

  // ---- the launcher menu
  var btn = document.getElementById("tourBtn");
  if (btn) btn.addEventListener("click", function (ev) { ev.stopPropagation(); menu ? closeMenu() : openMenu(); });
  function openMenu() {
    closeMenu(); var prog = load();
    menu = document.createElement("div"); menu.className = "tour-menu"; menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "Tutorial levels");
    menu.innerHTML = "<p class='tour-menu-h'>Tutorial</p>" + CONTENT.LEVELS.map(function (l) {
      var pr = prog[l.id] || {}, state = pr.done ? "done ✓" : pr.step ? "step " + (pr.step + 1) + " of " + l.steps.length : l.steps.length + " steps · " + l.minutes + " min";
      return "<button type='button' class='tour-level' data-level='" + l.id + "'><b>" + l.title + "</b><span>" + l.blurb + "</span><em>" + state + "</em></button>";
    }).join("");
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + "px"; menu.style.right = Math.max(8, innerWidth - r.right) + "px";
    menu.querySelectorAll("[data-level]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-level"), pr = load()[id] || {}; closeMenu(); start(id, pr.done ? 0 : pr.step || 0); }); });
    setTimeout(function () { document.addEventListener("click", outside); }, 0);
  }
  function outside(ev) { if (menu && !menu.contains(ev.target)) closeMenu(); }
  function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener("click", outside); } }

  // ---- playing a level
  function start(id, step) {
    level = levelById(id); if (!level) return;
    go(Math.max(0, Math.min(level.steps.length - 1, step || 0)));
  }
  function go(k) {
    var st = level.steps[k];
    var prog = load(); prog[level.id] = { step: k, done: (prog[level.id] || {}).done || false }; save(prog);
    if (st.page !== PAGE) { location.href = (st.page === "network" ? "network.html" : "index.html") + "?tour=" + level.id + "&step=" + k; return; }
    idx = k; setup(st.setup || {}); show(st);
  }
  function setup(s) {
    var a = api(); if (!a) return;
    var shown = {}, opts = { basis: s.basis, mapState: s.mapState, mapYear: s.mapYear };
    var presets = PAGE === "network" ? window.ROSpecs.network.PRESETS : window.ROSpecs.single.PRESETS;
    if (s.preset) { Object.keys(presets[s.preset]).forEach(function (k) { shown[k] = presets[s.preset][k]; }); opts.preset = s.preset; }
    Object.keys(s.shown || {}).forEach(function (k) { shown[k] = s.shown[k]; });
    if (s.shown && Object.keys(s.shown).length && s.preset) opts.preset = null;
    a.set(shown, opts);
    if (s.open) { var d = document.querySelector(s.open); if (d && d.tagName === "DETAILS") d.open = true; }
    if (s.sample) { var b = document.querySelector("[data-sample='" + s.sample + "']"); if (b) b.click(); }
  }
  function fill(text) {
    var a = api(), sol = a && a.solution(), money = function (v, sign) { return (sign && v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(1) + "M"; };
    return String(text).replace(/\{\{(\w+)\}\}/g, function (m, t) {
      if (!sol) return m;
      if (PAGE === "index") {
        var keys = ["full", "best", "defer", "stage", "lease"], fx = ["defer", "stage", "lease"], bf = fx.reduce(function (x, y) { return sol[y].npv > sol[x].npv ? y : x; });
        var top = keys.reduce(function (x, y) { return sol[y].npv > sol[x].npv ? y : x; });
        switch (t) {
          case "flex": return money(sol[bf].npv - sol.best.npv, true);
          case "vsFull": return money(sol[bf].npv - sol.full.npv, true);
          case "top": return a.names[top];
          case "bestK": return sol.best.K.toFixed(0) + "k units, " + money(sol.best.npv);
          case "fullNpv": return money(sol.full.npv);
          case "deferNpv": return money(sol.defer.npv);
          case "leaseBreak": return money(sol.lease.npv - sol.lease.noBreak);
          case "mothValue": return money(sol.best.npv - sol.best.noMoth);
        }
      } else {
        var nk = ["central", "two", "both", "pilot", "wait"], ntop = nk.reduce(function (x, y) { return sol[y].npv > sol[x].npv + 1e-9 ? y : x; });
        switch (t) {
          case "netTop": return a.names[ntop];
          case "netFlex": return money(Math.max(sol.pilot.npv, sol.wait.npv) - Math.max(sol.central.npv, sol.two.npv), true);
        }
      }
      return m;
    });
  }
  function show(st) {
    if (!card) {
      card = document.createElement("div"); card.className = "tour-card"; card.setAttribute("role", "dialog"); card.setAttribute("aria-live", "polite");
      document.body.appendChild(card);
      document.addEventListener("keydown", keys);
    }
    var n = level.steps.length;
    card.innerHTML = "<div class='tour-top'><span>" + level.title + " · step " + (idx + 1) + " of " + n + "</span><button type='button' class='tour-x' aria-label='Leave the tutorial'>×</button></div>" +
      "<div class='tour-bar'><i style='width:" + Math.round(100 * (idx + 1) / n) + "%'></i></div>" +
      "<h3>" + st.title + "</h3><div class='tour-body'>" + fill(st.body) + "</div>" +
      (st.quiz ? "<div class='tour-quiz'><p>" + st.quiz.q + "</p>" + st.quiz.options.map(function (o, k) { return "<button type='button' data-opt='" + k + "'>" + o + "</button>"; }).join("") + "<div class='tour-fb' hidden></div></div>" : "") +
      "<div class='tour-nav'><button type='button' class='tour-back'" + (idx === 0 ? " disabled" : "") + ">Back</button><button type='button' class='tour-next'>" + (idx === n - 1 ? "Finish" : "Next") + "</button></div>";
    card.querySelector(".tour-x").addEventListener("click", stop);
    card.querySelector(".tour-back").addEventListener("click", function () { if (idx > 0) go(idx - 1); });
    card.querySelector(".tour-next").addEventListener("click", next);
    card.querySelectorAll("[data-opt]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = +b.getAttribute("data-opt"), ok = k === st.quiz.answer, fb = card.querySelector(".tour-fb");
        card.querySelectorAll("[data-opt]").forEach(function (o) { o.disabled = true; o.classList.toggle("right", +o.getAttribute("data-opt") === st.quiz.answer); });
        if (!ok) b.classList.add("wrong");
        fb.hidden = false; fb.innerHTML = "<b>" + (ok ? "Right." : "Not quite.") + "</b> " + fill(st.quiz.explain);
      });
    });
    highlight(st.target);
    // tokens depend on results that some pages finish a moment later (the background sweeps): refresh the text once
    setTimeout(function () { var body = card && card.querySelector(".tour-body"); if (body) body.innerHTML = fill(st.body); }, 400);
  }
  function highlight(sel) {
    if (lit) lit.classList.remove("tour-hl");
    lit = sel ? document.querySelector(sel) : null;
    if (!lit) return;
    var d = lit.closest("details"); if (d && !d.open) d.open = true;
    lit.classList.add("tour-hl");
    var r = lit.getBoundingClientRect(), wide = innerWidth > 900;
    if (r.top < 70 || r.bottom > innerHeight - (wide ? 20 : 260)) lit.scrollIntoView({ block: wide ? "center" : "start", behavior: "smooth" });
  }
  function next() {
    if (idx < level.steps.length - 1) { go(idx + 1); return; }
    var prog = load(); prog[level.id] = { step: 0, done: true }; save(prog);
    var nextLevel = CONTENT.LEVELS[CONTENT.LEVELS.indexOf(level) + 1];
    card.innerHTML = "<div class='tour-top'><span>" + level.title + " complete</span><button type='button' class='tour-x' aria-label='Close'>×</button></div><h3>Well done</h3><div class='tour-body'>You finished the " + level.title.toLowerCase() + " level." +
      (nextLevel ? " Ready for <b>" + nextLevel.title.toLowerCase() + "</b>? " + nextLevel.blurb : " That is the whole tutorial.") + "</div><div class='tour-nav'>" + (nextLevel ? "<button type='button' class='tour-next'>Start " + nextLevel.title.toLowerCase() + "</button>" : "") + "<button type='button' class='tour-back'>Close</button></div>";
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
    if (ev.key === "Escape") stop();
    else if (ev.key === "ArrowRight" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) next();
    else if (ev.key === "ArrowLeft" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && idx > 0) go(idx - 1);
  }

  // resume a level handed over from the other page
  var q = new URLSearchParams(location.search), t = q.get("tour");
  if (t && levelById(t)) {
    history.replaceState(null, "", location.pathname + location.hash);
    setTimeout(function () { start(t, +q.get("step") || 0); }, 60);
  }
  window.ROTour = { start: start, stop: stop, levels: CONTENT.LEVELS };
})();
