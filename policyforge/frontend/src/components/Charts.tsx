// Small SVG charts for the report and the monitor: fan charts, densities, scatter small multiples, sparklines.
// Colours come from the validated series tokens (--s1…--s4); text stays in ink tokens; every chart has a legend or a
// title naming its one series, and a hover tooltip.

import { useRef, useState, type ReactNode } from "react";
import { bandPath, kde, linear, linePath, nearest, niceTicks, padded, quantile } from "../lib/chart";

export const SERIES: Record<string, { label: string; color: string }> = {
  candidate: { label: "Candidate", color: "var(--s1)" },
  incumbent: { label: "Incumbent", color: "var(--s2)" },
  naive: { label: "Naive", color: "var(--s3)" },
  rolling_opt: { label: "Rolling optimisation", color: "var(--s4)" },
};
export const seriesOf = (name: string) => SERIES[name] ?? { label: name, color: "var(--pf-ink-faint)" };

export function Legend({ names }: { names: string[] }) {
  if (names.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-3 text-[12px] text-ink-dim" data-testid="legend">
      {names.map((n) => (
        <span key={n} className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-[3px] rounded" style={{ background: seriesOf(n).color }} />{seriesOf(n).label}
        </span>
      ))}
    </div>
  );
}

function Frame({ title, children, legend }: { title: string; children: ReactNode; legend?: string[] }) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-head font-semibold text-[13px] tracking-wider uppercase text-ink-dim">{title}</span>
        {legend && <Legend names={legend} />}
      </figcaption>
      {children}
    </figure>
  );
}

const M = { l: 52, r: 12, t: 8, b: 24 };

export interface FanSeries { name: string; p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] }

export function FanChart({ title, series, format, startWeek = 0, height = 210 }: {
  title: string; series: FanSeries[]; format: (v: number) => string; startWeek?: number; height?: number;
}) {
  const W = 560;
  const H = height;
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!series.length || !series[0].p50.length) return null;
  const n = series[0].p50.length;
  const [lo, hi] = padded(series.flatMap((s) => [...s.p5, ...s.p95]));
  const x = linear(0, Math.max(1, n - 1), M.l, W - M.r);
  const y = linear(lo, hi, H - M.b, M.t);
  const xs = Array.from({ length: n }, (_, i) => x(i));
  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(nearest(xs, px));
  };
  return (
    <Frame title={title} legend={series.map((s) => s.name)}>
      <div ref={box} className="relative" data-testid={`fan-${title}`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          role="img" aria-label={`${title}: median and P5–P95 bands over ${n} weeks`}>
          {niceTicks(lo, hi, 4).map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--pf-line-soft)" />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10.5} fill="var(--pf-ink-faint)" className="mono">{format(t)}</text>
            </g>
          ))}
          {niceTicks(0, n - 1, 6).map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--pf-ink-faint)" className="mono">
              {Math.round(t) + startWeek}</text>
          ))}
          {series.map((s) => (
            <g key={s.name}>
              <path d={bandPath(xs, s.p5.map(y), s.p95.map(y))} fill={seriesOf(s.name).color} opacity={0.12} />
              <path d={bandPath(xs, s.p25.map(y), s.p75.map(y))} fill={seriesOf(s.name).color} opacity={0.22} />
              <path d={linePath(xs, s.p50.map(y))} fill="none" stroke={seriesOf(s.name).color} strokeWidth={2} />
            </g>
          ))}
          {hover !== null && <line x1={xs[hover]} x2={xs[hover]} y1={M.t} y2={H - M.b} stroke="var(--pf-ink-faint)" strokeDasharray="3 3" />}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: `${Math.min(70, (xs[hover] / W) * 100)}%`, top: 6 }}>
            <div className="mono text-ink-faint">week {hover + startWeek}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: seriesOf(s.name).color }} />
                <span>{seriesOf(s.name).label}</span>
                <span className="mono ml-auto">{format(s.p50[hover])} <span className="text-ink-faint">({format(s.p5[hover])}–{format(s.p95[hover])})</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

/** A distribution per policy, as a mirrored density with P5, median and P95 marks (violin-style). */
export function Densities({ title, series, format }: {
  title: string; series: { name: string; values: number[] }[]; format: (v: number) => string;
}) {
  const W = 560;
  const row = 34;
  const H = M.t + series.length * row + M.b;
  const [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (all.length < 2) return null;
  const [lo, hi] = padded(all);
  const x = linear(lo, hi, M.l + 70, W - M.r);
  return (
    <Frame title={title} legend={series.length > 1 ? series.map((s) => s.name) : undefined}>
      <div className="relative" data-testid={`density-${title}`}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={`${title}: distributions`}>
          {niceTicks(lo, hi, 5).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t} y2={H - M.b} stroke="var(--pf-line-soft)" />
              <text x={x(t)} y={H - 6} textAnchor="middle" fontSize={10.5} fill="var(--pf-ink-faint)" className="mono">{format(t)}</text>
            </g>
          ))}
          {series.map((s, i) => {
            const cy = M.t + i * row + row / 2;
            const d = kde(s.values, lo, hi, 60);
            const top = Math.max(...d.map((p) => p.y), 1e-12);
            const half = (row / 2 - 3) / top;
            const upper = d.map((p) => `${x(p.x).toFixed(1)},${(cy - p.y * half).toFixed(1)}`);
            const lower = [...d].reverse().map((p) => `${x(p.x).toFixed(1)},${(cy + p.y * half).toFixed(1)}`);
            const [q5, q50, q95] = [0.05, 0.5, 0.95].map((q) => quantile(s.values, q));
            const c = seriesOf(s.name).color;
            return (
              <g key={s.name} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={M.l} y={cy - row / 2} width={W - M.l - M.r} height={row} fill="transparent" />
                <text x={M.l - 2} y={cy + 4} fontSize={11.5} fill="var(--pf-ink-dim)">{seriesOf(s.name).label}</text>
                {d.length > 0 && <polygon points={[...upper, ...lower].join(" ")} fill={c} opacity={0.35} stroke={c} strokeWidth={1} />}
                <line x1={x(q5)} x2={x(q95)} y1={cy} y2={cy} stroke="var(--pf-ink)" strokeWidth={1.5} />
                <circle cx={x(q50)} cy={cy} r={4} fill="var(--pf-ink)" stroke="var(--pf-panel)" strokeWidth={2} />
              </g>
            );
          })}
        </svg>
        {hover !== null && (() => {
          const v = series[hover].values;
          return (
            <div className="tip" style={{ left: "40%", top: M.t + hover * row - 4 }}>
              <b>{seriesOf(series[hover].name).label}</b> · {v.length} futures<br />
              <span className="mono">P5 {format(quantile(v, 0.05))} · median {format(quantile(v, 0.5))} · P95 {format(quantile(v, 0.95))}</span>
            </div>
          );
        })()}
      </div>
    </Frame>
  );
}

