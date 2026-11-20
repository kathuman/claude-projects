import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import type { Shared } from "../App";
import { api, ApiError, type Preview } from "../api";
import { useDebounced } from "../checks";
import { download } from "../components/FileMenu";
import { NumberInput } from "../components/Inspector";
import { getAt, setAt } from "../lib/paths";
import { defaultComponent, emptyScenario, KINDS, shift, span, summary, type Component, type ComponentKind,
  type Scenario, type ScenarioSet } from "../lib/scenario";
import { bounds, FieldChecker, fieldsAt, type Field } from "../lib/schema";
import type { Network } from "../lib/types";
import { useStore } from "../store";
import setSchemaJson from "../../../backend/schemas/scenario_set.schema.json";

const SET_SCHEMA = setSchemaJson as Record<string, any>;
const setChecker = new FieldChecker(SET_SCHEMA);
const HORIZON = 104;
const LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<ComponentKind, string>;
const COLOURS: Record<ComponentKind, string> = {
  supplier_outage: "var(--pf-bad)", lead_time_inflation: "var(--pf-warn)", plant_capacity_loss: "#fb923c",
  demand_shift: "var(--g-markets)", correlated_shock: "var(--g-suppliers)", signal_noise: "var(--pf-ink-faint)",
  baseline_demand: "var(--pf-line)",
};

