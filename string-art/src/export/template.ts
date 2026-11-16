// The nail template at true size, to print, tape to the board and drill or hammer through.
//
// Units are millimetres throughout: the SVG's width and height carry "mm" and the viewBox is in mm, so a printer set
// to "actual size" (100 %, no fit-to-page) reproduces it 1:1. Nail i stands at angle −90° + 360°·i/N on the circle of
// the board diameter (clockwise from the top, as in the solver); it is marked by a 1 mm dot and numbered outside the
// circle. A 100 mm × 100 mm calibration square on every page lets you check the print scale with a ruler.
//
// A 600 mm board does not fit on any office paper, so `templatePages` cuts the drawing into A4 or A3 tiles. The tiles
// overlap by OVERLAP mm (so no nail falls in an unprinted margin twice), carry crop marks and a label "row r, column c"
// with the neighbours' labels on each edge, and pages with no part of the circle on them are skipped.

export type Paper = "A4" | "A3";
export const PAPER: Record<Paper, { w: number; h: number }> = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
export const MARGIN = 10;     // printers cannot print to the edge
export const OVERLAP = 15;    // tiles share this much drawing so the sheets can be lined up

export interface TemplateInput { nails: number; boardMm: number; labels: { title: string; calibration: string; page: (r: number, c: number) => string } }

