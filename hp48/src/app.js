/*
 * app.js — the page: loads the ROM the user supplies (kept in this browser's
 * IndexedDB, never uploaded), runs the machine in step with real time, draws
 * the display and annunciators, and turns clicks, touches and computer keys
 * into key presses.
 */
(function () {
  "use strict";
  const { Machine, Keys, RomFile } = window.HP48;
  const VERSION = "0.3.0";
  const CLOCK = Machine.CLOCK;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ ROM storage (this browser only)
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
  const saveRom = (bytes) => dbOp("readwrite", (s) => s.put(bytes, "rom")).catch(() => {});
  const readRom = () => dbOp("readonly", (s) => s.get("rom")).catch(() => null);
  const forgetRom = () => dbOp("readwrite", (s) => s.delete("rom")).catch(() => {});

  // ------------------------------------------------------------ state
  let rom = null, m = null, pad = null, running = false, speed = 1, error = null;

  function start(bytes) {
    rom = bytes; m = new Machine(bytes); pad = new Keys.Keypad(m); error = null; running = true;
    $("norom").hidden = true;
    ["btnPause", "btnReset", "btnForget"].forEach((id) => { $(id).disabled = false; });
    $("btnPause").textContent = "Pause";
    status();
  }
  async function accept(buf, remember) {
    const r = RomFile.load(new Uint8Array(buf));
    if (r.error) { $("romStatus").textContent = r.error; $("romStatus").classList.add("err"); return; }
    $("romStatus").classList.remove("err");
    $("romStatus").textContent = "48GX ROM, revision " + r.revision + ", kept in this browser.";
    if (remember) await saveRom(r.bytes);
    start(r.bytes);
  }

  // ------------------------------------------------------------ the display
  const lcd = $("lcd"), g = lcd.getContext("2d"), img = g.createImageData(131, 64);
  const annun = Array.from($("annun").children);
  const LCD_BG = [0xb9, 0xc9, 0xb2], LCD_INK = [0x17, 0x24, 0x1c];
  let lastFrame = "";
  function draw() {
    if (!m) return;
    const d = m.display();
    const rows = d.on ? m.pixels() : null;
    // contrast: the ROM's default is about 9–12; darker as it rises
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
        if (speed > 0) {
          let cycles = dt / 1000 * CLOCK * speed;
          while (cycles > 0) { const c = Math.min(cycles, CLOCK / 500); m.run(c); pad.update(); cycles -= c; }
        } else {
          const until = performance.now() + 12;
          while (performance.now() < until) { m.run(CLOCK / 500); pad.update(); }
        }
        const took = performance.now() - now;
        slowFrames = took > dt && speed > 0 ? slowFrames + 1 : 0;
      } catch (e) {
        error = e.message; running = false; status();
      }
    }
    draw();
    if (slowFrames === 30) status();
    requestAnimationFrame(frame);
  }
  function status() {
    const s = $("runStatus");
    s.classList.toggle("err", !!error);
    if (error) s.textContent = "Stopped: " + error + ". Restart to try again.";
    else if (!m) s.textContent = "";
    else if (!running) s.textContent = "Paused.";
    else if (slowFrames >= 30) s.textContent = "This device can't keep up with real speed.";
    else s.textContent = speed === 1 ? "Running at the 48GX's speed (3.69 MHz)." : speed > 1 ? "Running at " + speed + "× speed." : "Running as fast as this device can.";
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
        const title = [label || "menu key " + k.id, k.ls && "left shift: " + k.ls, k.rs && "right shift: " + k.rs, k.a && "alpha: " + k.a].filter(Boolean).join(" · ");
        el.innerHTML = '<div class="shift"><span class="ls"></span><span class="rs"></span></div><div class="capline"><button type="button"></button><span class="alpha"></span></div>';
        el.querySelector(".ls").textContent = k.ls; el.querySelector(".rs").textContent = k.rs;
        el.querySelector(".alpha").textContent = r === 0 ? "" : k.a;
        const b = el.querySelector("button");
        b.textContent = label; b.setAttribute("aria-label", title); b.title = title;
        const down = (e) => { e.preventDefault(); if (!pad) return; b.setPointerCapture && e.pointerId !== undefined && b.setPointerCapture(e.pointerId); pad.press(k); b.classList.add("down"); };
        const up = () => { if (!pad) return; pad.release(k); b.classList.remove("down"); };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
        keyEls[k.id] = b;
        div.appendChild(el);
      });
      box.appendChild(div);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (!pad || (e.target.closest && e.target.closest("select, textarea, input:not([type=file])"))) return;
    const k = Keys.fromEvent(e); if (!k) return;
    e.preventDefault();
    if (e.repeat) return;
    pad.press(k); keyEls[k.id].classList.add("down");
  });
  document.addEventListener("keyup", (e) => {
    if (!pad) return;
    const k = Keys.fromEvent(e); if (!k) return;
    e.preventDefault(); pad.release(k); keyEls[k.id].classList.remove("down");
  });
  window.addEventListener("blur", () => { if (pad) pad.releaseAll(); Object.values(keyEls).forEach((b) => b.classList.remove("down")); });

  // ------------------------------------------------------------ controls
  function pick() { $("romFile").value = ""; $("romFile").click(); }
  $("btnLoad").onclick = pick; $("btnLoad2").onclick = pick;
  $("romFile").onchange = async (e) => { const f = e.target.files[0]; if (f) accept(await f.arrayBuffer(), true); };
  $("btnForget").onclick = async () => {
    await forgetRom(); m = pad = rom = null; running = false;
    g.fillStyle = "rgb(185,201,178)"; g.fillRect(0, 0, 131, 64); lastFrame = "";
    $("norom").hidden = false; $("romStatus").textContent = "No ROM loaded. The stored copy was deleted from this browser.";
    ["btnPause", "btnReset", "btnForget"].forEach((id) => { $(id).disabled = true; });
    status();
  };
  $("btnPause").onclick = () => { running = !running; $("btnPause").textContent = running ? "Pause" : "Run"; status(); };
  $("btnReset").onclick = () => { if (rom) start(rom); };
  $("speed").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    speed = +b.dataset.v; slowFrames = 0;
    Array.from($("speed").children).forEach((x) => x.classList.toggle("on", x === b));
    status();
  };
  const calc = $("calc"), norom = $("norom");
  calc.addEventListener("dragover", (e) => { e.preventDefault(); norom.classList.add("drag"); });
  calc.addEventListener("dragleave", () => norom.classList.remove("drag"));
  calc.addEventListener("drop", async (e) => {
    e.preventDefault(); norom.classList.remove("drag");
    const f = e.dataTransfer.files[0]; if (f) accept(await f.arrayBuffer(), true);
  });

  // ------------------------------------------------------------ go
  $("ver").textContent = "v" + VERSION;
  buildKeys();
  g.fillStyle = "rgb(185,201,178)"; g.fillRect(0, 0, 131, 64);
  readRom().then((b) => { if (b) accept(b, false); });
  requestAnimationFrame(frame);
  window.HP48.app = { get machine() { return m; }, get pad() { return pad; } };   // for testing from the console
})();