export default function Scenarios({ shared }: { shared: Shared }) {
  const s = useStore();
  const qc = useQueryClient();
  const [set, setSet] = useState<ScenarioSet>({ id: "my-scenarios", name: "My scenarios", scenarios: [emptyScenario(1)] });
  const [si, setSi] = useState(0);
  const [ci, setCi] = useState<number | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const sets = useQuery({ queryKey: ["scenario-sets"], queryFn: api.scenarioSets, enabled: shared.online });

  const issues = useMemo(() => setChecker.check(set), [set]);
  const scen = set.scenarios[si] ?? set.scenarios[0];
  const edit = (path: string, value: unknown) => setSet((x) => setAt(x, path, value));
  const base = `scenarios.${si}`;

  const openSet = async (id: string) => {
    const loaded = await api.scenarioSet(id);
    setSet(loaded); setSi(0); setCi(null); setServerErrors([]);
    if (loaded.id === "default-suite") setSet({ ...loaded, id: "my-suite", name: `${loaded.name} (copy)` });
  };

  const save = useMutation({
    mutationFn: () => api.saveScenarioSet(set),
    onSuccess: (r) => {
      setServerErrors([]);
      s.notify(r.created ? `Saved scenario set ${r.id} version ${r.version}` : `No change: the same as ${r.id} version ${r.version}`);
      qc.invalidateQueries({ queryKey: ["scenario-sets"] });
    },
    onError: (e) => {
      const d = e instanceof ApiError ? e.body?.detail : null;
      setServerErrors(Array.isArray(d) ? d.map((x: any) => `${(x.loc ?? []).slice(1).join(".")}: ${x.msg}`) : [(e as Error).message]);
    },
  });

  const addComponent = (kind: ComponentKind) => {
    const comps = [...scen.components, defaultComponent(kind, s.net, 10)];
    edit(`${base}.components`, comps);
    setCi(comps.length - 1);
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-head font-bold uppercase tracking-wider m-0 mr-2">Scenario builder</h2>
        <label className="lbl" htmlFor="set-id">Set id</label>
        <input id="set-id" className="inp w-40" value={set.id} data-testid="set-id" onChange={(e) => edit("id", e.target.value)} />
        <label className="lbl" htmlFor="set-name">Name</label>
        <input id="set-name" className="inp w-52" value={set.name} onChange={(e) => edit("name", e.target.value)} />
        <button className="btn btn-primary" data-testid="save-set" disabled={!shared.online || issues.length > 0 || save.isPending}
          onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save set"}</button>
        <button className="btn" onClick={() => download(`${set.id}.json`, `${JSON.stringify(set, null, 2)}\n`, "application/json")}>Export JSON</button>
        {shared.online && (sets.data ?? []).length > 0 && (
          <select className="inp" aria-label="Open a saved set" value="" onChange={(e) => e.target.value && openSet(e.target.value)}>
            <option value="">Open a saved set…</option>
            {sets.data!.map((x) => <option key={x.set_id} value={x.set_id}>{x.name} ({x.scenarios}){x.builtin ? " · built in" : ` · v${x.version}`}</option>)}
          </select>
        )}
      </div>
      <p className="text-[12.5px] text-ink-faint m-0 max-w-[900px]">A scenario is a stack of components on a timeline of
        periods (weeks). Policies are evaluated against every scenario of a set: pass <code className="mono">scenario_set</code> to
        <code className="mono"> POST /policies/…/evaluate</code>. Drag a bar to move it in time.</p>
      {(issues.length > 0 || serverErrors.length > 0) && (
        <ul className="err m-0 pl-4" data-testid="scenario-issues">
          {issues.map((i, k) => <li key={k}><span className="mono">{i.path}</span>: {i.message}</li>)}
          {serverErrors.map((m, k) => <li key={`s${k}`}>{m}</li>)}
        </ul>
      )}
      <div className="flex gap-4 min-h-0">
        <div className="w-56 shrink-0 flex flex-col gap-1">
          <div className="lbl">Scenarios</div>
          {set.scenarios.map((x, i) => (
            <button key={i} className="btn text-left normal-case tracking-normal font-body" aria-pressed={i === si}
              onClick={() => { setSi(i); setCi(null); }}>{x.name || x.id}<span className="text-ink-faint"> · {x.components.length}</span></button>
          ))}
          <button className="btn" data-testid="add-scenario" onClick={() => {
            const n = set.scenarios.length + 1;
            edit("scenarios", [...set.scenarios, emptyScenario(n)]); setSi(set.scenarios.length); setCi(null);
          }}>Add scenario</button>
          {set.scenarios.length > 1 && <button className="btn" onClick={() => {
            edit("scenarios", set.scenarios.filter((_, i) => i !== si)); setSi(0); setCi(null);
          }}>Remove this one</button>}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-2 items-center max-w-[760px]">
            <label className="lbl" htmlFor="scen-id">Id</label>
            <input id="scen-id" className="inp" value={scen.id} data-testid="scenario-id" onChange={(e) => edit(`${base}.id`, e.target.value)} />
            <label className="lbl" htmlFor="scen-name">Name</label>
            <input id="scen-name" className="inp" value={scen.name} data-testid="scenario-name" onChange={(e) => edit(`${base}.name`, e.target.value)} />
            <label className="lbl" htmlFor="scen-desc">About</label>
            <input id="scen-desc" className="inp col-span-3" value={scen.description} onChange={(e) => edit(`${base}.description`, e.target.value)} />
          </div>
          <Timeline scenario={scen} selected={ci} onSelect={setCi}
            onShift={(j, by) => edit(`${base}.components.${j}`, shift(scen.components[j], by))} />
          <div className="flex flex-wrap items-center gap-2">
            <span className="lbl">Add</span>
            {KINDS.filter((k) => k.kind !== "baseline_demand").map((k) => (
              <button key={k.kind} className="btn" data-testid={`add-${k.kind}`} onClick={() => addComponent(k.kind)}>{k.label}</button>
            ))}
          </div>
          {ci !== null && scen.components[ci] && (
            <div className="border border-line rounded-lg bg-panel p-3 max-w-[760px]" data-testid="component-form">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-head font-bold uppercase tracking-wider">{LABEL[scen.components[ci].kind]}</span>
                <span className="text-[12.5px] text-ink-dim">{summary(scen.components[ci])}</span>
                <button className="btn ml-auto" onClick={() => {
                  edit(`${base}.components`, scen.components.filter((_, j) => j !== ci)); setCi(null);
                }}>Remove</button>
              </div>
              <ComponentForm doc={set} path={`${base}.components.${ci}`} net={s.net} issues={issues} onChange={edit} />
            </div>
          )}
          <PreviewPanel scenario={scen} net={s.net} online={shared.online} valid={issues.length === 0 && shared.checks.issues.length === 0} />
        </div>
      </div>
    </div>
  );
}

