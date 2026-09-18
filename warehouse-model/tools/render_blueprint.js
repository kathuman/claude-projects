// Generates a technical-blueprint-style floor plan SVG of the baseline
// warehouse, using the SAME tested calculations.js layout arithmetic the
// live app uses (data/parameters.json defaults) -- not a separate,
// hand-guessed drawing. Run from anywhere: `node tools/render_blueprint.js`
// (from the warehouse-model/ folder) or `node warehouse-model/tools/render_blueprint.js`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = global;
require(path.join(ROOT, 'web/src/calculations.js'));

const paramsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/parameters.json'), 'utf8')).parameters;
const p = {};
for (const k in paramsRaw) p[k] = paramsRaw[k].value;

const results = window.WH.calc.computeAll(p);
const layout = results.layout;
const capacity = results.capacity;

// ---------------------------------------------------------------------
// Geometry, in metres, local building coords: (0,0) = outer NW corner
// ---------------------------------------------------------------------
const WT = p.wall_thickness / 1000;
const buildingW = p.warehouse_length + 2 * WT;   // x extent
const buildingH = p.warehouse_width + 2 * WT;    // y extent

const PX = 9; // px per metre
const MARGIN_X = 13, MARGIN_TOP = 7, MARGIN_BOTTOM = 9, TITLE_H = 15;
const canvasWm = buildingW + 2 * MARGIN_X;
const canvasHm = MARGIN_TOP + buildingH + MARGIN_BOTTOM + TITLE_H;
const W = Math.round(canvasWm * PX), H = Math.round(canvasHm * PX);
const ox = MARGIN_X * PX, oy = MARGIN_TOP * PX; // building origin in px

function X(xm) { return ox + xm * PX; }
function Y(ym) { return oy + ym * PX; }

const INK = '#bfe4ff';
const INK_DIM = '#6fa8c9';
const LINE = '#8fd0f2';
const BG = '#0a2f52';
const BG2 = '#0d3a63';
const RACK = '#ffb27a';
const RACK_FILL = 'rgba(217,89,38,0.35)';
const DOCK = '#7be0c4';
const ZONE = '#eda100';
const ACCENT = '#7dd3fc';

let s = [];
function el(str) { s.push(str); }

