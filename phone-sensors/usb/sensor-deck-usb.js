#!/usr/bin/env node
// Sensor Deck USB bridge — connects a phone to the Sensor Deck computer view over a USB cable, with no Wi-Fi and no
// internet in the path.
//
// How it works: Android's `adb reverse tcp:8766 tcp:8766` makes port 8766 on the phone lead, through the cable, to
// port 8766 on this computer. This script listens there (on 127.0.0.1 only) and relays the page's messages between
// the phone (ws://127.0.0.1:8766/phone) and the computer view (ws://127.0.0.1:8766/viewer). It runs `adb reverse`
// itself whenever a phone is plugged in.
//
// Needs: Node.js 18 or later, Android platform-tools (adb), and USB debugging switched on in the phone's developer
// options. No npm packages.
//
//   node sensor-deck-usb.js              start on port 8766
//   node sensor-deck-usb.js --port 9000  another port (open the page with ?usb=9000 then)
//   node sensor-deck-usb.js --no-adb     relay only, for an emulator or testing
//
// Version history:
//   1.0.0  first release: WebSocket relay (RFC 6455, text frames, fragmentation, ping/pong), adb reverse on plug-in,
//          origin check, one phone and one computer view at a time
"use strict";
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const VERSION = "1.0.0";
const DEFAULT_PORT = 8766;
const PAGE = "https://kathuman.github.io/claude-projects/phone-sensors/";
const MAX_MESSAGE = 1 << 20; // 1 MB: a batch of readings or a camera thumbnail is far smaller
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
// only the Sensor Deck page (and local copies of it) may use the bridge, so another website open in the same browser
// cannot read the phone's sensors through it
const ALLOWED = [/^https:\/\/kathuman\.github\.io$/, /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/];

// ---- WebSocket framing (RFC 6455): just what the relay needs
function acceptKey(key) { return crypto.createHash("sha1").update(key + GUID).digest("base64"); }

function encodeFrame(data, opcode = 1) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const n = payload.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x80 | opcode; // FIN + opcode; frames from a server are not masked
  return Buffer.concat([head, payload]);
}

// Feeds bytes in, calls onMessage(text) for each complete text message and onControl(opcode, payload) for ping, pong
// and close. Calls onError(reason) and stops on anything malformed or too large.
class FrameParser {
  constructor({ onMessage, onControl, onError, maxMessage = MAX_MESSAGE, requireMask = true }) {
    Object.assign(this, { onMessage, onControl, onError, maxMessage, requireMask });
    this.buf = Buffer.alloc(0); this.parts = []; this.partLen = 0; this.dead = false;
  }
  push(chunk) {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      if (b0 & 0x70) return this.fail("reserved bits set");
      if (this.requireMask && !masked) return this.fail("client frames must be masked");
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxMessage)) return this.fail("message too large");
        len = Number(big); off = 10;
      }
      if (len > this.maxMessage) return this.fail("message too large");
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4), out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = this.buf.subarray(need);
      if (opcode >= 8) { // control frames: never fragmented, at most 125 bytes
        if (!fin || len > 125) return this.fail("bad control frame");
        this.onControl(opcode, payload);
        if (this.dead) return;
        continue;
      }
      if (opcode === 2) return this.fail("binary messages are not used");
      if (opcode === 1) { if (this.parts.length) return this.fail("new message inside a fragmented one"); }
      else if (opcode === 0) { if (!this.parts.length) return this.fail("continuation without a start"); }
      else return this.fail("unknown opcode " + opcode);
      this.partLen += len;
      if (this.partLen > this.maxMessage) return this.fail("message too large");
      this.parts.push(payload);
      if (fin) {
        const text = Buffer.concat(this.parts).toString("utf8");
        this.parts = []; this.partLen = 0;
        this.onMessage(text);
        if (this.dead) return;
      }
    }
  }
  fail(reason) { this.dead = true; this.onError(reason); }
}

function originAllowed(origin, extra = []) {
  if (!origin) return true; // not a browser (curl, the tests): it cannot have come from another website
  return ALLOWED.concat(extra).some((re) => re.test(origin));
}

// ---- adb
function parseDevices(text) {
  // "List of devices attached\nR58N12ABCDE    device usb:1-1 product:x model:SM_G991B device:o1s transport_id:3\n..."
  return String(text).split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [serial, state] = l.split(/\s+/);
    const model = (l.match(/model:(\S+)/) || [])[1];
    return { serial, state, model: model ? model.replace(/_/g, " ") : serial };
  }).filter((d) => d.serial && d.state);
}