function Timeline({ scenario, selected, onSelect, onShift }: {
  scenario: Scenario; selected: number | null; onSelect: (i: number) => void; onShift: (i: number, by: number) => void;
}) {
  const W = 760;
  const ROW = 26;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ i: number; x0: number; by: number } | null>(null);
  const px = (W - 20) / HORIZON;
  const x = (t: number) => 10 + t * px;
  const H = Math.max(1, scenario.components.length) * ROW + 26;
  const up = () => {
    if (drag) { if (drag.by !== 0) onShift(drag.i, drag.by); else onSelect(drag.i); }
    setDrag(null);
  };
  return (
    <svg ref={ref} width={W} height={H} data-testid="timeline" className="bg-panel border border-line rounded-lg"
      onPointerMove={(e: RPE) => drag && setDrag({ ...drag, by: Math.round((e.clientX - drag.x0) / px) })}
      onPointerUp={up} onPointerLeave={() => setDrag(null)}>
      {Array.from({ length: HORIZON / 13 + 1 }, (_, k) => k * 13).map((t) => (
        <g key={t}><line x1={x(t)} x2={x(t)} y1={4} y2={H - 16} stroke="var(--pf-line-soft)" />
          <text x={x(t)} y={H - 4} fontSize={10} textAnchor="middle" className="mono" fill="var(--pf-ink-faint)">{t}</text></g>
      ))}
      {scenario.components.length === 0 && <text x={W / 2} y={22} textAnchor="middle" fontSize={12.5} fill="var(--pf-ink-faint)">
        No components: this scenario is the baseline (seasonal demand, normal lead times).</text>}
      {scenario.components.map((c, i) => {
        const moved = drag?.i === i ? shift(c, drag.by) : c;
        const sp = span(moved as Component, HORIZON);
        const y = 6 + i * ROW;
        return (
          <g key={i} data-testid={`bar-${i}`} style={{ cursor: "grab" }}
            onPointerDown={(e) => { e.stopPropagation(); setDrag({ i, x0: e.clientX, by: 0 }); }}>
            <title>{summary(moved as Component)}</title>
            {sp.fuzzy && <rect x={x(sp.fuzzy[0])} y={y + 2} width={Math.max(2, x(sp.fuzzy[1]) - x(sp.fuzzy[0]))} height={ROW - 10}
              fill={COLOURS[c.kind]} opacity={0.25} />}
            <rect x={x(sp.start)} y={y} width={Math.max(3, x(sp.end) - x(sp.start))} height={ROW - 6} rx={4}
              fill={COLOURS[c.kind]} fillOpacity={0.45} stroke={selected === i ? "var(--pf-accent)" : COLOURS[c.kind]}
              strokeWidth={selected === i ? 2 : 1} />
            <text x={x(sp.start) + 6} y={y + 14} fontSize={11.5} fill="var(--pf-ink)">{LABEL[c.kind]}</text>
          </g>
        );
      })}
    </svg>
  );
}

const REFS: Record<string, (n: Network) => string[]> = {
  supplier: (n) => n.suppliers.map((x) => x.id), plant: (n) => n.plants.map((x) => x.id),
  suppliers: (n) => n.suppliers.map((x) => x.id), markets: (n) => n.markets.map((x) => x.id),
  skus: (n) => n.skus.map((x) => x.id), categories: () => ["chilled", "ambient"],
};

function ComponentForm({ doc, path, net, issues, onChange }: {
  doc: unknown; path: string; net: Network; issues: { path: string; message: string }[];
  onChange: (path: string, v: unknown) => void;
}) {
  const fields = fieldsAt(SET_SCHEMA, doc, path).filter((f) => f.key !== "kind");
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => <Row key={f.key} f={f} path={`${path}.${f.key}`} doc={doc} net={net} issues={issues} onChange={onChange} />)}
    </div>
  );
}

