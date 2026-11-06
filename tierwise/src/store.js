// Tierwise — the data layer (window.TWStore / module.exports). Networks, named scenarios and decisions are kept as
// records that are never changed in place: saving again adds a version that points to the one before, so every earlier
// state can be read back and compared. Each record carries an owner and a schema version from the start, so that when
// accounts and a server arrive the same records move across without a migration. For the pilot the records live in the
// browser (localStorage); the back end is a small get/set/keys object, so a database can replace it behind the same calls.
// Also here: `diff`, what changed between two networks, site by site and route by route.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TWStore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var SCHEMA = 1, PREFIX = "tierwise.v1.", KEEP_AUTOSAVES = 20;

  function hashOf(text) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ("00000000" + (h2 >>> 0).toString(16)).slice(-8) + ("00000000" + (h1 >>> 0).toString(16)).slice(-8);
  }
  // back ends: a plain object in memory (tests, or when the browser refuses storage), or the browser's localStorage
  function memory() { var m = {}; return { get: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, set: function (k, v) { m[k] = String(v); }, del: function (k) { delete m[k]; }, keys: function () { return Object.keys(m); } }; }
  function browser(ls) {
    try { ls.setItem(PREFIX + "probe", "1"); ls.removeItem(PREFIX + "probe"); } catch (e) { return null; }
    return { get: function (k) { return ls.getItem(k); }, set: function (k, v) { ls.setItem(k, v); }, del: function (k) { ls.removeItem(k); }, keys: function () { var o = []; for (var i = 0; i < ls.length; i++) o.push(ls.key(i)); return o; } };
  }

  function open(backend, opts) {
    opts = opts || {};
    var be = backend || memory(), owner = opts.owner || "local", now = opts.now || function () { return new Date().toISOString(); }, seq = 0;
    var read = function (k) { try { var r = JSON.parse(be.get(k)); return r && r.schema && r.kind ? r : null; } catch (e) { return null; } };
    // every record in the store, of a kind; newest first. Unreadable entries are skipped, not fatal.
    function all(kind) {
      return be.keys().filter(function (k) { return k.indexOf(PREFIX + "rec.") === 0; }).map(read).filter(function (r) { return r && (!kind || r.kind === kind); })
        .sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : b.seq - a.seq; });
    }
    // add a record. With a name, it becomes the newest version of that name, pointing to the one before.
    function put(kind, name, data, extra) {
      var text = JSON.stringify(data), prev = name != null ? latest(kind, name) : null;
      var rec = Object.assign({ id: "", kind: kind, schema: SCHEMA, owner: owner, name: name == null ? null : String(name), created: now(), seq: ++seq, parent: prev ? prev.id : null, version: prev ? prev.version + 1 : 1, hash: hashOf(text), data: data }, extra || {});
      rec.id = kind + "-" + hashOf(rec.created + "|" + rec.seq + "|" + rec.hash + "|" + Math.random()).slice(0, 12);
      try { be.set(PREFIX + "rec." + rec.id, JSON.stringify(rec)); }
      catch (e) { return { ok: false, error: "The browser's storage is full: export your scenarios as files, then delete old ones." }; }
      return { ok: true, record: rec };
    }
    function get(id) { return read(PREFIX + "rec." + id); }
    function versions(kind, name) { return all(kind).filter(function (r) { return r.name === String(name); }); }
    function latest(kind, name) { return versions(kind, name)[0] || null; }
    // the newest version of each name, for a list
    function names(kind) { var seen = {}, out = []; all(kind).forEach(function (r) { if (r.name != null && !seen[r.name]) { seen[r.name] = 1; out.push({ name: r.name, latest: r, versions: versions(kind, r.name).length }); } }); return out; }
    // deleting is the user's choice about their own data: every version of the name goes
    function remove(kind, name) { versions(kind, name).forEach(function (r) { be.del(PREFIX + "rec." + r.id); }); }
    // the session: kept as its own short history, so a reload resumes where you were
    function autosave(data) {
      var last = latest("autosave", "session");
      if (last && last.hash === hashOf(JSON.stringify(data))) return { ok: true, record: last, unchanged: true };
      var r = put("autosave", "session", data);
      versions("autosave", "session").slice(KEEP_AUTOSAVES).forEach(function (o) { be.del(PREFIX + "rec." + o.id); });
      return r;
    }
    function session() { var r = latest("autosave", "session"); return r ? r.data : null; }
    function clearSession() { remove("autosave", "session"); }
    return { put: put, get: get, all: all, versions: versions, latest: latest, names: names, remove: remove, autosave: autosave, session: session, clearSession: clearSession };
  }

  // what changed from network a to network b: sites added, removed and changed (field by field), routes likewise, settings
  function diff(a, b) {
    var byId = function (n) { var m = {}; n.sites.forEach(function (s) { m[s.id] = s; }); return m; };
    var A = byId(a), B = byId(b), skip = { suppliers: 1, id: 1 }, out = { sites: { added: [], removed: [], changed: [] }, routes: { added: [], removed: [], changed: [] }, settings: [] };
    var same = function (x, y) { return JSON.stringify(x) === JSON.stringify(y); };
    Object.keys(B).forEach(function (id) { if (!A[id]) out.sites.added.push(id); });
    Object.keys(A).forEach(function (id) {
      if (!B[id]) { out.sites.removed.push(id); return; }
      var keys = {}; Object.keys(A[id]).concat(Object.keys(B[id])).forEach(function (k) { if (!skip[k]) keys[k] = 1; });
      var f = Object.keys(keys).filter(function (k) { return !same(A[id][k], B[id][k]); }).map(function (k) { return { k: k, from: A[id][k], to: B[id][k] }; });
      if (f.length) out.sites.changed.push({ id: id, fields: f });
    });
    var routes = function (n) { var m = {}; n.sites.forEach(function (s) { (s.suppliers || []).forEach(function (l) { m[l.from + ">" + s.id] = l; }); }); return m; };
    var RA = routes(a), RB = routes(b);
    Object.keys(RB).forEach(function (k) { if (!RA[k]) out.routes.added.push(k); });
    Object.keys(RA).forEach(function (k) {
      if (!RB[k]) { out.routes.removed.push(k); return; }
      var f = ["share", "days", "mode"].filter(function (q) { return !same(RA[k][q], RB[k][q]); }).map(function (q) { return { k: q, from: RA[k][q], to: RB[k][q] }; });
      if (f.length) out.routes.changed.push({ id: k, fields: f });
    });
    var ca = a.config || {}, cb = b.config || {}, ck = {}; Object.keys(ca).concat(Object.keys(cb)).forEach(function (k) { ck[k] = 1; });
    Object.keys(ck).forEach(function (k) { if (!same(ca[k], cb[k])) out.settings.push({ k: k, from: ca[k], to: cb[k] }); });
    if (!same(a.bom, b.bom)) out.settings.push({ k: "bom", from: a.bom, to: b.bom });
    out.count = out.sites.added.length + out.sites.removed.length + out.sites.changed.length + out.routes.added.length + out.routes.removed.length + out.routes.changed.length + out.settings.length;
    return out;
  }

  return { SCHEMA: SCHEMA, PREFIX: PREFIX, KEEP_AUTOSAVES: KEEP_AUTOSAVES, open: open, memory: memory, browser: browser, diff: diff, hashOf: hashOf };
});
