import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type Alert, type MonitorState } from "../api";
import { Spark } from "../components/Charts";
import Report, { VerdictBadge } from "../components/Report";
import { useJob, JobBar } from "../jobs";
import { fmtEur, fmtNum, fmtPct } from "../lib/chart";
import { useRoute } from "../route";
import { useStore } from "../store";

const SEV: Record<string, string> = { critical: "text-bad border-bad", high: "text-bad border-bad", medium: "text-warn border-warn", low: "text-ink-faint border-line" };
const KINDS = [
  { kind: "supplier_outage", label: "Supplier capacity loss" },
  { kind: "lead_time_inflation", label: "Lead-time inflation" },
  { kind: "plant_capacity_loss", label: "Plant capacity loss" },
  { kind: "demand_shift", label: "Demand shift" },
];
const SPEEDS = [{ ms: 900, label: "slow" }, { ms: 350, label: "normal" }, { ms: 80, label: "fast" }];

function fmtFor(m: MonitorState): (v: number) => string {
  if (m.kind === "input") return (v) => `×${v.toFixed(2)}`;
  if (m.subject === "service" || m.subject.includes("fill_rate") || m.subject.includes("utilisation")) return (v) => fmtPct(v);
  if (m.subject === "cost") return fmtEur;
  return fmtNum;
}

