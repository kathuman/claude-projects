// The winding instructions: a self-contained HTML document to keep at the board, print, or save as PDF.
//
// It holds everything needed to wind the piece without the app: the settings (nails, board, thread), how the nails are
// numbered, where to tie on, a picture of the result, and the nail sequence in numbered blocks of 10 lines, each with
// a checkbox. Nail numbers are set large for reading at arm's length. The ticks are remembered in the browser that
// opens the file (keyed by a hash of the sequence), so a long winding session can be picked up again.

import { T, fx, int, lang, LANGS } from "../ui/i18n";

export interface InstructionsInput {
  sequence: Uint16Array;
  nails: number;
  boardMm: number;
  threadMm: number;
  minSkip: number;
  threadM: number;
  slackM: number;
  version: string;
  /** a picture of the result (data: URL), or null */
  preview: string | null;
  /** when the document was made, already formatted for the reader */
  date: string;
}

export const BLOCK = 10;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** FNV-1a hash of the sequence: a short, stable id for remembering the ticks. */
export function sequenceId(seq: Uint16Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seq.length; i++) { h ^= seq[i] & 0xff; h = Math.imul(h, 0x01000193); h ^= seq[i] >> 8; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function instructionsHtml(d: InstructionsInput): string {
  const steps = d.sequence.length - 1, blocks = Math.ceil(steps / BLOCK), id = sequenceId(d.sequence);
  const facts: [string, string][] = [
    [T("Nails"), T("{n}, numbered 0 to {m} clockwise; nail 0 at the top", { n: int(d.nails), m: int(d.nails - 1) })],
    [T("Board diameter"), T("{d} mm (the circle the nails stand on)", { d: fx(d.boardMm, 0) })],
    [T("Thread"), T("{t} mm black; you need {m} m, plus {s} m for wrapping and slack", { t: fx(d.threadMm, 2), m: fx(d.threadM, 0), s: fx(d.slackM, 0) })],
    [T("Lines"), int(steps)],
    [T("Start"), T("tie the thread to nail {n}", { n: d.sequence[0] })]
  ];
  let rows = "";
  for (let b = 0; b < blocks; b++) {
    const s0 = b * BLOCK + 1, s1 = Math.min(steps, s0 + BLOCK - 1), nails: string[] = [];
    for (let s = s0; s <= s1; s++) nails.push(`<span>${d.sequence[s]}</span>`);
    rows += `<li class="blk"><label><input type="checkbox" data-b="${b}"><span class="bn">${int(s0)}–${int(s1)}</span></label><div class="nails">${nails.join("")}</div></li>\n`;
  }
  return `<!doctype html>
<html lang="${LANGS[lang].html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T("String Art — winding instructions"))}</title>
<style>
  body{font-family:Barlow,"Helvetica Neue",Arial,sans-serif; color:#111; margin:24px auto; max-width:900px; padding:0 16px; line-height:1.45;}
  h1{font-size:26px; margin:0 0 4px;} .sub{color:#555; margin:0 0 16px;}
  .top{display:grid; grid-template-columns:1fr 220px; gap:20px; align-items:start;}
  .top img{width:220px; height:220px; border-radius:50%; border:1px solid #bbb; background:#fff;}
  table.facts{border-collapse:collapse; width:100%; font-size:15px;}
  table.facts th{text-align:left; font-weight:600; padding:4px 10px 4px 0; vertical-align:top; white-space:nowrap;}
  table.facts td{padding:4px 0;}
  .how{background:#f3f5f7; border-left:4px solid #3a7bd5; padding:10px 14px; margin:18px 0; font-size:15px;}
  .how ol{margin:6px 0 0; padding-left:20px;}
  .bar{display:flex; gap:10px; align-items:center; margin:12px 0;} .bar button{font:inherit; font-weight:600; padding:8px 14px; border:1px solid #3a7bd5; background:#3a7bd5; color:#fff; border-radius:6px; cursor:pointer;}
  .bar .done{color:#555;}
  ol.blocks{list-style:none; padding:0; margin:0;}
  .blk{display:flex; align-items:center; gap:14px; padding:7px 4px; border-bottom:1px solid #ddd; break-inside:avoid;}
  .blk label{display:flex; align-items:center; gap:8px; min-width:120px; font-size:14px; color:#444; cursor:pointer;}
  .blk input{width:22px; height:22px;}
  .nails{display:grid; grid-template-columns:repeat(10, 1fr); gap:4px; flex:1;}
  .nails span{font:700 22px/1.2 "IBM Plex Mono",ui-monospace,Menlo,monospace; text-align:center; padding:2px 0; border-radius:4px; background:#f6f6f6;}
  .blk.ticked .nails span{color:#999; background:#fff; text-decoration:line-through;}
  @media (max-width:640px){ .top{grid-template-columns:1fr;} .nails{grid-template-columns:repeat(5, 1fr);} .blk{flex-wrap:wrap;} }
  @media print{ .bar{display:none;} body{margin:0; max-width:none;} .nails span{background:#fff; border:1px solid #ccc;} .how{break-inside:avoid;} }
</style>
</head>
<body>
<h1>${esc(T("String Art — winding instructions"))}</h1>
<p class="sub">${esc(T("Made with String Art version {v} on {d}.", { v: d.version, d: d.date }))}</p>
<div class="top">
  <table class="facts">${facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
  ${d.preview ? `<img src="${d.preview}" alt="${esc(T("The finished piece, as simulated"))}">` : ""}
</div>
<div class="how"><b>${esc(T("How to wind"))}</b><ol>
  <li>${esc(T("Number the nails 0 to {m} clockwise, starting with nail 0 at the top (12 o'clock).", { m: int(d.nails - 1) }))}</li>
  <li>${esc(T("Tie the thread to nail {n}.", { n: d.sequence[0] }))}</li>
  <li>${esc(T("Read each block left to right: take the thread straight across the board to the next nail, once around it, and on to the next. Keep the thread taut."))}</li>
  <li>${esc(T("Tick a block when it is done. The ticks are remembered in this browser, so you can stop and carry on later."))}</li>
  <li>${esc(T("After the last nail, tie the thread off."))}</li>
</ol></div>
<div class="bar"><button onclick="window.print()">${esc(T("Print or save as PDF"))}</button><span class="done" id="done"></span></div>
<ol class="blocks">
${rows}</ol>
<script>
(function(){
  var KEY = "string-art-ticks-${id}", boxes = document.querySelectorAll(".blk input"), done = document.getElementById("done");
  var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { saved = {}; }
  function show(){ var n = 0; boxes.forEach(function(b){ b.closest(".blk").classList.toggle("ticked", b.checked); if (b.checked) n++; });
    done.textContent = ${JSON.stringify(T("{n} of {t} blocks done"))}.replace("{n}", n).replace("{t}", boxes.length); }
  boxes.forEach(function(b){ b.checked = !!saved[b.dataset.b]; b.addEventListener("change", function(){ saved[b.dataset.b] = b.checked; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} show(); }); });
  show();
})();
</script>
</body>
</html>
`;
}
