// core.js — the parts of Sensor Deck that are plain maths, with no browser in them, so they can be tested in Node:
// the sensor catalogue, ring buffers and statistics, step and shake detection, the compass and spirit level, the
// spectrum (FFT, peak frequency), GPS distance, CSV export, the message format between phone and computer, and the
// demo phone used when a device has no sensors.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SensorCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var G = 9.80665, DEG = 180 / Math.PI, RAD = Math.PI / 180;

  // ---- the catalogue: one entry per card. `ch` are the numeric channels a sample carries, in order; `plot` picks
  // the ones drawn on the card's chart (by index); `src` says where the browser gets it from.
  var SENSORS = [
    { id: "accel", name: "Accelerometer", unit: "m/s²", ch: ["x", "y", "z", "|a|"], plot: [0, 1, 2], digits: 2,
      src: "DeviceMotionEvent.accelerationIncludingGravity", about: "Acceleration including gravity: lying flat, z reads about 9.81." },
    { id: "linacc", name: "Linear acceleration", unit: "m/s²", ch: ["x", "y", "z", "|a|"], plot: [0, 1, 2], digits: 2,
      src: "DeviceMotionEvent.acceleration", about: "Acceleration with gravity removed by the phone: zero when still." },
    { id: "gyro", name: "Gyroscope", unit: "°/s", ch: ["x (β)", "y (γ)", "z (α)"], plot: [0, 1, 2], digits: 1,
      src: "DeviceMotionEvent.rotationRate", about: "Rotation rate around each axis of the phone." },
    { id: "orient", name: "Orientation", unit: "°", ch: ["heading", "pitch (β)", "roll (γ)", "α"], plot: [1, 2], digits: 1,
      src: "deviceorientationabsolute / deviceorientation", about: "Which way the phone points (compass heading) and how it is tilted." },
    { id: "mag", name: "Magnetometer", unit: "µT", ch: ["x", "y", "z", "|B|"], plot: [0, 1, 2], digits: 1,
      src: "Magnetometer (Generic Sensor API)", about: "The magnetic field: the Earth's is 25–65 µT; magnets and steel push it far higher." },
    { id: "light", name: "Ambient light", unit: "lx", ch: ["illuminance"], plot: [0], digits: 0,
      src: "AmbientLightSensor (Generic Sensor API); Android app: Sensor.TYPE_LIGHT", about: "Light falling on the front of the phone, from the photosensor beside the earpiece." },
    // the next four have no web API: they come from the Sensor Deck Android app (app: true)
    { id: "pressure", name: "Barometer", unit: "hPa", ch: ["pressure hPa", "altitude m"], plot: [0], digits: 2, app: true,
      src: "Android app: Sensor.TYPE_PRESSURE", about: "Air pressure. Sea level is about 1013 hPa; it falls about 0.12 hPa per metre you climb, so the altitude (standard atmosphere) follows a lift or a staircase." },
    { id: "temp", name: "Temperature", unit: "°C", ch: ["battery °C", "air °C"], plot: [0, 1], digits: 1, app: true,
      src: "Android app: BatteryManager.EXTRA_TEMPERATURE, Sensor.TYPE_AMBIENT_TEMPERATURE", about: "The battery's temperature (every phone has it) and the air's, on the few phones with an air thermometer." },
    { id: "humidity", name: "Humidity", unit: "%", ch: ["relative humidity %", "dew point °C"], plot: [0], digits: 1, app: true,
      src: "Android app: Sensor.TYPE_RELATIVE_HUMIDITY", about: "Relative humidity, on the few phones with a hygrometer; the dew point needs the air temperature too." },
    { id: "proximity", name: "Proximity", unit: "cm", ch: ["distance cm", "near"], plot: [0], digits: 1, app: true,
      src: "Android app: Sensor.TYPE_PROXIMITY", about: "The infrared sensor that turns the screen off at your ear. Most only say near or far." },
    { id: "geo", name: "Location", unit: "", ch: ["latitude", "longitude", "accuracy m", "altitude m", "speed m/s", "course °"], plot: [4], digits: 6,
      src: "navigator.geolocation", about: "GPS, Wi-Fi and cell position. Speed and course need movement." },
    { id: "mic", name: "Microphone", unit: "dBFS", ch: ["level", "peak Hz"], plot: [0], digits: 1,
      src: "getUserMedia (audio)", about: "Sound level relative to full scale (0 dBFS is the loudest the microphone records) and the strongest frequency." },
    { id: "cam", name: "Camera", unit: "", ch: ["brightness", "red", "green", "blue"], plot: [0], digits: 0,
      src: "getUserMedia (video)", about: "Average brightness and colour the camera sees, 0–255. A light meter when there is no light sensor." },
    { id: "touch", name: "Touch", unit: "", ch: ["fingers", "pressure", "x (0–1)", "y (0–1)", "size px"], plot: [0, 1], digits: 2,
      src: "Pointer events", about: "Fingers on the touch pad below, with pressure and contact size where the screen reports them." },
    { id: "battery", name: "Battery", unit: "%", ch: ["level %", "charging"], plot: [0], digits: 0,
      src: "navigator.getBattery", about: "Charge level and whether the phone is plugged in." },
    { id: "net", name: "Network", unit: "", ch: ["downlink Mb/s", "round trip ms", "online"], plot: [0], digits: 1,
      src: "navigator.connection", about: "The browser's estimate of connection speed and latency." },
    { id: "screen", name: "Screen", unit: "°", ch: ["angle", "width px", "height px"], plot: [], digits: 0,
      src: "screen.orientation", about: "Screen rotation and size." },
    { id: "hwsteps", name: "Step counter", unit: "", ch: ["since boot", "this session"], plot: [], digits: 0, app: true,
      src: "Android app: Sensor.TYPE_STEP_COUNTER", about: "The phone's own low-power step counter, which counts even while the screen is off." },
    { id: "fingerprint", name: "Fingerprint", unit: "", ch: ["matched", "checks"], plot: [], digits: 0, app: true, event: true,
      src: "Android app: BiometricPrompt", about: "Asks Android to check a fingerprint. No app can read the fingerprint itself: Android keeps it in secure hardware and only says whether it matched." },
    { id: "raw", name: "Any sensor", unit: "", ch: ["v1", "v2", "v3", "v4", "v5", "v6"], plot: [0, 1, 2], digits: 3, app: true,
      src: "Android app: SensorManager.getSensorList(TYPE_ALL)", about: "Every sensor the phone has, by Android's own list. Pick one to see its raw values." }
  ];
  var BY_ID = {};
  SENSORS.forEach(function (s, i) { s.index = i; BY_ID[s.id] = s; });

  // ---- ring buffer of [t, values] for the charts and statistics
  function RingBuffer(capacity) { this.cap = capacity; this.t = new Array(capacity); this.v = new Array(capacity); this.start = 0; this.length = 0; }
  RingBuffer.prototype.push = function (t, v) {
    var i = (this.start + this.length) % this.cap;
    if (this.length < this.cap) this.length++; else this.start = (this.start + 1) % this.cap;
    this.t[i] = t; this.v[i] = v;
  };
  RingBuffer.prototype.at = function (k) { var i = (this.start + k) % this.cap; return [this.t[i], this.v[i]]; };
  RingBuffer.prototype.last = function () { return this.length ? this.at(this.length - 1) : null; };
  RingBuffer.prototype.clear = function () { this.start = 0; this.length = 0; };
  // the samples with t >= from, oldest first
  RingBuffer.prototype.since = function (from) {
    var out = [];
    for (var k = 0; k < this.length; k++) { var s = this.at(k); if (s[0] >= from) out.push(s); }
    return out;
  };

  function stats(xs) {
    var n = 0, sum = 0, sq = 0, min = Infinity, max = -Infinity;
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i]; if (typeof x !== "number" || !isFinite(x)) continue;
      n++; sum += x; sq += x * x; if (x < min) min = x; if (x > max) max = x;
    }
    if (!n) return { n: 0, min: null, max: null, mean: null, rms: null, sd: null };
    var mean = sum / n;
    return { n: n, min: min, max: max, mean: mean, rms: Math.sqrt(sq / n), sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }
  function magnitude(x, y, z) { return Math.sqrt(x * x + y * y + (z || 0) * (z || 0)); }

  // samples per second over the last couple of seconds
  function RateMeter(windowMs) { this.w = windowMs || 2000; this.ts = []; }
  RateMeter.prototype.tick = function (t) { this.ts.push(t); while (this.ts.length && this.ts[0] < t - this.w) this.ts.shift(); };
  RateMeter.prototype.rate = function (now) {
    while (this.ts.length && this.ts[0] < now - this.w) this.ts.shift();
    if (this.ts.length < 2) return 0;
    return (this.ts.length - 1) / ((this.ts[this.ts.length - 1] - this.ts[0]) / 1000 || 1);
  };

  // ---- step counter: peaks in the smoothed magnitude of acceleration-with-gravity. A step is a rise above
  // gravity + `high` after having dropped below gravity + `low` (hysteresis), at least 250 ms after the last step.
  function StepCounter(opts) {
    opts = opts || {};
    this.high = opts.high != null ? opts.high : 1.2; this.low = opts.low != null ? opts.low : 0.3;
    this.tau = opts.tau != null ? opts.tau : 60; // smoothing time constant in ms, so any sample rate behaves alike
    this.minGap = 250; this.steps = 0; this.times = []; this.s = null; this.prevT = null; this.armed = true; this.lastStep = -1e9;
  }
  StepCounter.prototype.add = function (t, mag) {
    var dt = this.prevT == null ? 0 : Math.max(0, t - this.prevT); this.prevT = t;
    this.s = this.s == null ? mag : this.s + (1 - Math.exp(-dt / this.tau)) * (mag - this.s);
    var d = this.s - G;
    if (this.armed && d > this.high && t - this.lastStep >= this.minGap) {
      this.steps++; this.lastStep = t; this.armed = false;
      this.times.push(t); if (this.times.length > 11) this.times.shift();
      return true;
    }
    if (!this.armed && d < this.low) this.armed = true;
    return false;
  };
  // steps per minute over the last ten steps; zero once walking has stopped for 2.5 s
  StepCounter.prototype.cadence = function (now) {
    var ts = this.times;
    if (ts.length < 3 || now - ts[ts.length - 1] > 2500) return 0;
    return (ts.length - 1) * 60000 / (ts[ts.length - 1] - ts[0]);
  };
  StepCounter.prototype.reset = function () { this.steps = 0; this.times = []; this.s = null; this.prevT = null; this.armed = true; this.lastStep = -1e9; };

  // ---- shake: three swings of linear acceleration above `threshold` m/s² in alternating directions within 800 ms
  function ShakeDetector(threshold) { this.th = threshold || 12; this.peaks = []; this.count = 0; this.cool = -1e9; this.sign = 0; }
  ShakeDetector.prototype.add = function (t, x, y, z) {
    var ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z), m = Math.max(ax, ay, az);
    if (m < this.th || t < this.cool) return false;
    var v = m === ax ? x : m === ay ? y : z, s = v > 0 ? 1 : -1;
    if (s === this.sign) return false;
    this.sign = s; this.peaks.push(t);
    while (this.peaks.length && this.peaks[0] < t - 800) this.peaks.shift();
    if (this.peaks.length >= 3) { this.count++; this.peaks = []; this.sign = 0; this.cool = t + 1000; return true; }
    return false;
  };

  // ---- compass: the heading of whichever phone axis is closer to horizontal, from W3C alpha/beta/gamma
  // (R = Rz(α)·Rx(β)·Ry(γ), Earth frame x east, y north, z up). Held flat: where the top edge points. Held upright:
  // where the camera on the back points. Returns degrees clockwise from north, or null if alpha is unknown.
  function compassHeading(alpha, beta, gamma) {
    if (alpha == null || !isFinite(alpha)) return null;
    var a = alpha * RAD, b = (beta || 0) * RAD, g = (gamma || 0) * RAD;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    var topE = -sa * cb, topN = ca * cb;                               // device +y
    var backE = -ca * sg - sa * sb * cg, backN = -sa * sg + ca * sb * cg; // device −z (the camera)
    var useTop = Math.abs(cb) >= magnitude(backE, backN) - 1e-9 && Math.abs(beta || 0) < 45;
    var e = useTop ? topE : backE, n = useTop ? topN : backN;
    if (Math.abs(e) < 1e-9 && Math.abs(n) < 1e-9) return null;
    var h = Math.atan2(e, n) * DEG;
    return (h + 360) % 360;
  }
  var POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  function cardinal(deg, sixteen) {
    if (deg == null || !isFinite(deg)) return "";
    var d = ((deg % 360) + 360) % 360;
    if (sixteen) return POINTS16[Math.round(d / 22.5) % 16];
    return POINTS16[(Math.round(d / 45) % 8) * 2];
  }
  // spirit level from acceleration including gravity: degrees of tilt toward x and y, and from flat overall
  function level(ax, ay, az) {
    var m = magnitude(ax, ay, az);
    if (!m) return { x: 0, y: 0, tilt: 0 };
    return { x: Math.atan2(ax, magnitude(ay, az)) * DEG, y: Math.atan2(ay, magnitude(ax, az)) * DEG, tilt: Math.acos(Math.max(-1, Math.min(1, az / m))) * DEG };
  }

  // ---- spectrum
  // in-place radix-2 FFT; re and im have a power-of-two length
  function fft(re, im) {
    var n = re.length, i, j, k;
    if (n & (n - 1)) throw new Error("fft length must be a power of two");
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var tr = re[i]; re[i] = re[j]; re[j] = tr; var ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  // evenly spaced samples at `rate` Hz from uneven (t ms, value) pairs, by linear interpolation
  function resample(ts, vs, rate) {
    if (ts.length < 2) return [];
    var out = [], step = 1000 / rate, j = 0;
    for (var t = ts[0]; t <= ts[ts.length - 1]; t += step) {
      while (j < ts.length - 2 && ts[j + 1] < t) j++;
      var t0 = ts[j], t1 = ts[j + 1], f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      out.push(vs[j] + (vs[j + 1] - vs[j]) * Math.max(0, Math.min(1, f)));
    }
    return out;
  }
  // the strongest frequency (Hz) in evenly spaced samples, mean removed and Hann-windowed; ignores below minHz
  function dominantFrequency(xs, rate, minHz) {
    var n = 1; while (n * 2 <= xs.length) n *= 2;
    if (n < 16) return null;
    var seg = xs.slice(xs.length - n), mean = seg.reduce(function (a, b) { return a + b; }, 0) / n;
    var re = new Array(n), im = new Array(n);
    for (var i = 0; i < n; i++) { re[i] = (seg[i] - mean) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); im[i] = 0; }
    fft(re, im);
    var best = -1, bm = 0, lo = Math.max(1, Math.ceil((minHz || 0) * n / rate)), mags = [];
    for (i = 0; i <= n / 2; i++) mags.push(Math.hypot(re[i], im[i]));
    for (i = lo; i < n / 2; i++) if (mags[i] > bm) { bm = mags[i]; best = i; }
    if (best < 0 || bm < 1e-9) return null;
    return { freq: refine(mags, best) * rate / n, magnitude: bm / n };
  }
  // the peak of a spectrum in dB from an AnalyserNode (bin k is k·sampleRate/fftSize Hz), with parabolic interpolation
  function peakFrequency(db, sampleRate, fftSize, minHz, floorDb) {
    var lo = Math.max(1, Math.ceil((minHz || 0) * fftSize / sampleRate)), best = -1, bv = floorDb != null ? floorDb : -90;
    for (var i = lo; i < db.length - 1; i++) if (db[i] > bv) { bv = db[i]; best = i; }
    if (best < 0) return null;
    return refine(db, best) * sampleRate / fftSize;
  }
  function refine(a, k) {
    if (k <= 0 || k >= a.length - 1) return k;
    var y0 = a[k - 1], y1 = a[k], y2 = a[k + 1], d = y0 - 2 * y1 + y2;
    return d ? k + 0.5 * (y0 - y2) / d : k;
  }
  // root mean square of time-domain samples (−1..1) as dB relative to full scale, floored at −100
  function dbfs(samples) {
    var s = 0;
    for (var i = 0; i < samples.length; i++) s += samples[i] * samples[i];
    var rms = Math.sqrt(s / (samples.length || 1));
    return rms > 1e-5 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
  }

  // ---- location
  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // a GPS track that ignores poor fixes (accuracy worse than 50 m) and jitter smaller than the fix's own uncertainty
  function Track() { this.points = []; this.distance = 0; }
  Track.prototype.add = function (t, lat, lon, acc) {
    if (!isFinite(lat) || !isFinite(lon) || !(acc <= 50)) return false;
    var last = this.points[this.points.length - 1];
    if (last) {
      var d = haversine(last[1], last[2], lat, lon);
      if (d < Math.max(3, Math.max(acc, last[3]) / 2)) return false;
      this.distance += d;
    }
    this.points.push([t, lat, lon, acc]);
    if (this.points.length > 5000) this.points.shift();
    return true;
  };

  // ---- export: one row per sample in long form (time, sensor, then that sensor's channels), so every sensor's
  // own rate is kept. `samples` is a list of [t ms, sensorId, values].
  function csvCell(v) {
    if (v == null || (typeof v === "number" && !isFinite(v))) return "";
    var s = typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(samples) {
    var width = 0;
    SENSORS.forEach(function (s) { width = Math.max(width, s.ch.length); });
    var head = ["time_s", "sensor"]; for (var i = 1; i <= width; i++) head.push("v" + i);
    var lines = [head.join(",")];
    samples.forEach(function (r) {
      var row = [csvCell(r[0] / 1000), csvCell(r[1])];
      for (var i = 0; i < width; i++) row.push(csvCell(r[2] && r[2][i]));
      lines.push(row.join(","));
    });
    return lines.join("\n") + "\n";
  }
  // which column means what, for the CSV
  function csvLegend() {
    return "sensor,unit,source," + ["v1", "v2", "v3", "v4", "v5", "v6"].join(",") + "\n" + SENSORS.map(function (s) {
      return [s.id, s.unit, s.src].concat(s.ch).map(csvCell).join(",");
    }).join("\n") + "\n";
  }

  // ---- phone → computer messages (JSON over a WebRTC data channel). Everything received is checked: known types
  // only, known sensor ids, numbers or null for values, short strings, bounded sizes. Anything else is dropped.
  var PROTOCOL = 1;
  function isNum(x) { return x === null || (typeof x === "number" && isFinite(x)); }
  function shortStr(x, n) { return typeof x === "string" ? x.slice(0, n || 200) : ""; }
  function checkMessage(m) {
    if (!m || typeof m !== "object") return null;
    if (m.type === "hello") {
      var info = {};
      if (m.info && typeof m.info === "object") Object.keys(m.info).slice(0, 40).forEach(function (k) { info[shortStr(k, 40)] = shortStr(String(m.info[k]), 200); });
      return { type: "hello", protocol: +m.protocol || 0, info: info, sensors: Array.isArray(m.sensors) ? m.sensors.filter(function (id) { return BY_ID[id]; }).slice(0, 40) : [] };
    }
    if (m.type === "batch" && Array.isArray(m.items)) {
      var items = [];
      for (var i = 0; i < m.items.length && i < 2000; i++) {
        var it = m.items[i];
        if (!Array.isArray(it) || it.length !== 3 || !isNum(it[0]) || it[0] === null || !BY_ID[it[1]] || !Array.isArray(it[2])) continue;
        var v = it[2].slice(0, BY_ID[it[1]].ch.length);
        if (!v.every(isNum)) continue;
        items.push([it[0], it[1], v]);
      }
      return { type: "batch", items: items };
    }
    if (m.type === "meta" && BY_ID[m.id]) return { type: "meta", id: m.id, text: shortStr(m.text, 300) };
    if (m.type === "status" && BY_ID[m.id]) return { type: "status", id: m.id, state: ["on", "off", "denied", "unavailable", "error"].indexOf(m.state) >= 0 ? m.state : "off", text: shortStr(m.text, 300) };
    if (m.type === "frame" && typeof m.jpeg === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.jpeg) && m.jpeg.length < 200000) return { type: "frame", jpeg: m.jpeg };
    if (m.type === "event" && ["step", "shake"].indexOf(m.name) >= 0) return { type: "event", name: m.name, t: isNum(m.t) ? m.t : 0 };
    if (m.type === "bye") return { type: "bye" };
    // computer → phone: a round-trip probe, and the one command a phone accepts (a short buzz)
    if ((m.type === "ping" || m.type === "pong") && isNum(m.n) && m.n !== null && isNum(m.t) && m.t !== null) return { type: m.type, n: m.n, t: m.t };
    if (m.type === "cmd" && m.name === "vibrate") return { type: "cmd", name: "vibrate" };
    return null;
  }
  // the USB bridge's status message ({type: "bridge", phone, viewer, device, adb}), reduced to known fields
  function checkBridge(m) {
    if (!m || typeof m !== "object" || m.type !== "bridge") return null;
    return { type: "bridge", phone: m.phone === true, viewer: m.viewer === true, device: m.device ? shortStr(String(m.device), 80) : null, adb: shortStr(String(m.adb || ""), 120) };
  }
  // collects samples and hands them over in batches, at most every `ms`, thinning each sensor to `maxHz`
  // (timers jitter, so a reading up to a quarter early still counts as on time)
  function Batcher(ms, maxHz) { this.ms = ms || 50; this.minGap = 0.75 * 1000 / (maxHz || 60); this.items = []; this.lastFlush = 0; this.lastBy = {}; }
  Batcher.prototype.add = function (t, id, v) {
    if (this.lastBy[id] != null && t - this.lastBy[id] < this.minGap) return false;
    this.lastBy[id] = t; this.items.push([t, id, v]); return true;
  };
  Batcher.prototype.take = function (now) {
    if (!this.items.length || now - this.lastFlush < this.ms) return null;
    this.lastFlush = now; var out = { type: "batch", items: this.items }; this.items = []; return out;
  };

  // a short code for pairing that is easy to read aloud and type: no 0/O, 1/I/L
  var CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function pairCode(rnd) {
    rnd = rnd || Math.random; var s = "";
    for (var i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
    return s;
  }
  function normaliseCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }
  function validCode(s) { return /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/.test(s); }
  var PEER_PREFIX = "kathuman-sensordeck-";

  // ---- the demo phone: someone walking at 1.8 steps a second with the phone in hand, turning slowly, in Copenhagen.
  // Deterministic in t (seconds), so the charts, the step counter and the tests all see the same signal.
  function simulate(t) {
    var f = 1.8, ph = 2 * Math.PI * f * t, bounce = Math.max(0, Math.sin(ph));
    var heading = (40 + 6 * t) % 360, pitch = 35 + 4 * Math.sin(ph / 2), roll = 3 * Math.sin(ph / 2 + 1);
    var b = pitch * RAD, g = roll * RAD;
    // gravity in phone axes for that tilt, plus the bounce of each step along the phone's up direction
    var gx = -G * Math.cos(b) * Math.sin(g), gy = G * Math.sin(b), gz = G * Math.cos(b) * Math.cos(g);
    var lin = 3.2 * bounce * bounce - 1.0, lx = 0.4 * Math.sin(ph / 2), ly = lin * Math.sin(b), lz = lin * Math.cos(b);
    var alpha = (360 - heading) % 360;
    var walked = 1.3 * t, north = walked * Math.cos(heading * RAD), east = walked * Math.sin(heading * RAD);
    var lat = 55.6761 + north / 111320, lon = 12.5683 + east / (111320 * Math.cos(55.6761 * RAD));
    var hum = 0.02 * Math.sin(2 * Math.PI * 0.25 * t);
    return {
      accel: [gx + lx, gy + ly, gz + lz, magnitude(gx + lx, gy + ly, gz + lz)],
      linacc: [lx, ly, lz, magnitude(lx, ly, lz)],
      gyro: [8 * Math.cos(ph / 2) * f, 4 * Math.cos(ph / 2 + 1) * f, 6],
      orient: [heading, pitch, roll, alpha],
      mag: [22 * Math.sin(heading * RAD), 22 * Math.cos(heading * RAD) * Math.cos(b) - 40 * Math.sin(b), -40 * Math.cos(b) - 5, 0].map(function (v, i, a) { return i === 3 ? magnitude(a[0], a[1], a[2]) : v; }),
      light: [320 + 60 * Math.sin(t / 7)],
      geo: [lat, lon, 6, 14 + 0.5 * Math.sin(t / 30), 1.3, heading],
      mic: [-46 + 6 * Math.sin(t * 1.3) + 40 * hum, 220 + 30 * Math.sin(t / 4)],
      touch: [0, 0, 0, 0, 0],
      cam: [118 + 20 * Math.sin(t / 5), 126, 120, 104],
      battery: [Math.max(5, 81 - t / 120), 0],
      net: [12.5, 45, 1],
      screen: [0, 412, 915],
      pressure: [1009.6 - 0.02 * Math.sin(t / 9), altitude(1009.6 - 0.02 * Math.sin(t / 9))],
      temp: [31.5 + t / 600, 21.8], humidity: [46, dewPoint(21.8, 46)], proximity: [5, 0],
      hwsteps: [18240 + Math.floor(1.8 * t), Math.floor(1.8 * t)],
      raw: [gx + lx, gy + ly, gz + lz, 0, 0, 0]
    };
  }

  // a reading Android reports as a sentinel (the emulator sends −1e30 for an unset sensor) or as not-a-number is
  // no reading at all
  function sane(x) { return typeof x === "number" && isFinite(x) && Math.abs(x) < 1e7 ? x : null; }

  // altitude from air pressure in the standard atmosphere (ICAO), metres, relative to a sea-level pressure p0
  function altitude(p, p0) { return p > 0 ? 44330 * (1 - Math.pow(p / (p0 || 1013.25), 1 / 5.255)) : null; }
  // dew point (°C) from air temperature (°C) and relative humidity (%), Magnus formula (Sonntag 1990 constants)
  function dewPoint(t, rh) {
    if (t == null || !(rh > 0)) return null;
    var a = 17.62, b = 243.12, g = Math.log(rh / 100) + a * t / (b + t);
    return b * g / (a - g);
  }

  function fmt(v, digits) {
    if (v == null || (typeof v === "number" && !isFinite(v))) return "–";
    if (typeof v !== "number") return String(v);
    var d = digits == null ? 2 : digits;
    var s = v.toFixed(d);
    return s === "-" + (0).toFixed(d) ? (0).toFixed(d) : s;
  }

  return {
    G: G, SENSORS: SENSORS, BY_ID: BY_ID, RingBuffer: RingBuffer, stats: stats, magnitude: magnitude, RateMeter: RateMeter,
    StepCounter: StepCounter, ShakeDetector: ShakeDetector, compassHeading: compassHeading, cardinal: cardinal, level: level,
    fft: fft, resample: resample, dominantFrequency: dominantFrequency, peakFrequency: peakFrequency, dbfs: dbfs,
    haversine: haversine, Track: Track, toCSV: toCSV, csvLegend: csvLegend, csvCell: csvCell,
    PROTOCOL: PROTOCOL, checkMessage: checkMessage, checkBridge: checkBridge, USB_PORT: 8766, Batcher: Batcher, pairCode: pairCode, normaliseCode: normaliseCode, validCode: validCode,
    PEER_PREFIX: PEER_PREFIX, simulate: simulate, fmt: fmt, altitude: altitude, dewPoint: dewPoint, sane: sane
  };
});