export default function Monitor({ params }: { params: Record<string, string> }) {
  const s = useStore();
  const qc = useQueryClient();
  const [, go] = useRoute();
  const streams = useQuery({ queryKey: ["streams"], queryFn: api.streams });
  const sid = params.stream ? Number(params.stream) : streams.data?.[0]?.id ?? null;
  const [reveal, setReveal] = useState(false);
  const stream = useQuery({ queryKey: ["stream", sid, reveal], queryFn: () => api.stream(sid!, reveal), enabled: sid !== null });
  const alerts = useQuery({ queryKey: ["alerts", sid], queryFn: () => api.alerts(undefined, sid!), enabled: sid !== null });
  const deployed = useQuery({ queryKey: ["summaries"], queryFn: api.summaries });
  const [seed, setSeed] = useState(1);
  const [scenario, setScenario] = useState("baseline");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(350);
  const [pauseOnAlert, setPauseOnAlert] = useState(true);

  const create = useMutation({
    mutationFn: () => api.createStream({ seed, scenario_id: scenario }),
    onSuccess: (st) => { qc.invalidateQueries({ queryKey: ["streams"] }); go("monitor", { stream: st.id }); s.notify(`Stream ${st.id} started at week 0`); },
    onError: (e) => s.notify((e as Error).message),
  });
  const step = useMutation({
    mutationFn: (weeks: number) => api.step(sid!, weeks),
    onSuccess: (r) => {
      qc.setQueryData(["stream", sid, reveal], reveal ? { ...r.stream, switches: stream.data?.switches ?? null } : r.stream);
      if (r.raised.length) {
        qc.invalidateQueries({ queryKey: ["alerts", sid] });
        s.notify(`Week ${r.stream.week}: ${r.raised.length} new alert${r.raised.length > 1 ? "s" : ""} in the inbox`);
        if (pauseOnAlert) setPlaying(false);
      }
      if (r.stream.week >= r.stream.horizon - 1) setPlaying(false);
    },
    onError: (e) => { setPlaying(false); s.notify((e as Error).message); },
  });
  const busy = useRef(false);
  busy.current = step.isPending;
  useEffect(() => {
    if (!playing || sid === null) return;
    const t = setInterval(() => { if (!busy.current) step.mutate(1); }, speed);
    return () => clearInterval(t);
  }, [playing, speed, sid]); // eslint-disable-line react-hooks/exhaustive-deps

  const st = stream.data;
  const nDeployed = (deployed.data ?? []).filter((p) => p.status === "deployed").length;
  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1500px]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-head font-bold text-[22px] tracking-wider uppercase m-0">Monitor</h1>
          <p className="text-ink-dim text-[13.5px] m-0 max-w-[820px]">A live stream runs the network week by week with the deployed
            policies, from a true world the monitors cannot see. Change that world with <b>Inject drift</b>, and watch the
            assumption, input, performance and mandate monitors catch it; alerts land in the inbox, ranked.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 border border-line rounded-lg bg-panel p-2">
          <select className="inp" aria-label="Stream" value={sid ?? ""} onChange={(e) => go("monitor", { stream: e.target.value })}>
            {(streams.data ?? []).map((x) => <option key={x.id} value={x.id}>stream {x.id} · week {x.week}/{x.horizon} · {x.policies.length} polic{x.policies.length === 1 ? "y" : "ies"}</option>)}
            {!streams.data?.length && <option value="">no streams yet</option>}
          </select>
          <label className="text-[12.5px] flex items-center gap-1">seed <input className="inp w-16" type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
          <select className="inp" aria-label="Matching scenario" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="baseline">compare with: baseline</option>
          </select>
          <button className="btn btn-primary" data-testid="new-stream" disabled={create.isPending} onClick={() => create.mutate()}
            title={`Runs the ${nDeployed} deployed polic${nDeployed === 1 ? "y" : "ies"} on top of the incumbent`}>New stream</button>
        </div>
      </div>
      {nDeployed === 0 && <p className="text-warn text-[13px] m-0">No policy is deployed: a stream will run the incumbent only, with input and performance monitors but no assumption monitors.</p>}
      {!st ? <p className="text-ink-faint">Start a stream.</p> : <>
        <section className="flex flex-wrap items-center gap-2 border border-line rounded-lg bg-panel p-2 sticky top-0 z-10">
          <span className="font-head font-bold text-[18px] mono" data-testid="week">week {st.week}</span>
          <span className="text-[12px] text-ink-faint">of {st.horizon} · {st.policies.join(", ") || "incumbent only"} · seed {st.seed}</span>
          <button className="btn btn-primary" data-testid={playing ? "pause" : "play"} disabled={st.week >= st.horizon - 1}
            onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
          <button className="btn" data-testid="step" disabled={playing || step.isPending} onClick={() => step.mutate(1)}>Step 1</button>
          <button className="btn" data-testid="step4" disabled={playing || step.isPending} onClick={() => step.mutate(4)}>Step 4</button>
          <select className="inp" aria-label="Speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((x) => <option key={x.ms} value={x.ms}>{x.label}</option>)}
          </select>
          <label className="text-[12.5px] flex items-center gap-1"><input type="checkbox" checked={pauseOnAlert} onChange={(e) => setPauseOnAlert(e.target.checked)} /> pause on a new alert</label>
          <span className={`ml-auto mono text-[12.5px] ${st.open_alerts ? "text-bad" : "text-ok"}`} data-testid="open-alerts">{st.open_alerts} open alert{st.open_alerts === 1 ? "" : "s"}</span>
        </section>

        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_560px] gap-4">
          <div className="flex flex-col gap-4">
            <Inject sid={st.id} week={st.week} onDone={() => qc.invalidateQueries({ queryKey: ["stream", sid] })} />
            <label className="text-[12.5px] flex items-center gap-1"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
              show the hidden world (for demos)</label>
            {reveal && st.switches && (
              <ul className="m-0 pl-4 text-[12.5px] text-ink-dim" data-testid="switches">
                {st.switches.length === 0 && <li>Nothing injected: the world is the baseline.</li>}
                {st.switches.map((w: any, i: number) => <li key={i}>from week {w.week}: <span className="mono">{JSON.stringify(w.component)}</span></li>)}
              </ul>
            )}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="border border-line rounded-lg bg-panel p-2"><div className="lbl">Fill rate per week</div>
                <Spark values={st.service} format={(v) => fmtPct(v)} label="service" width={420} height={70} /></div>
              <div className="border border-line rounded-lg bg-panel p-2"><div className="lbl">Cost per week</div>
                <Spark values={st.cost} format={fmtEur} label="cost" width={420} height={70} /></div>
            </section>
            <section>
              <h2 className="font-head font-bold uppercase tracking-wider text-[15px] m-0 mb-2">Monitors ({st.monitors.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" data-testid="monitors">
                {st.monitors.map((m) => (
                  <div key={m.id} className={`border rounded-lg bg-panel p-2 ${m.status === "alarm" ? "border-bad" : "border-line"}`} data-testid={`monitor-${m.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="lbl">{m.kind}</span>
                      <span className="mono text-[12px] truncate" title={m.id}>{m.subject}</span>
                      <span className={`ml-auto text-[11.5px] font-semibold ${m.status === "alarm" ? "text-bad" : m.status === "ok" ? "text-ok" : "text-ink-faint"}`}>{m.status.replace("_", " ")}</span>
                    </div>
                    <div className="text-[11.5px] text-ink-faint leading-tight mb-1">{m.description}</div>
                    {m.status !== "not_observable" && <Spark values={m.series} threshold={m.kind === "input" ? 1 : m.threshold} alarms={m.alarm_weeks} format={fmtFor(m)} label={m.id} />}
                  </div>
                ))}
              </div>
            </section>
          </div>
          <Inbox alerts={alerts.data ?? []} onChanged={() => { qc.invalidateQueries({ queryKey: ["alerts", sid] }); qc.invalidateQueries({ queryKey: ["stream", sid] }); }} />
        </div>
      </>}
    </div>
  );
}

function Inject({ sid, week, onDone }: { sid: number; week: number; onDone: () => void }) {
  const s = useStore();
  const [kind, setKind] = useState("supplier_outage");
  const [supplier, setSupplier] = useState("SUP_C");
  const [plant, setPlant] = useState("PLANT_N");
  const [markets, setMarkets] = useState<string[]>([]);
  const [start, setStart] = useState(20);
  const [duration, setDuration] = useState<string>("");
  const [size, setSize] = useState(0.6);
  useEffect(() => setSize(kind === "supplier_outage" || kind === "plant_capacity_loss" ? 0.6 : 1.5), [kind]);
  const component = () => {
    const window = { start, duration: duration ? Number(duration) : null };
    if (kind === "supplier_outage") return { kind, supplier, window, severity: size };
    if (kind === "plant_capacity_loss") return { kind, plant, window, severity: size };
    if (kind === "lead_time_inflation") return { kind, supplier, start, factor: size, ramp_periods: 0 };
    return { kind, window, factor: size, markets, skus: [], categories: [] };
  };
  const inject = useMutation({
    mutationFn: () => api.inject(sid, component(), "injected from the Monitor screen"),
    onSuccess: () => { onDone(); s.notify(`Injected from week ${week + 1}; it bites from week ${start}. The monitors are not told.`); },
    onError: (e) => s.notify((e as Error).message),
  });
  const severityLike = kind === "supplier_outage" || kind === "plant_capacity_loss";
  return (
    <section className="border border-line rounded-lg bg-panel p-2 flex flex-wrap items-end gap-2" data-testid="inject">
      <span className="lbl self-center">Inject drift</span>
      <select className="inp" aria-label="Drift kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      {(kind === "supplier_outage" || kind === "lead_time_inflation") && (
        <select className="inp" aria-label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          {s.net.suppliers.map((x) => <option key={x.id}>{x.id}</option>)}</select>)}
      {kind === "plant_capacity_loss" && (
        <select className="inp" aria-label="Plant" value={plant} onChange={(e) => setPlant(e.target.value)}>
          {s.net.plants.map((x) => <option key={x.id}>{x.id}</option>)}</select>)}
      {kind === "demand_shift" && (
        <span className="flex flex-wrap gap-2 text-[12px]">{s.net.markets.map((m) => (
          <label key={m.id} className="flex items-center gap-1"><input type="checkbox" checked={markets.includes(m.id)}
            onChange={(e) => setMarkets(e.target.checked ? [...markets, m.id] : markets.filter((x) => x !== m.id))} />{m.id}</label>))}
          {!markets.length && <span className="text-ink-faint">all markets</span>}</span>)}
      <label className="text-[12.5px] flex flex-col">from week<input className="inp w-20" type="number" aria-label="Bites from week" min={week + 1} value={start} onChange={(e) => setStart(Number(e.target.value))} /></label>
      {kind !== "lead_time_inflation" && <label className="text-[12.5px] flex flex-col">for weeks<input className="inp w-20" aria-label="Duration" placeholder="to the end" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>}
      <label className="text-[12.5px] flex flex-col">{severityLike ? "capacity lost (0–1)" : "factor"}
        <input className="inp w-20" type="number" step={0.05} aria-label={severityLike ? "Severity" : "Factor"} value={size} onChange={(e) => setSize(Number(e.target.value))} /></label>
      <button className="btn btn-primary" data-testid="do-inject" disabled={inject.isPending} onClick={() => inject.mutate()}>Inject</button>
      <span className="text-[11.5px] text-ink-faint basis-full">Applies from week {week + 1} on and never changes the weeks already observed.</span>
    </section>
  );
}

function Inbox({ alerts, onChanged }: { alerts: Alert[]; onChanged: () => void }) {
  const [closed, setClosed] = useState(false);
  const shown = alerts.filter((a) => closed || a.status === "open" || a.status === "acknowledged").sort((a, b) => b.score - a.score || a.week - b.week);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-head font-bold uppercase tracking-wider text-[15px] m-0">Escalation inbox</h2>
        <label className="ml-auto text-[12px] flex items-center gap-1"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} /> show closed</label>
      </div>
      <p className="text-[12px] text-ink-faint m-0">Ranked by severity × 1/reversibility × exposure (€/week).</p>
      {shown.length === 0 && <p className="text-[13px] text-ok m-0" data-testid="inbox-empty">Nothing to look at.</p>}
      <ol className="m-0 p-0 list-none flex flex-col gap-2" data-testid="inbox">
        {shown.map((a, i) => <AlertCard key={a.id} a={a} rank={i + 1} onChanged={onChanged} />)}
      </ol>
    </section>
  );
}

function AlertCard({ a, rank, onChanged }: { a: Alert; rank: number; onChanged: () => void }) {
  const s = useStore();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [showReport, setShowReport] = useState(false);
  const rid = a.retest_id ?? (job.data?.status === "done" ? job.data.result?.retest_id : null);
  const retest = useQuery({ queryKey: ["retest", rid], queryFn: () => api.getRetest(rid!), enabled: !!rid });
  useEffect(() => { if (job.data?.status === "done") { onChanged(); qc.invalidateQueries({ queryKey: ["retest"] }); } }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = useMutation({
    mutationFn: (to: "acknowledge" | "resolve" | "dismiss") => api.moveAlert(a.id, to),
    onSuccess: onChanged, onError: (e) => s.notify((e as Error).message),
  });
  const run = useMutation({
    mutationFn: () => api.retest(a.id, { replications: 100, periods: 104, rolling_replications: 10 }),
    onSuccess: (j) => setJobId(j.id), onError: (e) => s.notify((e as Error).message),
  });
  const open = a.status === "open" || a.status === "acknowledged";
  return (
    <li className={`border rounded-lg bg-panel p-2 flex flex-col gap-1 ${open ? "border-line" : "border-line-soft opacity-70"}`} data-testid={`alert-${a.id}`} data-monitor={a.monitor_id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[12px] text-ink-faint">#{rank}</span>
        <span className={`text-[11px] font-semibold uppercase border rounded px-1.5 ${SEV[a.severity] ?? ""}`}>{a.severity}</span>
        <span className="lbl">{a.kind}</span>
        <span className="mono text-[12px]">{a.subject}</span>
        <span className="ml-auto mono text-[12px]" title={`severity × 1/${a.reversibility} × €${Math.round(a.exposure_eur_per_week)}/week`}>score {Math.round(a.score).toLocaleString("en")}</span>
      </div>
      <div className="text-[13px]">{a.message}</div>
      <div className="text-[11.5px] text-ink-faint">week {a.week} · {a.status} · reversibility {a.reversibility} · exposure {fmtEur(a.exposure_eur_per_week)}/week: {a.basis}</div>
      {open && (
        <div className="flex flex-wrap gap-1">
          {a.status === "open" && <button className="btn" onClick={() => move.mutate("acknowledge")}>Acknowledge</button>}
          <button className="btn" onClick={() => move.mutate("resolve")}>Resolve</button>
          <button className="btn" onClick={() => move.mutate("dismiss")}>Dismiss</button>
          {(a.policy_id || a.kind !== "input") && <button className="btn btn-primary" data-testid="retest" disabled={run.isPending || (job.data && job.data.status !== "done" && job.data.status !== "failed")}
            onClick={() => run.mutate()}>Re-test with what we now see</button>}
        </div>
      )}
      {job.data && job.data.status !== "done" && <JobBar job={job.data} />}
      {retest.data && (
        <div className="border-t border-line-soft pt-1 flex flex-col gap-1" data-testid="retest-result">
          <div className="flex items-center gap-2"><span className="lbl">Re-test</span><VerdictBadge decision={retest.data.verdict} />
            <button className="btn ml-auto" onClick={() => setShowReport(!showReport)}>{showReport ? "Hide report" : "Full report"}</button></div>
          <ul className="m-0 pl-4 text-[12.5px]">{retest.data.retest.changes.map((c, i) => (
            <li key={i}><span className="mono">{c.path}</span>: {typeof c.before === "object" ? JSON.stringify(c.before) : c.before} → <b>{typeof c.after === "object" ? JSON.stringify(c.after) : c.after}</b> ({c.why})</li>))}
            {retest.data.retest.notes.map((n, i) => <li key={`n${i}`} className="text-ink-faint">{n}</li>)}</ul>
          {showReport && <Report report={retest.data.retest.report} />}
        </div>
      )}
    </li>
  );
}
