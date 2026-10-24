// The structure of the chain, drawn in full: customers, every stage, the orders travelling up the chain and the goods
// travelling down it with one box per week in transit, the plant's production line, and the costs. Structure only:
// no stock or quantities, so it can stay on screen while each stage keeps its own numbers to itself.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * cfg: { stages, names, orderDelay, shipDelay, prodDelay, holding, backlog }
 * opts: { now: stage deciding now (or -1), done: stages that have decided this week, simulated: stage indices }
 */
export function structureSvg(cfg, { now = -1, done = [], simulated = [] } = {}) {
  const n = cfg.stages;
  const SLOT = 16, GAP = 6, BOX_W = 128, BOX_H = 96, CUST_W = 100, TOP = 12;
  const laneO = TOP + 30;                 // orders travel right (up the chain) on this lane
  const laneG = TOP + BOX_H - 26;         // goods travel left (down the chain) on this lane
  const linkW = (k) => Math.max(k * (SLOT + GAP) + 60, 118);
  const between = linkW(Math.max(cfg.orderDelay, cfg.shipDelay));
  const prodW = linkW(cfg.prodDelay) + 40;
  const o = [];
  let x = 8;
  const slots = (x0, x1, y, k, cls) => {
    const w = k * SLOT + (k - 1) * GAP;
    const start = (x0 + x1) / 2 - w / 2;
    for (let s = 0; s < k; s++) o.push(`<rect class="slot ${cls}" x="${start + s * (SLOT + GAP)}" y="${y - 7}" width="${SLOT}" height="14" rx="3"/>`);
  };
  const arrow = (x0, x1, y, cls) => {
    const dir = x1 > x0 ? 1 : -1;
    o.push(`<line class="flow ${cls}" x1="${x0}" y1="${y}" x2="${x1 - dir * 7}" y2="${y}"/>`
      + `<path class="head ${cls}" d="M${x1} ${y} l${-dir * 8} -5 v10 z"/>`);
  };

  // customers
  o.push(`<rect class="cust" x="${x}" y="${TOP}" width="${CUST_W}" height="${BOX_H}" rx="10"/>`
    + `<text class="name" x="${x + CUST_W / 2}" y="${TOP + 36}" text-anchor="middle">Customers</text>`
    + `<text class="sub" x="${x + CUST_W / 2}" y="${TOP + 54}" text-anchor="middle">demand each week</text>`);
  x += CUST_W;
  const custLink = 70;
  arrow(x + 6, x + custLink - 4, laneO, 'ord');
  arrow(x + custLink - 6, x + 4, laneG, 'gds');
  o.push(`<text class="lbl" x="${x + custLink / 2}" y="${laneO - 9}" text-anchor="middle">orders</text>`
    + `<text class="lbl" x="${x + custLink / 2}" y="${laneG + 17}" text-anchor="middle">goods</text>`);
  x += custLink;

  for (let i = 0; i < n; i++) {
    const cls = ['stage', i === now ? 'now' : '', done.includes(i) ? 'done' : ''].join(' ');
    o.push(`<rect class="${cls}" x="${x}" y="${TOP}" width="${BOX_W}" height="${BOX_H}" rx="10" style="--c:var(--s${i + 1})"/>`
      + `<rect class="band" x="${x}" y="${TOP}" width="${BOX_W}" height="6" rx="3" style="fill:var(--s${i + 1})"/>`
      + `<text class="name" x="${x + BOX_W / 2}" y="${TOP + 34}" text-anchor="middle">${esc(cfg.names[i])}</text>`
      + `<text class="sub" x="${x + BOX_W / 2}" y="${TOP + 52}" text-anchor="middle">${i === n - 1 ? 'produces' : 'holds stock'}</text>`
      + `<text class="sub" x="${x + BOX_W / 2}" y="${TOP + 68}" text-anchor="middle">${simulated.includes(i) ? 'simulated' : i === now ? 'deciding now' : 'your team'}</text>`);
    x += BOX_W;
    if (i < n - 1) {
      arrow(x + 6, x + between - 4, laneO, 'ord');
      arrow(x + between - 6, x + 4, laneG, 'gds');
      slots(x, x + between, laneO, cfg.orderDelay, 'ord');
      slots(x, x + between, laneG, cfg.shipDelay, 'gds');
      o.push(`<text class="lbl" x="${x + between / 2}" y="${laneO - 14}" text-anchor="middle">orders · ${cfg.orderDelay} wk</text>`
        + `<text class="lbl" x="${x + between / 2}" y="${laneG + 23}" text-anchor="middle">goods · ${cfg.shipDelay} wk</text>`);
      x += between;
    }
  }

  // the plant's production line: production orders go in, finished goods come back after the production delay
  const px = x + 14;
  o.push(`<rect class="prod" x="${px}" y="${TOP}" width="${prodW - 14}" height="${BOX_H}" rx="10"/>`
    + `<text class="lbl" x="${px + (prodW - 14) / 2}" y="${TOP + BOX_H / 2 - 12}" text-anchor="middle">production · ${cfg.prodDelay} wk</text>`);
  arrow(x + 2, px + 10, laneO, 'ord');
  arrow(px + 10, x + 2, laneG, 'gds');
  slots(px + 8, px + prodW - 14, TOP + BOX_H / 2 + 10, cfg.prodDelay, 'gds');
  x = px + prodW;

  const W = x + 8;
  const legendY = TOP + BOX_H + 26;
  o.push(`<g class="legend">
    <line class="flow ord" x1="10" y1="${legendY - 4}" x2="34" y2="${legendY - 4}"/><text x="40" y="${legendY}">orders travel up the chain</text>
    <line class="flow gds" x1="220" y1="${legendY - 4}" x2="244" y2="${legendY - 4}"/><text x="250" y="${legendY}">goods travel down</text>
    <rect class="slot gds" x="392" y="${legendY - 11}" width="${SLOT}" height="14" rx="3"/><text x="${392 + SLOT + 6}" y="${legendY}">one week in transit</text>
    <text x="560" y="${legendY}">stock costs ${cfg.holding} · owed costs ${cfg.backlog} per unit per week</text></g>`);
  return `<svg class="structure-svg" viewBox="0 0 ${Math.max(W, 900)} ${legendY + 10}" role="img" aria-label="The chain: customers, ${cfg.names.map(esc).join(', ')}; orders take ${cfg.orderDelay} week(s), goods ${cfg.shipDelay}, production ${cfg.prodDelay}">${o.join('')}</svg>`;
}
