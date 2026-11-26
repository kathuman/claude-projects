/*
 * romfile.js — accepts a ROM file in the common dump layouts and returns the
 * 512 KB packed image the machine takes (two nibbles a byte, low nibble first),
 * with the revision it reports. Nothing here fetches or uploads anything.
 *
 *   512 KB  packed (as dumped by most tools)              → used as it is
 *   1 MB    one nibble per byte (every byte 0–15)          → packed
 *   1 MB    packed 49G image, 256 KB 48SX image            → refused, with the reason
 *
 * Pure, no DOM: window.HP48.RomFile in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.RomFile = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIZE = 524288;
  const VERSION_AT = 0x7ffaf;               // nibble address of "Version HP48-x"

  // the text stored at a nibble address of a packed image
  function text(bytes, at, len) {
    const nib = (i) => (bytes[i >> 1] >> ((i & 1) * 4)) & 15;
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(nib(at + 2 * i) | (nib(at + 2 * i + 1) << 4));
    return s;
  }

  // → { bytes, revision } or { error }
  function load(input) {
    let b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length === SIZE * 2) {
      let unpacked = true;
      for (let i = 0; i < b.length; i++) if (b[i] > 15) { unpacked = false; break; }
      if (!unpacked) return { error: "This file is 1 MB but not one nibble per byte. It may be an HP 49G ROM; this emulator runs the 48GX." };
      const p = new Uint8Array(SIZE);
      for (let i = 0; i < SIZE; i++) p[i] = b[2 * i] | (b[2 * i + 1] << 4);
      b = p;
    } else if (b.length === SIZE / 2) {
      return { error: "This file is 256 KB, the size of an HP 48S/SX ROM. This emulator runs the 48G/GX (512 KB)." };
    } else if (b.length !== SIZE) {
      return { error: "This file is " + b.length.toLocaleString("en") + " bytes. A 48GX ROM is 512 KB (524,288 bytes)." };
    }
    const v = text(b, VERSION_AT, 14);
    if (!/^Version HP48-[A-Z]$/.test(v)) return { error: "This 512 KB file doesn't identify itself as an HP 48 ROM (no \"Version HP48-x\" where the 48GX keeps it)." };
    return { bytes: b, revision: v.slice(-1) };
  }

  return { load: load, text: text, SIZE: SIZE };
});
