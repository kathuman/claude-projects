// Heat Pump Studio — the printable datasheet and the guided tour (window.HPSextras). Both are driven by app.js, which
// passes in what they need: datasheet(ctx) builds the white A4 sheet; tour(steps, T) walks through the page.
(function (root) {
  "use strict";
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---- datasheet: a modal preview with Print and Close; printing shows only the sheet
  function datasheet(c) {
    var T = c.T;
    var old = document.getElementById("dsOverlay"); if (old) old.remove();
    var rows = function (list) { return "<table class='dst'>" + list.map(function (r) { return "<tr><th>" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join("") + "</table>"; };
    var html = "<div class='ds-bar'><button class='btn primary' id='dsPrint'>" + esc(T("Print")) + "</button><button class='btn' id='dsClose'>" + esc(T("Close")) + "</button></div>" +
      "<div class='ds-sheet'>" +
      "<header class='ds-head'><div><div class='ds-brand'>Heat Pump <span>Studio</span></div><div class='ds-title'>" + esc(c.title) + "</div></div>" +
      "<div class='ds-meta'>" + esc(T("Datasheet")) + " · v" + esc(c.version) + "<br>" + esc(c.date) + "</div></header>" +
      "<div class='ds-diagram'>" + c.diagram + "</div>" +
      "<div class='ds-cols'>" +
      "<section><h3>" + esc(T("Design basis")) + "</h3>" + rows(c.basis) + "</section>" +
      "<section><h3>" + esc(T("Results at the design point")) + "</h3>" + rows(c.results) + "</section>" +
      "</div>" +
      "<section><h3>" + esc(T("Cycle states")) + "</h3>" + c.states + "</section>" +
      "<div class='ds-cols'>" + c.components.map(function (k) { return "<section><h3>" + esc(k[0]) + "</h3>" + rows(k[1]) + "</section>"; }).join("") + "</div>" +
      (c.year ? "<section><h3>" + esc(T("Year round")) + "</h3>" + rows(c.year) + "</section>" : "") +
      (c.warnings.length ? "<section><h3>" + esc(T("Notes and warnings")) + "</h3><ul>" + c.warnings.map(function (w) { return "<li>" + w + "</li>"; }).join("") + "</ul></section>" : "") +
      "<footer class='ds-foot'>" + esc(c.footer) + "</footer></div>";
    var ov = document.createElement("div"); ov.id = "dsOverlay"; ov.className = "ds-overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = html; document.body.appendChild(ov); document.body.classList.add("ds-open");
    var close = function () { ov.remove(); document.body.classList.remove("ds-open"); };
    document.getElementById("dsClose").addEventListener("click", close);
    document.getElementById("dsPrint").addEventListener("click", function () { window.print(); });
    ov.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    document.getElementById("dsClose").focus();
    return ov;
  }

  // ---- guided tour: highlight one element at a time with a short explanation
  function tour(steps, T, before) {
    var i = 0, box = document.createElement("div"), mark = null;
    box.className = "tour"; box.setAttribute("role", "dialog");
    document.body.appendChild(box);
    function end() { box.remove(); if (mark) mark.classList.remove("tour-mark"); document.removeEventListener("keydown", key); }
    function key(e) { if (e.key === "Escape") end(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); }
    function go(d) { i = Math.max(0, Math.min(steps.length - 1, i + d)); show(); }
    function show() {
      var st = steps[i]; if (before) before(st);
      if (mark) mark.classList.remove("tour-mark");
      mark = document.querySelector(st.el);
      if (mark) { mark.classList.add("tour-mark"); mark.scrollIntoView({ block: "center", behavior: "smooth" }); }
      box.innerHTML = "<div class='tour-n'>" + (i + 1) + " / " + steps.length + "</div><h4>" + esc(st.title) + "</h4><p>" + esc(st.text) + "</p>" +
        "<div class='tour-b'><button class='btn' data-a='prev'" + (i ? "" : " disabled") + ">" + esc(T("Back")) + "</button>" +
        "<button class='btn primary' data-a='next'>" + esc(i === steps.length - 1 ? T("Finish") : T("Next")) + "</button>" +
        "<button class='btn' data-a='end'>" + esc(T("Close")) + "</button></div>";
      box.querySelector("[data-a=prev]").onclick = function () { go(-1); };
      box.querySelector("[data-a=next]").onclick = function () { if (i === steps.length - 1) end(); else go(1); };
      box.querySelector("[data-a=end]").onclick = end;
      box.querySelector("[data-a=next]").focus({ preventScroll: true });
    }
    document.addEventListener("keydown", key);
    show();
    return { end: end, go: go };
  }

  root.HPSextras = { datasheet: datasheet, tour: tour };
})(typeof self !== "undefined" ? self : this);
