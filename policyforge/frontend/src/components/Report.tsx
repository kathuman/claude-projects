// An evaluation report: verdict, comparisons, the constitution table, fan charts, distributions and trade-offs.

import { useState } from "react";
import { fmtEur, fmtNum, fmtPct } from "../lib/chart";
import { Densities, FanChart, SERIES, TradeOffs, seriesOf } from "./Charts";

const DECISION: Record<string, { label: string; cls: string }> = {
  approve: { label: "Approve", cls: "text-ok border-ok" },
  approve_with_conditions: { label: "Approve with conditions", cls: "text-warn border-warn" },
  reject: { label: "Reject", cls: "text-bad border-bad" },
  none: { label: "No verdict", cls: "text-ink-faint border-line" },
};

export function VerdictBadge({ decision }: { decision: string }) {
  const d = DECISION[decision] ?? DECISION.none;
  return <span className={`font-head font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${d.cls}`} data-testid="verdict">{d.label}</span>;
}

export default function Report({ report }: { report: any }) {
  const scenarios: any[] = report.scenarios;
  const [sid, setSid] = useState<string>(scenarios.find((s) => !s.normal)?.scenario_id ?? scenarios[0]?.scenario_id);
  const sc = scenarios.find((s) => s.scenario_id === sid) ?? scenarios[0];
  const order = Object.keys(SERIES);
  const runs: any[] = [...sc.runs].sort((a, b) => order.indexOf(a.policy) - order.indexOf(b.policy));
  const names = runs.map((r) => r.policy);
  const reasons: any[] = report.verdict.reasons;
  const constraints: { id: string; text: string }[] = runs[0]?.constitution.map((c: any) => ({ id: c.id, text: c.text })) ?? [];

  return (
    <div className="flex flex-col gap-5" data-testid="report">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <VerdictBadge decision={report.verdict.decision} />
          <span className="text-[13px] text-ink-dim">{report.candidate?.name ?? report.candidate_id} · {report.replications} futures
            × {report.periods} weeks · {report.scenario_set} · {report.constitution_ref} · network {report.network}</span>
        </div>
        <ul className="m-0 pl-4 flex flex-col gap-1 text-[13.5px]" data-testid="reasons">
          {reasons.map((r, i) => (
            <li key={i} className={r.level === "reject" ? "err" : r.level === "condition" ? "text-warn" : "text-ink-dim"}>
              <span className="lbl mr-1">{r.level}</span>{r.text}</li>
          ))}
        </ul>
        {report.verdict.comparisons?.length > 0 && (
          <table className="border-collapse text-[13px] max-w-[760px]">
            <thead><tr>{["Objective", "Measure", "Candidate", "Incumbent", ""].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>{report.verdict.comparisons.map((c: any) => (
              <tr key={c.objective}>
                <td className="grid-cell px-2">{c.objective}</td>
                <td className="grid-cell px-2 text-ink-dim">{report.metric_info[c.metric]?.label ?? c.metric} ({c.measure.toUpperCase()})</td>
                <td className="grid-cell px-2 mono">{fmt(c.candidate, c.unit)}</td>
                <td className="grid-cell px-2 mono">{fmt(c.incumbent, c.unit)}</td>
                <td className={`grid-cell px-2 ${c.outcome === "better" ? "text-ok" : c.outcome === "worse" ? "text-bad" : "text-ink-faint"}`}>{c.outcome}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="font-head font-bold uppercase tracking-wider text-[15px] m-0">Constitution: share of futures breaching each limit</h3>
        <p className="text-[12px] text-ink-faint m-0">A limit may be breached in at most {fmtPct(report.breach_alpha, 0)} of futures. Candidate first, then the baselines.</p>
        <div className="overflow-auto border border-line rounded-lg bg-panel">
          <table className="border-collapse text-[12.5px] w-full" data-testid="constitution-table">
            <thead className="bg-panel-2"><tr>
              <th className="grid-cell lbl px-2 py-1 text-left">Scenario</th>
              {constraints.map((c) => <th key={c.id} className="grid-cell lbl px-2 py-1 text-left" title={c.text}>{c.id}</th>)}
            </tr></thead>
            <tbody>{scenarios.map((s) => (
              <tr key={s.scenario_id}>
                <td className="grid-cell px-2 py-1"><button className="underline-offset-2 hover:underline text-left" onClick={() => setSid(s.scenario_id)}>{s.name}</button></td>
                {constraints.map((c) => (
                  <td key={c.id} className="grid-cell px-2 mono whitespace-nowrap">
                    {s.runs.map((r: any) => {
                      const row = r.constitution.find((x: any) => x.id === c.id);
                      if (!row) return null;
                      return <span key={r.policy} className={`mr-2 ${row.passed ? "" : "text-bad font-semibold"}`} title={`${seriesOf(r.policy).label}: ${fmtPct(row.breach_share)} of futures`}>
                        <span className="inline-block w-2 h-2 rounded-full mr-0.5" style={{ background: seriesOf(r.policy).color }} />{fmtPct(row.breach_share, 0)}</span>;
                    })}
                  </td>
                ))}
              </tr>))}</tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-head font-bold uppercase tracking-wider text-[15px] m-0">Over time and across futures</h3>
          <select className="inp ml-2" value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Scenario" data-testid="report-scenario">
            {scenarios.map((s) => <option key={s.scenario_id} value={s.scenario_id}>{s.name}</option>)}
          </select>
          <span className="text-[12.5px] text-ink-faint">{sc.description}</span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <FanChart title="Weekly fill rate" format={(v) => fmtPct(v, 0)} startWeek={report.warmup}
            series={runs.filter((r) => r.fans.weekly_fill).map((r) => ({ name: r.policy, ...r.fans.weekly_fill }))} />
          <FanChart title="Weekly cost" format={fmtEur} startWeek={report.warmup}
            series={runs.filter((r) => r.fans.weekly_cost).map((r) => ({ name: r.policy, ...r.fans.weekly_cost }))} />
          <Densities title="Fill rate per future" format={(v) => fmtPct(v)}
            series={runs.map((r) => ({ name: r.policy, values: (r.samples.fill_rate ?? []).filter((v: any) => v !== null) }))} />
          <Densities title="Cost per week per future" format={fmtEur}
            series={runs.map((r) => ({ name: r.policy, values: (r.samples.cost_per_week ?? []).filter((v: any) => v !== null) }))} />
        </div>
        <TradeOffs names={["candidate", "incumbent"].filter((n) => names.includes(n))}
          panels={scenarios.map((s) => ({ id: s.scenario_id, title: s.name, points: s.runs
            .filter((r: any) => r.policy === "candidate" || r.policy === "incumbent")
            .flatMap((r: any) => (r.samples.fill_rate ?? []).map((f: number | null, i: number) => ({
              name: r.policy, service: f ?? NaN, cost: r.samples.cost_per_week?.[i] ?? NaN })))
            .filter((p: any) => Number.isFinite(p.service) && Number.isFinite(p.cost)) }))} />
      </section>
      {report.notes?.length > 0 && (
        <section><h3 className="font-head font-bold uppercase tracking-wider text-[15px] m-0">Notes</h3>
          <ul className="m-0 pl-4 text-[12.5px] text-ink-dim">{report.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul></section>
      )}
    </div>
  );
}

function fmt(v: number | null, unit: string): string {
  if (v === null || v === undefined) return "—";
  if (unit === "fraction" || unit === "share") return fmtPct(v);
  if (unit === "EUR" || unit.startsWith("EUR")) return fmtEur(v);
  return `${fmtNum(v)} ${unit}`;
}
