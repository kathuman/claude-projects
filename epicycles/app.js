// Epicycles page — picture in, two chains of circles out. The maths lives in src/fourier.js; this file reads the
// picture, keeps the animation state and draws.
(function () {
  "use strict";
  var VERSION = "1.0.0";
  var E = window.Epicycles, TAU = Math.PI * 2, M = 1024, KMAX = 500, HISTORY = 4;
  var $ = function (id) { return document.getElementById(id); };
  $("ver").textContent = "v" + VERSION;

  var css = getComputedStyle(document.documentElement);
  var C = {};
  ["cx", "cy", "pen", "ink", "ink-dim", "ink-faint", "line", "line-soft", "accent", "panel-2"].forEach(function (k) { C[k] = css.getPropertyValue("--" + k).trim(); });

  var S = {
    sample: "text", mode: "outline", invert: false, keep: 7, maxPoints: 1500,
    seq: "auto", order: "frequency", period: 8, playing: true,
    show: { circles: true, target: true, picture: true, history: true },
    source: null,        // { kind: "image", canvas, w, h } or { kind: "path", path }
    path: null,          // the normalised, resampled closed line
    toPicture: null,     // { cx, cy, scale } pixel → world
    sr: null, ox: null, oy: null, stages: [], errs: null,
    stage: 0, N: 1, t: 0, trace: [], history: [],
    lay: null,           // eased layout radii
    drawing: false, strokes: [], tracedPoints: 0
  };

  // ---- pictures ------------------------------------------------------------------------------------------

  function sampleCanvas(kind) {
    var cv = document.createElement("canvas"), W = 360, H = 300;
    cv.width = W; cv.height = H;
    var g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#000";
    if (kind === "text") {
      var txt = $("textIn").value.trim() || "Hi", size = 220;
      g.font = "bold " + size + "px Georgia, 'Times New Roman', serif";
      while (g.measureText(txt).width > W - 30 && size > 20) { size -= 6; g.font = "bold " + size + "px Georgia, 'Times New Roman', serif"; }
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, W / 2, H / 2 + size * 0.04);
    } else if (kind === "heart") {
      g.beginPath();
      for (var i = 0; i <= 400; i++) {
        var t = TAU * i / 400, x = 16 * Math.pow(Math.sin(t), 3), y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        g.lineTo(W / 2 + x * 8, H / 2 - 10 - y * 8);
      }
      g.fill();
    } else if (kind === "star") {
      g.beginPath();
      for (i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 52 : 130; g.lineTo(W / 2 + r * Math.cos(a), H / 2 + 12 + r * Math.sin(a)); }
      g.fill();
    } else if (kind === "gear") {
      g.beginPath();
      for (i = 0; i <= 720; i++) {
        var th = TAU * i / 720, tooth = Math.cos(12 * th) > 0.15 ? 125 : 100;
        g.lineTo(W / 2 + tooth * Math.cos(th), H / 2 + tooth * Math.sin(th));
      }
      g.moveTo(W / 2 + 45, H / 2); g.arc(W / 2, H / 2, 45, 0, TAU, true);
      g.fill("evenodd");
    }
    return cv;
  }

  // the picture as pale ink on a transparent ground, so it sits on the dark canvas without a white box
  function inkLayer(cv) {
    var out = document.createElement("canvas"); out.width = cv.width; out.height = cv.height;
    var src = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height), d = src.data;
    for (var i = 0; i < d.length; i += 4) {
      var l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255, ink = S.invert ? l : 1 - l;
      d[i] = 191; d[i + 1] = 228; d[i + 2] = 255; d[i + 3] = Math.round(255 * ink);
    }
    out.getContext("2d").putImageData(src, 0, 0);
    return out;
  }

  function setImageSource(cv) {
    S.source = { kind: "image", canvas: cv, w: cv.width, h: cv.height };
    retrace();
  }

  function loadFile(file) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var s = Math.min(1, 360 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.max(8, Math.round(img.width * s)); cv.height = Math.max(8, Math.round(img.height * s));
      var g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      setSample(null);
      setMode("edges");
      setImageSource(cv);
    };
    img.onerror = function () { URL.revokeObjectURL(url); flash("That file could not be read as a picture."); };
    img.src = url;
  }

  // ---- picture → line → series ---------------------------------------------------------------------------

  function retrace() {
    if (!S.source) return;
    $("busy").hidden = false;
    setTimeout(function () {
      var tour, norm;
      if (S.source.kind === "image") {
        var src = S.source, data = src.canvas.getContext("2d").getImageData(0, 0, src.w, src.h).data;
        var res = E.traceImage(data, src.w, src.h, { mode: S.mode, invert: S.invert, keep: S.keep / 100, maxPoints: S.maxPoints, timeBudgetMs: 700 });
        $("busy").hidden = true;
        if (!res) { flash(S.mode === "outline" ? "No shapes found. Try Edges, or tick “Light shapes on a dark background”." : "No edges found. Try Outline."); return; }
        tour = res.tour; S.tracedPoints = res.points;
      } else {
        $("busy").hidden = true;
        tour = S.source.path; S.tracedPoints = tour.length;
      }
      var resampled = E.resample(tour, M);
      norm = E.normalise(resampled);
      S.path = norm.path;
      S.toPicture = S.source.kind === "image" ? { cx: norm.cx, cy: norm.cy, scale: norm.scale } : null;
      if (S.source.kind === "image") S.source.ink = inkLayer(S.source.canvas);
      S.sr = E.series(S.path, KMAX);
      S.stages = E.stages(S.sr.K);
      reorder();
      flash("");
    }, 30);
  }

  function reorder() {
    if (!S.sr) return;
    S.ox = E.circleOrder(S.sr.x, S.order); S.oy = E.circleOrder(S.sr.y, S.order);
    S.errs = new Float64Array(S.sr.K + 1);
    for (var n = 0; n <= S.sr.K; n++) S.errs[n] = E.relativeError(S.sr, S.ox, S.oy, n);
    S.lay = null;
    $("nIn").max = S.sr.K;
    restart();
    drawErrChart(); fillErrTable();
  }

  function restart() {
    if (!S.sr) return;
    if (S.seq === "auto") { S.stage = 0; S.N = S.stages[0]; } else S.N = Math.min(+$("nIn").value || 1, S.sr.K);
    S.t = 0; S.trace = []; S.history = [];
    syncN();
  }

  function setN(n, keepHistory) {
    if (!S.sr) return;
    if (S.trace.length > 2 && keepHistory) pushHistory();
    S.N = Math.max(1, Math.min(n, S.sr.K)); S.t = 0; S.trace = [];
    syncN();
  }

  function pushHistory() {
    S.history.push({ N: S.N, pts: S.trace });
    if (S.history.length > HISTORY) S.history.shift();
  }

  function nextStage() {
    if (!S.sr) return;
    if (S.seq === "auto") {
      if (S.stage < S.stages.length - 1) S.stage++;
      setN(S.stages[S.stage], true);
    } else setN(S.N + 1, true);
  }

  // ---- animation -----------------------------------------------------------------------------------------

  var cv = $("stage"), ctx = cv.getContext("2d"), last = performance.now(), view = null;

  function penAt(t) { return [E.evalAxis(S.sr.x, S.ox, S.N, t), E.evalAxis(S.sr.y, S.oy, S.N, t)]; }

  function tick(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (S.sr && S.playing && !S.drawing) {
      var dth = TAU * dt / S.period, steps = Math.max(1, Math.ceil(dth / (TAU / 1500)));
      for (var i = 1; i <= steps; i++) {
        var t = Math.min(TAU, S.t + dth * i / steps);
        S.trace.push(penAt(t));
      }
      S.t += dth;
      if (S.t >= TAU) {
        if (S.seq === "auto" && S.stage < S.stages.length - 1) nextStage();
        else { pushHistory(); S.t = 0; S.trace = [penAt(0)]; }
      }
    }
    render();
    requestAnimationFrame(tick);
  }

  function sizeCanvas() {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w: r.width, h: r.height, dpr: dpr };
  }

  // where everything sits, in world units: the line inside its box, the x chain above, the y chain to the left
  function layout() {
    var bx = [Infinity, -Infinity], by = [Infinity, -Infinity];
    S.path.forEach(function (p) { bx[0] = Math.min(bx[0], p[0]); bx[1] = Math.max(bx[1], p[0]); by[0] = Math.min(by[0], p[1]); by[1] = Math.max(by[1], p[1]); });
    var cap = 1.4, rx = Math.min(cap, E.radiusSum(S.sr.x, S.ox, S.N)), ry = Math.min(cap, E.radiusSum(S.sr.y, S.oy, S.N));
    if (!S.lay) S.lay = { rx: rx, ry: ry };
    S.lay.rx += (rx - S.lay.rx) * 0.08; S.lay.ry += (ry - S.lay.ry) * 0.08;
    var gap = 0.18, Rx = S.lay.rx, Ry = S.lay.ry;
    var xBase = [S.sr.x.a0, by[0] - gap - Rx], yBase = [bx[0] - gap - Ry, S.sr.y.a0];
    var x0 = Math.min(yBase[0] - Ry, S.sr.x.a0 - Rx, bx[0]), x1 = Math.max(bx[1], S.sr.x.a0 + Rx);
    var y0 = Math.min(xBase[1] - Rx, S.sr.y.a0 - Ry, by[0]), y1 = Math.max(by[1], S.sr.y.a0 + Ry);
    return { xBase: xBase, yBase: yBase, box: [x0, y0, x1, y1] };
  }

  function render() {
    var sz = sizeCanvas();
    ctx.setTransform(sz.dpr, 0, 0, sz.dpr, 0, 0);
    ctx.clearRect(0, 0, sz.w, sz.h);
    drawGrid(sz);
    if (S.drawing) { renderDrawing(sz); return; }
    if (!S.sr) return;
    var L = layout(), b = L.box, pad = 18;
    var sc = Math.min((sz.w - 2 * pad) / (b[2] - b[0]), (sz.h - 2 * pad) / (b[3] - b[1]));
    var ox = (sz.w - sc * (b[2] - b[0])) / 2 - sc * b[0], oy = (sz.h - sc * (b[3] - b[1])) / 2 - sc * b[1];
    view = { sc: sc, ox: ox, oy: oy };
    var X = function (x) { return ox + sc * x; }, Y = function (y) { return oy + sc * y; };

    if (S.show.picture && S.toPicture && S.source && S.source.kind === "image") {
      var tp = S.toPicture;
      ctx.save(); ctx.globalAlpha = 0.14;
      ctx.drawImage(S.source.ink, X(-tp.cx / tp.scale), Y(-tp.cy / tp.scale), sc * S.source.w / tp.scale, sc * S.source.h / tp.scale);
      ctx.restore();
    }
    if (S.show.target) polyline(S.path, X, Y, C["ink-faint"], 1, 0.45, true, [3, 4]);
    if (S.show.history) S.history.forEach(function (h, i) { polyline(h.pts, X, Y, C["ink-dim"], 1.2, 0.12 + 0.12 * (i + 1) / S.history.length, false); });

    var pen = penAt(S.t % TAU);
    var cx = E.chain(S.sr.x, S.ox, S.N, S.t, L.xBase, "x"), cy = E.chain(S.sr.y, S.oy, S.N, S.t, L.yBase, "y");
    if (S.show.circles) { drawChain(cx, S.sr.x, S.ox, X, Y, sc, C.cx); drawChain(cy, S.sr.y, S.oy, X, Y, sc, C.cy); }
    var tx = cx[cx.length - 1], ty = cy[cy.length - 1];
    ctx.save(); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.strokeStyle = C.cx; ctx.globalAlpha = 0.7; line(X(tx[0]), Y(tx[1]), X(pen[0]), Y(pen[1]));
    ctx.strokeStyle = C.cy; line(X(ty[0]), Y(ty[1]), X(pen[0]), Y(pen[1]));
    ctx.restore();

    polyline(S.trace, X, Y, C.pen, 2, 1, false);
    dot(X(pen[0]), Y(pen[1]), 4, C.pen);
    dot(X(tx[0]), Y(tx[1]), 3, C.cx); dot(X(ty[0]), Y(ty[1]), 3, C.cy);
    ctx.font = "600 13px Rajdhani, sans-serif"; ctx.fillStyle = C.cx;
    ctx.fillText("x(t)", X(L.xBase[0]) + 6, Math.max(14, Y(L.xBase[1] - S.lay.rx) - 2));
    ctx.fillStyle = C.cy; ctx.fillText("y(t)", Math.max(4, X(L.yBase[0] - S.lay.ry)), Y(L.yBase[1]) - 6);
    updateStats();
  }

  function drawGrid(sz) {
    ctx.save(); ctx.strokeStyle = "rgba(125,211,252,.06)"; ctx.lineWidth = 1;
    for (var x = 0; x < sz.w; x += 32) line(x + 0.5, 0, x + 0.5, sz.h);
    for (var y = 0; y < sz.h; y += 32) line(0, y + 0.5, sz.w, y + 0.5);
    ctx.restore();
  }

  function drawChain(pts, ax, order, X, Y, sc, color) {
    ctx.save(); ctx.strokeStyle = color;
    for (var i = 1; i < pts.length; i++) {
      var r = ax.r[order[i - 1]] * sc, c = pts[i - 1];
      if (r < 0.4) continue;
      ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X(c[0]), Y(c[1]), r, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4;
      line(X(c[0]), Y(c[1]), X(pts[i][0]), Y(pts[i][1]));
    }
    ctx.restore();
    dot(X(pts[0][0]), Y(pts[0][1]), 2.5, color);
  }

  function polyline(pts, X, Y, color, w, alpha, closed, dash) {
    if (!pts || pts.length < 2) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.globalAlpha = alpha; ctx.lineJoin = "round";
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    if (closed) ctx.closePath();
    ctx.stroke(); ctx.restore();
  }
  function line(a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
  function dot(x, y, r, color) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = color; ctx.fill(); }

  // ---- read-outs -----------------------------------------------------------------------------------------

  var lastStatsKey = "";
  function updateStats() {
    var key = S.N + "|" + S.order + "|" + S.stage + "|" + S.seq;
    if (key === lastStatsKey) return;
    lastStatsKey = key;
    $("stN").textContent = S.N;
    $("stStage").textContent = S.seq === "auto" ? "count " + (S.stage + 1) + " of " + S.stages.length + (S.stage === S.stages.length - 1 ? ", repeating" : "") : "fixed";
    $("stErr").textContent = pct(S.errs[S.N]);
    var fast = 0;
    for (var i = 0; i < S.N; i++) fast = Math.max(fast, S.ox[i], S.oy[i]);
    $("stFast").textContent = fast + "×";
    $("stPts").textContent = S.tracedPoints.toLocaleString("en");
    $("stPtsS").textContent = "points joined, resampled to " + M.toLocaleString("en");
    $("nOut").textContent = S.N; $("nIn").value = S.N;
    $("eq").innerHTML = equation("x", S.sr.x, S.ox) + "<br>" + equation("y", S.sr.y, S.oy);
    fillCircleTables();
    drawErrChart();
  }

  function pct(e) { return (100 * e).toFixed(e < 0.1 ? 2 : 1) + " %"; }
  function f3(v) { return (v < 0 ? "−" : "") + Math.abs(v).toFixed(3); }

  function equation(name, ax, order) {
    var s = '<span class="' + name + '">' + name + "(t)</span> ≈ " + f3(ax.a0), shown = Math.min(S.N, 4);
    for (var i = 0; i < shown; i++) {
      var k = order[i], ph = ax.phi[k];
      s += " + " + ax.r[k].toFixed(3) + " cos(" + (k === 1 ? "" : k) + "t " + (ph < 0 ? "− " : "+ ") + Math.abs(ph).toFixed(2) + ")";
    }
    if (S.N > shown) s += " + … (" + (S.N - shown) + " more)";
    return s;
  }

  function fillCircleTables() {
    var rows = Math.min(S.N, 12);
    [["tabX", S.sr.x, S.ox, C.cx], ["tabY", S.sr.y, S.oy, C.cy]].forEach(function (d) {
      var h = '<tr><th></th><th>k</th><th>radius</th><th>start φ</th><th>turns / cycle</th></tr>';
      for (var i = 0; i < rows; i++) {
        var k = d[2][i];
        h += '<tr><td class="sw" style="color:' + d[3] + '"><i></i></td><td>' + k + "</td><td>" + d[1].r[k].toFixed(4) + "</td><td>" + Math.round(d[1].phi[k] * 180 / Math.PI) + "°</td><td>" + k + "</td></tr>";
      }
      $(d[0]).innerHTML = h;
    });
    $("more").textContent = S.N > rows ? "…and " + (S.N - rows) + " more on each side. Radii are in units of half the picture's longer side." : "Radii are in units of half the picture's longer side.";
  }

  // ---- error chart ---------------------------------------------------------------------------------------

  var ec = $("errChart"), ectx = ec.getContext("2d"), chartGeom = null;

  function drawErrChart() {
    if (!S.errs) return;
    var r = ec.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (ec.width !== Math.round(r.width * dpr)) { ec.width = Math.round(r.width * dpr); ec.height = Math.round(r.height * dpr); }
    var g = ectx, W = r.width, H = r.height, l = 44, rt = 10, t = 10, bt = 26, K = S.sr.K;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var X = function (n) { return l + (W - l - rt) * Math.log(n) / Math.log(K); };
    var Y = function (e) { return t + (H - t - bt) * (1 - Math.min(1, e)); };
    chartGeom = { X: X, Y: Y, l: l, rt: rt, W: W, K: K };
    g.font = "11px 'IBM Plex Mono', monospace"; g.fillStyle = C["ink-faint"]; g.strokeStyle = C["line-soft"]; g.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(function (e) { g.beginPath(); g.moveTo(l, Y(e) + 0.5); g.lineTo(W - rt, Y(e) + 0.5); g.stroke(); g.textAlign = "right"; g.fillText(e * 100 + "%", l - 6, Y(e) + 4); });
    g.textAlign = "center";
    [1, 2, 5, 10, 20, 50, 100, 200, 500].forEach(function (n) { if (n <= K) g.fillText(n, X(n), H - 8); });
    g.strokeStyle = C.accent; g.lineWidth = 2; g.lineJoin = "round"; g.beginPath();
    for (var n = 1; n <= K; n++) { if (n === 1) g.moveTo(X(n), Y(S.errs[n])); else g.lineTo(X(n), Y(S.errs[n])); }
    g.stroke();
    var cx = X(S.N), cy = Y(S.errs[S.N]);
    g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fillStyle = C.accent; g.fill(); g.lineWidth = 2; g.strokeStyle = C["panel-2"]; g.stroke();
  }

  ec.addEventListener("pointermove", function (ev) {
    if (!chartGeom) return;
    var r = ec.getBoundingClientRect(), x = ev.clientX - r.left, G = chartGeom;
    var n = Math.round(Math.exp(Math.log(G.K) * (x - G.l) / (G.W - G.l - G.rt)));
    if (n < 1 || n > G.K || x < G.l - 4) { $("tip").hidden = true; return; }
    drawErrChart();
    ectx.save(); ectx.strokeStyle = C["ink-faint"]; ectx.lineWidth = 1; ectx.beginPath(); ectx.moveTo(G.X(n) + 0.5, G.Y(1)); ectx.lineTo(G.X(n) + 0.5, G.Y(0)); ectx.stroke();
    ectx.beginPath(); ectx.arc(G.X(n), G.Y(S.errs[n]), 4, 0, TAU); ectx.fillStyle = C.pen; ectx.fill(); ectx.restore();
    var tip = $("tip"); tip.hidden = false;
    tip.textContent = n + " circle" + (n > 1 ? "s" : "") + " per side · " + pct(S.errs[n]);
    tip.style.left = Math.min(Math.max(G.X(n), 90), G.W - 90) + "px"; tip.style.top = G.Y(S.errs[n]) + "px";
  });
  ec.addEventListener("pointerleave", function () { $("tip").hidden = true; drawErrChart(); });
  ec.addEventListener("click", function (ev) {
    if (!chartGeom) return;
    var r = ec.getBoundingClientRect(), G = chartGeom;
    var n = Math.round(Math.exp(Math.log(G.K) * (ev.clientX - r.left - G.l) / (G.W - G.l - G.rt)));
    if (n >= 1 && n <= G.K) { setSeq("manual"); setN(n, true); }
  });

  function fillErrTable() {
    var h = "<tr><th>Circles per side</th><th>Distance</th></tr>";
    S.stages.forEach(function (n) { h += "<tr><td>" + n + "</td><td>" + pct(S.errs[n]) + "</td></tr>"; });
    $("errTable").innerHTML = h;
  }

  // ---- drawing your own ----------------------------------------------------------------------------------

  function renderDrawing(sz) {
    ctx.save(); ctx.strokeStyle = C.pen; ctx.lineWidth = 2; ctx.lineJoin = ctx.lineCap = "round";
    S.strokes.forEach(function (st) {
      if (st.length < 2) return;
      ctx.beginPath(); ctx.moveTo(st[0][0], st[0][1]);
      for (var i = 1; i < st.length; i++) ctx.lineTo(st[i][0], st[i][1]);
      ctx.stroke();
    });
    ctx.restore();
    if (!S.strokes.length) {
      ctx.fillStyle = C["ink-faint"]; ctx.font = "600 18px Rajdhani, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Draw here", sz.w / 2, sz.h / 2); ctx.textAlign = "left";
    }
  }

  var down = false;
  cv.addEventListener("pointerdown", function (ev) {
    if (!S.drawing) return;
    down = true; cv.setPointerCapture(ev.pointerId);
    var r = cv.getBoundingClientRect(); S.strokes.push([[ev.clientX - r.left, ev.clientY - r.top]]);
  });
  cv.addEventListener("pointermove", function (ev) {
    if (!S.drawing || !down) return;
    var r = cv.getBoundingClientRect(), st = S.strokes[S.strokes.length - 1], p = [ev.clientX - r.left, ev.clientY - r.top], q = st[st.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 2) st.push(p);
  });
  cv.addEventListener("pointerup", function () { down = false; });
  cv.addEventListener("pointercancel", function () { down = false; });

  function useDrawing() {
    var path = [].concat.apply([], S.strokes);
    if (path.length < 3) { flash("Draw a longer line first."); return; }
    S.drawing = false; cv.classList.remove("drawing");
    S.source = { kind: "path", path: path };
    retrace();
  }

  // ---- controls ------------------------------------------------------------------------------------------

  function pressed(groupId, attr, value) {
    document.querySelectorAll("#" + groupId + " [data-" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset[attr] === value)); });
  }

  function setSample(kind) {
    S.sample = kind;
    pressed("samples", "sample", kind);
    $("textCtl").hidden = kind !== "text";
    $("drawCtl").hidden = kind !== "draw";
  }

  function setMode(m) {
    S.mode = m; pressed("modeSeg", "mode", m);
    $("invertCtl").hidden = m !== "outline"; $("keepCtl").hidden = m !== "edges";
  }

  function setSeq(q) {
    S.seq = q; pressed("seqSeg", "seq", q);
    if (q === "auto") { var i = 0; while (i < S.stages.length - 1 && S.stages[i] < S.N) i++; S.stage = i; }
    lastStatsKey = "";
  }

  function syncN() { lastStatsKey = ""; }

  $("samples").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-sample]"); if (!b) return;
    var kind = b.dataset.sample;
    setSample(kind);
    if (kind === "draw") { S.drawing = true; S.strokes = []; cv.classList.add("drawing"); flash("Draw, then press “Use drawing”."); return; }
    S.drawing = false; cv.classList.remove("drawing");
    setMode("outline"); S.invert = false; $("invert").checked = false;
    setImageSource(sampleCanvas(kind));
  });
  var textTimer = null;
  $("textIn").addEventListener("input", function () {
    clearTimeout(textTimer);
    textTimer = setTimeout(function () { if (S.sample === "text") setImageSource(sampleCanvas("text")); }, 350);
  });
  $("useDrawing").addEventListener("click", useDrawing);
  $("clearDrawing").addEventListener("click", function () { S.strokes = []; });
  $("file").addEventListener("change", function (ev) { var f = ev.target.files[0]; if (f) loadFile(f); ev.target.value = ""; });

  $("modeSeg").addEventListener("click", function (ev) { var b = ev.target.closest("[data-mode]"); if (b) { setMode(b.dataset.mode); if (S.source && S.source.kind === "image") retrace(); } });
  $("invert").addEventListener("change", function (ev) { S.invert = ev.target.checked; retrace(); });
  $("keep").addEventListener("input", function (ev) { S.keep = +ev.target.value; $("keepOut").textContent = S.keep + " %"; });
  $("keep").addEventListener("change", retrace);
  $("pts").addEventListener("input", function (ev) { S.maxPoints = +ev.target.value; $("ptsOut").textContent = S.maxPoints.toLocaleString("en"); });
  $("pts").addEventListener("change", function () { if (S.source && S.source.kind === "image") retrace(); });

  $("seqSeg").addEventListener("click", function (ev) { var b = ev.target.closest("[data-seq]"); if (b) { setSeq(b.dataset.seq); if (b.dataset.seq === "auto") restart(); } });
  $("nIn").addEventListener("input", function (ev) {
    var n = +ev.target.value;
    if (S.seq === "auto") { var i = 0; while (i < S.stages.length - 1 && S.stages[i] < n) i++; S.stage = i; n = S.stages[i]; }
    setN(n, false);
  });
  $("orderSeg").addEventListener("click", function (ev) { var b = ev.target.closest("[data-order]"); if (b) { S.order = b.dataset.order; pressed("orderSeg", "order", S.order); reorder(); } });
  $("play").addEventListener("click", function () { S.playing = !S.playing; $("play").textContent = S.playing ? "Pause" : "Play"; });
  $("restart").addEventListener("click", restart);
  $("next").addEventListener("click", nextStage);
  $("period").addEventListener("input", function (ev) { S.period = +ev.target.value; $("periodOut").textContent = S.period + " s"; });
  [["showCircles", "circles"], ["showTarget", "target"], ["showPicture", "picture"], ["showHistory", "history"]].forEach(function (p) {
    $(p[0]).addEventListener("change", function (ev) { S.show[p[1]] = ev.target.checked; });
  });
  $("svgOut").addEventListener("click", downloadSvg);
  window.addEventListener("resize", function () { drawErrChart(); });

  function downloadSvg() {
    if (!S.sr) return;
    var pts = [];
    for (var i = 0; i < 2000; i++) pts.push(penAt(TAU * i / 2000));
    var d = "M" + pts.map(function (p) { return (500 + 450 * p[0]).toFixed(2) + " " + (500 + 450 * p[1]).toFixed(2); }).join(" L") + " Z";
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>Drawn with ' + S.N + ' circles per side</title><path d="' + d + '" fill="none" stroke="#0a2f52" stroke-width="2" stroke-linejoin="round"/></svg>';
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    a.download = "epicycles-" + S.N + "-circles.svg"; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var flashTimer = null;
  function flash(text) {
    clearTimeout(flashTimer);
    $("msg").hidden = !text; $("msg").textContent = text;
    if (text && !S.drawing) flashTimer = setTimeout(function () { $("msg").hidden = true; }, 5000);
  }

  // ---- start ---------------------------------------------------------------------------------------------
  $("keepOut").textContent = S.keep + " %"; $("ptsOut").textContent = S.maxPoints.toLocaleString("en"); $("periodOut").textContent = S.period + " s";
  setSample("text"); setMode("outline");
  setImageSource(sampleCanvas("text"));
  requestAnimationFrame(tick);
})();
