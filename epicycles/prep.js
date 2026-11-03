// Epicycles — the "Prepare picture" window (window.EpPrepUI). An uploaded picture opens here before it is imported:
// smoothing, posterizing, background removal and the tone curve (src/prepare.js) apply live, with the original,
// the prepared picture and the line it will give side by side. open(picture, settings, onUse) shows it; onUse gets
// the prepared picture as a canvas and the settings, to import and to reopen the window with later.
(function () {
  "use strict";
  var I = window.EPi18n, T = I.T, P = window.EpPrepare, E = window.Epicycles;
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULTS = { smooth: 4, levels: 5, removeBackground: true, tolerance: 22, largest: false, invert: false,
    cutoff: 20, gamma: 1.6, mode: "edges", detail: 50, maxPoints: 1500, seeds: [] };

  var st = null;   // { pic, rgba, w, h, o (settings), result, onUse, lastFocus }

  function settingsFor(a) {
    // a logo-like picture (two clear tones) needs no smoothing or posterizing and is traced by its outline
    var o = JSON.parse(JSON.stringify(DEFAULTS));
    if (a && a.twoTone) { o.smooth = 0; o.levels = 0; o.mode = "outline"; o.cutoff = 0; o.gamma = 1; }
    if (a) o.invert = !!a.darkBackground;
    return o;
  }

  function open(pic, settings, onUse) {
    st = { pic: pic, w: pic.width, h: pic.height, rgba: pic.getContext("2d").getImageData(0, 0, pic.width, pic.height).data,
      o: JSON.parse(JSON.stringify(settings)), onUse: onUse, lastFocus: document.activeElement };
    toControls();
    var orig = $("prOrig"); orig.width = st.w; orig.height = st.h; orig.getContext("2d").drawImage(pic, 0, 0);
    $("prep").hidden = false;
    document.body.classList.add("prep-open");
    recompute(true);
    setTimeout(function () { $("prSmooth").focus(); }, 0);
  }

  function close() {
    $("prep").hidden = true;
    document.body.classList.remove("prep-open");
    if (st && st.lastFocus && st.lastFocus.focus) st.lastFocus.focus();
    st = null;
  }

  // ---- controls ↔ settings

  function toControls() {
    var o = st.o;
    $("prSmooth").value = o.smooth; $("prLevels").value = String(o.levels); $("prBg").checked = o.removeBackground;
    $("prTol").value = o.tolerance; $("prLargest").checked = o.largest; $("prInvert").checked = o.invert;
    $("prCutoff").value = o.cutoff; $("prGamma").value = o.gamma; $("prDetail").value = o.detail; $("prPts").value = o.maxPoints;
    pressMode(o.mode); outputs();
  }

  function fromControls() {
    var o = st.o;
    o.smooth = +$("prSmooth").value; o.levels = +$("prLevels").value; o.removeBackground = $("prBg").checked;
    o.tolerance = +$("prTol").value; o.largest = $("prLargest").checked; o.invert = $("prInvert").checked;
    o.cutoff = +$("prCutoff").value; o.gamma = +$("prGamma").value; o.detail = +$("prDetail").value; o.maxPoints = +$("prPts").value;
    outputs();
  }

  function outputs() {
    var o = st.o;
    $("prSmoothOut").textContent = o.smooth ? o.smooth : T("off");
    $("prTolOut").textContent = o.tolerance;
    $("prCutoffOut").textContent = o.cutoff + " %";
    $("prGammaOut").textContent = I.fx(o.gamma, 1);
    $("prDetailOut").textContent = o.detail + " %";
    $("prPtsOut").textContent = o.maxPoints.toLocaleString(I.locale);
    $("prBgCtl").classList.toggle("off", !o.removeBackground);
    $("prDetailCtl").hidden = o.mode !== "edges";
    $("prSeedsN").textContent = o.seeds.length ? T("{n} clicked", { n: o.seeds.length }) : "";
  }

  function pressMode(m) {
    st.o.mode = m;
    document.querySelectorAll("#prMode [data-mode]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === m)); });
  }

  // ---- the pipeline, live: the picture at once, the line a moment later (its tour takes longer)

  var picTimer = null, lineTimer = null;
  function recompute(now) {
    clearTimeout(picTimer);
    picTimer = setTimeout(function () {
      if (!st) return;
      st.result = P.prepare(st.rgba, st.w, st.h, st.o);
      var c = $("prOut"); c.width = st.w; c.height = st.h;
      var img = c.getContext("2d").createImageData(st.w, st.h);
      img.data.set(P.toRGBA(st.result.gray, st.result.mask, [214, 232, 246]));
      c.getContext("2d").putImageData(img, 0, 0);
      clearTimeout(lineTimer);
      lineTimer = setTimeout(drawLine, 60);
    }, now ? 0 : 90);
  }

  function drawLine() {
    if (!st || !st.result) return;
    var o = st.o, res = E.traceImage(null, st.w, st.h, { gray: st.result.gray, mode: o.mode, detail: o.detail / 100, maxPoints: o.maxPoints, timeBudgetMs: 250 });
    var c = $("prLine"), sc = 2, g = c.getContext("2d");
    c.width = st.w * sc; c.height = st.h * sc;
    g.fillStyle = "#082444"; g.fillRect(0, 0, c.width, c.height);
    st.points = res ? res.points : 0;
    if (!res || res.tour.length < 3) {
      $("prLineInfo").textContent = T("Nothing left to trace. Lower the cutoff or the tolerance, or try another way of making the line.");
      $("prUse").disabled = true;
      return;
    }
    g.strokeStyle = "#e6f3ff"; g.lineWidth = 1; g.lineJoin = "round"; g.beginPath();
    res.tour.forEach(function (p, i) { if (i) g.lineTo(p[0] * sc + 1, p[1] * sc + 1); else g.moveTo(p[0] * sc + 1, p[1] * sc + 1); });
    g.closePath(); g.stroke();
    $("prLineInfo").textContent = T("{n} points joined into one closed line", { n: res.points.toLocaleString(I.locale) });
    $("prUse").disabled = false;
  }

  // the prepared picture as an ordinary canvas, ready to import
  function preparedCanvas() {
    var c = document.createElement("canvas"); c.width = st.w; c.height = st.h;
    var img = c.getContext("2d").createImageData(st.w, st.h);
    img.data.set(P.toRGBA(st.result.gray, null, null));
    c.getContext("2d").putImageData(img, 0, 0);
    return c;
  }

  // ---- events

  ["prSmooth", "prTol", "prCutoff", "prGamma", "prDetail", "prPts"].forEach(function (id) {
    $(id).addEventListener("input", function () { fromControls(); recompute(); });
  });
  ["prLevels", "prBg", "prLargest", "prInvert"].forEach(function (id) {
    $(id).addEventListener("change", function () { fromControls(); recompute(); });
  });
  $("prMode").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-mode]"); if (!b || !st) return;
    pressMode(b.dataset.mode); outputs(); clearTimeout(lineTimer); lineTimer = setTimeout(drawLine, 30);
  });
  // a click on the prepared picture removes that patch too (another starting point for the background fill)
  $("prOut").addEventListener("click", function (ev) {
    if (!st || !st.o.removeBackground) return;
    var r = ev.target.getBoundingClientRect();
    st.o.seeds.push([Math.round((ev.clientX - r.left) / r.width * st.w), Math.round((ev.clientY - r.top) / r.height * st.h)]);
    outputs(); recompute(true);
  });
  $("prReset").addEventListener("click", function () { if (!st) return; st.o.seeds = []; outputs(); recompute(true); });
  $("prDefaults").addEventListener("click", function () {
    if (!st) return;
    var a = E.analyse(st.rgba, st.w, st.h);
    st.o = settingsFor(a); toControls(); recompute(true);
  });
  $("prCancel").addEventListener("click", close);
  $("prClose").addEventListener("click", close);
  $("prUse").addEventListener("click", function () {
    if (!st || !st.result) return;
    var done = st.onUse, canvas = preparedCanvas(), o = JSON.parse(JSON.stringify(st.o)), pic = st.pic;
    close();
    done(canvas, o, pic);
  });
  $("prep").addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (ev.key !== "Tab") return;
    // keep the keyboard inside the window while it is open
    var f = Array.prototype.filter.call($("prep").querySelectorAll("button, input, select"), function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!f.length) return;
    if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
    else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
  });

  window.EpPrepUI = { open: open, settingsFor: settingsFor };
})();