/** Nail positions in mm, origin at the board centre, y down (screen convention). */
export function nailPositionsMm(nails: number, boardMm: number): { x: number; y: number }[] {
  const R = boardMm / 2, out: { x: number; y: number }[] = [];
  for (let i = 0; i < nails; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / nails;
    out.push({ x: R * Math.cos(t), y: R * Math.sin(t) });
  }
  return out;
}

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The template's content in board coordinates (origin at the centre): circle, centre cross, 0° mark, nails, numbers. */
function boardGroup(d: TemplateInput): string {
  const R = d.boardMm / 2, P = nailPositionsMm(d.nails, d.boardMm);
  // label size: as large as fits between neighbouring nails, between 2.2 and 5 mm
  const gap = (Math.PI * d.boardMm) / d.nails, size = Math.max(2.2, Math.min(5, gap * 0.9));
  let s = `<circle cx="0" cy="0" r="${f(R)}" fill="none" stroke="#000" stroke-width="0.2"/>`;
  s += `<path d="M-8 0H8M0 -8V8" stroke="#000" stroke-width="0.2"/><circle cx="0" cy="0" r="1" fill="#000"/>`;
  s += `<path d="M0 ${f(-R - 6)}V${f(-R + 6)}" stroke="#000" stroke-width="0.4"/>`;   // the 0° mark at the top
  P.forEach((p, i) => {
    // Numbers run radially, starting 3 mm outside the nail, so their length lies along the radius and only their
    // height (≤ 90 % of the nail spacing) along the circle: neighbours never overlap. On the left half the text is
    // turned the other way round and anchored at its end, so no number reads upside down.
    const a = Math.atan2(p.y, p.x), lr = R + 3, lx = lr * Math.cos(a), ly = lr * Math.sin(a);
    const left = Math.cos(a) < -1e-9, deg = (a * 180) / Math.PI + (left ? 180 : 0);
    s += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="0.5" fill="#000"/>`;
    s += `<text x="${f(lx)}" y="${f(ly)}" font-size="${f(size)}" text-anchor="${left ? "end" : "start"}" dominant-baseline="central" transform="rotate(${f(deg)} ${f(lx)} ${f(ly)})"${i % 10 === 0 ? ' font-weight="700"' : ""}>${i}</text>`;
  });
  return s;
}

/** A 100 mm calibration square with its label, top-left corner at (x, y). */
function calibration(x: number, y: number, label: string): string {
  return `<rect x="${f(x)}" y="${f(y)}" width="100" height="100" fill="none" stroke="#000" stroke-width="0.3"/>` +
    `<text x="${f(x + 50)}" y="${f(y + 50)}" font-size="3.5" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`;
}

/** The whole template on one sheet, sized to the board plus room for the labels and the calibration square. */
export function templateSvg(d: TemplateInput): string {
  const R = d.boardMm / 2, pad = 16, side = 2 * (R + pad), W = side + 120;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(side)}mm" viewBox="0 0 ${f(W)} ${f(side)}" font-family="Arial, Helvetica, sans-serif">` +
    `<title>${esc(d.labels.title)}</title>` +
    `<g transform="translate(${f(R + pad)} ${f(R + pad)})">${boardGroup(d)}</g>` +
    calibration(side + 10, 10, d.labels.calibration) +
    `<text x="${f(side + 10)}" y="125" font-size="4">${esc(d.labels.title)}</text></svg>`;
}

export interface TemplatePage {
  row: number; col: number; svg: string;
  /** the board region shown, in mm from the top-left of the board's bounding square */
  x0: number; y0: number; w: number; h: number;
  /** where the calibration square's top-left corner is, in the same frame, if it is on this page */
  calibration: { x: number; y: number } | null;
}

/**
 * The template cut into pages. The printable area of each page is (paper − 2·MARGIN); consecutive tiles advance by
 * that minus OVERLAP, so each shares an OVERLAP-wide strip with its neighbour. Tile (r, c) shows the board region
 * [x0, x0 + pw] × [y0, y0 + ph] in a coordinate frame whose origin is the top-left of the board's bounding square.
 */
export function templatePages(d: TemplateInput, paper: Paper): TemplatePage[] {
  const { w, h } = PAPER[paper], pw = w - 2 * MARGIN, ph = h - 2 * MARGIN, R = d.boardMm / 2, pad = 16;
  const side = 2 * (R + pad), step = { x: pw - OVERLAP, y: ph - OVERLAP };
  const cols = Math.max(1, Math.ceil((side - OVERLAP) / step.x)), rows = Math.max(1, Math.ceil((side - OVERLAP) / step.y));
  const inner = boardGroup(d), pages: TemplatePage[] = [];
  const cx = R + pad, cy = R + pad;
  const hasRingAt = (x0: number, y0: number) => {
    // does any part of the ring of nails and numbers (radius R − 10 … R + pad) cross this tile?
    const nx = Math.max(x0, Math.min(cx, x0 + pw)), ny = Math.max(y0, Math.min(cy, y0 + ph));
    const far = Math.max(...[[x0, y0], [x0 + pw, y0], [x0, y0 + ph], [x0 + pw, y0 + ph]].map(([px, py]) => Math.hypot(px - cx, py - cy)));
    return Math.hypot(nx - cx, ny - cy) <= R + pad && far >= R - 10;
  };
  // Where the 100 mm calibration square goes: the first printed tile with a corner where the square lies wholly
  // outside the ring of nails and numbers or wholly inside it, so it never covers a nail. (null: a page of its own.)
  let cal: { r: number; c: number; x: number; y: number } | null = null;
  for (let r = 0; r < rows && !cal; r++) {
    for (let c = 0; c < cols && !cal; c++) {
      const x0 = c * step.x, y0 = r * step.y;
      if (!hasRingAt(x0, y0)) continue;
      for (const [sx, sy] of [[x0 + 4, y0 + ph - 104], [x0 + 4, y0 + 4], [x0 + pw - 104, y0 + 4], [x0 + pw - 104, y0 + ph - 104]]) {
        const nx = Math.max(sx, Math.min(cx, sx + 100)), ny = Math.max(sy, Math.min(cy, sy + 100));
        const near = Math.hypot(nx - cx, ny - cy);
        const far = Math.max(...[[sx, sy], [sx + 100, sy], [sx, sy + 100], [sx + 100, sy + 100]].map(([px, py]) => Math.hypot(px - cx, py - cy)));
        if (near > R + pad + 2 || far < R - 12) { cal = { r, c, x: sx - x0 + MARGIN, y: sy - y0 + MARGIN }; break; }
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * step.x, y0 = r * step.y;
      if (!hasRingAt(x0, y0)) continue;   // nothing of the ring on this tile
      const withCal = !!cal && cal.r === r && cal.c === c;
      const mark = (x: number, y: number) => `<path d="M${f(x - 5)} ${f(y)}H${f(x + 5)}M${f(x)} ${f(y - 5)}V${f(y + 5)}" stroke="#000" stroke-width="0.25"/>`;
      let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">`;
      s += `<defs><clipPath id="clip"><rect x="${MARGIN}" y="${MARGIN}" width="${pw}" height="${ph}"/></clipPath></defs>`;
      s += `<g clip-path="url(#clip)"><g transform="translate(${f(MARGIN - x0 + cx)} ${f(MARGIN - y0 + cy)})">${inner}</g></g>`;
      // the overlap strips, shaded lightly, and alignment crosses at the four corners of the printable area
      s += `<rect x="${MARGIN}" y="${MARGIN}" width="${pw}" height="${ph}" fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="2 2"/>`;
      if (c > 0) s += `<rect x="${MARGIN}" y="${MARGIN}" width="${OVERLAP}" height="${ph}" fill="#000" fill-opacity="0.04"/>`;
      if (r > 0) s += `<rect x="${MARGIN}" y="${MARGIN}" width="${pw}" height="${OVERLAP}" fill="#000" fill-opacity="0.04"/>`;
      s += mark(MARGIN + OVERLAP, MARGIN + OVERLAP) + mark(MARGIN + pw - OVERLAP, MARGIN + OVERLAP) + mark(MARGIN + OVERLAP, MARGIN + ph - OVERLAP) + mark(MARGIN + pw - OVERLAP, MARGIN + ph - OVERLAP);
      s += `<text x="${w / 2}" y="${MARGIN - 3}" font-size="3.5" text-anchor="middle">${esc(d.labels.title)} · ${esc(d.labels.page(r + 1, c + 1))}</text>`;
      if (withCal) s += calibration(cal!.x, cal!.y, d.labels.calibration);
      s += `</svg>`;
      pages.push({ row: r + 1, col: c + 1, svg: s, x0, y0, w: pw, h: ph, calibration: withCal ? { x: cal!.x - MARGIN + x0, y: cal!.y - MARGIN + y0 } : null });
    }
  }
  if (!cal) {
    // no room beside the ring: the calibration square gets a sheet of its own
    pages.unshift({ row: 0, col: 0, x0: 0, y0: 0, w: pw, h: ph, calibration: null,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">` +
        `<text x="${w / 2}" y="${MARGIN - 3}" font-size="3.5" text-anchor="middle">${esc(d.labels.title)}</text>` + calibration(MARGIN + 4, MARGIN + 4, d.labels.calibration) + `</svg>` });
  }
  return pages;
}

/** A printable HTML document holding the pages, one per sheet, at actual size. */
export function templatePrintHtml(pages: TemplatePage[], paper: Paper, title: string, note: string, htmlLang: string): string {
  const { w, h } = PAPER[paper];
  return `<!doctype html><html lang="${htmlLang}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:${paper} portrait; margin:0} body{margin:0; font-family:Arial,sans-serif} .note{padding:12px 16px; background:#fff8d8; border-bottom:1px solid #e0c060}
.page{width:${w}mm; height:${h}mm; page-break-after:always; overflow:hidden} .page svg{display:block}
@media print{.note{display:none}}</style></head><body><p class="note">${esc(note)}</p>
${pages.map((p) => `<div class="page">${p.svg}</div>`).join("\n")}</body></html>`;
}
