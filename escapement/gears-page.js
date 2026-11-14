// Escapement — the "Making the gears" page: a summary of every gear, the tooth form, a card per gear with a drawing,
// a tooth detail, cutting data, dividing settings and SVG/DXF downloads, and the plate holes. Everything comes from
// src/clock.js through src/gears.js, so it is the clock in the model.
(function () {
  "use strict";
  var VERSION = "1.1.0";
  var I = window.ESi18n, T = I.T, fx = I.fx, C = window.ESClock, P = window.ESParts, GE = window.ESGears;
  var D = C.derive(), GEARS = GE.list(D), BY = {};
  GEARS.forEach(function (g) { BY[g.id] = g; });
  var DICT = I.lang === "es" ? window.ESC_ES : I.lang === "da" ? window.ESC_DA : null;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function gearName(id) { var tr = DICT && DICT.N && DICT.N[id]; return tr || BY[id].name; }
  function partName(k) { var tr = DICT && DICT.P && DICT.P[k]; return tr ? tr[0] : P.PARTS[k].name; }
  function mm(v, dgt) { return fx(v, dgt == null ? 2 : dgt) + " mm"; }
  function dist(a, b) { return Math.hypot(D.arbors[a].x - D.arbors[b].x, D.arbors[a].y - D.arbors[b].y); }

  function kindName(g) {
    return g.kind === "wheel" ? T("Wheel") : g.kind === "pinion" ? T("Pinion") : g.kind === "escape" ? T("Escape wheel") : T("Ratchet wheel");
  }
  function material(g) {
    if (g.kind === "ratchet") return T("Gauge plate (O1), hardened and tempered");
    if (g.kind === "escape") return T("Hard brass or steel");
    return g.material === "brass" ? T("Brass (CZ120), hard-rolled") : T("Silver steel, hardened and tempered");
  }
  function partner(g) {
    if (g.meshes === "pallets") return [partName("anchor"), null];
    if (g.meshes === "click") return [partName("click"), null];
    var o = BY[g.meshes];
    return [gearName(o.id), dist(g.arbor, o.arbor)];
  }
  function note(g) {
    var dm = GE.dims(g);
    switch (g.id) {
      case "great": return T("Riveted to the barrel drum; it runs on the barrel arbor and turns once in 8 hours. Its teeth carry the largest force in the clock, so it is cut from the thickest sheet.");
      case "centrePinion": return T("Cut on the centre arbor, whose front end carries the cannon pinion and the minute hand. It takes the largest force of all the pinions.");
      case "centre": return T("Riveted to a collet on the centre arbor, which must sit exactly at the middle of the dial.");
      case "thirdPinion": return T("Cut on the third arbor, next to the collet that carries the third wheel.");
      case "third": return T("Riveted to a collet on the third arbor; it drives the escape pinion.");
      case "escapePinion": return T("Six leaves is the fewest that work well, and only because the force here is very small. Its core is just {r} across, so cut it from rod of at least {s} and support it close to the cutter.", { r: mm(dm.rootD), s: mm(Math.ceil(dm.tipD + 0.3), 0) });
      case "escape": return T("The teeth lean forward about 12° and their backs are cut away, so only the tips touch the pallets; the wheel turns clockwise seen from the dial. The tips must be sharp and all the same height.");
      case "cannon": return T("Cut on a short tube with a {b} bore, a friction fit on the centre arbor so the hands can be set.", { b: mm(dm.bore, 1) });
      case "minuteWheel": return T("Turns on a fixed stud in the front plate, {x} to the right of the centre arbor; its 8-leaf minute pinion is on the same pipe.", { x: mm(D.arbors.minuteWheel.x - D.arbors.centre.x, 1) });
      case "minutePinion": return T("Cut on the pipe of the minute wheel, so the two turn together.");
      case "hourWheel": return T("Its tube rides on the cannon pinion's tube and carries the hour hand: bore {b}.", { b: mm(dm.bore, 1) });
      case "ratchet": return T("Sits on the square of the barrel arbor, outside the front plate; the click catches its radial faces.");
      default: return "";
    }
  }
  function howLink(g) {
    var k = g.kind === "wheel" ? "wheel" : g.kind;
    var label = { wheel: T("How a wheel is made"), pinion: T("How a pinion is made"), escape: T("How the escape wheel is made"), ratchet: T("How the ratchet wheel is made") }[k];
    return "<a href='#how-" + k + "'>" + esc(label) + " ↑</a>";
  }
  function dividing(n) {
    var ix = GE.indexing(n), out = [];
    if (ix.direct) out.push(ix.direct.step === 1 ? T("Division plate: every hole of a {h}-hole circle", { h: ix.direct.holes })
      : T("Division plate: every {s} holes of a {h}-hole circle", { s: ix.direct.step, h: ix.direct.holes }));
    ix.heads.filter(function (h) { return h.ratio !== 60; }).forEach(function (h) {
      var v = { r: h.ratio, t: h.turns, k: h.holes, c: h.circle };
      if (!h.circle) out.push(h.turns === 1 ? T("{r}:1 dividing head: one whole turn", v) : T("{r}:1 dividing head: {t} whole turns", v));
      else if (h.turns === 0) out.push(T("{r}:1 dividing head: {k} holes on the {c}-hole circle", v));
      else if (h.turns === 1) out.push(T("{r}:1 dividing head: one turn + {k} holes on the {c}-hole circle", v));
      else out.push(T("{r}:1 dividing head: {t} turns + {k} holes on the {c}-hole circle", v));
    });
    return out;
  }

  // ---- drawings
  function path(pts, rot) {
    var c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    return "M" + pts.map(function (p) { var x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c; return x.toFixed(3) + " " + (-y).toFixed(3); }).join("L") + "Z";
  }
  function circle(r, cls) { return "<circle class='" + cls + "' r='" + r.toFixed(3) + "'/>"; }
  function gearSvg(g) {
    var dm = GE.dims(g), R = dm.tipD / 2, pad = R * 0.16 + 0.8, top = R + pad + R * 0.14;
    var shape = path(GE.outline(g)) + GE.windows(g).map(function (w) { return path(w); }).join("");
    var hole = dm.square ? "<rect class='hole' x='" + (-dm.square / 2) + "' y='" + (-dm.square / 2) + "' width='" + dm.square + "' height='" + dm.square + "'/>"
      : dm.bore ? circle(dm.bore / 2, "hole") : "";
    var y = -(R + pad * 0.55), u = R / 40;
    var dim = "<g class='dim' style='--u:" + u.toFixed(3) + "'><path d='M" + (-R) + " " + (-R * 0.15) + "V" + (y - 1) + "M" + R + " " + (-R * 0.15) + "V" + (y - 1) + "M" + (-R) + " " + y + "H" + R + "'/>" +
      "<path class='ar' d='M" + (-R) + " " + y + "l" + 2.2 * u + " " + (-0.8 * u) + "v" + 1.6 * u + "zM" + R + " " + y + "l" + (-2.2 * u) + " " + (-0.8 * u) + "v" + 1.6 * u + "z'/>" +
      "<text y='" + (y - 1.2 * u) + "' text-anchor='middle'>Ø " + esc(fx(dm.tipD, 2)) + "</text></g>";
    return "<svg class='gsv " + g.kind + "' viewBox='" + (-R - pad) + " " + (-top) + " " + 2 * (R + pad) + " " + (top + R + pad) + "' role='img' aria-label='" + esc(gearName(g.id)) + "'>" +
      "<path class='body' d='" + shape + "' fill-rule='evenodd'/>" + hole + (dm.pitchD ? circle(dm.pitchD / 2, "pitch") : "") +
      "<path class='cl' d='M" + (-R - 1) + " 0H" + (R + 1) + "M0 " + (-R - 1) + "V" + (R + 1) + "'/>" + dim + "</svg>";
  }
  // one tooth, enlarged, pointing up, with its tip, pitch and root circles
  function toothSvg(g, small) {
    var dm = GE.dims(g), pitch = 2 * Math.PI / g.teeth, win = 0.8 * pitch, rot = Math.PI / 2;
    // the last tooth, tooth 0 and tooth 1 in outline order, so the points around angle 0 come out in sequence
    var all = GE.outline(g), per = all.length / g.teeth;
    // turn the outline so that tooth 0's tip is at 0°, whatever angle the gear starts at
    var tip = all.slice(0, per).reduce(function (m, p) { return Math.hypot(p[0], p[1]) > Math.hypot(m[0], m[1]) + 1e-9 ? p : m; }), a0 = Math.atan2(tip[1], tip[0]);
    all = all.map(function (p) { return [p[0] * Math.cos(-a0) - p[1] * Math.sin(-a0), p[0] * Math.sin(-a0) + p[1] * Math.cos(-a0)]; });
    var pts = all.slice(all.length - per).concat(all.slice(0, 2 * per)).filter(function (p) { return Math.abs(Math.atan2(p[1], p[0])) <= win; });
    var R = dm.tipD / 2, r0 = dm.rootD / 2, cy = (R + r0) / 2, h = (R - r0) * 1.9, w = h * 1.25;
    var rIn = r0 - (R - r0) * 0.6;   // the body is closed a little below the root circle
    var aL = Math.atan2(pts[pts.length - 1][1], pts[pts.length - 1][0]), aF = Math.atan2(pts[0][1], pts[0][0]);
    pts = pts.concat([[rIn * Math.cos(aL), rIn * Math.sin(aL)], [rIn * Math.cos(aF), rIn * Math.sin(aF)]]);
    var arc = function (r, cls) {
      var a0 = rot - win, a1 = rot + win;
      return "<path class='" + cls + "' d='M" + (r * Math.cos(a0)).toFixed(3) + " " + (-r * Math.sin(a0)).toFixed(3) + "A" + r + " " + r + " 0 0 0 " + (r * Math.cos(a1)).toFixed(3) + " " + (-r * Math.sin(a1)).toFixed(3) + "'/>";
    };
    var u = h / 30, labels = "";
    if (dm.pitchD) {
      var rp = dm.pitchD / 2, x = w / 2 - 1.5 * u;
      labels = "<g class='tl' style='--u:" + u.toFixed(4) + "'><text x='" + x + "' y='" + (-(R + rp) / 2 + 1.2 * u) + "' text-anchor='end'>a " + esc(fx(dm.addendum, 2)) + "</text>" +
        "<text x='" + x + "' y='" + (-(rp + r0) / 2 + 1.2 * u) + "' text-anchor='end'>d " + esc(fx(dm.dedendum, 2)) + "</text>" +
        "<text x='" + (-w / 2 + 1.5 * u) + "' y='" + (-rp - 1.6 * u) + "'>s " + esc(fx(dm.toothThickness, 2)) + "</text></g>";
    }
    return "<svg class='tooth " + g.kind + (small ? " small" : "") + "' viewBox='" + (-w / 2) + " " + (-cy - h / 2) + " " + w + " " + h + "' role='img' aria-label='" + esc(T("One tooth, enlarged")) + "'>" +
      "<path class='body' d='M" + pts.map(function (p) { var x = -p[1], y = p[0]; return x.toFixed(3) + " " + (-y).toFixed(3); }).join("L") + "Z'/>" +
      arc(R, "c tip") + (dm.pitchD ? arc(dm.pitchD / 2, "c pitch") : "") + arc(r0, "c root") + labels + "</svg>";
  }

  // ---- the page
  function summary() {
    var head = [T("Gear"), T("Teeth"), T("Module"), T("Pitch Ø"), T("Tip Ø"), T("Root Ø"), T("Thickness"), T("Material"), T("Meshes with")];
    var rows = GEARS.map(function (g) {
      var dm = GE.dims(g), pr = partner(g);
      return "<tr><td><a href='#gear-" + g.id + "'>" + esc(gearName(g.id)) + "</a></td><td>" + g.teeth + "</td><td>" + (g.module ? esc(fx(g.module, 1)) : "—") + "</td><td>" +
        (dm.pitchD ? esc(fx(dm.pitchD, 2)) : "—") + "</td><td>" + esc(fx(dm.tipD, 2)) + "</td><td>" + esc(fx(dm.rootD, 2)) + "</td><td>" + esc(fx(g.thickness, 1)) + "</td><td>" +
        esc(material(g)) + "</td><td>" + esc(pr[0]) + "</td></tr>";
    });
    $("summary").innerHTML = "<table class='cmp wide'><thead><tr>" + head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>" +
      "<p class='fine'>" + esc(T("All sizes in millimetres. Ø is a diameter; the module is the pitch diameter divided by the number of teeth.")) + "</p>";
  }
  function formFig() {
    $("formFig").innerHTML = "<figure><div class='pair'>" + toothSvg(BY.centre) + toothSvg(BY.thirdPinion) + "</div><figcaption class='fine'>" +
      esc(T("A tooth of the centre wheel and a leaf of the third pinion, which mesh with each other (module 0.6), enlarged. a: addendum, above the pitch circle; d: dedendum, below it; s: the tooth's width on the pitch circle.")) + "</figcaption></figure>";
  }
  function card(g) {
    var dm = GE.dims(g), pr = partner(g), rows = [];
    rows.push([T("Teeth"), g.teeth]);
    if (dm.module) rows.push([T("Module"), mm(dm.module, 1)], [T("Pitch diameter"), mm(dm.pitchD)]);
    rows.push([T("Tip diameter (turn the blank to this)"), mm(dm.tipD)], [T("Root diameter"), mm(dm.rootD)], [T("Tooth depth (depth of cut)"), mm(dm.depth)]);
    if (dm.module) rows.push([T("Addendum / dedendum"), fx(dm.addendum, 2) + " / " + mm(dm.dedendum)], [T("Tooth width at the pitch circle"), mm(dm.toothThickness)]);
    rows.push([T("Circular pitch"), mm(dm.circularPitch)], [g.kind === "pinion" ? T("Length of the leaves") : T("Thickness"), mm(g.thickness, 1)], [T("Material"), material(g)]);
    if (g.kind === "escape") rows.push([T("Leading faces lean forward of radial by"), fx(window.ESEscapement.TOOTH.lean * 180 / Math.PI, 0) + "°"], [T("Width of the tip"), mm(window.ESEscapement.TOOTH.tip, 2)]);
    if (dm.bore) rows.push([T("Centre hole"), mm(dm.bore, 1)]);
    if (dm.square) rows.push([T("Square hole"), mm(dm.square, 1)]);
    if (dm.spokes) rows.push([T("Crossing out"), T("{n} spokes, {w} wide; rim {r} wide (inside Ø {i}); hub Ø {h}", { n: dm.spokes, w: mm(dm.spokeWidth), r: mm(dm.rimWidth), i: mm(dm.rimInD), h: mm(dm.hubD, 1) })]);
    rows.push([T("Meshes with"), pr[0] + (pr[1] ? " · " + T("centres {c} apart", { c: mm(pr[1]) }) : "")]);
    var div = dividing(g.teeth);
    return "<article class='gcard' id='gear-" + g.id + "'><header><h3>" + esc(gearName(g.id)) + "</h3><span class='kind'>" + esc(kindName(g) + " · " + T("{n} teeth", { n: g.teeth })) + "</span></header>" +
      "<div class='gbody'><div class='figs'>" + gearSvg(g) + toothSvg(g, true) + "</div><div class='gdata'>" +
      "<p>" + esc(note(g)) + " " + howLink(g) + "</p>" +
      "<table class='cmp'><tbody>" + rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
      "<h4>" + esc(T("Dividing")) + "</h4><ul class='div'>" + div.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" +
      "<div class='runbar no-print'><button class='btn' data-dl='svg' data-g='" + g.id + "'>" + esc(T("Drawing (SVG)")) + "</button><button class='btn' data-dl='dxf' data-g='" + g.id + "'>" + esc(T("Drawing (DXF)")) + "</button></div>" +
      "</div></div></article>";
  }
  // the anchor and pallets: a drawing in the anchor's frame and the pallets' outlines to cut
  var EG = window.ESEscapement.geometry(D), AN = window.ESEscapement.anchor();
  function anchorCard() {
    var all = [EG.entry, EG.exit].concat(EG.arms), xs = [], ys = [];
    all.forEach(function (s) { s.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    var x0 = Math.min.apply(null, xs) - 3, x1 = Math.max.apply(null, xs) + 3, y0 = Math.min.apply(null, ys) - 3, y1 = Math.max.apply(null, ys) + 3;
    var svg = "<svg class='gsv anchor' viewBox='" + x0 + " " + (-y1) + " " + (x1 - x0) + " " + (y1 - y0) + "' role='img' aria-label='" + esc(partName("anchor")) + "'>" +
      "<path class='arm' d='" + EG.arms.map(function (s) { return path(s); }).join("") + "'/>" + circle(EG.hubRadius, "arm") + circle(1.0, "hole") +
      "<path class='body' d='" + path(EG.entry) + path(EG.exit) + "'/></svg>";
    var rows = [
      [T("Pallet arbor above the escape arbor"), mm(D.palletDistance)],
      [T("Pallets span"), T("{n} teeth", { n: fx(D.spec.anchorSpan, 1) })],
      [T("Entry pallet: locking face (outer) radius"), mm(AN.entry.lockRadius, 3)],
      [T("Exit pallet: locking face (inner) radius"), mm(AN.exit.lockRadius, 3)],
      [T("Width of each pallet"), mm(AN.entry.rOut - AN.entry.rIn, 2)],
      [T("Lift (pendulum swing during the impulse)"), fx(2 * EG.lift * 180 / Math.PI, 2) + "°"],
      [T("Pendulum swing"), "± " + fx(D.spec.pendulum.amplitude * 180 / Math.PI, 1) + "°"],
      [T("Pallet thickness"), mm(EG.palletThickness, 1)],
      [T("Material"), T("Steel, hardened, faces polished (or jewelled)")]
    ];
    $("anchorCard").innerHTML = "<article class='gcard'><div class='gbody'><div class='figs'>" + svg + "</div><div class='gdata'>" +
      "<table class='cmp'><tbody>" + rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>"; }).join("") + "</tbody></table>" +
      "<p class='fine'>" + esc(T("Drawn from the front with the pendulum at the middle of its swing; the lighter pieces are the pallets.")) + "</p>" +
      "<div class='runbar no-print'><button class='btn' id='dlPallets'>" + esc(T("Pallets (DXF)")) + "</button></div></div></div></article>";
    $("dlPallets").addEventListener("click", function () { save("escapement-pallets.dxf", GE.dxfLoops([EG.entry, EG.exit]), "application/dxf"); });
  }
  function plates() {
    var A = D.arbors, rows = [
      ["barrel", partName("barrel"), "centre"], ["centre", partName("centre"), null], ["third", partName("third"), "centre"], ["escape", partName("escape"), "third"],
      ["pallet", partName("anchor"), "escape"], ["minuteWheel", T("Minute-wheel stud (front plate only)"), "centre"]
    ];
    var head = [T("Arbor"), "x", "y", T("Meshes with"), T("Distance")];
    $("plates").innerHTML = "<table class='cmp wide'><thead><tr>" + head.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        var a = A[r[0]];
        return "<tr><td>" + esc(r[1]) + "</td><td>" + esc(fx(a.x, 2)) + "</td><td>" + esc(fx(a.y, 2)) + "</td><td>" + (r[2] ? esc(partName(r[2])) : "—") + "</td><td>" + (r[2] ? esc(fx(dist(r[0], r[2]), 2)) : "—") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "<p class='fine'>" + esc(T("The pallet arbor's distance is to the escape arbor; the anchor's pallets span {n} teeth of the escape wheel.", { n: fx(D.spec.anchorSpan, 1) })) + "</p>";
  }

  // ---- downloads
  function save(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-dl]"); if (!b) return;
    var g = BY[b.dataset.g];
    if (b.dataset.dl === "svg") save("escapement-" + g.id + ".svg", GE.svg(g), "image/svg+xml");
    else save("escapement-" + g.id + ".dxf", GE.dxf([g]), "application/dxf");
  });
  $("dlAll").addEventListener("click", function () { save("escapement-gears.dxf", GE.dxf(GEARS), "application/dxf"); });
  $("btnPrint").addEventListener("click", function () { window.print(); });

  summary(); formFig();
  $("cards").innerHTML = GEARS.map(card).join("");
  plates(); anchorCard();
  window.__gears = { VERSION: VERSION, count: GEARS.length };
})();