el(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Mono', ui-monospace, monospace">`);
el(`<rect x="0" y="0" width="${W}" height="${H}" fill="${BG}"/>`);

// grid (every 5m across the whole canvas)
el(`<g stroke="${BG2}" stroke-width="1">`);
for (let gx = 0; gx <= canvasWm; gx += 5) el(`<line x1="${gx*PX}" y1="0" x2="${gx*PX}" y2="${H}"/>`);
for (let gy = 0; gy <= canvasHm; gy += 5) el(`<line x1="0" y1="${gy*PX}" x2="${W}" y2="${gy*PX}"/>`);
el(`</g>`);

// border frame
el(`<rect x="6" y="6" width="${W-12}" height="${H-12}" fill="none" stroke="${INK}" stroke-width="2"/>`);
el(`<rect x="12" y="12" width="${W-24}" height="${H-24}" fill="none" stroke="${INK_DIM}" stroke-width="1"/>`);

// ---------------------------------------------------------------------
// Building envelope: outer wall face + inner wall face (double line)
// ---------------------------------------------------------------------
el(`<rect x="${X(0)}" y="${Y(0)}" width="${buildingW*PX}" height="${buildingH*PX}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
el(`<rect x="${X(WT)}" y="${Y(WT)}" width="${(buildingW-2*WT)*PX}" height="${(buildingH-2*WT)*PX}" fill="none" stroke="${INK}" stroke-width="1"/>`);

// wall hatch (diagonal ticks in the wall thickness band) - west/east/north/south
function wallHatch(x0, y0, x1, y1, step) {
  el(`<g stroke="${INK_DIM}" stroke-width="0.8">`);
  if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) {
    for (let x = x0; x < x1; x += step) el(`<line x1="${X(x)}" y1="${Y(y0)}" x2="${X(x+ (y1-y0))}" y2="${Y(y1)}"/>`);
  } else {
    for (let y = y0; y < y1; y += step) el(`<line x1="${X(x0)}" y1="${Y(y)}" x2="${X(x1)}" y2="${Y(y + (x1-x0))}"/>`);
  }
  el(`</g>`);
}
wallHatch(0.3, 0, buildingW - 0.3, WT, 1.2);
wallHatch(0.3, buildingH - WT, buildingW - 0.3, buildingH, 1.2);

// ---------------------------------------------------------------------
// Staging zones
// ---------------------------------------------------------------------
function dashedZone(x, y, w, h, label) {
  el(`<rect x="${X(x)}" y="${Y(y)}" width="${w*PX}" height="${h*PX}" fill="${ZONE}" fill-opacity="0.10" stroke="${ZONE}" stroke-width="1" stroke-dasharray="5,4"/>`);
  el(`<text x="${X(x+w/2)}" y="${Y(y+h/2)}" fill="${ZONE}" font-size="10" text-anchor="middle" transform="rotate(-90 ${X(x+w/2)} ${Y(y+h/2)})">${label}</text>`);
}
dashedZone(WT, WT, p.cross_aisle_width, p.warehouse_width, 'RECEIVING STAGING');
dashedZone(buildingW - WT - p.cross_aisle_width, WT, p.cross_aisle_width, p.warehouse_width, 'SHIPPING STAGING');

// ---------------------------------------------------------------------
// Rack rows
// ---------------------------------------------------------------------
const yOffset = (p.warehouse_width - layout.rackingWidthUsed) / 2;
const x0rack = p.cross_aisle_width + WT;
let rowIndex = 1;
for (let i = 0; i < layout.numAisleUnits; i++) {
  const unitY0 = yOffset + i * layout.widthPerAisleUnit + WT;
  [unitY0, unitY0 + p.rack_depth + p.aisle_width].forEach((ry) => {
    el(`<rect x="${X(x0rack)}" y="${Y(ry)}" width="${layout.rackRowLength*PX}" height="${p.rack_depth*PX}" fill="${RACK_FILL}" stroke="${RACK}" stroke-width="0.9"/>`);
    if (rowIndex === 1 || rowIndex === layout.numRackRows) {
      el(`<text x="${X(x0rack+2)}" y="${Y(ry+p.rack_depth/2+0.3)}" fill="${RACK}" font-size="6.5">R${String(rowIndex).padStart(2,'0')}</text>`);
    }
    rowIndex++;
  });
}
// rack block label
el(`<text x="${X(x0rack + layout.rackRowLength/2)}" y="${Y(yOffset + WT - 1.2)}" fill="${INK}" font-size="8" text-anchor="middle">${layout.numRackRows} RACK ROWS &#183; ${layout.baysPerRow} BAYS/ROW &#183; ${capacity.storageCapacity.toLocaleString('en-US')} POSITIONS</text>`);

// ---------------------------------------------------------------------
// Dock doors (west = receiving, east = shipping)
// ---------------------------------------------------------------------
function dockTicks(xEdge, count, label) {
  const total = count * p.dock_bay_width;
  const y0 = (p.warehouse_width - total) / 2 + WT;
  for (let i = 0; i < count; i++) {
    const y = y0 + i * p.dock_bay_width;
    el(`<rect x="${X(xEdge)-3}" y="${Y(y)}" width="6" height="${p.dock_bay_width*PX}" fill="${DOCK}"/>`);
  }
  el(`<text x="${X(xEdge)}" y="${Y(y0 - 0.8)}" fill="${DOCK}" font-size="7" text-anchor="middle">${label}</text>`);
}
dockTicks(0, p.num_receiving_docks, `${p.num_receiving_docks}\u00d7 RECEIVING`);
dockTicks(buildingW, p.num_shipping_docks, `${p.num_shipping_docks}\u00d7 SHIPPING`);

// ---------------------------------------------------------------------
// Dimension lines
// ---------------------------------------------------------------------
function dimH(y, x1, x2, label) {
  el(`<line x1="${X(x1)}" y1="${Y(y)}" x2="${X(x2)}" y2="${Y(y)}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<line x1="${X(x1)}" y1="${Y(y)-4}" x2="${X(x1)}" y2="${Y(y)+4}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<line x1="${X(x2)}" y1="${Y(y)-4}" x2="${X(x2)}" y2="${Y(y)+4}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<text x="${X((x1+x2)/2)}" y="${Y(y)-6}" fill="${ACCENT}" font-size="9" text-anchor="middle">${label}</text>`);
}
function dimV(x, y1, y2, label) {
  el(`<line x1="${X(x)}" y1="${Y(y1)}" x2="${X(x)}" y2="${Y(y2)}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<line x1="${X(x)-4}" y1="${Y(y1)}" x2="${X(x)+4}" y2="${Y(y1)}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<line x1="${X(x)-4}" y1="${Y(y2)}" x2="${X(x)+4}" y2="${Y(y2)}" stroke="${ACCENT}" stroke-width="0.8"/>`);
  el(`<text x="${X(x)-8}" y="${Y((y1+y2)/2)}" fill="${ACCENT}" font-size="9" text-anchor="middle" transform="rotate(-90 ${X(x)-8} ${Y((y1+y2)/2)})">${label}</text>`);
}
dimH(-3.5, 0, buildingW, `${p.warehouse_length.toFixed(1)} m (+ 2 \u00d7 ${(WT).toFixed(2)} m wall)`);
dimV(-4.5, 0, buildingH, `${p.warehouse_width.toFixed(1)} m (+ 2 \u00d7 ${(WT).toFixed(2)} m wall)`);
const aisleMidY = yOffset + WT + p.rack_depth + p.aisle_width / 2;
dimH(aisleMidY, x0rack, x0rack + p.bay_width, `bay ${p.bay_width.toFixed(2)} m`);
dimV(x0rack + p.bay_width + 1.2, yOffset+WT, yOffset+WT+p.rack_depth, `depth ${p.rack_depth.toFixed(2)}`);

// north arrow
const naX = buildingW + MARGIN_X - 5, naY = MARGIN_TOP + 2;
el(`<g stroke="${INK}" stroke-width="1" fill="${INK}">`);
el(`<line x1="${X(naX)}" y1="${Y(naY+3)}" x2="${X(naX)}" y2="${Y(naY)}"/>`);
el(`<path d="M ${X(naX)-4} ${Y(naY)+7} L ${X(naX)} ${Y(naY)} L ${X(naX)+4} ${Y(naY)+7} Z"/>`);
el(`</g>`);
el(`<text x="${X(naX)}" y="${Y(naY+5.5)}" fill="${INK}" font-size="9" text-anchor="middle">N</text>`);

// scale bar (true to the SVG's own coordinate system, so it stays correct
// at any display size, unlike a printed "1:200" ratio claim would)
const sbX = MARGIN_X, sbY = MARGIN_TOP + buildingH + 3;
el(`<g stroke="${INK}" stroke-width="1.2">`);
for (let i = 0; i < 4; i++) {
  el(`<rect x="${X(sbX+i*5)}" y="${Y(sbY)}" width="${5*PX}" height="4" fill="${i%2===0?INK:'none'}" stroke="${INK}"/>`);
}
el(`</g>`);
el(`<text x="${X(sbX)}" y="${Y(sbY)-2}" fill="${INK}" font-size="7">0</text>`);
el(`<text x="${X(sbX+20)}" y="${Y(sbY)-2}" fill="${INK}" font-size="7">20 m</text>`);

// ---------------------------------------------------------------------
// Title block
// ---------------------------------------------------------------------
const tbY = MARGIN_TOP + buildingH + MARGIN_BOTTOM;
el(`<rect x="12" y="${tbY*PX}" width="${W-24}" height="${TITLE_H*PX-6}" fill="none" stroke="${INK}" stroke-width="1.5"/>`);
const tbTextY = tbY * PX + 22;
el(`<text x="26" y="${tbTextY}" fill="${INK}" font-size="15" font-weight="700">WAREHOUSE MODEL &#8212; FLOOR PLAN (BASELINE)</text>`);
el(`<text x="26" y="${tbTextY+18}" fill="${INK_DIM}" font-size="9.5">freecad/create_model.py &#183; data/parameters.json defaults &#183; drawn to the SVG's own scale, see bar above</text>`);

const stats = [
  ['CAPACITY', capacity.storageCapacity.toLocaleString('en-US') + ' pos'],
  ['RACK ROWS', String(layout.numRackRows)],
  ['FOOTPRINT', Math.round(results.cost.footprint).toLocaleString('en-US') + ' m\u00b2'],
  ['DOCKS', (p.num_receiving_docks + p.num_shipping_docks) + ' (' + p.num_receiving_docks + '/' + p.num_shipping_docks + ')']
];
let statX = W - 470;
stats.forEach(([label, value]) => {
  el(`<text x="${statX}" y="${tbTextY-4}" fill="${INK_DIM}" font-size="8.5">${label}</text>`);
  el(`<text x="${statX}" y="${tbTextY+13}" fill="${ACCENT}" font-size="13" font-weight="700">${value}</text>`);
  statX += 118;
});

el(`</svg>`);

const outPath = path.join(ROOT, 'web/assets/blueprint.svg');
fs.writeFileSync(outPath, s.join('\n'));
console.log('Wrote', outPath, '(' + fs.statSync(outPath).size + ' bytes)');
console.log('Canvas:', W, 'x', H, 'px  |  storage_capacity=' + capacity.storageCapacity, ' rack_rows=' + layout.numRackRows);
