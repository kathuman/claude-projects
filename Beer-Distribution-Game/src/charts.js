// Small SVG charts for the debrief, drawn from plain numbers. Every chart has a legend, labels at the line ends, a
// hover read-out for the week under the pointer, and a table view, so no series is told apart by colour alone.
// Colours are CSS variables (--s1 … --s5 for the stages in chain order, --demand for customer demand), set for the
// light and the dark theme in styles.css.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

/**
 * A line chart over weeks.
 * series: [{ name, color (CSS colour or var), values: [...], dashed? }]; opts: { yLabel, zero (draw y = 0), id }
 * Returns HTML: the figure (SVG + legend) and a hidden table; wire() adds the hover read-out and the table toggle.
 */
export function lineChart(series, { yLabel = '', id, unit = '', min } = {}) {
  const W = 760, H = 300, M = { l: 52, r: 120, t: 14, b: 34 };
  const n = Math.max(...series.map((s) => s.values.length));
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const lo = min ?? Math.min(0, ...all);
  const hiRaw = Math.max(...all, 1);
  const hi = niceMax(hiRaw);
  const loN = lo < 0 ? -niceMax(-lo) : 0;
  const X = (k) => M.l + (n > 1 ? (k / (n - 1)) * (W - M.l - M.r) : 0);
  const Y = (v) => M.t + (1 - (v - loN) / (hi - loN)) * (H - M.t - M.b);
  const ticks = [];
  const step = (hi - loN) / 5;
  for (let v = loN; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(2));
  const grid = ticks.map((v) => `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  const xt = [];
  const every = n > 30 ? 10 : 5;
  for (let k = 0; k < n; k++) if ((k + 1) % every === 0 || k === 0) xt.push(`<text class="ax" x="${X(k)}" y="${H - M.b + 18}" text-anchor="middle">${k + 1}</text>`);
  const zero = loN < 0 ? `<line class="zero" x1="${M.l}" x2="${W - M.r}" y1="${Y(0)}" y2="${Y(0)}"/>` : '';
  // labels at the line ends, nudged apart so they never overlap
  const ends = series.map((s, j) => ({ j, y: Y(s.values[s.values.length - 1] ?? 0) })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  const lines = series.map((s, j) => {
    const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    const end = ends.find((e) => e.j === j);
    return `<path class="ln${s.dashed ? ' dashed' : ''}" d="${d}" style="stroke:${s.color}"/>`
      + `<text class="endlbl" x="${W - M.r + 6}" y="${end.y + 4}">${esc(s.name)}</text>`;
  }).join('');
  const legend = series.map((s) => `<span><i class="${s.dashed ? 'dash' : ''}" style="background:${s.color};border-color:${s.color}"></i>${esc(s.name)}</span>`).join('');
  const table = `<table class="data"><thead><tr><th>Week</th>${series.map((s) => `<th class="num">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${
    Array.from({ length: n }, (_, k) => `<tr><td>${k + 1}</td>${series.map((s) => `<td class="num">${s.values[k] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const data = JSON.stringify({ n, names: series.map((s) => s.name), colors: series.map((s) => s.color), values: series.map((s) => s.values), unit, x0: M.l, x1: W - M.r, W });
  return `<figure class="chart" id="${id}" data-chart='${esc(data)}'>
    <div class="legend">${legend}<button class="linkbtn" type="button" data-table>Show as table</button></div>
    <div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} by week">
      ${grid}${zero}${xt.join('')}<text class="axt" x="${M.l}" y="${H - 4}">Week</text>
      <text class="axt" x="12" y="${M.t + 4}" transform="rotate(-90 12 ${M.t + 4})" text-anchor="end">${esc(yLabel)}</text>
      ${lines}<line class="cross" x1="0" x2="0" y1="${M.t}" y2="${H - M.b}" hidden/>
      <rect class="hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}"/></svg>
      <div class="tip" hidden></div></div>
    <div class="tablewrap" hidden>${table}</div>
  </figure>`;
}

/** Hover read-out and table toggle for every chart in a container. */
export function wire(root) {
  for (const fig of root.querySelectorAll('figure.chart[data-chart]')) {
    const d = JSON.parse(fig.dataset.chart);
    const svg = fig.querySelector('svg');
    const rect = fig.querySelector('rect.hit');
    const cross = fig.querySelector('line.cross');
    const tip = fig.querySelector('.tip');
    const show = (ev) => {
      const box = svg.getBoundingClientRect();
      const x = ((ev.clientX - box.left) / box.width) * d.W;
      const k = Math.max(0, Math.min(d.n - 1, Math.round(((x - d.x0) / (d.x1 - d.x0)) * (d.n - 1))));
      const cx = d.x0 + (d.n > 1 ? (k / (d.n - 1)) * (d.x1 - d.x0) : 0);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.hidden = false;
      tip.innerHTML = `<b>Week ${k + 1}</b>${d.names.map((nm, j) => `<span><i style="background:${d.colors[j]}"></i>${esc(nm)}<em>${d.values[j][k] ?? '–'}${d.unit}</em></span>`).join('')}`;
      tip.hidden = false;
      const px = (cx / d.W) * box.width;
      tip.style.left = `${Math.min(Math.max(4, px + 12), box.width - tip.offsetWidth - 4)}px`;
    };
    rect.addEventListener('pointermove', show);
    rect.addEventListener('pointerdown', show);
    rect.addEventListener('pointerleave', () => { cross.hidden = true; tip.hidden = true; });
    const btn = fig.querySelector('[data-table]');
    btn.addEventListener('click', () => {
      const tw = fig.querySelector('.tablewrap');
      tw.hidden = !tw.hidden;
      btn.textContent = tw.hidden ? 'Show as table' : 'Hide table';
    });
  }
}

/** The supply-line curve: team cost against the share of the supply line counted, with markers. */
export function curveChart(curve, marks, { id } = {}) {
  const W = 760, H = 260, M = { l: 62, r: 24, t: 16, b: 40 };
  const hi = niceMax(Math.max(...curve.map((c) => c.cost)));
  const X = (b) => M.l + b * (W - M.l - M.r);
  const Y = (v) => M.t + (1 - v / hi) * (H - M.t - M.b);
  const d = curve.map((c, k) => `${k ? 'L' : 'M'}${X(c.beta).toFixed(1)} ${Y(c.cost).toFixed(1)}`).join(' ');
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => t * hi);
  const at = (b) => {
    const k = Math.min(curve.length - 2, Math.floor(b * (curve.length - 1)));
    const f = b * (curve.length - 1) - k;
    return curve[k].cost + f * (curve[k + 1].cost - curve[k].cost);
  };
  const mk = marks.map((m) => `<g class="mk ${m.cls ?? ''}"><line x1="${X(m.beta)}" x2="${X(m.beta)}" y1="${M.t}" y2="${H - M.b}"/>
      <circle cx="${X(m.beta)}" cy="${Y(at(m.beta))}" r="5"/><text x="${X(m.beta) + (m.beta > 0.8 ? -6 : 6)}" y="${M.t + 12 + (m.row ?? 0) * 14}" text-anchor="${m.beta > 0.8 ? 'end' : 'start'}">${esc(m.label)}</text></g>`).join('');
  return `<figure class="chart" id="${id}"><div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team cost against the share of the supply line counted">
    ${ticks.map((v) => `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${M.l - 8}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    ${[0, 0.25, 0.5, 0.75, 1].map((b) => `<text class="ax" x="${X(b)}" y="${H - M.b + 18}" text-anchor="middle">${Math.round(b * 100)} %</text>`).join('')}
    <text class="axt" x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">Share of what was already on order that every stage counted</text>
    <text class="axt" x="14" y="${M.t + 4}" transform="rotate(-90 14 ${M.t + 4})" text-anchor="end">Team cost</text>
    <path class="ln" d="${d}" style="stroke:var(--accent)"/>${mk}</svg></div>
    <table class="data sr"><thead><tr><th>Share counted</th><th class="num">Team cost</th></tr></thead><tbody>${curve.map((c) => `<tr><td>${Math.round(c.beta * 100)} %</td><td class="num">${Math.round(c.cost)}</td></tr>`).join('')}</tbody></table></figure>`;
}
