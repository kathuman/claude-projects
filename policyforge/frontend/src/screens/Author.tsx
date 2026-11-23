import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type CompileResult } from "../api";
import { useDebounced } from "../checks";
import SchemaForm, { type FormIssue } from "../components/SchemaForm";
import { setAt } from "../lib/paths";
import { formatRoute } from "../lib/route";
import { FieldChecker } from "../lib/schema";
import { useStore } from "../store";
import policySchema from "../../../backend/schemas/policy.schema.json";

const SCHEMA = policySchema as Record<string, any>;
const checker = new FieldChecker(SCHEMA);
const OPS: Record<string, string> = { lt: "<", le: "≤", gt: ">", ge: "≥" };

/** Validator paths look like rule.rules[1].secondary; form paths like rule.rules.1.secondary. */
const dotted = (p: string) => p.replace(/\[(\d+)\]/g, ".$1");

export default function Author({ params }: { params: Record<string, string> }) {
  const s = useStore();
  const qc = useQueryClient();
  const [intent, setIntent] = useState("");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<any>(null);
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [tab, setTab] = useState<"form" | "json">("form");
  const summaries = useQuery({ queryKey: ["summaries"], queryFn: api.summaries });

  const open = async (id: string, version?: number) => {
    const p = await api.policy(id, version);
    setDraft(p);
    setIntent(p.intent_text ?? "");
    setResult(null);
    setEditing({ id: p.id, version: p.version });
  };
  useEffect(() => { if (params.policy) void open(params.policy, params.version ? Number(params.version) : undefined); },
    [params.policy, params.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const compile = useMutation({
    mutationFn: (withAnswers: boolean) => api.compile(intent, withAnswers ? answers : undefined),
    onSuccess: (r) => {
      setResult(r);
      setDraft(r.policy);
      if (!r.clarifying_questions.length) setAnswers({});
      s.notify(r.clarifying_questions.length ? `Compiled, with ${r.clarifying_questions.length} question${r.clarifying_questions.length > 1 ? "s" : ""} for you`
        : "Compiled");
    },
    onError: (e) => s.notify((e as Error).message),
  });

  const fieldIssues = useMemo(() => (draft ? checker.check(draft) : []), [draft]);
  const deb = useDebounced(draft, 400);
  const server = useQuery({ queryKey: ["validate", deb], queryFn: () => api.validatePolicy(deb), enabled: !!deb,
    retry: false, placeholderData: (p) => p });
  const issues: FormIssue[] = [...fieldIssues, ...(server.data?.issues ?? []).filter((i) => i.code !== "schema")
    .map((i) => ({ path: dotted(i.path), message: i.message }))];
  const errors = fieldIssues.length + (server.data?.issues ?? []).filter((i) => i.severity === "error" && i.code !== "schema").length;

  const save = useMutation({
    mutationFn: () => (editing ? api.editPolicy(editing.id, draft) : api.createPolicy(draft)),
    onSuccess: (r) => {
      setEditing({ id: r.id, version: r.version });
      qc.invalidateQueries({ queryKey: ["summaries"] });
      s.notify(r.created ? `Saved ${r.id} version ${r.version}` : `No change: the same as version ${r.version}`);
    },
    onError: (e) => s.notify((e as Error).message),
  });

  const refs = (key: string): string[] | null => {
    const nodes = [...s.net.plants, ...s.net.dcs, ...s.net.markets].map((n) => n.id);
    if (["primary", "secondary", "supplier", "suppliers"].includes(key)) return s.net.suppliers.map((x) => x.id);
    if (key === "nodes" || key === "node" || key === "priority") return nodes;
    if (key === "skus" || key === "sku") return s.net.skus.map((x) => x.id);
    if (key === "lanes") return s.net.lanes.map((x) => x.id);
    return null;
  };

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1400px]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-head font-bold text-[22px] tracking-wider uppercase m-0">Author</h1>
          <p className="text-ink-dim text-[13.5px] m-0 max-w-[760px]">Say what you want in plain language. The compiler turns it
            into a typed, bounded rule with a mandate and the assumptions it rests on; it never writes code. Check the
            back-translation against what you meant, answer its questions, adjust, and save.</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-[12.5px]">
          <span className="lbl">Edit a saved policy</span>
          <select className="inp" value={editing?.id ?? ""} aria-label="Edit a saved policy"
            onChange={(e) => e.target.value ? open(e.target.value) : (setEditing(null), setDraft(null), setResult(null))}>
            <option value="">— new policy —</option>
            {[...new Set((summaries.data ?? []).map((p) => p.policy_id))].map((id) => <option key={id}>{id}</option>)}
          </select>
        </label>
      </div>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <label className="lbl" htmlFor="intent">Intent</label>
          <textarea id="intent" data-testid="intent" className="inp w-full font-body text-[14px]" rows={4} value={intent}
            placeholder="If Supplier B misses more than 10% of orders for three weeks running, shift ambient volume to Supplier C…"
            onChange={(e) => setIntent(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn btn-primary" data-testid="compile" disabled={!intent.trim() || compile.isPending}
              onClick={() => compile.mutate(false)}>{compile.isPending ? "Compiling…" : "Compile"}</button>
            {result && <span className="mono text-[11.5px] text-ink-faint self-center">{result.model} · {result.attempts.length} attempt{result.attempts.length > 1 ? "s" : ""}</span>}
          </div>
          {result && result.clarifying_questions.length > 0 && (
            <div className="border border-warn rounded-lg p-3 flex flex-col gap-2" data-testid="questions">
              <div className="lbl text-warn">Questions before this is right</div>
              {result.clarifying_questions.map((q, i) => (
                <label key={q} className="flex flex-col gap-1">
                  <span className="text-[13.5px]">{q}</span>
                  <input className="inp" data-testid={`answer-${i}`} value={answers[q] ?? ""} onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })} />
                </label>
              ))}
              <button className="btn self-start" data-testid="recompile"
                disabled={compile.isPending || result.clarifying_questions.some((q) => !answers[q]?.trim())}
                onClick={() => compile.mutate(true)}>Recompile with answers</button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="lbl">What the policy does (back-translation)</span>
          <div className="border border-line rounded-lg bg-panel p-3 text-[14px] min-h-[100px]" data-testid="back-translation">
            {result?.back_translation ?? <span className="text-ink-faint">Compile an intent to read back what the rule will do.</span>}</div>
          {result && <>
            <p className="text-[13px] text-ink-dim m-0">{result.interpretation_notes}</p>
            <div className="flex flex-wrap gap-2 text-[12px]">
              {Object.entries(result.confidence).map(([k, v]) => (
                <span key={k} className="border border-line-soft rounded px-2 py-0.5">{k} <span className="mono">{Math.round(v * 100)}%</span></span>
              ))}
            </div>
          </>}
        </div>
      </section>

      {draft && <>
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 border border-line rounded-lg bg-panel p-2 sticky top-0 z-10">
            <span className="font-head font-bold uppercase tracking-wider">{draft.name}</span>
            <span className="mono text-[12px] text-ink-faint">{editing ? `${editing.id} v${editing.version}` : "not saved yet"}</span>
            <span className={`mono text-[12px] ${errors ? "text-bad" : "text-ok"}`} data-testid="policy-status">
              {errors ? `${errors} error${errors > 1 ? "s" : ""}` : server.isFetching ? "checking…" : "valid"}</span>
            <div className="ml-auto flex gap-2">
              <button className="btn btn-primary" data-testid="save-policy" disabled={errors > 0 || save.isPending}
                onClick={() => save.mutate()}>{editing ? "Save as new version" : "Save to the registry"}</button>
              {editing && <a className="btn no-underline" data-testid="to-stress" href={formatRoute("stress", { policy: editing.id, version: editing.version })}>Stress test it →</a>}
            </div>
          </div>
          {(server.data?.issues ?? []).filter((i) => i.code !== "schema").length > 0 && (
            <ul className="m-0 pl-4 text-[13px]" data-testid="validator-issues">
              {server.data!.issues.filter((i) => i.code !== "schema").map((i, k) => (
                <li key={k} className={i.severity === "error" ? "err" : "text-warn"}><span className="mono">{dotted(i.path)}</span>: {i.message}</li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-head font-bold uppercase tracking-wider text-[15px] m-0 mb-1">Assumptions ({draft.assumptions.length})</h2>
          <p className="text-[12.5px] text-ink-faint m-0 mb-1">Each becomes a drift monitor once the policy is deployed.</p>
          <div className="overflow-auto border border-line rounded-lg bg-panel">
            <table className="border-collapse text-[13px] w-full" data-testid="assumptions">
              <thead className="bg-panel-2"><tr>{["Statement", "Variable", "Test", "Source", "Confidence", ""].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>
                {draft.assumptions.map((a: any, i: number) => (
                  <tr key={i}>
                    <td className="grid-cell p-1"><input className="inp w-full" value={a.statement} aria-label={`assumption ${i + 1} statement`}
                      onChange={(e) => setDraft((d: any) => setAt(d, `assumptions.${i}.statement`, e.target.value))} /></td>
                    <td className="grid-cell px-2 mono text-[12px] whitespace-nowrap">{a.variable.var}[{[a.variable.supplier, a.variable.node, a.variable.sku].filter(Boolean).join(", ")}]</td>
                    <td className="grid-cell px-2 whitespace-nowrap">
                      {a.threshold !== null && a.threshold !== undefined ? <>
                        <select className="inp" value={a.operator} aria-label={`assumption ${i + 1} operator`}
                          onChange={(e) => setDraft((d: any) => setAt(d, `assumptions.${i}.operator`, e.target.value))}>
                          {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input className="inp w-24 ml-1" value={a.threshold} aria-label={`assumption ${i + 1} threshold`}
                          onChange={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n)) setDraft((d: any) => setAt(d, `assumptions.${i}.threshold`, n)); }} />
                      </> : <span className="mono text-[12px]">~ {a.distribution?.kind}</span>}
                    </td>
                    <td className="grid-cell px-2 text-[12px]">{a.source === "user_stated" ? "you" : "inferred"}</td>
                    <td className="grid-cell px-2 mono">{Math.round(a.confidence * 100)}%</td>
                    <td className="grid-cell px-1"><button className="text-ink-faint hover:text-bad" title="Remove"
                      onClick={() => setDraft((d: any) => setAt(d, "assumptions", d.assumptions.filter((_: any, j: number) => j !== i)))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex gap-1" role="tablist">
            <button role="tab" className="btn" aria-pressed={tab === "form"} onClick={() => setTab("form")}>Form</button>
            <button role="tab" className="btn" aria-pressed={tab === "json"} onClick={() => setTab("json")}>JSON</button>
          </div>
          {tab === "form" ? (
            <div className="border border-line rounded-lg bg-panel p-3" data-testid="policy-form">
              <SchemaForm root={SCHEMA} doc={draft} path="" issues={issues} refs={refs}
                skip={["status", "version", "provenance", "assumptions", "intent_text"]} readOnly={editing ? ["id"] : []}
                onChange={(path, v) => setDraft((d: any) => setAt(d, path, v))} />
            </div>
          ) : <JsonBox value={draft} onChange={setDraft} />}
        </section>
      </>}
    </div>
  );
}

function JsonBox({ value, onChange }: { value: unknown; onChange: (v: any) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    try { if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value)) return; } catch { /* keep the user's text */ }
    setText(JSON.stringify(value, null, 2));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-1">
      <textarea className="inp w-full h-[520px] text-[12.5px]" spellCheck={false} value={text} data-testid="policy-json"
        aria-label="Policy as JSON"
        onChange={(e) => {
          setText(e.target.value);
          try { onChange(JSON.parse(e.target.value)); setErr(null); } catch (x) { setErr((x as Error).message); }
        }} />
      {err && <div className="err">Not valid JSON yet: {err}</div>}
    </div>
  );
}

