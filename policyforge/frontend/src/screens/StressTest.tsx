import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { download } from "../components/FileMenu";
import Report, { VerdictBadge } from "../components/Report";
import { useJob, JobBar } from "../jobs";
import { formatRoute } from "../lib/route";
import { useStore } from "../store";

export default function StressTest({ params }: { params: Record<string, string> }) {
  const s = useStore();
  const qc = useQueryClient();
  const summaries = useQuery({ queryKey: ["summaries"], queryFn: api.summaries });
  const ids = [...new Set((summaries.data ?? []).map((p) => p.policy_id))];
  const [pid, setPid] = useState(params.policy ?? "");
  const [ver, setVer] = useState<number>(params.version ? Number(params.version) : 0);
  useEffect(() => { if (!pid && ids.length) setPid(ids[0]); }, [ids.join(), pid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.policy) { setPid(params.policy); setVer(Number(params.version ?? 0)); } }, [params.policy, params.version]);
  const versions = useQuery({ queryKey: ["versions-p", pid], queryFn: () => api.policyVersions(pid), enabled: !!pid });
  const version = ver || versions.data?.at(-1)?.version || 0;

  const sets = useQuery({ queryKey: ["scenario-sets"], queryFn: api.scenarioSets });
  const [setId, setSetId] = useState("default-suite");
  const chosenSet = useQuery({ queryKey: ["scenario-set", setId], queryFn: () => api.scenarioSet(setId) });
  const [picked, setPicked] = useState<string[] | null>(null);
  useEffect(() => setPicked(null), [setId]);
  const scenarioIds: string[] = (chosenSet.data?.scenarios ?? []).map((x: any) => x.id);
  const selected = picked ?? scenarioIds;
  const [baselines, setBaselines] = useState<string[]>(["naive", "rolling_opt"]);
  const [reps, setReps] = useState(200);
  const [periods, setPeriods] = useState(104);
  const [rolling, setRolling] = useState(20);

  const evals = useQuery({ queryKey: ["evaluations", pid, version], queryFn: () => api.evaluations(pid, version), enabled: !!pid && !!version });
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [eid, setEid] = useState<number | null>(null);
  useEffect(() => { setEid(null); }, [pid, version]);
  const shown = eid ?? evals.data?.at(-1)?.id ?? null;
  const report = useQuery({ queryKey: ["report", shown], queryFn: () => api.report(shown!), enabled: shown !== null });

  useEffect(() => {
    if (job.data?.status === "done" && job.data.result?.evaluation_id) {
      setEid(job.data.result.evaluation_id);
      qc.invalidateQueries({ queryKey: ["evaluations"] });
      qc.invalidateQueries({ queryKey: ["summaries"] });
    }
  }, [job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useMutation({
    mutationFn: () => api.evaluate(pid, version, {
      replications: reps, periods, rolling_replications: rolling, scenario_set: setId === "default-suite" ? null : setId,
      scenarios: selected.length === scenarioIds.length ? null : selected, baselines: ["incumbent", ...baselines] }),
    onSuccess: (j) => setJobId(j.id),
    onError: (e) => s.notify((e as Error).message),
  });
  const running = job.data && (job.data.status === "queued" || job.data.status === "running");

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1400px]">
      <div>
        <h1 className="font-head font-bold text-[22px] tracking-wider uppercase m-0">Stress test</h1>
        <p className="text-ink-dim text-[13.5px] m-0 max-w-[820px]">Run a policy against the same futures as the incumbent and the
          baselines, in every scenario of a set, and get a verdict built from the numbers against the active constitution.</p>
      </div>
      <section className="border border-line rounded-lg bg-panel p-3 grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        <div className="flex flex-col gap-2">
          <label className="lbl" htmlFor="st-policy">Policy</label>
          <select id="st-policy" className="inp" value={pid} data-testid="st-policy" onChange={(e) => { setPid(e.target.value); setVer(0); }}>
            {!ids.length && <option value="">no policies yet: write one in Author</option>}
            {ids.map((id) => <option key={id}>{id}</option>)}
          </select>
          <label className="lbl" htmlFor="st-version">Version</label>
          <select id="st-version" className="inp" value={version} data-testid="st-version" onChange={(e) => setVer(Number(e.target.value))}>
            {(versions.data ?? []).map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="lbl" htmlFor="st-set">Scenario set</label>
          <select id="st-set" className="inp" value={setId} onChange={(e) => setSetId(e.target.value)}>
            {(sets.data ?? [{ set_id: "default-suite", name: "Default suite", version: 0, builtin: true, scenarios: 8 }]).map((x) =>
              <option key={x.set_id} value={x.set_id}>{x.name}{x.builtin ? "" : ` v${x.version}`}</option>)}
          </select>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {(chosenSet.data?.scenarios ?? []).map((x: any) => (
              <label key={x.id} className="flex items-center gap-1 text-[12.5px]">
                <input type="checkbox" checked={selected.includes(x.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...selected, x.id] : selected.filter((y) => y !== x.id))} />{x.name}</label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="lbl">Baselines</span>
          <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked disabled /> Incumbent (always)</label>
          {[["naive", "Naive base stock"], ["rolling_opt", "Rolling optimisation (LP, a subsample)"]].map(([k, l]) => (
            <label key={k} className="flex items-center gap-1 text-[12.5px]">
              <input type="checkbox" checked={baselines.includes(k)} data-testid={`baseline-${k}`}
                onChange={(e) => setBaselines(e.target.checked ? [...baselines, k] : baselines.filter((b) => b !== k))} />{l}</label>
          ))}
          <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 items-center text-[12.5px]">
            <label htmlFor="st-reps">Futures</label><input id="st-reps" data-testid="st-reps" className="inp w-24" type="number" min={10} max={2000} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
            <label htmlFor="st-periods">Weeks</label><input id="st-periods" className="inp w-24" type="number" min={26} max={156} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} />
            <label htmlFor="st-rolling">Rolling-optimisation futures</label><input id="st-rolling" data-testid="st-rolling" className="inp w-24" type="number" min={2} max={200} value={rolling} onChange={(e) => setRolling(Number(e.target.value))} />
          </div>
          <button className="btn btn-primary self-start" data-testid="run-stress" disabled={!pid || !version || !selected.length || run.isPending || !!running}
            onClick={() => run.mutate()}>{running ? "Running…" : "Run stress test"}</button>
        </div>
        {job.data && <div className="lg:col-span-3"><JobBar job={job.data} /></div>}
      </section>

      {(evals.data ?? []).length > 0 && (
        <section className="flex flex-wrap items-center gap-2 no-print">
          <span className="lbl">Evaluations of {pid} v{version}</span>
          {evals.data!.map((e) => (
            <button key={e.id} className="btn" aria-pressed={shown === e.id} onClick={() => setEid(e.id)}>
              #{e.id} · {e.replications} futures · {e.verdict.replace(/_/g, " ")}</button>
          ))}
        </section>
      )}
      {report.data && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 no-print">
            <button className="btn" onClick={async () => download(`report-${report.data.id}.md`, await api.reportMarkdown(shown!), "text/markdown")}>Export Markdown</button>
            <button className="btn" onClick={() => window.print()} title="Your browser's print dialog can save as PDF">Export PDF</button>
            <a className="btn no-underline" href={formatRoute("registry", { policy: pid, version })}>Open in the registry →</a>
            <span className="ml-auto"><VerdictBadge decision={report.data.verdict.decision} /></span>
          </div>
          <Report report={report.data} />
        </section>
      )}
    </div>
  );
}
