// USB bridge checks — run with: node phone-sensors/tests/usb-bridge.test.js (Node 22+, for its built-in WebSocket)
// Framing against hand-made frames, the relay between a phone and a computer view, status messages, replacement of a
// second phone, the origin check, oversized and malformed frames, and parsing of `adb devices -l`.
const net = require("net");
const crypto = require("crypto");
const B = require("../usb/sensor-deck-usb.js");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) pass++; else fail++; if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + name + (detail !== undefined ? "  → " + detail : "")); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a masked client frame, as a browser sends
function clientFrame(text, { opcode = 1, fin = true, mask = true } = {}) {
  const p = Buffer.isBuffer(text) ? text : Buffer.from(text), n = p.length;
  let head = n < 126 ? Buffer.from([0, n]) : n < 65536 ? Buffer.from([0, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (!mask) return Buffer.concat([head, p]);
  head[1] |= 0x80;
  const k = crypto.randomBytes(4), out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = p[i] ^ k[i & 3];
  return Buffer.concat([head, k, out]);
}
function parse(frames) {
  const got = [], ctl = [], errs = [];
  const P = new B.FrameParser({ onMessage: (t) => got.push(t), onControl: (o, p) => ctl.push([o, p.toString()]), onError: (e) => errs.push(e) });
  return { P, got, ctl, errs, feed(buf) { P.push(buf); return this; } };
}

(async () => {
  // ---- framing
  check("handshake key: the RFC 6455 example", B.acceptKey("dGhlIHNhbXBsZSBub25jZQ==") === "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  check("server frames: short, 16-bit and 64-bit lengths, unmasked", (() => {
    const a = B.encodeFrame("hi"), b = B.encodeFrame("x".repeat(300)), c = B.encodeFrame("y".repeat(70000));
    return a[0] === 0x81 && a[1] === 2 && b[1] === 126 && b.readUInt16BE(2) === 300 && c[1] === 127 && Number(c.readBigUInt64BE(2)) === 70000;
  })());
  const p1 = parse().feed(clientFrame("hello"));
  check("parser: a masked text frame", p1.got[0] === "hello" && !p1.errs.length);
  const big = "z".repeat(70000), p2 = parse(), f2 = clientFrame(big);
  for (let i = 0; i < f2.length; i += 1000) p2.feed(f2.subarray(i, i + 1000));
  check("parser: a 70 kB message arriving in 1 kB pieces", p2.got.length === 1 && p2.got[0] === big);
  const p3 = parse().feed(Buffer.concat([clientFrame("ab", { fin: false }), clientFrame("cd", { opcode: 0, fin: false }), clientFrame("ef", { opcode: 0 })]));
  check("parser: a fragmented message is joined", p3.got[0] === "abcdef");
  const p4 = parse().feed(Buffer.concat([clientFrame("one"), clientFrame("ping!", { opcode: 9 }), clientFrame("two")]));
  check("parser: ping between messages goes to control, messages stay in order", p4.got.join() === "one,two" && p4.ctl[0][0] === 9 && p4.ctl[0][1] === "ping!");
  check("parser: UTF-8 survives", parse().feed(clientFrame("µT · °C · 🦉")).got[0] === "µT · °C · 🦉");
  check("parser: unmasked client frames are refused", parse().feed(clientFrame("x", { mask: false })).errs[0] === "client frames must be masked");
  check("parser: binary frames are refused", parse().feed(clientFrame(Buffer.from([1, 2]), { opcode: 2 })).errs.length === 1);
  const huge = Buffer.alloc(10); huge[0] = 0x81; huge[1] = 0x80 | 127; huge.writeBigUInt64BE(BigInt(5e9), 2);
  check("parser: a frame claiming 5 GB is refused before any of it arrives", parse().feed(huge).errs[0] === "message too large");
  check("parser: continuation without a start is refused", parse().feed(clientFrame("x", { opcode: 0 })).errs.length === 1);

  // ---- origins
  check("origin: the Sensor Deck page and local copies are allowed", ["https://kathuman.github.io", "http://localhost:8767", "http://127.0.0.1:8767", undefined].every((o) => B.originAllowed(o)));
  check("origin: other websites are refused", ["https://evil.example", "https://kathuman.github.io.evil.example", "http://192.168.1.5", "null"].every((o) => !B.originAllowed(o)));

  // ---- adb devices
  const devs = B.parseDevices("List of devices attached\nR58N12ABCDE            device usb:1-1 product:o1sxeea model:SM_G991B device:o1s transport_id:3\nemulator-5554          unauthorized transport_id:1\n\n");
  check("adb devices -l: serial, state and model", devs.length === 2 && devs[0].serial === "R58N12ABCDE" && devs[0].state === "device" && devs[0].model === "SM G991B" && devs[1].state === "unauthorized");
  check("adb devices -l: none attached", B.parseDevices("List of devices attached\n\n").length === 0);

  // ---- the relay, end to end
  const br = await B.start({ port: 0, adb: false, quiet: true });
  const url = "ws://127.0.0.1:" + br.port;
  const open = (role) => new Promise((res, rej) => { const ws = new WebSocket(url + "/" + role); ws.msgs = []; ws.onmessage = (e) => ws.msgs.push(JSON.parse(e.data)); ws.onopen = () => res(ws); ws.onerror = rej; });
  const viewer = await open("viewer"); await sleep(100);
  check("relay: the view hears it is connected, no phone yet", viewer.msgs.some((m) => m.type === "bridge" && m.viewer && !m.phone && m.adb === "off"));
  const phone = await open("phone"); await sleep(100);
  check("relay: both hear the phone has joined", viewer.msgs.some((m) => m.type === "bridge" && m.phone) && phone.msgs.some((m) => m.type === "bridge" && m.viewer && m.phone));
  const batch = { type: "batch", items: Array.from({ length: 200 }, (_, i) => [i * 16, "accel", [0.1, 0.2, 9.8, 9.8]]) };
  phone.send(JSON.stringify(batch)); phone.send(JSON.stringify({ type: "meta", id: "net", text: "Online" }));
  viewer.send(JSON.stringify({ type: "ping", n: 1, t: 5 }));
  await sleep(150);
  const vb = viewer.msgs.filter((m) => m.type !== "bridge");
  check("relay: phone → view, in order and intact", vb.length === 2 && vb[0].items.length === 200 && vb[0].items[199][0] === 3184 && vb[1].text === "Online");
  check("relay: view → phone", phone.msgs.some((m) => m.type === "ping" && m.n === 1));
  const st = await (await fetch("http://127.0.0.1:" + br.port + "/status")).json();
  check("status page: JSON says who is connected", st.phone === true && st.viewer === true && st.version === B.VERSION);
  const html = await (await fetch("http://127.0.0.1:" + br.port + "/")).text();
  check("status page: links to the computer view with the port", html.includes("?mode=view&amp;usb=" + br.port) || html.includes("?mode=view&usb=" + br.port));
  // a second phone replaces the first
  const phone2 = await open("phone"); let closed1 = false; phone.onclose = () => { closed1 = true; }; await sleep(150);
  phone2.send(JSON.stringify({ type: "bye" })); await sleep(100);
  check("relay: a second phone replaces the first", closed1 && viewer.msgs.some((m) => m.type === "bye"));
  phone2.close(); await sleep(150);
  check("relay: the view hears the phone left", viewer.msgs.filter((m) => m.type === "bridge").pop().phone === false);
  // a large message (a camera thumbnail is ~10 kB; 300 kB is generous) and one over the limit
  const p3w = await open("phone"); await sleep(50);
  p3w.send(JSON.stringify({ type: "frame", jpeg: "data:image/jpeg;base64," + "A".repeat(300000) })); await sleep(200);
  check("relay: a 300 kB message passes", viewer.msgs.some((m) => m.type === "frame" && m.jpeg.length > 300000));
  let cut = false; p3w.onclose = () => { cut = true; };
  p3w.send("x".repeat(1.2e6)); await sleep(300);
  check("relay: over 1 MB closes that connection", cut);
  // origin check at the handshake, and junk paths
  const raw = (pathName, origin) => new Promise((res) => {
    const s = net.connect(br.port, "127.0.0.1", () => s.write("GET " + pathName + " HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" + (origin ? "Origin: " + origin + "\r\n" : "") + "\r\n"));
    let d = ""; s.on("data", (c) => { d += c; s.destroy(); res(d.split("\r\n")[0]); }); s.on("error", () => res("error"));
  });
  check("handshake: another website is refused (403)", (await raw("/phone", "https://evil.example")) === "HTTP/1.1 403 Forbidden");
  check("handshake: the Sensor Deck page is accepted (101)", (await raw("/viewer", "https://kathuman.github.io")) === "HTTP/1.1 101 Switching Protocols");
  check("handshake: an unknown role is refused (400)", (await raw("/admin", "https://kathuman.github.io")) === "HTTP/1.1 400 Bad Request");
  // listens on loopback only
  check("listens on the loopback address only, never the network", br.address === "127.0.0.1", br.address);
  viewer.close();
  await br.close();

  // ---- adb: plug-in, unauthorised phone, unplug, and cleanup, with a stand-in adb
  const os = require("os"), fs = require("fs"), path = require("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdusb-")), devFile = path.join(dir, "devices"), logFile = path.join(dir, "log");
  fs.writeFileSync(devFile, "emulator-5554          unauthorized transport_id:1\n"); fs.writeFileSync(logFile, "");
  process.env.FAKE_ADB_DEVICES = devFile; process.env.FAKE_ADB_LOG = logFile;
  const ba = await B.start({ port: 0, adbPath: [process.execPath, path.join(__dirname, "fake-adb.js")], pollMs: 150, quiet: true });
  check("adb: an unauthorised phone is reported, not reversed", ba.status().adb === "waiting for the phone" && !fs.readFileSync(logFile, "utf8").includes("reverse"));
  fs.writeFileSync(devFile, "R58N12ABCDE            device usb:1-1 product:o1s model:SM_G991B device:o1s transport_id:3\n");
  await sleep(600);
  const log1 = fs.readFileSync(logFile, "utf8");
  check("adb: an authorised phone gets its port reversed once", (log1.match(new RegExp("-s R58N12ABCDE reverse tcp:" + ba.port + " tcp:" + ba.port, "g")) || []).length === 1, log1.trim().split("\n").filter((l) => /reverse/.test(l)).join(" | "));
  check("adb: the status names the phone", ba.status().device === "SM G991B" && ba.status().adb === "phone ready");
  fs.writeFileSync(devFile, ""); await sleep(400);
  check("adb: unplugging is noticed", ba.status().adb === "no phone plugged in" && ba.status().device === null);
  fs.writeFileSync(devFile, "R58N12ABCDE            device usb:1-1 model:SM_G991B transport_id:4\n"); await sleep(400);
  check("adb: plugging back in reverses again", (fs.readFileSync(logFile, "utf8").match(/R58N12ABCDE reverse tcp/g) || []).length === 2);
  await ba.close();
  check("adb: stopping the bridge removes the reverse", fs.readFileSync(logFile, "utf8").includes("-s R58N12ABCDE reverse --remove tcp:" + ba.port));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(pass + "/" + (pass + fail) + " checks passed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
