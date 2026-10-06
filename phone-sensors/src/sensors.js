// sensors.js — reads each of the phone's sensors through the web APIs Android's Chrome (and, where it can, iOS
// Safari) offers, and reports every reading as emit(id, values) with values in the order of SensorCore.SENSORS[id].ch.
// Each source has start() (call it from a tap: most need permission) and stop(), and reports its state through
// status(id, "on" | "off" | "denied" | "unavailable" | "error", text). Text facts that are not numbers (the network
// type, whether a heading is true north) go through meta(id, text).
(function (root) {
  "use strict";
  var C = root.SensorCore;

  function SensorHub(emit, status, meta) {
    this.emit = emit; this.status = status; this.meta = meta || function () {};
    this.on = {}; this.cleanup = {}; this.motionUsers = 0; this.motionSeen = false;
    this.audio = null; this.video = null; this.track = null;
  }
  var P = SensorHub.prototype;

  P.isOn = function (id) { return !!this.on[id]; };
  P.start = function (id) {
    if (this.on[id]) return Promise.resolve(true);
    var f = this["start_" + id];
    if (!f) { this.status(id, "unavailable", "Not readable from a web page."); return Promise.resolve(false); }
    var self = this;
    return Promise.resolve().then(function () { return f.call(self); }).then(function (ok) {
      if (ok !== false) { self.on[id] = true; }
      return ok !== false;
    }, function (err) {
      var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError" || err.code === 1 || /denied|permission/i.test(err.message || ""));
      self.status(id, denied ? "denied" : "error", denied ? "Permission was refused. Allow it in the browser's site settings and try again." : (err && err.message) || String(err));
      return false;
    });
  };
  P.stop = function (id) {
    if (this.cleanup[id]) { try { this.cleanup[id](); } catch (e) { /* already stopped */ } }
    delete this.cleanup[id]; delete this.on[id];
    this.status(id, "off", "");
  };
  P.stopAll = function () { var self = this; Object.keys(this.on).forEach(function (id) { self.stop(id); }); };

  // iOS 13+ asks for motion and orientation permission once, from a tap. Call this first, inside the click handler.
  P.askMotionPermission = function () {
    var asks = [];
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") asks.push(DeviceMotionEvent.requestPermission());
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") asks.push(DeviceOrientationEvent.requestPermission());
    return Promise.all(asks).then(function (r) { return r.every(function (x) { return x === "granted"; }); }, function () { return false; });
  };

  // ---- motion: one devicemotion listener feeds the accelerometer, linear acceleration and gyroscope cards
  P.motionListen = function (id) {
    var self = this;
    if (typeof DeviceMotionEvent === "undefined") { this.status(id, "unavailable", "This browser has no motion events."); return false; }
    this.motionUsers++;
    if (!this.motionHandler) {
      this.motionHandler = function (e) {
        self.motionSeen = true;
        var g = e.accelerationIncludingGravity, a = e.acceleration, r = e.rotationRate;
        if (self.on.accel && g && g.x != null) self.emit("accel", [g.x, g.y, g.z, C.magnitude(g.x, g.y, g.z)]);
        if (self.on.linacc && a && a.x != null) self.emit("linacc", [a.x, a.y, a.z, C.magnitude(a.x, a.y, a.z)]);
        if (self.on.gyro && r && r.alpha != null) self.emit("gyro", [r.beta, r.gamma, r.alpha]);
      };
      root.addEventListener("devicemotion", this.motionHandler);
    }
    this.cleanup[id] = function () {
      self.motionUsers--;
      if (self.motionUsers <= 0 && self.motionHandler) { root.removeEventListener("devicemotion", self.motionHandler); self.motionHandler = null; self.motionUsers = 0; }
    };
    this.status(id, "on", "");
    // desktops have the event but never fire it: say so after a while
    setTimeout(function () { if (self.on[id] && !self.motionSeen) self.status(id, "unavailable", "No readings: this device has no motion sensor, or the browser hides it."); }, 2500);
    return true;
  };
  P.start_accel = function () { return this.motionListen("accel"); };
  P.start_linacc = function () { return this.motionListen("linacc"); };
  P.start_gyro = function () { return this.motionListen("gyro"); };

  // ---- orientation: prefer the absolute (true-north) event; iOS gives webkitCompassHeading instead
  P.start_orient = function () {
    var self = this, absolute = "ondeviceorientationabsolute" in root, type = absolute ? "deviceorientationabsolute" : "deviceorientation", seen = false;
    if (typeof DeviceOrientationEvent === "undefined") { this.status("orient", "unavailable", "This browser has no orientation events."); return false; }
    var h = function (e) {
      if (e.alpha == null && e.beta == null) return;
      seen = true;
      var heading = typeof e.webkitCompassHeading === "number" ? e.webkitCompassHeading : (absolute || e.absolute) ? C.compassHeading(e.alpha, e.beta, e.gamma) : null;
      self.emit("orient", [heading, e.beta, e.gamma, e.alpha]);
    };
    root.addEventListener(type, h);
    this.cleanup.orient = function () { root.removeEventListener(type, h); };
    this.status("orient", "on", "");
    this.meta("orient", absolute || typeof root.webkitCompassHeading !== "undefined" ? "Heading from magnetic north (true compass)." : "Heading is relative: this browser gives no compass reference.");
    setTimeout(function () { if (self.on.orient && !seen) self.status("orient", "unavailable", "No readings: this device has no orientation sensor."); }, 2500);
    return true;
  };

  // ---- Generic Sensor API (Chrome on Android): magnetometer and ambient light
  P.generic = function (id, Ctor, name, read, flag) {
    var self = this;
    if (typeof root[Ctor] !== "function") {
      this.status(id, "unavailable", name + " is not exposed to web pages here." + (flag ? " In Chrome on Android, turn on chrome://flags/#enable-generic-sensor-extra-classes and reload." : ""));
      return false;
    }
    var s;
    try { s = new root[Ctor]({ frequency: 20 }); } catch (e) { this.status(id, e.name === "SecurityError" ? "denied" : "unavailable", e.message); return false; }
    s.addEventListener("reading", function () { self.emit(id, read(s)); });
    s.addEventListener("error", function (e) {
      var n = e.error && e.error.name;
      self.status(id, n === "NotAllowedError" ? "denied" : n === "NotReadableError" ? "unavailable" : "error", (e.error && e.error.message) || "Sensor error");
    });
    s.start();
    this.cleanup[id] = function () { s.stop(); };
    this.status(id, "on", "");
    return true;
  };
  P.start_mag = function () { return this.generic("mag", "Magnetometer", "The magnetometer", function (s) { return [s.x, s.y, s.z, C.magnitude(s.x, s.y, s.z)]; }, true); };
  P.start_light = function () { return this.generic("light", "AmbientLightSensor", "The light sensor", function (s) { return [s.illuminance]; }, true); };

  // ---- location
  P.start_geo = function () {
    var self = this;
    if (!navigator.geolocation) { this.status("geo", "unavailable", "No location in this browser."); return false; }
    return new Promise(function (resolve, reject) {
      var first = true;
      var id = navigator.geolocation.watchPosition(function (p) {
        var c = p.coords;
        self.emit("geo", [c.latitude, c.longitude, c.accuracy, c.altitude, c.speed, c.heading != null && !isNaN(c.heading) ? c.heading : null]);
        if (first) { first = false; self.status("geo", "on", ""); resolve(true); }
      }, function (err) {
        if (first) { first = false; navigator.geolocation.clearWatch(id); reject(err.code === 1 ? Object.assign(new Error("denied"), { name: "NotAllowedError" }) : new Error(err.message || "No position")); }
        else self.status("geo", "error", err.message);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      self.cleanup.geo = function () { navigator.geolocation.clearWatch(id); };
      self.status("geo", "on", "Waiting for the first fix…");
    });
  };

  // ---- microphone: level and strongest frequency 20 times a second; the analyser is kept for the spectrum view
  P.start_mic = function () {
    var self = this;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.status("mic", "unavailable", "No microphone access in this browser."); return false; }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      var AC = root.AudioContext || root.webkitAudioContext, ctx = new AC(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 4096; an.smoothingTimeConstant = 0.5; src.connect(an);
      var td = new Float32Array(an.fftSize), fd = new Float32Array(an.frequencyBinCount);
      var timer = setInterval(function () {
        an.getFloatTimeDomainData(td); an.getFloatFrequencyData(fd);
        var lvl = C.dbfs(td);
        self.emit("mic", [lvl, lvl > -70 ? C.peakFrequency(fd, ctx.sampleRate, an.fftSize, 60, -85) : null]);
      }, 50);
      self.audio = { ctx: ctx, analyser: an, freq: fd };
      self.cleanup.mic = function () { clearInterval(timer); stream.getTracks().forEach(function (t) { t.stop(); }); ctx.close(); self.audio = null; };
      self.status("mic", "on", "");
      return true;
    });
  };

  // ---- camera: average brightness and colour five times a second from a tiny copy of the frame; the torch where
  // the phone has one. frame(quality) returns a small JPEG for the computer view.
  P.start_cam = function () {
    var self = this;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.status("cam", "unavailable", "No camera access in this browser."); return false; }
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }).then(function (stream) {
      var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.srcObject = stream;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      var cv = document.createElement("canvas"); cv.width = 64; cv.height = 48;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      var timer = setInterval(function () {
        if (v.readyState < 2) return;
        cx.drawImage(v, 0, 0, 64, 48);
        var d = cx.getImageData(0, 0, 64, 48).data, r = 0, g = 0, b = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        r /= n; g /= n; b /= n;
        self.emit("cam", [0.299 * r + 0.587 * g + 0.114 * b, r, g, b]);
      }, 200);
      self.video = v; self.track = stream.getVideoTracks()[0];
      self.cleanup.cam = function () { clearInterval(timer); stream.getTracks().forEach(function (t) { t.stop(); }); self.video = null; self.track = null; };
      self.status("cam", "on", "");
      return true;
    });
  };
  P.hasTorch = function () {
    try { return !!(this.track && this.track.getCapabilities && this.track.getCapabilities().torch); } catch (e) { return false; }
  };
  P.torch = function (on) { return this.track ? this.track.applyConstraints({ advanced: [{ torch: !!on }] }) : Promise.reject(new Error("camera off")); };
  P.frame = function (w, q) {
    var v = this.video; if (!v || v.readyState < 2) return null;
    var h = Math.round(w * (v.videoHeight || 3) / (v.videoWidth || 4));
    var cv = this._fc || (this._fc = document.createElement("canvas")); cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(v, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", q || 0.5);
  };

  // ---- touch: the page's touch pad reports pointers through touch(list)
  P.start_touch = function () { this.status("touch", "on", "Touch the pad."); return true; };
  P.touch = function (pts) {
    if (!this.on.touch) return;
    var p = pts[0] || {};
    this.emit("touch", [pts.length, pts.length ? p.pressure : 0, pts.length ? p.x : null, pts.length ? p.y : null, pts.length ? p.size : null]);
  };

  // ---- battery
  P.start_battery = function () {
    var self = this;
    if (!navigator.getBattery) { this.status("battery", "unavailable", "This browser does not report the battery (Safari and Firefox don't)."); return false; }
    return navigator.getBattery().then(function (b) {
      var send = function () {
        self.emit("battery", [b.level * 100, b.charging ? 1 : 0]);
        var t = b.charging ? (isFinite(b.chargingTime) && b.chargingTime ? "Full in about " + Math.round(b.chargingTime / 60) + " min." : "Charging.")
          : (isFinite(b.dischargingTime) && b.dischargingTime ? "About " + Math.round(b.dischargingTime / 3600 * 10) / 10 + " h left." : "On battery.");
        self.meta("battery", t);
      };
      ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"].forEach(function (e) { b.addEventListener(e, send); });
      var timer = setInterval(send, 5000); send();
      self.cleanup.battery = function () { clearInterval(timer); ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"].forEach(function (e) { b.removeEventListener(e, send); }); };
      self.status("battery", "on", "");
      return true;
    });
  };

  // ---- network
  P.start_net = function () {
    var self = this, c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var send = function () {
      self.emit("net", [c && c.downlink != null ? c.downlink : null, c && c.rtt != null ? c.rtt : null, navigator.onLine ? 1 : 0]);
      self.meta("net", (navigator.onLine ? "Online" : "Offline") + (c ? " · " + [c.type, c.effectiveType && c.effectiveType.toUpperCase() + " class", c.saveData ? "data saver on" : ""].filter(Boolean).join(" · ") : " · this browser gives no connection details"));
    };
    if (c && c.addEventListener) c.addEventListener("change", send);
    root.addEventListener("online", send); root.addEventListener("offline", send);
    var timer = setInterval(send, 3000); send();
    this.cleanup.net = function () { clearInterval(timer); if (c && c.removeEventListener) c.removeEventListener("change", send); root.removeEventListener("online", send); root.removeEventListener("offline", send); };
    this.status("net", "on", "");
    return true;
  };

  // ---- screen
  P.start_screen = function () {
    var self = this;
    var send = function () {
      var o = screen.orientation;
      self.emit("screen", [o ? o.angle : (typeof root.orientation === "number" ? root.orientation : 0), root.innerWidth, root.innerHeight]);
      self.meta("screen", (o ? o.type.replace("-", " ") : "") + " · " + screen.width + "×" + screen.height + " at " + (root.devicePixelRatio || 1) + "× pixel ratio");
    };
    if (screen.orientation) screen.orientation.addEventListener("change", send);
    root.addEventListener("resize", send);
    send();
    this.cleanup.screen = function () { if (screen.orientation) screen.orientation.removeEventListener("change", send); root.removeEventListener("resize", send); };
    this.status("screen", "on", "");
    return true;
  };

  // ---- the device itself: model (Android Chrome reports it), system, cores, memory, screen, and which APIs exist
  function deviceInfo() {
    var n = navigator, info = {
      "Browser": (n.userAgentData && n.userAgentData.brands ? n.userAgentData.brands.filter(function (b) { return !/Not.?A.?Brand/i.test(b.brand); }).map(function (b) { return b.brand + " " + b.version; }).join(", ") : "") || n.userAgent.replace(/^Mozilla\/5\.0 /, ""),
      "System": n.userAgentData ? (n.userAgentData.platform || "") + (n.userAgentData.mobile ? " (mobile)" : "") : n.platform,
      "CPU cores": n.hardwareConcurrency || "unknown",
      "Memory": n.deviceMemory ? "≈ " + n.deviceMemory + " GB (rounded by the browser)" : "not reported",
      "Screen": screen.width + " × " + screen.height + " CSS px at " + (root.devicePixelRatio || 1) + "×",
      "Touch points": n.maxTouchPoints || 0,
      "Language": n.language,
      "Time zone": (Intl.DateTimeFormat().resolvedOptions().timeZone || ""),
      "Secure page": root.isSecureContext ? "yes" : "no — sensors need HTTPS",
      "Motion events": typeof DeviceMotionEvent !== "undefined" ? "yes" : "no",
      "Compass (absolute orientation)": "ondeviceorientationabsolute" in root ? "yes" : "no",
      "Magnetometer API": typeof root.Magnetometer === "function" ? "yes" : "no",
      "Light sensor API": typeof root.AmbientLightSensor === "function" ? "yes" : "no",
      "Vibration": n.vibrate ? "yes" : "no",
      "Screen wake lock": n.wakeLock ? "yes" : "no"
    };
    if (n.userAgentData && n.userAgentData.getHighEntropyValues) {
      return n.userAgentData.getHighEntropyValues(["model", "platformVersion"]).then(function (h) {
        if (h.model) info = Object.assign({ "Model": h.model }, info);
        if (h.platformVersion) info.System = (n.userAgentData.platform || "") + " " + h.platformVersion + (n.userAgentData.mobile ? " (mobile)" : "");
        return info;
      }, function () { return info; });
    }
    return Promise.resolve(info);
  }

  root.SensorHub = SensorHub;
  root.SensorHub.deviceInfo = deviceInfo;
})(typeof self !== "undefined" ? self : this);
