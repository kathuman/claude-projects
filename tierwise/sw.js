// Tierwise — works offline once it has been opened. The page's own files are fetched fresh whenever the network is there
// (so a new version arrives at once) and kept as a copy for when it is not. The solver and the Excel library come from
// CDNs at fixed versions, so a copy of them never goes stale and is used first.
var CACHE = "tierwise-2.5.0", SHELL = ["./", "index.html", "style.css", "app.js", "studio.js", "i18n.js", "i18n-es.js", "i18n-da.js", "tour.js", "tour-content.js", "tour-content-es.js", "tour-content-da.js",
  "about.html", "validation.html", "assets/land.json", "src/plan.js", "src/network.js", "src/graph.js", "src/geo.js", "src/io.js", "src/store.js", "src/constrained.js", "src/invest.js", "src/priorities.js",
  "src/api.js", "src/jobs.js", "src/solve-worker.js", "src/invest-worker.js", "src/priorities-worker.js", "src/validation.js", "src/validation-worker.js"];
var PINNED = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/highs@1\.15\.3\/|cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/|fonts\.(googleapis|gstatic)\.com\/)/;
self.addEventListener("install", function (e) {
  // each file on its own, so one that is missing does not stop the rest from being kept
  e.waitUntil(caches.open(CACHE).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf("tierwise-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  if (PINNED.test(req.url)) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); return res; }); }));
    return;
  }
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); });
  }));
});