function findAdb() {
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  const homes = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    process.env.HOME && path.join(process.env.HOME, "Library", "Android", "sdk"),
    process.env.HOME && path.join(process.env.HOME, "Android", "Sdk")].filter(Boolean);
  if (process.env.ADB) return Promise.resolve(process.env.ADB);
  return new Promise((resolve) => {
    execFile(exe, ["version"], (err) => {
      if (!err) return resolve(exe);
      const hit = homes.map((h) => path.join(h, "platform-tools", exe)).find((p) => fs.existsSync(p));
      resolve(hit || null);
    });
  });
}

// cmd is adb's path, or [program, ...args] for a stand-in (the tests use a Node script)
function run(cmd, args) {
  const [file, pre] = Array.isArray(cmd) ? [cmd[0], cmd.slice(1)] : [cmd, []];
  return new Promise((resolve) => execFile(file, pre.concat(args), { timeout: 8000 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ""), err: String(stderr || (err && err.message) || "") })));
}

// ---- the bridge
function start(opts = {}) {
  let port = opts.port != null ? opts.port : DEFAULT_PORT; // becomes the port actually bound (port 0 picks one)
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);
  const extra = (opts.allowOrigins || []).map((o) => new RegExp("^" + o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  const peers = { phone: null, viewer: null };
  const state = { adb: opts.adb === false ? "off" : "looking", device: null, reversed: new Set(), warned: new Set() };
  let timer = null, adbPath = null;

  function status() { return { type: "bridge", version: VERSION, phone: !!peers.phone, viewer: !!peers.viewer, device: state.device, adb: state.adb }; }
  function tellAll() { const s = JSON.stringify(status()); for (const r of ["phone", "viewer"]) if (peers[r]) peers[r].sendText(s); }

  const server = http.createServer((req, res) => {
    if (req.url === "/status") { res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(status())); return; }
    const view = PAGE + "?mode=view&usb=" + server.address().port;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sensor Deck USB bridge</title>
<body style="font:16px system-ui,sans-serif;background:#0a2f52;color:#bfe4ff;padding:24px;max-width:640px;margin:auto">
<h1 style="font-size:22px">Sensor Deck USB bridge ${VERSION}</h1>
<p>Running on port ${server.address().port}. Phone: <b>${peers.phone ? "connected" : "not connected"}</b>${state.device ? " (" + escapeHtml(state.device) + ")" : ""}. Computer view: <b>${peers.viewer ? "connected" : "not connected"}</b>. adb: <b>${escapeHtml(state.adb)}</b>.</p>
<p><a style="color:#7dd3fc" href="${view}">Open the computer view</a>, then on the phone open Sensor Deck and tap <b>USB cable</b>.</p></body>`);
  });

  server.on("upgrade", (req, socket) => {
    const role = (req.url || "").split("?")[0].replace(/^\/+/, "");
    const key = req.headers["sec-websocket-key"];
    if (!["phone", "viewer"].includes(role) || !key || String(req.headers.upgrade).toLowerCase() !== "websocket") { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
    if (!originAllowed(req.headers.origin, extra)) { log("refused a connection from " + req.headers.origin); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n");
    socket.setNoDelay(true);
    const peer = {
      role, socket, closed: false,
      sendText(t) { if (!this.closed) socket.write(encodeFrame(t, 1)); },
      close(code = 1000) { if (this.closed) return; this.closed = true; const b = Buffer.alloc(2); b.writeUInt16BE(code); try { socket.end(encodeFrame(b, 8)); } catch (e) { /* gone */ } }
    };
    // one of each: a newer phone or view replaces the older one
    if (peers[role]) peers[role].close(1000);
    peers[role] = peer;
    log((role === "phone" ? "phone" : "computer view") + " connected");
    const other = () => peers[role === "phone" ? "viewer" : "phone"];
    const parser = new FrameParser({
      onMessage(text) { const o = other(); if (o) o.sendText(text); },
      onControl(op, payload) {
        if (op === 9) socket.write(encodeFrame(payload, 10));
        else if (op === 8) peer.close(1000);
      },
      onError(reason) { log(role + ": " + reason); peer.close(1002); }
    });
    socket.on("data", (c) => parser.push(c));
    const gone = () => {
      if (peers[role] === peer) { peers[role] = null; log((role === "phone" ? "phone" : "computer view") + " disconnected"); tellAll(); }
      peer.closed = true;
    };
    socket.on("close", gone); socket.on("error", gone);
    tellAll();
  });

  // plug-in watch: reverse the port for every authorised phone, say what to do for the others
  async function watch() {
    if (!adbPath) return;
    const r = await run(adbPath, ["devices", "-l"]);
    if (!r.ok) { state.adb = "error: " + r.err.trim().split("\n")[0]; return; }
    const devs = parseDevices(r.out), seen = new Set(devs.map((d) => d.serial));
    for (const s of [...state.reversed]) if (!seen.has(s)) { state.reversed.delete(s); log("USB: " + s + " unplugged"); }
    let named = null;
    for (const d of devs) {
      if (d.state === "device") {
        named = named || d.model;
        if (!state.reversed.has(d.serial)) {
          const rr = await run(adbPath, ["-s", d.serial, "reverse", "tcp:" + port, "tcp:" + port]);
          if (rr.ok) { state.reversed.add(d.serial); log("USB: " + d.model + " plugged in — its port " + port + " now leads here. On the phone, tap USB cable."); }
          else log("USB: could not set up " + d.model + ": " + rr.err.trim());
        }
      } else if (!state.warned.has(d.serial + d.state)) {
        state.warned.add(d.serial + d.state);
        log(d.state === "unauthorized" ? "USB: " + d.serial + " is waiting: accept “Allow USB debugging” on the phone." : "USB: " + d.serial + " is " + d.state + ".");
      }
    }
    const before = state.device + state.adb;
    state.device = named; state.adb = devs.some((d) => d.state === "device") ? "phone ready" : devs.length ? "waiting for the phone" : "no phone plugged in";
    if (before !== state.device + state.adb) tellAll();
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", async () => {
      const actual = port = server.address().port;
      log("Sensor Deck USB bridge " + VERSION + " on 127.0.0.1:" + actual);
      log("Computer view: " + PAGE + "?mode=view&usb=" + actual + (actual === DEFAULT_PORT ? "  (or choose Computer view → USB cable)" : ""));
      if (opts.adb !== false) {
        adbPath = opts.adbPath || await findAdb();
        if (!adbPath) {
          state.adb = "adb not found";
          log("adb was not found. Install Android platform-tools (https://developer.android.com/tools/releases/platform-tools)");
          log("and put it on the PATH, or set ADB=/path/to/adb. The relay keeps running.");
        } else { log("Using " + [].concat(adbPath).join(" ") + ". Plug in the phone (USB debugging on)."); await watch(); timer = setInterval(watch, opts.pollMs || 2000); }
      }
      resolve({
        port: actual, address: server.address().address, status,
        close: async () => {
          clearInterval(timer);
          if (adbPath) for (const s of state.reversed) await run(adbPath, ["-s", s, "reverse", "--remove", "tcp:" + actual]);
          for (const r of ["phone", "viewer"]) if (peers[r]) { peers[r].close(1001); peers[r].socket.destroy(); }
          await new Promise((r) => server.close(r));
        }
      });
    });
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

module.exports = { start, encodeFrame, FrameParser, acceptKey, originAllowed, parseDevices, VERSION, DEFAULT_PORT };

if (require.main === module) {
  const a = process.argv.slice(2), opt = { allowOrigins: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--port") opt.port = +a[++i];
    else if (a[i] === "--no-adb") opt.adb = false;
    else if (a[i] === "--allow-origin") opt.allowOrigins.push(a[++i]);
    else if (a[i] === "--quiet") opt.quiet = true;
    else if (a[i] === "--version") { console.log(VERSION); process.exit(0); }
    else { console.log("usage: node sensor-deck-usb.js [--port 8766] [--no-adb] [--allow-origin https://example.org] [--quiet]"); process.exit(a[i] === "--help" ? 0 : 1); }
  }
  start(opt).then((b) => {
    const stop = () => { console.log("\nstopping"); b.close().then(() => process.exit(0)); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  }, (e) => {
    console.error(e.code === "EADDRINUSE" ? "Port " + (opt.port || DEFAULT_PORT) + " is in use: is the bridge already running? Try --port 8767." : e.message);
    process.exit(1);
  });
}