function Row({ f, path, doc, net, issues, onChange }: {
  f: Field; path: string; doc: unknown; net: Network; issues: { path: string; message: string }[];
  onChange: (path: string, v: unknown) => void;
}) {
  const v = getAt(doc, path) as any;
  const errs = issues.filter((i) => i.path === path);
  let control: React.ReactNode;
  if (f.kind === "object") {
    return (
      <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0">
        <legend className="lbl px-1">{f.label}</legend>
        <ComponentForm doc={doc} path={path} net={net} issues={issues} onChange={onChange} />
      </fieldset>
    );
  }
  if (REFS[f.key] && f.kind === "array") {
    control = (
      <div className="flex flex-wrap gap-x-3">
        {REFS[f.key](net).map((id) => (
          <label key={id} className="flex items-center gap-1 mono text-[12.5px]">
            <input type="checkbox" checked={(v ?? []).includes(id)}
              onChange={(e) => onChange(path, e.target.checked ? [...(v ?? []), id] : (v ?? []).filter((x: string) => x !== id))} />{id}</label>
        ))}
        <span className="text-[11px] text-ink-faint">{(v ?? []).length ? "" : "none ticked = all"}</span>
      </div>
    );
  } else if (REFS[f.key]) {
    const opts = REFS[f.key](net);
    control = (
      <select className={`inp ${errs.length ? "bad" : ""}`} value={v ?? ""} aria-label={f.key} onChange={(e) => onChange(path, e.target.value)}>
        {!opts.includes(v) && <option value={v}>{v || "—"}</option>}
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  } else if (f.kind === "boolean") {
    control = <input type="checkbox" checked={!!v} onChange={(e) => onChange(path, e.target.checked)} />;
  } else if (f.kind === "enum") {
    control = <select className="inp" value={v} onChange={(e) => onChange(path, e.target.value)}>
      {f.schema.enum.map((o: string) => <option key={o}>{o}</option>)}</select>;
  } else {
    control = <NumberInput value={v ?? null} nullable={f.nullable} bad={errs.length > 0} label={f.key}
      testid={`comp-${f.key}`} hint={bounds(f.schema)} placeholder={f.nullable ? "to the end" : undefined}
      onChange={(n) => onChange(path, n)} />;
  }
  return (
    <div className="grid grid-cols-[150px_1fr] gap-x-2 items-start">
      <label className="lbl pt-1 leading-tight">{f.label}
        {f.description && <div className="normal-case tracking-normal font-body font-normal text-[11px] text-ink-faint">{f.description}</div>}</label>
      <div>{control}{errs.map((e, k) => <div key={k} className="err">{e.message}</div>)}</div>
    </div>
  );
}

function PreviewPanel({ scenario, net, online, valid }: { scenario: Scenario; net: Network; online: boolean; valid: boolean }) {
  const deb = useDebounced(scenario, 400);
  const q = useQuery({ queryKey: ["preview", deb, net], queryFn: () => api.preview(deb, net, HORIZON),
    enabled: online && valid, retry: false, placeholderData: (p) => p });
  if (!online) return <p className="text-[12.5px] text-ink-faint">The preview needs the API.</p>;
  if (!valid) return <p className="text-[12.5px] text-warn">Fix the issues above (and the network’s) to see the preview.</p>;
  if (q.error) return <p className="err">{(q.error as Error).message}</p>;
  if (!q.data) return <p className="text-[12.5px] text-ink-faint">Computing the preview…</p>;
  return <PreviewCharts p={q.data} />;
}

function PreviewCharts({ p }: { p: Preview }) {
  const groups: [string, Record<string, number[]>][] = [["Demand", p.demand], ["Supplier capacity", p.supplier_capacity],
    ["Supplier lead time", p.supplier_lead_time], ["Plant capacity", p.plant_capacity]];
  const series = groups.flatMap(([g, m]) => Object.entries(m).filter(([, xs]) => xs.some((x) => Math.abs(x - 1) > 1e-6))
    .map(([id, xs]) => ({ label: `${g}: ${id}`, xs, kind: "ratio" as const })));
  if (p.shock_share.some((x) => x > 0)) series.push({ label: "Futures with the shock on", xs: p.shock_share, kind: "ratio" });
  return (
    <div data-testid="preview">
      <div className="lbl mb-1">What this scenario changes (× normal, mean over 200 futures)</div>
      {series.length === 0 && p.signal_noise === 0 && p.extra_delay === 0 && (
        <p className="text-[12.5px] text-ink-faint m-0">Nothing beyond the baseline.</p>)}
      {(p.signal_noise > 0 || p.extra_delay > 0) && (
        <p className="text-[12.5px] text-ink-dim m-0 mb-1">Demand signal: noise {Math.round(p.signal_noise * 100)}%,
          {" "}{p.extra_delay} extra period{p.extra_delay === 1 ? "" : "s"} of information delay.</p>)}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
        {series.map((sr) => <Spark key={sr.label} label={sr.label} xs={sr.xs} />)}
      </div>
    </div>
  );
}

function Spark({ label, xs }: { label: string; xs: number[] }) {
  const W = 240;
  const H = 54;
  const hi = Math.max(1.05, ...xs);
  const lo = Math.min(0, ...xs);
  const sx = (i: number) => 4 + (i / Math.max(1, xs.length - 1)) * (W - 8);
  const sy = (v: number) => H - 6 - ((v - lo) / (hi - lo)) * (H - 16);
  const minV = Math.min(...xs);
  const maxV = Math.max(...xs);
  return (
    <div className="border border-line-soft rounded p-1.5" data-testid="spark">
      <div className="text-[11.5px] mono truncate" title={label}>{label}</div>
      <svg width={W} height={H}>
        <line x1={4} x2={W - 4} y1={sy(1)} y2={sy(1)} stroke="var(--pf-line)" strokeDasharray="3 2" />
        <path d={`M${xs.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join("L")}`} fill="none" stroke="var(--pf-accent)" strokeWidth={1.5} />
      </svg>
      <div className="mono text-[10.5px] text-ink-faint">range ×{minV.toFixed(2)} – ×{maxV.toFixed(2)}</div>
    </div>
  );
}
