/*
 * app.js — the page: loads the ROM the user supplies (kept in this browser's
 * IndexedDB, never uploaded), keeps the calculator between visits, runs the
 * machine in step with real time, draws the display and annunciators, turns
 * clicks, touches and computer keys into key presses, and types programs.
 */
(function () {
  "use strict";
  const { Machine, Keys, RomFile, Typer, Stack, SCM } = window.HP48;
  const I = window.ESi18n || { T: (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m)), locale: "en-US" };
  const T = I.T;
  const VERSION = "0.5.0";
  const CLOCK = Machine.CLOCK;
  const $ = (id) => document.getElementById(id);
  const say = (id, text, kind) => { const el = $(id); el.textContent = text; el.classList.toggle("err", kind === "err"); el.classList.toggle("ok", kind === "ok"); };

  // ------------------------------------------------------------ storage (this browser only)
  const DB = "hp48-emulator", STORE = "files";
  function db() {
    return new Promise((ok, fail) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    });
  }
  async function dbOp(mode, fn) {
    const d = await db();
    return new Promise((ok, fail) => {
      const tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(req && req.result); tx.onerror = () => fail(tx.error);
    });
  }
  const put = (k, v) => dbOp("readwrite", (s) => s.put(v, k)).catch(() => {});
  const get = (k) => dbOp("readonly", (s) => s.get(k)).catch(() => null);
  const del = (k) => dbOp("readwrite", (s) => s.delete(k)).catch(() => {});

  // ------------------------------------------------------------ state
  let rom = null, m = null, pad = null, running = false, speed = 1, error = null, typist = null;
  const ENABLE = ["btnPause", "btnReset", "btnForget", "btnSave", "btnOpen", "btnType", "btnInstall", "btnCopy", "btnCsv"];

  // a machine for this ROM: carried on from the snapshot kept in this browser, if there is one
  async function start(bytes, fresh) {
    rom = bytes; m = new Machine(bytes); pad = new Keys.Keypad(m); error = null; running = true; typist = null; job = null;
    let resumed = false;
    if (!fresh) {
      const kept = await get("state");
      if (kept && kept.snapshot && kept.snapshot.rom === m.romId()) {
        try { m.restore(kept.snapshot); m.elapse((Date.now() - kept.savedAt) / 1000); resumed = true; }
        catch (e) { m = new Machine(bytes); pad = new Keys.Keypad(m); }
      }
    }
    $("norom").hidden = true;
    ENABLE.forEach((id) => { $(id).disabled = false; });
    $("btnPause").textContent = T("Pause");
    say("memStatus", resumed ? T("Carried on from your last visit.") : "");
    lastSave = performance.now();
    status();
  }
  async function acceptRom(buf, remember) {
    const r = RomFile.load(new Uint8Array(buf));
    if (r.error) { say("romStatus", T(r.errorKey, r.vars), "err"); return; }
    say("romStatus", T("48GX ROM, revision {r}, kept in this browser.", { r: r.revision }));
    if (remember) await put("rom", r.bytes);
    await start(r.bytes, false);
  }

  // keeping the calculator: every few seconds while it runs, and when the page is hidden or closed
  let lastSave = 0;
  function save() {
    if (!m || error) return;
    put("state", { snapshot: m.snapshot(), savedAt: Date.now() });
    lastSave = performance.now();
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });
  window.addEventListener("pagehide", save);

  // ------------------------------------------------------------ the display
  const lcd = $("lcd"), g = lcd.getContext("2d"), img = g.createImageData(131, 64);
  const annun = Array.from($("annun").children);
  const LCD_BG = [0xb9, 0xc9, 0xb2], LCD_INK = [0x17, 0x24, 0x1c];
  let lastFrame = "";
  function blank() { g.fillStyle = "rgb(185,201,178)"; g.fillRect(0, 0, 131, 64); lastFrame = ""; annun.forEach((s) => s.classList.remove("on")); }
  function draw() {
    if (!m) return;
    const d = m.display();
    const rows = d.on ? m.pixels() : null;
    // contrast: the ROM's default is about 9–14; darker as it rises
    const a = Math.max(0.15, Math.min(1, (d.contrast - 2) / 12));
    const ink = LCD_INK.map((c, i) => Math.round(LCD_BG[i] + (c - LCD_BG[i]) * a));
    let key = d.on + ":" + d.contrast;
    if (rows) for (let y = 0; y < 64; y++) key += rows[y].join("");
    if (key !== lastFrame) {
      lastFrame = key;
      const p = img.data;
      for (let y = 0, i = 0; y < 64; y++) for (let x = 0; x < 131; x++, i += 4) {
        const c = rows && rows[y][x] ? ink : LCD_BG;
        p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (!job) showStack();
    }
    const ann = d.annunciators, enabled = !!(ann & 0x80);
    annun.forEach((s) => s.classList.toggle("on", enabled && !!(ann & (1 << +s.dataset.bit))));
  }

  // ------------------------------------------------------------ running in step with real time
  let last = performance.now(), slowFrames = 0;
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    if (m && running && !error) {
      try {
        if (job) {
          // typing runs as fast as the device allows
          const until = performance.now() + 14;
          while (job && performance.now() < until) {
            if (typist) { if (typist.advance(CLOCK / 200)) nextLine(); }
            else { m.run(CLOCK / 200); if (m.time >= job.waitUntil && m.cpu.shutdown) { endTyping(true); break; } }
          }
          if (job) say(job.opts.status, T("Typing… {p}%", { p: progress() }));
        } else if (speed > 0) {
          let cycles = dt / 1000 * CLOCK * speed;
          while (cycles > 0) { const c = Math.min(cycles, CLOCK / 500); m.run(c); pad.update(); cycles -= c; }
        } else {
          const until = performance.now() + 12;
          while (performance.now() < until) { m.run(CLOCK / 500); pad.update(); }
        }
        const took = performance.now() - now;
        slowFrames = took > dt && speed > 0 && !job ? slowFrames + 1 : 0;
        if (performance.now() - lastSave > 5000) save();
      } catch (e) {
        error = e.message; running = false; typist = null; job = null; status();
      }
    }
    draw();
    if (slowFrames === 30) status();
    requestAnimationFrame(frame);
  }
  function status() {
    if (error) say("runStatus", T("Stopped: {e}. Restart to try again.", { e: error }), "err");
    else if (!m) say("runStatus", "");
    else if (!running) say("runStatus", T("Paused."));
    else if (slowFrames >= 30) say("runStatus", T("This device can't keep up with real speed."));
    else say("runStatus", speed === 1 ? T("Running at the 48GX's speed (3.69 MHz).") : speed > 1 ? T("Running at {s}× speed.", { s: speed }) : T("Running as fast as this device can."));
  }

  // ------------------------------------------------------------ the keyboard
  const keyEls = {};
  function buildKeys() {
    const box = $("keys");
    Keys.ROWS.forEach((row, r) => {
      const div = document.createElement("div");
      div.className = "krow " + (row.length === 6 || row.some((k) => k.id === "ENTER") ? "k6" : "k5") + (r === 0 ? " menu" : "");
      row.forEach((k) => {
        const el = document.createElement("div");
        el.className = "key" + (k.id === "ENTER" ? " wide" : "");
        el.dataset.id = k.id;
        const label = k.main || "";
        const title = [label || T("menu key {k}", { k: k.id }), k.ls && T("left shift: {f}", { f: k.ls }), k.rs && T("right shift: {f}", { f: k.rs }), k.a && T("alpha: {f}", { f: k.a })].filter(Boolean).join(" · ");
        // compact legends: shifted functions in the key's top corners, the alpha letter in its bottom corner
        el.innerHTML = '<button type="button"><span class="il"></span><span class="ir"></span><span class="main"></span><span class="al"></span></button>';
        const b = el.querySelector("button");
        b.querySelector(".il").textContent = k.ls; b.querySelector(".ir").textContent = k.rs;
        b.querySelector(".main").textContent = label; b.querySelector(".al").textContent = r === 0 ? "" : k.a;
        b.setAttribute("aria-label", title); b.title = title;
        const down = (e) => { e.preventDefault(); if (!pad || job) return; if (b.setPointerCapture && e.pointerId !== undefined) b.setPointerCapture(e.pointerId); pad.press(k); b.classList.add("down"); };
        const up = () => { if (!pad) return; pad.release(k); b.classList.remove("down"); };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
        keyEls[k.id] = b;
        div.appendChild(el);
      });
      box.appendChild(div);
    });
  }
  // keys typed into the page's own fields stay there; the hidden file inputs keep focus after loading, so they don't count
  const typingInField = (e) => e.target.closest && e.target.closest("select, textarea, input:not([type=file]):not([type=checkbox])");
  document.addEventListener("keydown", (e) => {
    if (!pad || job || typingInField(e)) return;
    const k = Keys.fromEvent(e); if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    pad.press(k); keyEls[k.id].classList.add("down");
  });
  document.addEventListener("keyup", (e) => {
    if (!pad || typingInField(e)) return;
    const k = Keys.fromEvent(e); if (!k) return;
    e.preventDefault(); pad.release(k); keyEls[k.id].classList.remove("down");
  });
  window.addEventListener("blur", () => { if (pad) pad.releaseAll(); Object.values(keyEls).forEach((b) => b.classList.remove("down")); });

  // ------------------------------------------------------------ typing: one or more lines, then (optionally) a callback once the calculator is idle
  let job = null;
  function typeLines(lines, opts) {
    if (!m || job) return false;
    const plans = lines.map((t) => Typer.plan(t, { enter: opts.enter }));
    if (plans.every((p) => p.chars === 0)) { say(opts.status, T("Nothing to type."), "err"); return false; }
    pad.releaseAll();
    job = { plans: plans, n: 0, opts: opts, unsupported: [].concat(...plans.map((p) => p.unsupported)).filter((c, i, a) => a.indexOf(c) === i), waitUntil: 0 };
    nextLine();
    if (!running) { running = true; $("btnPause").textContent = T("Pause"); status(); }
    document.querySelectorAll(".while-typing").forEach((el) => { el.hidden = false; });
    document.querySelectorAll(".not-while-typing").forEach((el) => { el.disabled = true; });
    return true;
  }
  function nextLine() {
    if (job.n < job.plans.length) { typist = new Typer.Typist(m, pad, Keys.byId, job.plans[job.n++].keys); return; }
    typist = null; job.waitUntil = m.time + CLOCK * 0.3;          // let the last line run before reading the result
  }
  function progress() { return job ? Math.round(((job.n - 1) + (typist ? typist.progress() : 1)) / job.plans.length * 100) : 100; }
  function endTyping(finished) {
    const j = job; typist = null; job = null; pad.releaseAll();
    document.querySelectorAll(".while-typing").forEach((el) => { el.hidden = true; });
    document.querySelectorAll(".not-while-typing").forEach((el) => { el.disabled = !m; });
    if (!j) return;
    if (!finished) say(j.opts.status, T("Stopped."));
    else if (j.unsupported.length) say(j.opts.status, T("Typed, but the 48GX keyboard has no key for: {c}. Those were left out.", { c: j.unsupported.join(" ") }), "err");
    else say(j.opts.status, j.opts.done || T("Typed."), "ok");
    if (finished && j.opts.then) j.opts.then();
    save(); showStack(true);
  }
  function typeText(text) { typeLines([text], { enter: $("typeEnter").checked, status: "typeStatus" }); }
  $("btnType").onclick = () => typeText($("typeText").value);
  document.querySelectorAll(".stop-typing").forEach((b) => { b.onclick = () => endTyping(false); });


  // ------------------------------------------------------------ the stack, read from the calculator's memory
  let levels = [];
  function showStack(force) {
    if (!m) return;
    let lv;
    try { lv = Stack.read(m, 50); } catch (e) { lv = []; }
    const key = lv.map((o) => o.text).join("\n");
    if (!force && key === levels.map((o) => o.text).join("\n")) return;
    levels = lv;
    const ol = $("stackList"); ol.innerHTML = "";
    if (!lv.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = T("The stack is empty."); ol.appendChild(li); return; }
    lv.slice(0, 12).forEach((o, i) => {
      const li = document.createElement("li");
      const n = document.createElement("span"); n.className = "lvl"; n.textContent = (i + 1) + ":";
      const v = document.createElement("span"); v.className = "val"; v.textContent = o.text;
      li.append(n, v); ol.appendChild(li);
    });
    if (lv.length > 12) { const li = document.createElement("li"); li.className = "empty"; li.textContent = T("…and {n} more levels (all are copied).", { n: lv.length - 12 }); ol.appendChild(li); }
  }
  function copy(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = T("Copied"); setTimeout(() => { btn.textContent = t; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
    else fallback(text, done);
  }
  function fallback(text, done) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* the text stays selected for the viewer to copy */ }
    ta.remove();
  }
  $("btnCopy").onclick = () => copy(levels.map((o, i) => (i + 1) + ": " + o.text).join("\n"), $("btnCopy"));
  $("btnCsv").onclick = () => copy(Stack.csv(levels), $("btnCsv"));

  // ------------------------------------------------------------ the supply chain toolkit
  const num = (v) => (Number.isFinite(v) ? String(parseFloat(v.toPrecision(12))) : "—");
  function buildScm() {
    const box = $("scmList");
    SCM.PROGRAMS.forEach((p) => {
      const d = document.createElement("details"); d.className = "prog";
      const sum = document.createElement("summary");
      sum.innerHTML = "<b></b> <span></span>";
      sum.querySelector("b").textContent = p.name; sum.querySelector("span").textContent = T(p.title);
      d.appendChild(sum);
      const form = document.createElement("form"); form.className = "inputs";
      p.inputs.forEach((label, i) => {
        const id = "in-" + p.name + "-" + i;
        const row = document.createElement("label"); row.htmlFor = id;
        const lv = document.createElement("span"); lv.className = "lvl"; lv.textContent = (p.inputs.length - i) + ":";
        const t = document.createElement("span"); t.className = "lab"; t.textContent = T(label);
        const inp = document.createElement("input"); inp.id = id; inp.type = "text"; inp.inputMode = Array.isArray(p.example[i]) ? "text" : "decimal";
        inp.value = Array.isArray(p.example[i]) ? p.example[i].join(" ") : String(p.example[i]);
        row.append(lv, t, inp); form.appendChild(row);
      });
      const outs = document.createElement("p"); outs.className = "small";
      outs.textContent = T("Gives") + " " + p.outputs.map((o) => T(o)).join("; ") + ".";
      const btn = document.createElement("button"); btn.type = "submit"; btn.className = "btn not-while-typing"; btn.textContent = T("Run on the calculator");
      const res = document.createElement("div"); res.className = "result";
      form.append(outs, btn, res);
      form.addEventListener("submit", (e) => { e.preventDefault(); runProgram(p, form, res); });
      d.appendChild(form); box.appendChild(d);
    });
  }
  function readInputs(p, form) {
    const vals = [];
    for (let i = 0; i < p.inputs.length; i++) {
      const raw = form.querySelector("#in-" + p.name + "-" + i).value.trim();
      if (Array.isArray(p.example[i])) {
        const xs = raw.split(/[\s,;]+/).filter(Boolean).map(Number);
        if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return { error: T("{f} needs at least two numbers, separated by spaces.", { f: T(p.inputs[i]) }) };
        vals.push(xs);
      } else {
        const x = Number(raw.replace(",", "."));
        if (raw === "" || !Number.isFinite(x)) return { error: T("{f} needs a number.", { f: T(p.inputs[i]) }) };
        vals.push(x);
      }
    }
    return { vals: vals };
  }
  const literal = (v) => (Array.isArray(v) ? "{ " + v.join(" ") + " }" : String(v));
  function runProgram(p, form, res) {
    const r = readInputs(p, form);
    res.innerHTML = "";
    if (r.error) { res.textContent = r.error; res.className = "result err"; return; }
    res.className = "result";
    typeLines(["CLEAR « SCM » EVAL " + r.vals.map(literal).join(" ") + " " + p.name], { enter: true, status: "scmStatus", done: T("Ran {p}.", { p: p.name }),
      then: () => showResult(p, r.vals, res) });
  }
  function showResult(p, vals, res) {
    const lv = Stack.read(m, 50);
    if (!lv.length || lv.every((o) => typeof o.value !== "number")) {
      res.className = "result err";
      res.textContent = T("No result on the stack. If the calculator shows Undefined Name, install the programs first.");
      return;
    }
    const c = SCM.check(p, lv, vals);
    const tb = document.createElement("table");
    tb.innerHTML = "<tr><th></th><th></th><th></th><th></th></tr>";
    const ths = tb.querySelectorAll("th"); ths[1].textContent = T("Calculator"); ths[2].textContent = T("Reference");
    c.rows.forEach((row) => {
      const tr = document.createElement("tr");
      [row.tag || T(row.label).split(":")[0], num(row.got), num(row.want), row.ok ? "✓" : "✗"].forEach((t, i) => { const td = document.createElement("td"); td.textContent = t; if (i === 3) td.className = row.ok ? "ok" : "bad"; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    const note = document.createElement("p"); note.className = "small";
    note.textContent = c.ok ? T("The calculator agrees with the reference calculation to 12 digits.") : T("The calculator's answer differs from the reference.");
    res.append(tb, note); res.className = "result " + (c.ok ? "ok" : "err");
  }
  $("btnInstall").onclick = () => {
    typeLines(SCM.installText().split("\n"), { enter: true, status: "scmStatus", done: T("Installed: the programs are on the menu keys, in the directory SCM.") });
  };

  // ------------------------------------------------------------ saving and opening the calculator as a file
  $("btnSave").onclick = () => {
    if (!m) return;
    const data = JSON.stringify({ snapshot: m.snapshot(), savedAt: Date.now() });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "hp48gx-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say("memStatus", T("Saved. The file holds the calculator's memory, not the ROM."), "ok");
  };
  function openState(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { say("memStatus", T("That file isn't a saved calculator."), "err"); return; }
    const snap = data && data.snapshot ? data.snapshot : data;
    try {
      const next = new Machine(rom); next.restore(snap);
      if (data && data.savedAt) next.elapse((Date.now() - data.savedAt) / 1000);
      m = next; pad = new Keys.Keypad(m); typist = null; job = null; error = null; running = true;
      $("btnPause").textContent = T("Pause");
      save(); status();
      say("memStatus", T("Opened. The calculator carries on from the saved file."), "ok");
    } catch (e) {
      say("memStatus", /different ROM/.test(e.message) ? T("That file was saved with a different ROM.") : T("That file isn't a saved calculator."), "err");
    }
  }
  $("btnOpen").onclick = () => { $("stateFile").value = ""; $("stateFile").click(); };
  $("stateFile").onchange = async (e) => { const f = e.target.files[0]; if (f) openState(await f.text()); };

  // ------------------------------------------------------------ files dropped or chosen: a ROM, a saved calculator, or text
  async function acceptFile(f) {
    const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
    const head = new TextDecoder("latin1").decode(b.subarray(0, 16));
    if (/^HPHP4[89]-/.test(head)) { say("typeStatus", T("That is a binary HP 48 object. Loading those needs the calculator's serial port, which isn't emulated yet; a text (ASCII) version of the program can be typed."), "err"); return; }
    if ([262144, 524288, 1048576].indexOf(b.length) >= 0 || !rom) { acceptRom(buf, true); return; }
    const text = new TextDecoder("utf-8").decode(b);
    if (/"format"\s*:\s*"hp48gx-state"/.test(text.slice(0, 200)) || /^\s*\{\s*"snapshot"/.test(text)) { openState(text); return; }
    if (b.length > 200000) { say("typeStatus", T("That file is too large to type."), "err"); return; }
    $("typeText").value = text;
    say("typeStatus", T("The file's text is ready: press Type it."));
  }
  function pick() { $("romFile").value = ""; $("romFile").click(); }
  $("btnLoad").onclick = pick; $("btnLoad2").onclick = pick;
  $("romFile").onchange = async (e) => { const f = e.target.files[0]; if (f) acceptRom(await f.arrayBuffer(), true); };
  const calc = $("calc"), norom = $("norom");
  calc.addEventListener("dragover", (e) => { e.preventDefault(); norom.classList.add("drag"); });
  calc.addEventListener("dragleave", () => norom.classList.remove("drag"));
  calc.addEventListener("drop", (e) => { e.preventDefault(); norom.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) acceptFile(f); });

  // ------------------------------------------------------------ controls
  $("btnForget").onclick = async () => {
    await del("rom"); await del("state"); m = pad = rom = typist = job = null; running = false;
    blank();
    $("norom").hidden = false; say("romStatus", T("No ROM loaded. The ROM and the calculator's memory were deleted from this browser."));
    ENABLE.forEach((id) => { $(id).disabled = true; });
    say("memStatus", ""); status();
  };
  $("btnPause").onclick = () => { running = !running; $("btnPause").textContent = running ? T("Pause") : T("Run"); if (!running) save(); status(); };
  $("btnReset").onclick = () => { if (rom) { start(rom, true).then(save); say("memStatus", T("Restarted: memory is cleared.")); } };
  $("speed").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    speed = +b.dataset.v; slowFrames = 0;
    Array.from($("speed").children).forEach((x) => x.classList.toggle("on", x === b));
    status();
  };

  // ------------------------------------------------------------ go
  $("ver").textContent = "v" + VERSION;
  buildKeys();
  buildScm();
  blank();
  get("rom").then((b) => { if (b) acceptRom(b, false); });
  requestAnimationFrame(frame);
  window.HP48.app = { get machine() { return m; }, get pad() { return pad; }, get typing() { return !!job; }, save };   // for testing from the console
})();
