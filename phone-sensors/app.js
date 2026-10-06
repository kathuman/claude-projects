// Sensor Deck — every sensor a phone's browser can read, live, with recording and a computer view.
// Version history:
//   1.0.0  launch: 13 sensor cards (motion, gyroscope, orientation/compass, magnetometer, light, location, microphone,
//          camera, touch, battery, network, screen) with live charts, hover read-outs and tables; steps, shakes,
//          heading, spirit level, motion rhythm and GPS distance; CSV/JSON recording; a computer view paired by QR code
//          over WebRTC (PeerJS); a demo phone for devices without sensors
(function () {
  "use strict";
  var VERSION = "1.0.0";
  var C = window.SensorCore, $ = function (id) { return document.getElementById(id); };
  var WINDOW = 10000, PARAMS = new URLSearchParams(location.search);
  $("ver").textContent = "v" + VERSION; $("verFoot").textContent = "v" + VERSION;
  if (!window.isSecureContext) $("insecure").hidden = false;

  // ---- theme
  $("themeBtn").addEventListener("click", function () {
    var t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("sensordeck-theme", t); } catch (e) { /* private mode */ }
    readColors(); redrawAll = true;
  });
  var COLORS = [];
  function readColors() { var cs = getComputedStyle(document.documentElement); COLORS = ["--s1", "--s2", "--s3", "--s4"].map(function (v) { return cs.getPropertyValue(v).trim(); }); COLORS.ink = cs.getPropertyValue("--muted").trim(); COLORS.line = cs.getPropertyValue("--line").trim(); }
  readColors();

  // ---- clocks: local readings use this page's clock; in the computer view, the phone's timestamps are mapped onto
  // ours by the smallest delay seen, so the charts scroll smoothly between batches
  var t0 = performance.now(), remoteOffset = null, mode = "phone";
  function localNow() { return performance.now() - t0; }
  function clock() { return mode === "view" && remoteOffset != null ? performance.now() - remoteOffset : localNow(); }

  // ---- the deck: one state per sensor, fed by local sensors, the demo phone or a remote phone
  var D = {}, redrawAll = true;
  C.SENSORS.forEach(function (s) { D[s.id] = { s: s, buf: new C.RingBuffer(4000), rate: new C.RateMeter(2000), state: "off", msg: "", meta: "", last: null, dirty: false }; });
  var steps = new C.StepCounter(), shake = new C.ShakeDetector(14), track = new C.Track(), rec = { on: false, rows: [] };

  function feed(id, t, v) {
    var d = D[id]; if (!d) return;
    d.buf.push(t, v); d.rate.tick(t); d.last = v; d.dirty = true;
    if (d.state !== "on") setState(id, "on", d.msg && /Waiting|Touch/.test(d.msg) ? "" : d.msg);
    if (rec.on && rec.rows.length < 3000000) rec.rows.push([t, id, v.slice()]);
    derive(id, t, v);
    if (mode === "phone" && link.conn && link.open) link.batcher.add(t, id, v);
    if (mode === "view") cardOf(id).hidden = false, $("viewEmpty").hidden = true;
  }
  function setState(id, state, msg) {
    var d = D[id]; d.state = state; if (msg != null) d.msg = msg; d.dirty = true; paintHead(id);
    if (mode === "phone" && link.open) link.send({ type: "status", id: id, state: state, text: d.msg });
  }
  function setMeta(id, text) {
    var d = D[id]; if (d.meta === text) return; d.meta = text; var el = cardOf(id).querySelector(".meta"); if (el) el.textContent = text;
    if (mode === "phone" && link.open) link.send({ type: "meta", id: id, text: text });
  }

  // ---- derived readings
  var lastFreqAt = 0;
  function derive(id, t, v) {
    if (id === "accel") {
      if (steps.add(t, v[3])) { $("dSteps").textContent = steps.steps; }
      var lv = C.level(v[0], v[1], v[2]);
      $("dTilt").textContent = C.fmt(lv.tilt, 1) + "°";
      $("dTiltXY").textContent = "x " + C.fmt(lv.x, 1) + "° · y " + C.fmt(lv.y, 1) + "°";
      var k = 22 / 45, bx = Math.max(-22, Math.min(22, -lv.x * k)), by = Math.max(-22, Math.min(22, lv.y * k));
      $("bubbleDot").style.transform = "translate(calc(-50% + " + bx.toFixed(1) + "px), calc(-50% + " + by.toFixed(1) + "px))";
      $("bubbleDot").style.background = lv.tilt < 1 ? "var(--good)" : "var(--warn)";
      if (t - lastFreqAt > 1000) {
        lastFreqAt = t;
        var w = D.accel.buf.since(t - 5000), df = w.length > 40 ? C.dominantFrequency(C.resample(w.map(function (s) { return s[0]; }), w.map(function (s) { return s[1][3]; }), 50), 50, 0.5) : null;
        $("dFreq").textContent = df && df.magnitude > 0.05 ? C.fmt(df.freq, 2) + " Hz" : "–";
      }
    } else if (id === "linacc") {
      if (shake.add(t, v[0], v[1], v[2])) { $("dShakes").textContent = shake.count; if (mode === "phone" && navigator.vibrate) navigator.vibrate(60); }
    } else if (id === "orient") {
      var h = v[0];
      $("dHeading").textContent = h == null ? "–" : Math.round(h) + "° " + C.cardinal(h);
      $("dHeadingNote").textContent = h == null ? "no compass reference" : "of the top edge (flat) or camera (upright)";
      $("roseNeedle").setAttribute("transform", "rotate(" + (h == null ? 0 : -h).toFixed(1) + ")");
      var ph = cardOf("orient").querySelector(".phone3d .body");
      if (ph) ph.style.transform = "rotateX(" + (v[1] || 0).toFixed(1) + "deg) rotateY(" + (-(v[2] || 0)).toFixed(1) + "deg) rotateZ(" + (-(v[3] || 0)).toFixed(1) + "deg)";
    } else if (id === "geo") {
      if (track.add(t, v[0], v[1], v[2])) { $("dDist").textContent = track.distance < 1000 ? Math.round(track.distance) + " m" : C.fmt(track.distance / 1000, 2) + " km"; drawTrack(); }
      var a = cardOf("geo").querySelector("a.osm");
      if (a && v[0] != null) a.href = "https://www.openstreetmap.org/?mlat=" + v[0].toFixed(6) + "&mlon=" + v[1].toFixed(6) + "#map=17/" + v[0].toFixed(6) + "/" + v[1].toFixed(6);
      $("dDistNote").textContent = v[2] != null ? "fix accuracy ±" + Math.round(v[2]) + " m" : "from good GPS fixes";
    } else if (id === "touch" && mode === "view") {
      drawRemoteTouch(v);
    }
  }
  function resetDerived() {
    steps.reset(); shake = new C.ShakeDetector(14); track = new C.Track();
    $("dSteps").textContent = "0"; $("dShakes").textContent = "0"; $("dDist").textContent = "0 m"; $("dFreq").textContent = "–"; $("dHeading").textContent = "–"; $("dTilt").textContent = "–";
  }

  // ---- cards
  var cardsEl = $("cards"), CARD = {};
  function cardOf(id) { return CARD[id]; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // the device card and the tools card come first; they are not sensors
  var devCard = el("section", "panel card"); devCard.id = "card-device";
  devCard.appendChild((function () { var t = el("div", "top"); t.appendChild(el("h3", "", "This device")); return t; })());
  var devInfo = el("dl", "info"); devCard.appendChild(devInfo);
  devCard.appendChild(el("div", "about", "What the browser says about the phone. The model is reported by Chrome on Android."));
  cardsEl.appendChild(devCard);
  function showInfo(info) {
    devInfo.textContent = "";
    Object.keys(info).forEach(function (k) { devInfo.appendChild(el("dt", "", k)); devInfo.appendChild(el("dd", "", String(info[k]))); });
  }

  var toolsCard = el("section", "panel card"); toolsCard.id = "card-tools";
  toolsCard.innerHTML = '<div class="top"><h3>Buzz &amp; screen</h3></div>' +
    '<div class="row"><button class="btn small" type="button" data-buzz="200">Buzz</button><button class="btn small" type="button" data-buzz="100,80,100,80,100">Triple</button>' +
    '<button class="btn small" type="button" data-buzz="100,100,100,100,100,300,300,100,300,100,300,300,100,100,100,100,100">SOS</button>' +
    '<button class="btn small" type="button" id="wakeBtn" aria-pressed="false">Keep screen on</button></div>' +
    '<div class="msg" id="toolsMsg"></div><div class="about">The vibration motor and the screen wake lock: the two things a page can make the phone do. The screen stays on by itself while a computer is connected.</div>';
  cardsEl.appendChild(toolsCard);
  toolsCard.addEventListener("click", function (e) {
    var b = e.target.closest("[data-buzz]"); if (!b) return;
    if (!navigator.vibrate) { $("toolsMsg").textContent = "This browser cannot vibrate the phone (iPhones don't allow it)."; return; }
    navigator.vibrate(b.dataset.buzz.split(",").map(Number));
  });

  C.SENSORS.forEach(function (s) {
    var c = el("section", "panel card"); c.id = "card-" + s.id; CARD[s.id] = c;
    var top = el("div", "top"); top.appendChild(el("h3", "", s.name));
    top.appendChild(el("span", "rate num"));
    var pill = el("span", "pill state", "off"); top.appendChild(pill);
    var tbl = el("button", "btn small tblbtn", "Table"); tbl.type = "button"; tbl.setAttribute("aria-pressed", "false"); tbl.title = "Show the latest readings as a table"; top.appendChild(tbl);
    var tog = el("button", "btn small toggle", "Start"); tog.type = "button"; top.appendChild(tog);
    c.appendChild(top);
    c.appendChild(el("div", "msg"));
    var vals = el("div", "vals");
    s.ch.forEach(function (name, i) {
      var v = el("div", "val"), k = el("span", "k"), pi = s.plot.indexOf(i);
      if (pi >= 0) { var sw = el("i"); sw.dataset.series = pi; k.appendChild(sw); }
      k.appendChild(document.createTextNode(name + (s.unit && !/[%°]|Hz|m\/s|ms|px|Mb|0–1/.test(name) && !/fingers|charging|online|pressure/.test(name) ? " (" + s.unit + ")" : "")));
      v.appendChild(k); v.appendChild(el("span", "v", "–")); vals.appendChild(v);
    });
    c.appendChild(vals);
    var extra = el("div", "extra"); c.appendChild(extra);
    if (s.plot.length) {
      var box = el("div", "chartbox"), cv = el("canvas"); cv.setAttribute("role", "img"); cv.setAttribute("aria-label", s.name + ", last 10 seconds");
      box.appendChild(cv); var tip = el("div", "tip"); tip.hidden = true; box.appendChild(tip); c.appendChild(box);
      c._chart = new Chart(cv, tip, s);
    }
    var tw = el("div", "tablewrap"); tw.hidden = true; c.appendChild(tw); c._table = tw;
    c.appendChild(el("div", "meta about"));
    c.appendChild(el("div", "about", s.about));
    c.appendChild(el("div", "src", "Source: " + s.src));
    cardsEl.appendChild(c);
    tog.addEventListener("click", function () {
      if (demo.on) return;
      if (hub.isOn(s.id) || D[s.id].state === "on") { hub.stop(s.id); }
      else { var ask = /accel|linacc|gyro|orient/.test(s.id) ? hub.askMotionPermission() : Promise.resolve(); ask.then(function () { return hub.start(s.id); }).then(refreshButtons); }
      refreshButtons();
    });
    tbl.addEventListener("click", function () { tw.hidden = !tw.hidden; tbl.setAttribute("aria-pressed", String(!tw.hidden)); paintTable(s.id); });
    addExtras(s.id, extra);
  });

  function paintHead(id) {
    var d = D[id], c = cardOf(id), pill = c.querySelector(".state"), msg = c.querySelector(".msg");
    pill.textContent = { on: "on", off: "off", denied: "not allowed", unavailable: "not available", error: "error" }[d.state] || d.state;
    pill.className = "pill state" + (d.state === "on" ? " on" : d.state === "denied" || d.state === "error" ? " bad" : d.state === "unavailable" ? " warn" : "");
    msg.textContent = d.msg || ""; msg.classList.toggle("bad", d.state === "denied" || d.state === "error");
    var tog = c.querySelector(".toggle");
    tog.textContent = d.state === "on" || hub.isOn(id) ? "Stop" : "Start";
    if (id === "cam") paintCam();
  }
  function paintValues(id) {
    var d = D[id], c = cardOf(id), vs = c.querySelectorAll(".val .v"), s = d.s;
    if (d.last) d.last.forEach(function (x, i) {
      var txt;
      if (id === "battery" && i === 1) txt = x ? "yes" : "no";
      else if (id === "net" && i === 2) txt = x ? "yes" : "no";
      else if (id === "geo") txt = C.fmt(x, i < 2 ? 6 : 1);
      else if (id === "orient" && i === 0 && x != null) txt = C.fmt(x, 1) + " " + C.cardinal(x);
      else if (id === "mic" && i === 1) txt = x == null ? "–" : C.fmt(x, 0);
      else if (id === "touch") txt = C.fmt(x, i === 0 ? 0 : 2);
      else txt = C.fmt(x, s.digits);
      if (vs[i].textContent !== txt) vs[i].textContent = txt;
    });
    var r = d.rate.rate(clock());
    c.querySelector(".rate").textContent = d.state === "on" && r > 0 ? C.fmt(r, r < 10 ? 1 : 0) + " Hz" : "";
    if (!c._table.hidden) paintTable(id);
  }
  function paintTable(id) {
    var d = D[id], c = cardOf(id); if (c._table.hidden) return;
    var rows = [], n = d.buf.length;
    for (var k = n - 1; k >= 0 && rows.length < 15; k--) rows.push(d.buf.at(k));
    var h = "<table class='data'><thead><tr><th>t (s)</th>" + d.s.ch.map(function (x) { return "<th>" + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>";
    h += rows.map(function (r) { return "<tr><td>" + C.fmt(r[0] / 1000, 2) + "</td>" + r[1].map(function (x) { return "<td>" + esc(C.fmt(x, d.s.digits)) + "</td>"; }).join("") + "</tr>"; }).join("");
    c._table.innerHTML = h + "</tbody></table>" + (rows.length ? "" : "<p class='empty'>No readings yet.</p>");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }

  // ---- per-sensor extras: 3D phone, GPS track, spectrum, camera, touch pad
  var trackCv, specCv, camBox, padEl;
  function addExtras(id, box) {
    if (id === "orient") { box.innerHTML = '<div class="phone3d" aria-hidden="true"><div class="body"></div></div><div class="about">The outline turns as the phone does.</div>'; }
    if (id === "geo") {
      trackCv = el("canvas"); trackCv.width = 240; trackCv.height = 140; trackCv.setAttribute("aria-label", "Track walked, north up");
      box.appendChild(trackCv);
      var a = el("a", "osm lnk", "Open in OpenStreetMap"); a.href = "https://www.openstreetmap.org/"; a.target = "_blank"; a.rel = "noopener"; box.appendChild(a);
    }
    if (id === "mic") { specCv = el("canvas"); specCv.width = 300; specCv.height = 80; specCv.hidden = true; specCv.setAttribute("aria-label", "Sound spectrum, 50 Hz to 10 kHz"); box.appendChild(specCv); }
    if (id === "cam") {
      camBox = box;
      var tb = el("button", "btn small", "Torch"); tb.type = "button"; tb.id = "torchBtn"; tb.hidden = true; tb.setAttribute("aria-pressed", "false"); box.appendChild(tb);
      tb.addEventListener("click", function () { var on = tb.getAttribute("aria-pressed") !== "true"; hub.torch(on).then(function () { tb.setAttribute("aria-pressed", String(on)); }, function () {}); });
      var img = el("img"); img.id = "camFrame"; img.alt = "What the phone's camera sees"; img.width = 160; img.hidden = true; box.appendChild(img);
    }
    if (id === "touch") {
      padEl = el("div", "touchpad"); padEl.appendChild(el("em", "", "Touch here, with several fingers"));
      box.style.display = "block"; box.appendChild(padEl);
      var pts = {};
      var upd = function () {
        var list = Object.keys(pts).map(function (k) { return pts[k]; });
        padEl.querySelectorAll("span").forEach(function (s) { s.remove(); });
        list.forEach(function (p) { var s = el("span"); var r = Math.max(14, p.size || 0); s.style.left = (p.x * 100) + "%"; s.style.top = (p.y * 100) + "%"; s.style.width = s.style.height = (r * 1.6) + "px"; padEl.appendChild(s); });
        if (!demo.on) hub.touch(list);
      };
      var on = function (e) {
        var r = padEl.getBoundingClientRect();
        pts[e.pointerId] = { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), pressure: e.pressure, size: Math.max(e.width || 0, e.height || 0) };
        upd(); e.preventDefault();
      };
      padEl.addEventListener("pointerdown", function (e) { try { padEl.setPointerCapture(e.pointerId); } catch (x) { /* synthetic */ } on(e); });
      padEl.addEventListener("pointermove", function (e) { if (pts[e.pointerId]) on(e); });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (n) { padEl.addEventListener(n, function (e) { if (pts[e.pointerId]) { delete pts[e.pointerId]; upd(); } }); });
    }
  }
  function drawRemoteTouch(v) {
    padEl.querySelectorAll("span").forEach(function (s) { s.remove(); });
    if (v[0] > 0 && v[2] != null) { var s = el("span"); s.style.left = v[2] * 100 + "%"; s.style.top = v[3] * 100 + "%"; s.style.width = s.style.height = Math.max(22, (v[4] || 0) * 1.6) + "px"; padEl.appendChild(s); }
  }
  function drawTrack() {
    var cx = trackCv.getContext("2d"), W = trackCv.width, H = trackCv.height, pts = track.points;
    cx.clearRect(0, 0, W, H);
    if (pts.length < 1) return;
    var lat0 = pts[0][1], lon0 = pts[0][2], k = Math.cos(lat0 * Math.PI / 180);
    var xy = pts.map(function (p) { return [(p[2] - lon0) * 111320 * k, (p[1] - lat0) * 111320]; });
    var xs = xy.map(function (p) { return p[0]; }), ys = xy.map(function (p) { return p[1]; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs), miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var span = Math.max(20, maxx - minx, maxy - miny) * 1.15, sc = Math.min(W, H) / span, mx = (minx + maxx) / 2, my = (miny + maxy) / 2;
    cx.strokeStyle = COLORS[0]; cx.lineWidth = 2; cx.lineJoin = "round"; cx.beginPath();
    xy.forEach(function (p, i) { var X = W / 2 + (p[0] - mx) * sc, Y = H / 2 - (p[1] - my) * sc; if (i) cx.lineTo(X, Y); else cx.moveTo(X, Y); });
    cx.stroke();
    var lp = xy[xy.length - 1]; cx.fillStyle = COLORS[0]; cx.beginPath(); cx.arc(W / 2 + (lp[0] - mx) * sc, H / 2 - (lp[1] - my) * sc, 4, 0, 7); cx.fill();
    cx.fillStyle = COLORS.ink; cx.font = "10px IBM Plex Mono, monospace"; cx.fillText("N ↑  " + Math.round(span) + " m across", 6, 13);
  }
  function drawSpectrum() {
    if (!specCv || !hub.audio || specCv.hidden) return;
    var a = hub.audio, f = a.freq, cx = specCv.getContext("2d"), W = specCv.width, H = specCv.height, sr = a.ctx.sampleRate, n = a.analyser.fftSize;
    cx.clearRect(0, 0, W, H); cx.fillStyle = COLORS[0];
    var lo = Math.log(50), hi = Math.log(10000);
    for (var x = 0; x < W; x += 3) {
      var hz = Math.exp(lo + (hi - lo) * x / W), bin = Math.round(hz * n / sr), db = f[bin] || -140, hgt = Math.max(0, Math.min(1, (db + 100) / 80)) * H;
      cx.fillRect(x, H - hgt, 2, hgt);
    }
    cx.fillStyle = COLORS.ink; cx.font = "10px IBM Plex Mono, monospace"; cx.fillText("50 Hz", 2, 10); cx.fillText("10 kHz", W - 40, 10);
  }
  function paintCam() {
    if (!camBox) return;
    var v = hub.video, img = $("camFrame");
    if (mode === "phone" && v && v.parentNode !== camBox) { v.width = 160; v.style.width = "160px"; camBox.insertBefore(v, camBox.firstChild); }
    $("torchBtn").hidden = !(mode === "phone" && hub.hasTorch());
    img.hidden = mode !== "view" || !img.src;
  }

  // ---- charts: the last ten seconds of the plotted channels, 2px lines, a recessive grid, a hover read-out
  function Chart(cv, tip, s) {
    this.cv = cv; this.tip = tip; this.s = s; this.hx = null; var self = this;
    cv.addEventListener("pointermove", function (e) { var r = cv.getBoundingClientRect(); self.hx = e.clientX - r.left; self.dirty = true; });
    cv.addEventListener("pointerleave", function () { self.hx = null; tip.hidden = true; self.dirty = true; });
  }
  Chart.prototype.draw = function (d, now) {
    var cv = this.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var cx = cv.getContext("2d"); cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    var s = this.s, pts = d.buf.since(now - WINDOW - 500), L = 44, R = 6, T = 6, B = 16, pw = W - L - R, ph = H - T - B;
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { s.plot.forEach(function (i) { var y = p[1][i]; if (y != null && isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; } }); });
    cx.font = "10px IBM Plex Mono, monospace"; cx.fillStyle = COLORS.ink; cx.strokeStyle = COLORS.line; cx.lineWidth = 1;
    if (lo === Infinity) { cx.fillText("no readings yet", L, T + ph / 2); return; }
    var span = hi - lo, pad = Math.max(span * 0.12, Math.abs(hi) * 0.02, s.id === "geo" ? 0.5 : 0.05);
    lo -= pad; hi += pad;
    var X = function (t) { return L + pw * (1 - (now - t) / WINDOW); }, Y = function (v) { return T + ph * (hi - v) / (hi - lo); };
    // grid: three values, and zero when it is in view
    [hi - pad, (hi + lo) / 2, lo + pad].forEach(function (v) { var y = Math.round(Y(v)) + 0.5; cx.globalAlpha = 0.5; cx.beginPath(); cx.moveTo(L, y); cx.lineTo(W - R, y); cx.stroke(); cx.globalAlpha = 1; cx.fillText(axisLabel(v), 2, y + 3); });
    if (lo < 0 && hi > 0) { var y0 = Math.round(Y(0)) + 0.5; cx.beginPath(); cx.moveTo(L, y0); cx.lineTo(W - R, y0); cx.stroke(); }
    cx.fillText("−10 s", L, H - 3); cx.fillText("now", W - R - 20, H - 3);
    cx.save(); cx.beginPath(); cx.rect(L, 0, pw, H); cx.clip();
    cx.lineWidth = 2; cx.lineJoin = "round"; cx.lineCap = "round";
    s.plot.forEach(function (i, k) {
      cx.strokeStyle = COLORS[k]; cx.beginPath(); var pen = false, lt = null;
      pts.forEach(function (p) {
        var v = p[1][i]; if (v == null || !isFinite(v)) { pen = false; return; }
        if (lt != null && p[0] - lt > 1500) pen = false; // a gap in the readings is left as a gap
        if (pen) cx.lineTo(X(p[0]), Y(v)); else { cx.moveTo(X(p[0]), Y(v)); pen = true; }
        lt = p[0];
      });
      if (pts.length === 1) { cx.fillStyle = COLORS[k]; cx.fillRect(X(pts[0][0]) - 3, Y(pts[0][1][i]) - 3, 6, 6); }
      cx.stroke();
    });
    cx.restore();
    // hover: crosshair at the nearest reading, values in text ink beside their series swatch
    if (this.hx != null && this.hx >= L) {
      var tt = now - WINDOW * (1 - (this.hx - L) / pw), best = null, bd = Infinity;
      pts.forEach(function (p) { var dd = Math.abs(p[0] - tt); if (dd < bd) { bd = dd; best = p; } });
      if (best && bd < 1500) {
        var bx = Math.round(X(best[0])) + 0.5; cx.strokeStyle = COLORS.ink; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(bx, T); cx.lineTo(bx, T + ph); cx.stroke();
        s.plot.forEach(function (i, k) { var v = best[1][i]; if (v == null) return; cx.fillStyle = COLORS[k]; cx.beginPath(); cx.arc(bx, Y(v), 4, 0, 7); cx.fill(); });
        var tip = this.tip;
        tip.innerHTML = "<b>" + C.fmt((best[0] - now) / 1000, 1) + " s</b><br>" + s.plot.map(function (i, k) {
          return '<span style="display:inline-block;width:8px;height:3px;border-radius:2px;vertical-align:middle;background:' + COLORS[k] + '"></span> ' + esc(s.ch[i]) + " " + esc(C.fmt(best[1][i], s.digits));
        }).join("<br>");
        tip.hidden = false;
        var tw = tip.offsetWidth; tip.style.left = Math.min(W - tw - 4, Math.max(L, bx + 10)) + "px"; tip.style.top = "4px";
      } else this.tip.hidden = true;
    }
  };
  function axisLabel(v) { var a = Math.abs(v); return a >= 1000 ? (v / 1000).toFixed(1) + "k" : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); }

  // swatches follow the theme's series colours
  function paintSwatches() { document.querySelectorAll(".val .k i").forEach(function (i) { i.style.background = COLORS[+i.dataset.series]; }); }
  paintSwatches();

  // ---- the frame loop: charts at about 20 fps, numbers at 10
  var lastVals = 0, lastCharts = 0;
  function frame(ts) {
    var now = clock(), doVals = ts - lastVals > 100, doCharts = ts - lastCharts > 50;
    if (redrawAll) { paintSwatches(); drawTrack(); }
    if (doCharts) {
      lastCharts = ts;
      C.SENSORS.forEach(function (s) {
        var d = D[s.id], c = CARD[s.id];
        if (c._chart && !c.hidden && (d.state === "on" || d.dirty || redrawAll || c._chart.dirty) && d.buf.length) { c._chart.draw(d, now); c._chart.dirty = false; }
      });
      drawSpectrum();
    }
    if (doVals) {
      lastVals = ts;
      C.SENSORS.forEach(function (s) { var d = D[s.id]; if (d.dirty || d.state === "on") { paintValues(s.id); d.dirty = false; } });
      $("dCadence").textContent = (steps.cadence(now) ? Math.round(steps.cadence(now)) : "–") + " steps/min";
      if (rec.on) $("recPill").textContent = rec.rows.length.toLocaleString() + " readings";
    }
    redrawAll = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- local sensors
  var hub = new window.SensorHub(
    function (id, v) { feed(id, localNow(), v); },
    function (id, state, text) { setState(id, state, text); if (id === "mic" && specCv) specCv.hidden = state !== "on"; if (id === "cam") paintCam(); refreshButtons(); },
    function (id, text) { setMeta(id, text); }
  );
  var AUTO = ["accel", "linacc", "gyro", "orient", "mag", "light", "geo", "touch", "battery", "net", "screen"];
  $("startAll").addEventListener("click", function () {
    if (demo.on) stopDemo();
    hub.askMotionPermission().then(function () {
      return Promise.all(AUTO.map(function (id) { return hub.start(id); }));
    }).then(refreshButtons);
    wake.want("sensors", true);
    refreshButtons();
  });
  $("stopAll").addEventListener("click", function () { if (demo.on) stopDemo(); hub.stopAll(); wake.want("sensors", false); refreshButtons(); });
  function refreshButtons() {
    var any = demo.on || C.SENSORS.some(function (s) { return hub.isOn(s.id) || D[s.id].state === "on"; });
    $("stopAll").disabled = !any;
    C.SENSORS.forEach(function (s) { var t = CARD[s.id].querySelector(".toggle"); t.disabled = demo.on; t.textContent = hub.isOn(s.id) || (D[s.id].state === "on" && !demo.on) ? "Stop" : "Start"; });
  }

  // ---- the demo phone: motion and orientation at 60 Hz, the rest at 5 Hz, from SensorCore.simulate
  var demo = { on: false, timer: null, start: 0, k: 0 };
  function startDemo() {
    hub.stopAll(); demo.on = true; demo.start = localNow(); demo.k = 0;
    C.SENSORS.forEach(function (s) { setState(s.id, "on", "Demo phone: simulated readings."); });
    setMeta("orient", "Heading from magnetic north (demo)."); setMeta("net", "Online · wifi · 4G class (demo)"); setMeta("battery", "On battery (demo)."); setMeta("screen", "portrait primary (demo)");
    demo.timer = setInterval(function () {
      var t = localNow(), sim = C.simulate((t - demo.start) / 1000); demo.k++;
      ["accel", "linacc", "gyro", "orient"].forEach(function (id) { feed(id, t, sim[id]); });
      if (demo.k % 12 === 0) ["mag", "light", "geo", "mic", "cam", "battery", "net", "screen", "touch"].forEach(function (id) { feed(id, t, sim[id]); });
    }, 1000 / 60);
    $("demoBtn").setAttribute("aria-pressed", "true"); $("demoBtn").textContent = "Stop demo";
    refreshButtons();
  }
  function stopDemo() {
    clearInterval(demo.timer); demo.on = false;
    C.SENSORS.forEach(function (s) { setState(s.id, "off", ""); });
    $("demoBtn").setAttribute("aria-pressed", "false"); $("demoBtn").textContent = "Demo phone";
    refreshButtons();
  }
  $("demoBtn").addEventListener("click", function () { if (demo.on) stopDemo(); else startDemo(); });

  // ---- keep the screen on while sensors run or a computer is connected (the browser stops sensors when it sleeps)
  var wake = { lock: null, reasons: {}, manual: false };
  wake.want = function (why, on) {
    wake.reasons[why] = on;
    var need = wake.manual || Object.keys(wake.reasons).some(function (k) { return wake.reasons[k]; });
    if (need && !wake.lock && navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { wake.lock = l; l.addEventListener("release", function () { wake.lock = null; }); paintWake(); }, function () {});
    if (!need && wake.lock) { wake.lock.release(); wake.lock = null; }
    paintWake();
  };
  function paintWake() { $("wakeBtn").setAttribute("aria-pressed", String(!!wake.lock)); $("wakeBtn").textContent = wake.lock ? "Screen stays on" : "Keep screen on"; }
  $("wakeBtn").addEventListener("click", function () {
    if (!navigator.wakeLock) { $("toolsMsg").textContent = "This browser cannot keep the screen on."; return; }
    wake.manual = !wake.manual; wake.want("manual", wake.manual);
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") wake.want("again", false); });

  // ---- recording
  function stamp() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  function download(name, text, type) {
    var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], { type: type }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  $("recBtn").addEventListener("click", function () {
    rec.on = !rec.on;
    if (rec.on) { rec.rows = []; rec.started = new Date().toISOString(); }
    $("recBtn").setAttribute("aria-pressed", String(rec.on)); $("recBtn").textContent = rec.on ? "■ Stop" : "● Record";
    $("recPill").textContent = rec.rows.length.toLocaleString() + " readings" + (rec.on ? "" : " recorded");
    $("csvBtn").disabled = $("jsonBtn").disabled = rec.on || !rec.rows.length;
    wake.want("rec", rec.on);
  });
  $("csvBtn").addEventListener("click", function () { download("sensor-deck-" + stamp() + ".csv", C.toCSV(rec.rows), "text/csv"); });
  $("legendBtn").addEventListener("click", function () { download("sensor-deck-columns.csv", C.csvLegend(), "text/csv"); });
  $("jsonBtn").addEventListener("click", function () {
    download("sensor-deck-" + stamp() + ".json", JSON.stringify({
      app: "Sensor Deck", version: VERSION, started: rec.started, device: lastInfo, timeUnit: "ms",
      sensors: C.SENSORS.map(function (s) { return { id: s.id, name: s.name, unit: s.unit, channels: s.ch, source: s.src }; }),
      samples: rec.rows
    }), "application/json");
  });

  // ---- phone side of the link: connect to a waiting computer by its code and stream in batches
  var link = { peer: null, conn: null, open: false, batcher: null, timer: null, frameTimer: null };
  link.send = function (m) { if (link.conn && link.open) { try { link.conn.send(m); } catch (e) { /* closing */ } } };
  function linkPill(text, cls) { var p = $("linkPill"); p.textContent = text; p.className = "pill" + (cls ? " " + cls : ""); }
  function connect(raw) {
    var code = C.normaliseCode(raw);
    if (!C.validCode(code)) { linkPill("A code is six letters and digits", "bad"); return; }
    if (typeof window.Peer !== "function") { linkPill("The pairing library did not load", "bad"); return; }
    disconnect(true);
    linkPill("Connecting to " + code + "…", "warn");
    var peer = new window.Peer({ debug: 0 }); link.peer = peer;
    var giveUp = setTimeout(function () { if (!link.open) { linkPill("No answer from " + code + ". Is the computer view open?", "bad"); disconnect(true); } }, 20000);
    peer.on("open", function () {
      var conn = peer.connect(C.PEER_PREFIX + code, { serialization: "json", reliable: true }); link.conn = conn;
      conn.on("open", function () {
        clearTimeout(giveUp); link.open = true; link.batcher = new C.Batcher(50, 60);
        linkPill("Streaming to the computer", "on"); $("connectBtn").textContent = "Disconnect";
        sendHello(); wake.want("link", true);
        link.timer = setInterval(function () { var m = link.batcher.take(performance.now()); if (m) link.send(m); }, 50);
        link.frameTimer = setInterval(function () { if (hub.video) { var f = hub.frame(160, 0.5); if (f) link.send({ type: "frame", jpeg: f }); } }, 500);
      });
      conn.on("data", function (raw) {
        var m = C.checkMessage(raw); if (!m) return;
        if (m.type === "ping") link.send({ type: "pong", n: m.n, t: m.t });
        if (m.type === "cmd" && m.name === "vibrate" && navigator.vibrate) navigator.vibrate([150, 80, 150]);
      });
      conn.on("close", function () { if (link.open) linkPill("The computer closed the connection"); disconnect(false); });
      conn.on("error", function (e) { linkPill("Connection error: " + (e && e.message || e), "bad"); });
    });
    peer.on("error", function (e) {
      clearTimeout(giveUp);
      var t = e.type === "peer-unavailable" ? "No computer is waiting with code " + code
        : /network|server-error|socket/.test(e.type) ? "Cannot reach the pairing service. Check the connection." : (e.message || String(e));
      linkPill(t, "bad"); disconnect(false);
    });
  }
  function sendHello() {
    window.SensorHub.deviceInfo().then(function (info) {
      link.send({ type: "hello", protocol: C.PROTOCOL, info: info, sensors: C.SENSORS.filter(function (s) { return D[s.id].state === "on"; }).map(function (s) { return s.id; }) });
      C.SENSORS.forEach(function (s) { var d = D[s.id]; if (d.state !== "off") link.send({ type: "status", id: s.id, state: d.state, text: d.msg }); if (d.meta) link.send({ type: "meta", id: s.id, text: d.meta }); });
    });
  }
  function disconnect(quiet) {
    clearInterval(link.timer); clearInterval(link.frameTimer);
    if (link.open && quiet) link.send({ type: "bye" });
    try { if (link.conn) link.conn.close(); } catch (e) { /* gone */ }
    try { if (link.peer) link.peer.destroy(); } catch (e) { /* gone */ }
    link.peer = null; link.conn = null; link.open = false; $("connectBtn").textContent = "Connect";
    wake.want("link", false);
    if (quiet) linkPill("Not connected");
  }
  $("connectBtn").addEventListener("click", function () { if (link.peer) { disconnect(true); } else connect($("codeIn").value); });
  $("codeIn").addEventListener("keydown", function (e) { if (e.key === "Enter") connect($("codeIn").value); });

  // ---- computer side: wait under a fresh code, show it as a QR code, draw whatever the phone sends
  var view = { peer: null, conn: null, code: null, ping: null, n: 0 };
  function viewPill(text, cls) { var p = $("viewPill"); p.textContent = text; p.className = "pill" + (cls ? " " + cls : ""); }
  function startViewer() {
    stopViewer();
    if (typeof window.Peer !== "function") { viewPill("The pairing library did not load", "bad"); return; }
    var code = C.pairCode(); view.code = code;
    $("pairCode").textContent = "······"; viewPill("Getting a code…", "warn");
    var peer = new window.Peer(C.PEER_PREFIX + code, { debug: 0 }); view.peer = peer;
    peer.on("open", function () {
      $("pairCode").textContent = code;
      var url = location.origin + location.pathname + "?connect=" + code;
      $("pairUrl").textContent = url;
      $("qr").textContent = "";
      if (window.QRCode) new window.QRCode($("qr"), { text: url, width: 180, height: 180, colorDark: "#0a2f52", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
      viewPill("Waiting for a phone");
    });
    peer.on("connection", function (conn) {
      if (view.conn) { try { view.conn.close(); } catch (e) { /* replaced */ } }
      view.conn = conn;
      conn.on("open", function () {
        viewPill("Phone connected", "on"); $("buzzBtn").hidden = false;
        clearInterval(view.ping);
        view.ping = setInterval(function () { try { conn.send({ type: "ping", n: ++view.n, t: performance.now() }); } catch (e) { /* closing */ } }, 2000);
      });
      conn.on("data", onRemote);
      conn.on("close", function () { if (view.conn === conn) { phoneGone(); $("buzzBtn").hidden = true; $("rttPill").hidden = true; clearInterval(view.ping); view.conn = null; } });
    });
    peer.on("error", function (e) {
      if (e.type === "unavailable-id") { startViewer(); return; }
      viewPill(/network|server-error|socket/.test(e.type) ? "Cannot reach the pairing service. Check the connection." : (e.message || String(e)), "bad");
    });
    peer.on("disconnected", function () { if (view.peer === peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) { /* gone */ } } });
  }
  function stopViewer() {
    clearInterval(view.ping);
    try { if (view.conn) view.conn.close(); } catch (e) { /* gone */ }
    try { if (view.peer) view.peer.destroy(); } catch (e) { /* gone */ }
    view.peer = null; view.conn = null; $("buzzBtn").hidden = true; $("rttPill").hidden = true;
  }
  var lastInfo = null;
  function onRemote(raw) {
    var m = C.checkMessage(raw); if (!m) return;
    if (m.type === "hello") { clearDeck(); lastInfo = m.info; showInfo(m.info); remoteOffset = null; return; }
    if (m.type === "batch") {
      var pn = performance.now();
      m.items.forEach(function (it) { var off = pn - it[0]; if (remoteOffset == null || off < remoteOffset) remoteOffset = off; feed(it[1], it[0], it[2]); });
      return;
    }
    if (m.type === "status") { setState(m.id, m.state, m.text); if (m.state !== "off") { cardOf(m.id).hidden = false; $("viewEmpty").hidden = true; } return; }
    if (m.type === "meta") { setMeta(m.id, m.text); return; }
    if (m.type === "frame") { var img = $("camFrame"); img.src = m.jpeg; img.hidden = false; return; }
    if (m.type === "pong") { var p = $("rttPill"); p.hidden = false; p.textContent = "round trip " + Math.round(performance.now() - m.t) + " ms"; return; }
    if (m.type === "bye") phoneGone();
  }
  // the readings stay on screen, but nothing is live any more
  function phoneGone() {
    viewPill("The phone disconnected. Waiting for a phone");
    C.SENSORS.forEach(function (s) { if (D[s.id].state !== "off") setState(s.id, "off", "The phone disconnected."); });
  }
  $("buzzBtn").addEventListener("click", function () { if (view.conn) view.conn.send({ type: "cmd", name: "vibrate" }); });
  $("demoTab").addEventListener("click", function () {
    if (!view.code) return;
    window.open(location.pathname + "?connect=" + view.code + "&demo=1", "_blank", "noopener");
  });

  // ---- modes
  function clearDeck() {
    C.SENSORS.forEach(function (s) { var d = D[s.id]; d.buf.clear(); d.rate = new C.RateMeter(2000); d.last = null; d.state = "off"; d.msg = ""; d.meta = ""; d.dirty = true; paintHead(s.id);
      CARD[s.id].querySelectorAll(".val .v").forEach(function (v) { v.textContent = "–"; }); CARD[s.id].querySelector(".meta").textContent = ""; });
    resetDerived(); redrawAll = true;
  }
  function setMode(m) {
    if (m === mode && document.body.dataset.mode) return;
    mode = m; document.body.dataset.mode = m;
    $("tabPhone").setAttribute("aria-selected", String(m === "phone")); $("tabView").setAttribute("aria-selected", String(m === "view"));
    $("phoneView").hidden = m !== "phone"; $("viewView").hidden = m !== "view";
    toolsCard.hidden = m !== "phone";
    document.querySelectorAll(".card .toggle").forEach(function (b) { b.hidden = m !== "phone"; });
    if (m === "view") {
      if (demo.on) stopDemo(); hub.stopAll(); disconnect(true); clearDeck();
      C.SENSORS.forEach(function (s) { CARD[s.id].hidden = true; });
      $("viewEmpty").hidden = false; showInfo({ "Phone": "not connected yet" }); lastInfo = null;
      startViewer();
    } else {
      stopViewer(); clearDeck(); remoteOffset = null;
      C.SENSORS.forEach(function (s) { CARD[s.id].hidden = false; });
      $("viewEmpty").hidden = true;
      window.SensorHub.deviceInfo().then(function (i) { lastInfo = i; showInfo(i); });
    }
    paintCam();
  }
  $("tabPhone").addEventListener("click", function () { setMode("phone"); });
  $("tabView").addEventListener("click", function () { setMode("view"); });

  // ---- start: ?connect=CODE pairs this phone at once; ?demo=1 plays the demo phone; ?mode=view opens the computer
  // view. Without either, a device with no touch screen opens the computer view.
  var looksDesktop = !(navigator.maxTouchPoints > 0) && !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  var startMode = PARAMS.has("connect") || PARAMS.get("mode") === "phone" || PARAMS.has("demo") ? "phone" : PARAMS.get("mode") === "view" || looksDesktop ? "view" : "phone";
  setMode(startMode);
  if (PARAMS.has("demo")) startDemo();
  if (PARAMS.has("connect")) { $("codeIn").value = C.normaliseCode(PARAMS.get("connect")); connect($("codeIn").value); }
  refreshButtons();

  window.sensorDeck = { version: VERSION, D: D, feed: feed, hub: hub, link: link, view: view, rec: rec, steps: steps, track: track, setMode: setMode, startDemo: startDemo, stopDemo: stopDemo, mode: function () { return mode; } };
})();
