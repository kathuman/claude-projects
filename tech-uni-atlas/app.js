// Tech University Atlas — the technical universities in the QS World University Rankings 2027 on a 3D globe and a 2D
// Equal Earth map, filtered by rank tier, inclusion basis, country and name. Data in data/; theme tokens in style.css.
(function () {
  const VERSION = "1.0.1";   // also the ?v= on every local file in index.html and about.html (tests/release.test.js)
  const $ = id => document.getElementById(id);
  $("ver").textContent = "v" + VERSION;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const FEATURES = (typeof COUNTRIES_GEOJSON !== "undefined" && COUNTRIES_GEOJSON.features) || [];

  // ---------- tiers ----------
  const TIERS = [
    { id: 1, label: "Top 100", max: 100, tok: "--t1" },
    { id: 2, label: "101–300", max: 300, tok: "--t2" },
    { id: 3, label: "301–600", max: 600, tok: "--t3" },
    { id: 4, label: "601–1000", max: 1000, tok: "--t4" },
    { id: 5, label: "1001+", max: 1e9, tok: "--t5" }
  ];
  UNIS.forEach(u => {
    const m = String(u.rank).match(/(\d+)/); u.r = m ? +m[1] : 1500;
    u.tier = TIERS.find(t => u.r <= t.max).id;
  });
  const color = u => css(TIERS[u.tier - 1].tok);
  const state = { view: "3d", tiers: new Set([1, 2, 3, 4, 5]), match: "all", country: "", q: "", sel: null };
  try { const v = localStorage.getItem("tua-view"); if (v === "2d" || v === "3d") state.view = v; } catch (e) {}

  // ---------- sidebar ----------
  $("total").textContent = UNIS.length;
  const countries = [...new Set(UNIS.map(u => u.country))].sort();
  countries.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = `${c} (${UNIS.filter(u => u.country === c).length})`; $("f-country").appendChild(o); });
  TIERS.forEach(t => {
    const lab = document.createElement("label"); lab.className = "tier"; lab.htmlFor = "tier-" + t.id;
    lab.innerHTML = `<input type="checkbox" id="tier-${t.id}" checked><span><span class="sw" style="background:var(${t.tok})"></span>${t.label}</span><span class="n" id="tn-${t.id}"></span>`;
    $("tiers").appendChild(lab);
    lab.querySelector("input").addEventListener("change", e => { e.target.checked ? state.tiers.add(t.id) : state.tiers.delete(t.id); update(); });
  });
  $("f-match").addEventListener("change", e => { state.match = e.target.value; update(); });
  $("f-country").addEventListener("change", e => { state.country = e.target.value; update(); if (state.country) focusCountry(); });
  $("f-q").addEventListener("input", e => { state.q = e.target.value.trim().toLowerCase(); update(); });

  const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function filtered() {
    return UNIS.filter(u => state.tiers.has(u.tier)
      && (state.match === "all" || u.match === state.match)
      && (!state.country || u.country === state.country)
      && (!state.q || fold(u.name + " " + u.country).includes(fold(state.q))));
  }
  function preTier() {
    return UNIS.filter(u => (state.match === "all" || u.match === state.match) && (!state.country || u.country === state.country)
      && (!state.q || fold(u.name + " " + u.country).includes(fold(state.q))));
  }

  function renderList(rows) {
    const ul = $("list"); ul.innerHTML = "";
    rows.forEach(u => {
      const li = document.createElement("li"); li.tabIndex = 0; if (state.sel === u) li.className = "sel";
      li.innerHTML = `<span class="rk"><span class="dot ${u.match}" style="background:${color(u)}"></span>${u.rank}</span>
        <span class="nm">${u.name}<span class="ct">${u.country}${u.prec === "City" ? " · city-level" : ""}</span></span>`;
      const go = () => select(u, true);
      li.addEventListener("click", go); li.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      ul.appendChild(li);
    });
    $("list-n").textContent = rows.length;
  }

  // ---------- 3D globe ----------
  let world = null;
  function landTexture() {
    const W = 2048, H = 1024, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = css("--ocean"); g.fillRect(0, 0, W, H);
    g.strokeStyle = css("--grat"); g.lineWidth = 1;
    for (let lo = -180; lo <= 180; lo += 30) { const x = (lo + 180) / 360 * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let la = -60; la <= 60; la += 30) { const y = (90 - la) / 180 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = css("--land"); g.strokeStyle = css("--land-edge"); g.lineWidth = 1.1;
    FEATURES.forEach(f => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => {
        g.beginPath();
        poly.forEach(ring => { let prevX = null; ring.forEach(([lo, la], i) => { const x = (lo + 180) / 360 * W, y = (90 - la) / 180 * H; if (i === 0 || (prevX !== null && Math.abs(x - prevX) > W / 2)) g.moveTo(x, y); else g.lineTo(x, y); prevX = x; }); g.closePath(); });
        g.fill("evenodd"); g.stroke();
      });
    });
    return c.toDataURL("image/png");
  }
  function initGlobe() {
    if (typeof Globe === "undefined") { $("loading").textContent = "3D view unavailable: the globe library did not load. Use the 2D map."; return; }
    const el = $("globe");
    world = Globe()(el)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl(landTexture())
      .showAtmosphere(true).atmosphereColor(css("--accent")).atmosphereAltitude(0.16)
      .pointLat("lat").pointLng("lng")
      .pointColor(u => color(u))
      .pointAltitude(u => 0.012 + 0.16 * Math.pow(1 - Math.min(u.r, 1500) / 1500, 2.2))
      .pointRadius(u => u === state.sel ? 0.55 : 0.32)
      .pointResolution(10)
      .pointLabel(u => tipHTML(u))
      .onPointClick(u => select(u, false))
      .ringsData([]).ringLat("lat").ringLng("lng").ringColor(() => t => `rgba(${hexRgb(css("--tec-ring"))},${1 - t})`)
      .ringMaxRadius(1.1).ringPropagationSpeed(0.9).ringRepeatPeriod(1600)
      .width(el.clientWidth).height(el.clientHeight);
    world.controls().autoRotate = true; world.controls().autoRotateSpeed = 0.35;
    world.pointOfView({ lat: 30, lng: 15, altitude: 2.3 });
    $("loading").hidden = true;
  }
  function hexRgb(h) { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); return `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`; }

  // ---------- 2D Equal Earth map ----------
  const cv = $("map2d"), ctx = cv.getContext("2d");
  const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
  function ee(lng, lat) {
    const lam = lng * Math.PI / 180, phi = lat * Math.PI / 180;
    const l = Math.asin(M * Math.sin(phi)), l2 = l * l, l6 = l2 * l2 * l2;
    return [(lam * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))), l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2))];
  }
  const XMAX = ee(180, 0)[0], YMAX = ee(0, 90)[1];
  const view2d = { k: 1, x: 0, y: 0 };
  let base = 1, cx = 0, cy = 0, dpr = 1, landCache = null, pts2d = [];
  function fit() {
    const r = $("stage").getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    base = Math.min(cv.width / (2 * XMAX), cv.height / (2 * YMAX)) * 0.94; cx = cv.width / 2; cy = cv.height / 2;
    landCache = null;
  }
  const P = (lng, lat) => { const [x, y] = ee(lng, lat); return [cx + (x * base) * view2d.k + view2d.x * dpr, cy - (y * base) * view2d.k + view2d.y * dpr]; };
  function drawLand(g) {
    // outline of the projected globe
    g.beginPath();
    for (let la = -90; la <= 90; la += 2) { const [x, y] = P(-180, la); la === -90 ? g.moveTo(x, y) : g.lineTo(x, y); }
    for (let la = 90; la >= -90; la -= 2) { const [x, y] = P(180, la); g.lineTo(x, y); }
    g.closePath(); g.fillStyle = css("--ocean"); g.fill(); g.strokeStyle = css("--panel-border"); g.lineWidth = dpr; g.stroke();
    g.save(); g.clip();
    g.strokeStyle = css("--grat"); g.lineWidth = dpr;
    for (let lo = -180; lo <= 180; lo += 30) { g.beginPath(); for (let la = -90; la <= 90; la += 3) { const [x, y] = P(lo, la); la === -90 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    for (let la = -60; la <= 60; la += 30) { g.beginPath(); for (let lo = -180; lo <= 180; lo += 3) { const [x, y] = P(lo, la); lo === -180 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    g.fillStyle = css("--land"); g.strokeStyle = css("--land-edge"); g.lineWidth = 0.8 * dpr;
    FEATURES.forEach(f => {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => { g.beginPath(); poly.forEach(ring => { let px = null; ring.forEach(([lo, la], i) => { const [x, y] = P(lo, la); if (i === 0 || Math.abs(x - px) > cv.width / 3 * view2d.k) g.moveTo(x, y); else g.lineTo(x, y); px = x; }); g.closePath(); }); g.fill("evenodd"); g.stroke(); });
    });
    g.restore();
  }
  function draw2D() {
    if (state.view !== "2d") return;
    if (!landCache) { landCache = document.createElement("canvas"); landCache.width = cv.width; landCache.height = cv.height; drawLand(landCache.getContext("2d")); }
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(landCache, 0, 0);
    const rows = filtered().slice().sort((a, b) => b.r - a.r); // best ranked drawn last, on top
    pts2d = [];
    const rad = Math.max(3, Math.min(7, 3.2 * Math.sqrt(view2d.k))) * dpr;
    rows.forEach(u => {
      const [x, y] = P(u.lng, u.lat); pts2d.push({ u, x, y });
      const r = u === state.sel ? rad * 1.7 : rad;
      ctx.beginPath(); if (u.match === "status") ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8); else ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = color(u); ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = (u.match === "tec" ? 2 : 0.8) * dpr; ctx.strokeStyle = u.match === "tec" ? css("--tec-ring") : css("--dot-edge"); ctx.stroke();
    });
    if (state.sel && rows.includes(state.sel)) {
      const [x, y] = P(state.sel.lng, state.sel.lat);
      ctx.font = `600 ${12 * dpr}px ${css("--font")}`; const txt = state.sel.name.replace(/\s*\(.*?\)\s*/g, " ").trim();
      const w = ctx.measureText(txt).width + 12 * dpr; let tx = x + 10 * dpr, ty = y - 26 * dpr; if (tx + w > cv.width) tx = x - w - 10 * dpr;
      ctx.fillStyle = css("--float-bg"); ctx.strokeStyle = css("--panel-border"); ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(tx, ty, w, 20 * dpr, 4 * dpr) : ctx.rect(tx, ty, w, 20 * dpr); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css("--text"); ctx.fillText(txt, tx + 6 * dpr, ty + 14 * dpr);
    }
  }
  function pick(ev) {
    const r = cv.getBoundingClientRect(), mx = (ev.clientX - r.left) * dpr, my = (ev.clientY - r.top) * dpr;
    let best = null, bd = (9 * dpr) ** 2;
    for (let i = pts2d.length - 1; i >= 0; i--) { const p = pts2d[i], d = (p.x - mx) ** 2 + (p.y - my) ** 2; if (d < bd) { bd = d; best = p.u; } }
    return best;
  }
  // pan & zoom
  let drag = null, moved = false;
  cv.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, vx: view2d.x, vy: view2d.y }; moved = false; cv.setPointerCapture(e.pointerId); cv.classList.add("drag"); });
  cv.addEventListener("pointermove", e => {
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; view2d.x = drag.vx + dx; view2d.y = drag.vy + dy; landCache = null; draw2D(); $("tip").hidden = true; return; }
    const u = pick(e); cv.style.cursor = u ? "pointer" : "grab";
    if (u) showTip(u, e); else $("tip").hidden = true;
  });
  cv.addEventListener("pointerup", e => { cv.classList.remove("drag"); if (!moved) { const u = pick(e); if (u) select(u, false); } drag = null; });
  cv.addEventListener("pointerleave", () => { $("tip").hidden = true; });
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    const k0 = view2d.k, k1 = Math.max(1, Math.min(14, k0 * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    view2d.x = mx - (mx - view2d.x) * k1 / k0; view2d.y = my - (my - view2d.y) * k1 / k0; view2d.k = k1;
    if (k1 === 1) { view2d.x = 0; view2d.y = 0; }
    landCache = null; draw2D();
  }, { passive: false });
  function zoom2DTo(u, k) {
    const [x, y] = ee(u.lng, u.lat); view2d.k = k;
    view2d.x = -(x * base * k) / dpr; view2d.y = (y * base * k) / dpr; landCache = null; draw2D();
  }

  // ---------- tooltip ----------
  function tipHTML(u) {
    return `<div style="font-family:${css("--font")};font-size:12px;background:${css("--float-bg")};color:${css("--text")};border:1px solid ${css("--panel-border")};border-radius:8px;padding:8px 10px;max-width:280px">
      <div style="font-weight:600;margin-bottom:3px">${u.name}</div>
      <div style="color:${css("--text-dim")}">${u.country} · QS 2027 rank ${u.rank}</div>
      <div style="color:${css("--text-dim")};font-family:${css("--mono")};font-size:11px">${u.lat.toFixed(4)}, ${u.lng.toFixed(4)} · ${u.prec === "City" ? "city-level" : "campus"} · ${u.basis}</div></div>`;
  }
  function showTip(u, e) {
    const t = $("tip"), r = $("stage").getBoundingClientRect();
    t.innerHTML = `<div class="t">${u.name}</div><div>${u.country} · QS 2027 rank ${u.rank}</div><div class="m">${u.lat.toFixed(4)}, ${u.lng.toFixed(4)} · ${u.prec === "City" ? "city-level" : "campus"} · ${u.basis}</div>`;
    t.hidden = false;
    let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + 290 > r.width) x = e.clientX - r.left - 290; if (y + 90 > r.height) y = e.clientY - r.top - 90;
    t.style.left = Math.max(6, x) + "px"; t.style.top = Math.max(6, y) + "px";
  }

  // ---------- selection & view ----------
  function select(u, fly) {
    state.sel = u;
    if (world) {
      world.pointsData(filtered()); world.ringsData([u]);
      if (state.view === "3d") { world.controls().autoRotate = false; setSpin(false); world.pointOfView({ lat: u.lat, lng: u.lng, altitude: 0.9 }, 1100); }
    }
    if (state.view === "2d" && fly) zoom2DTo(u, 4);
    $("caption").textContent = `${u.name} · ${u.country} · QS 2027 rank ${u.rank}`;
    renderList(filtered()); draw2D();
    const li = $("list").querySelector("li.sel"); if (li && !fly) li.scrollIntoView({ block: "nearest" });
  }
  function focusCountry() {
    const rows = filtered(); if (!rows.length) return;
    const lat = rows.reduce((s, u) => s + u.lat, 0) / rows.length, lng = rows.reduce((s, u) => s + u.lng, 0) / rows.length;
    if (state.view === "3d" && world) { setSpin(false); world.pointOfView({ lat, lng, altitude: 1.4 }, 1000); }
    else zoom2DTo({ lat, lng }, 3);
  }
  let spinning = true;
  function setSpin(on) { spinning = on; if (world) world.controls().autoRotate = on && state.view === "3d"; $("b-spin").textContent = on ? "Pause spin" : "Resume spin"; $("b-spin").setAttribute("aria-pressed", on); }
  $("b-spin").addEventListener("click", () => setSpin(!spinning));
  $("b-reset").addEventListener("click", () => {
    state.sel = null; if (world) { world.ringsData([]); world.pointOfView({ lat: 30, lng: 15, altitude: 2.3 }, 900); }
    view2d.k = 1; view2d.x = 0; view2d.y = 0; landCache = null;
    $("caption").textContent = state.view === "3d" ? "Drag to rotate · scroll to zoom · click a point for details" : "Drag to pan · scroll to zoom · click a point for details";
    update();
  });
  function setView(v) {
    state.view = v; try { localStorage.setItem("tua-view", v); } catch (e) {}
    $("v3d").setAttribute("aria-pressed", v === "3d"); $("v2d").setAttribute("aria-pressed", v === "2d");
    $("globe").hidden = v !== "3d"; cv.hidden = v !== "2d"; $("tip").hidden = true;
    $("b-spin").hidden = v !== "3d";
    if (world) world.controls().autoRotate = spinning && v === "3d";
    if (!state.sel) $("caption").textContent = v === "3d" ? "Drag to rotate · scroll to zoom · click a point for details" : "Drag to pan · scroll to zoom · click a point for details";
    if (v === "2d") { fit(); draw2D(); }
  }
  $("v3d").addEventListener("click", () => setView("3d"));
  $("v2d").addEventListener("click", () => setView("2d"));

  function update() {
    const rows = filtered();
    if (state.sel && !rows.includes(state.sel)) { state.sel = null; if (world) world.ringsData([]); }
    $("shown").textContent = rows.length;
    $("s-n").textContent = rows.length;
    $("s-c").textContent = new Set(rows.map(u => u.country)).size;
    $("s-top").textContent = rows.filter(u => u.r <= 300).length;
    const pre = preTier(); TIERS.forEach(t => $("tn-" + t.id).textContent = pre.filter(u => u.tier === t.id).length);
    renderList(rows);
    if (world) world.pointsData(rows);
    draw2D();
  }

  function resize() {
    const s = $("stage"); if (world) world.width(s.clientWidth).height(s.clientHeight);
    if (state.view === "2d") { fit(); draw2D(); }
  }
  window.addEventListener("resize", resize);
  // theme: dark blueprint by default, like the AI Projects page; the button switches to blueprint paper and back,
  // and the change rebuilds the globe texture and every colour
  const retheme = () => { if (world) world.globeImageUrl(landTexture()).atmosphereColor(css("--accent")).pointColor(u => color(u)); landCache = null; update(); };
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  $("b-theme").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("tua-theme", next); } catch (e) { /* not remembered */ }
    $("b-theme").setAttribute("aria-label", next === "light" ? "Switch to dark theme" : "Switch to light theme");
  });

  initGlobe();
  setView(state.view);
  if (!world) { $("loading").hidden = state.view === "2d"; }
  update();
})();