/** Cost against service, one small panel per scenario on shared scales (8 scenarios would be too many colours). */
export function TradeOffs({ panels, names }: {
  panels: { id: string; title: string; points: { name: string; cost: number; service: number }[] }[]; names: string[];
}) {
  const W = 220;
  const H = 150;
  const m = { l: 40, r: 8, t: 6, b: 22 };
  const [hover, setHover] = useState<{ panel: string; i: number } | null>(null);
  const all = panels.flatMap((p) => p.points);
  if (!all.length) return null;
  const [c0, c1] = padded(all.map((p) => p.cost));
  const [s0, s1] = padded(all.map((p) => p.service).map((v) => Math.min(1, v)));
  const x = linear(c0, c1, m.l, W - m.r);
  const y = linear(s0, Math.min(1.0005, s1), H - m.b, m.t);
  return (
    <Frame title="Cost per week against fill rate, by scenario (one dot per future)" legend={names}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2" data-testid="tradeoffs">
        {panels.map((p) => (
          <div key={p.id} className="relative border border-line-soft rounded p-1">
            <div className="text-[11.5px] text-ink-dim truncate" title={p.title}>{p.title}</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={`${p.title}: cost against fill rate`}>
              {niceTicks(s0, s1, 3).map((t) => (
                <g key={t}><line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--pf-line-soft)" />
                  <text x={m.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9.5} fill="var(--pf-ink-faint)" className="mono">{(t * 100).toFixed(0)}%</text></g>
              ))}
              {niceTicks(c0, c1, 2).map((t) => (
                <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize={9.5} fill="var(--pf-ink-faint)" className="mono">€{(t / 1000).toFixed(0)}k</text>
              ))}
              {p.points.map((pt, i) => (
                <circle key={i} cx={x(pt.cost)} cy={y(Math.min(1, pt.service))} r={hover?.panel === p.id && hover.i === i ? 5 : 3}
                  fill={seriesOf(pt.name).color} fillOpacity={0.75} stroke="var(--pf-panel)" strokeWidth={1}
                  onPointerEnter={() => setHover({ panel: p.id, i })} onPointerLeave={() => setHover(null)} />
              ))}
            </svg>
            {hover?.panel === p.id && (
              <div className="tip" style={{ left: 8, top: 18 }}>
                {seriesOf(p.points[hover.i].name).label}: fill {(p.points[hover.i].service * 100).toFixed(1)}%,
                €{Math.round(p.points[hover.i].cost).toLocaleString("en")}/week
              </div>
            )}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** One series over time with an optional threshold line and alarm marks (monitor states, KPIs). */
export function Spark({ values, threshold, alarms = [], width = 260, height = 56, format, label }: {
  values: (number | null)[]; threshold?: number | null; alarms?: number[]; width?: number; height?: number;
  format: (v: number) => string; label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) return <div className="text-[11px] text-ink-faint">no observations yet</div>;
  const [lo, hi] = padded([...nums, ...(threshold != null ? [threshold] : [])], 0.1);
  const n = values.length;
  const x = linear(0, Math.max(1, n - 1), 2, width - 2);
  const y = linear(lo, hi, height - 4, 4);
  const segs: string[] = [];
  let cur = "";
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { if (cur) segs.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  return (
    <div ref={box} className="relative" data-testid={`spark-${label}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto block" role="img" aria-label={label}
        onPointerMove={(e) => {
          const r = box.current!.getBoundingClientRect();
          setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))));
        }} onPointerLeave={() => setHover(null)}>
        {threshold != null && <line x1={0} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--pf-warn)" strokeDasharray="4 3" />}
        {alarms.map((w) => <line key={w} x1={x(w)} x2={x(w)} y1={0} y2={height} stroke="var(--pf-bad)" strokeWidth={1.5} />)}
        {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="var(--pf-accent)" strokeWidth={2} />)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--pf-ink-faint)" strokeDasharray="2 2" />}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: 4, top: -28 }}>
          week {hover}: <span className="mono">{values[hover] === null ? "no observation" : format(values[hover] as number)}</span>
          {threshold != null && <span className="text-ink-faint"> · threshold {format(threshold)}</span>}
        </div>
      )}
    </div>
  );
}
