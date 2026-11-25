/*
 * share.js — share links: the inputs that differ from the defaults, in the
 * URL after #s=, so a link reopens the same comparison.
 *
 *   encode(inputs, defaults) → "s=<base64url JSON>" ("" when nothing changed)
 *   decode(hash, inputs, scJson) → how many values were applied
 *
 * A link is untrusted input: decode only accepts keys the scenario defines,
 * of the same type as the default, numbers clamped to the input's range,
 * choices only from its options. Anything else is ignored.
 *
 * Pure, no DOM: window.WC.share in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.WC = root.WC || {}; root.WC.share = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // WH-C's values are the Warehouse Model's, with no ranges or options here and
  // no controls on the page, so links carry the shared inputs, WH-A and WH-B only
  const GROUPS = ["sc", "A", "B"];
  const get = function (inputs, g) { return g === "sc" ? inputs.sc : inputs.layouts[g]; };

  function b64(s) {
    const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Buffer.from(s, "utf8");
    let bin = ""; bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    const enc = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return enc.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    const bin = typeof atob !== "undefined" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("utf8");
  }

  function encode(inputs, defaults) {
    const diff = {}; let n = 0;
    GROUPS.forEach(function (g) {
      const cur = get(inputs, g), def = get(defaults, g), d = {};
      for (const k in cur) if (cur[k] !== def[k] && (typeof cur[k] === "number" || typeof cur[k] === "string")) { d[k] = cur[k]; n++; }
      if (Object.keys(d).length) diff[g] = d;
    });
    return n ? "s=" + b64(JSON.stringify(diff)) : "";
  }

  // the input's definition in scenario.json
  function defOf(scJson, g, k) {
    const src = g === "sc" ? scJson.shared : scJson.layouts[g];
    const d = src && src[k];
    return d && typeof d === "object" ? d : null;
  }

  function decode(hash, inputs, scJson) {
    const m = /(?:^|[#&])s=([A-Za-z0-9_-]+)/.exec(hash || "");
    if (!m) return 0;
    let diff;
    try { diff = JSON.parse(unb64(m[1])); } catch (e) { return 0; }
    if (!diff || typeof diff !== "object") return 0;
    let applied = 0;
    GROUPS.forEach(function (g) {
      const src = diff[g], tgt = get(inputs, g);
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(tgt, k)) return;
        let v = src[k];
        if (typeof v !== typeof tgt[k]) return;
        const d = defOf(scJson, g, k);
        if (!d) return;                                  // only inputs the scenario defines (with a range or options)
        if (typeof v === "number") {
          if (!isFinite(v)) return;
          if (d.minimum === undefined) return;
          v = Math.max(d.minimum, Math.min(d.maximum, v));
        } else if (!d.options || d.options.indexOf(v) < 0) return;
        tgt[k] = v; applied++;
      });
    });
    return applied;
  }

  return { encode: encode, decode: decode };
});
