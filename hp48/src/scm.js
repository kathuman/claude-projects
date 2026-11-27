/*
 * scm.js — the supply chain program pack: RPL programs typed into a directory
 * SCM on the calculator, with a custom menu, and a JavaScript reference for
 * each so the page (and the tests) can check what the calculator answers.
 *
 * Written for what the 48GX keyboard can type: no √ (programs use ^.5) and no
 * Σ (sums use « + » STREAM). Results are tagged (Q:, SS: …) so they read
 * clearly on the stack. The normal distribution comes from the ROM's own UTPN
 * (upper-tail probability); the newsvendor inverts it with Newton's method.
 *
 * Pure, no DOM: window.HP48.SCM in the browser, module.exports in Node.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else { root.HP48 = root.HP48 || {}; root.HP48.SCM = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // the standard normal: density, distribution (erf by series / continued fraction, ~1e-14), inverse by Newton
  const pdf = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  function cdf(z) {
    const x = Math.abs(z) / Math.SQRT2;
    let erfc;
    if (x < 2.5) {
      let sum = x, term = x;
      for (let n = 1; n < 200; n++) { term *= -x * x / n; const t = term / (2 * n + 1); sum += t; if (Math.abs(t) < 1e-17) break; }
      erfc = 1 - 2 / Math.sqrt(Math.PI) * sum;
    } else {
      let f = 0;
      for (let n = 60; n >= 1; n--) f = n / 2 / (x + f);
      erfc = Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
    }
    return z >= 0 ? 1 - erfc / 2 : erfc / 2;
  }
  function inv(p) { let z = 0; for (let i = 0; i < 50; i++) z -= (cdf(z) - p) / pdf(z); return z; }
  const variance = (xs) => { const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / n; return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1); };

  // name, what it is, inputs (stack order, level n … level 1), outputs, RPL source, example, reference
  const PROGRAMS = [
    { name: "EOQ", title: "Economic order quantity",
      inputs: ["annual demand D", "cost per order S", "holding cost per unit-year H"], outputs: ["Q: order quantity", "N: orders a year", "TC: ordering + holding cost a year"],
      src: "« → D S H « '(2*D*S/H)^.5' →NUM → Q « Q \"Q\" →TAG D Q / \"N\" →TAG 'D/Q*S+Q/2*H' →NUM \"TC\" →TAG » » »",
      example: [12000, 100, 5],
      ref: (D, S, H) => { const Q = Math.sqrt(2 * D * S / H); return [Q, D / Q, D / Q * S + Q / 2 * H]; } },
    { name: "SS", title: "Safety stock",
      inputs: ["safety factor z", "mean demand per period", "σ of demand per period", "lead time L (periods)", "σ of lead time"], outputs: ["SS: safety stock"],
      src: "« → Z M S L W « 'Z*(L*S^2+M^2*W^2)^.5' →NUM \"SS\" →TAG » »",
      example: [1.645, 100, 20, 4, 0.5],
      ref: (Z, M, S, L, W) => [Z * Math.sqrt(L * S * S + M * M * W * W)] },
    { name: "ROP", title: "Reorder point",
      inputs: ["mean demand per period", "lead time L (periods)", "safety stock"], outputs: ["ROP: reorder point"],
      src: "« → M L B « 'M*L+B' →NUM \"ROP\" →TAG » »",
      example: [100, 4, 105.33],
      ref: (M, L, B) => [M * L + B] },
    { name: "NEWS", title: "Newsvendor",
      inputs: ["price p", "unit cost c", "salvage value v", "mean demand μ", "σ of demand"], outputs: ["CR: critical ratio (p−c)/(p−v)", "Q: order quantity μ + zσ"],
      src: "« → P C V M S « 'P-C' 'P-V' / →NUM → R « 0 1 20 START DUP 0 1 ROT UTPN 1 SWAP - R - OVER SQ -2 / EXP 2 π * →NUM .5 ^ / / - NEXT → Z « R \"CR\" →TAG 'M+Z*S' →NUM \"Q\" →TAG » » » »",
      example: [15, 6, 3, 500, 100],
      ref: (P, C, V, M, S) => { const R = (P - C) / (P - V); return [R, M + inv(R) * S]; } },
    { name: "FILL", title: "Fill rate",
      inputs: ["order quantity Q", "σ of demand over the lead time", "safety factor k"], outputs: ["FILL: fill rate", "G: normal loss G(k)"],
      src: "« → Q S K « K SQ -2 / EXP 2 π * →NUM .5 ^ / K 0 1 K UTPN * - → G « 1 S G * Q / - \"FILL\" →TAG G \"G\" →TAG » » »",
      example: [500, 40, 1],
      ref: (Q, S, K) => { const G = pdf(K) - K * (1 - cdf(K)); return [1 - S * G / Q, G]; } },
    { name: "LITTL", title: "Little's law",
      inputs: ["WIP (0 if unknown)", "throughput (0 if unknown)", "lead time (0 if unknown)"], outputs: ["the missing one: WIP, TH or LT"],
      src: "« → W T L « CASE W 0 == THEN T L * \"WIP\" →TAG END T 0 == THEN W L / \"TH\" →TAG END W T / \"LT\" →TAG END » »",
      example: [0, 50, 4],
      ref: (W, T, L) => [W === 0 ? T * L : T === 0 ? W / L : W / T] },
    { name: "BULL", title: "Bullwhip ratio",
      inputs: ["orders placed, as a list", "demand received, as a list"], outputs: ["BULL: variance of orders ÷ variance of demand"],
      src: "« → O D « O LVAR D LVAR / \"BULL\" →TAG » »",
      example: [[100, 120, 80, 140, 60], [100, 105, 95, 102, 98]],
      ref: (O, D) => [variance(O) / variance(D)] }
  ];
  // a helper the bullwhip program uses: the sample variance of a list
  const HELPERS = [{ name: "LVAR", src: "« DUP SIZE → X N « X SQ « + » STREAM X « + » STREAM SQ N / - N 1 - / » »" }];

  // the text typed to install the pack: the directory, each program, and the menu
  function installText() {
    const lines = ["« HOME IF 'SCM' VTYPE -1 == THEN 'SCM' CRDIR END SCM » EVAL"];
    HELPERS.concat(PROGRAMS).forEach((p) => lines.push(p.src + " '" + p.name + "' STO"));
    lines.push("{ " + PROGRAMS.map((p) => p.name).join(" ") + " } MENU");
    return lines.join("\n");
  }
  // the text typed to run an example: its inputs, then the program
  const literal = (v) => Array.isArray(v) ? "{ " + v.join(" ") + " }" : String(v);
  function exampleText(p) { return "« SCM » EVAL " + p.example.map(literal).join(" ") + " " + p.name; }

  // compare what the calculator left on the stack (level 1 first) with the reference; → { ok, rows }
  function check(p, levels, inputs) {
    const want = p.ref.apply(null, inputs || p.example);
    const got = levels.slice(0, want.length).reverse();         // results are pushed in order: the last is level 1
    const rows = want.map((w, i) => {
      const g = got[i], v = g && typeof g.value === "number" ? g.value : NaN;
      const ok = Number.isFinite(v) && Math.abs(v - w) <= 1e-9 * Math.max(1, Math.abs(w));
      return { label: p.outputs[i], tag: g && g.tag, want: w, got: v, ok: ok };
    });
    return { ok: rows.every((r) => r.ok), rows: rows };
  }

  return { PROGRAMS: PROGRAMS, HELPERS: HELPERS, installText: installText, exampleText: exampleText, check: check, normal: { pdf: pdf, cdf: cdf, inv: inv }, variance: variance };
});
