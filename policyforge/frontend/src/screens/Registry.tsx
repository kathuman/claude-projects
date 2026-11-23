import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type Summary } from "../api";
import { VerdictBadge } from "../components/Report";
import { formatRoute } from "../lib/route";
import { useRoute } from "../route";
import { useStore } from "../store";
import { ChangeTable } from "./Versions";

const STATUS_CLS: Record<string, string> = {
  draft: "text-ink-faint", tested: "text-accent", approved: "text-warn", deployed: "text-ok", retired: "text-ink-faint",
};

function scopeText(sc: any): string {
  const parts = [sc.nodes?.length && `nodes ${sc.nodes.join(", ")}`, sc.skus?.length && `SKUs ${sc.skus.join(", ")}`,
    sc.sku_classes?.length && `class ${sc.sku_classes.join("/")}`, sc.categories?.length && sc.categories.join("/"),
    sc.suppliers?.length && `suppliers ${sc.suppliers.join(", ")}`].filter(Boolean);
  return parts.length ? parts.join("; ") : "everything";
}

export default function Registry({ params }: { params: Record<string, string> }) {
  const s = useStore();
  const qc = useQueryClient();
  const [, go] = useRoute();
  const list = useQuery({ queryKey: ["summaries"], queryFn: api.summaries });
  const sel = list.data?.find((p) => p.policy_id === params.policy && p.version === Number(params.version))
    ?? list.data?.find((p) => p.policy_id === params.policy);
  const [tab, setTab] = useState<"policy" | "audit">("policy");

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1400px]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-head font-bold text-[22px] tracking-wider uppercase m-0">Registry</h1>
          <p className="text-ink-dim text-[13.5px] m-0 max-w-[800px]">Every policy version, from draft through tested, approved and
            deployed to retired. Approval needs a passing evaluation of that exact version against the active constitution
            and the current network; every change is in the hash-chained audit log.</p>
        </div>
        <div className="ml-auto flex gap-1" role="tablist">
          <button role="tab" className="btn" aria-pressed={tab === "policy"} onClick={() => setTab("policy")}>Policies</button>
          <button role="tab" className="btn" aria-pressed={tab === "audit"} onClick={() => setTab("audit")} data-testid="audit-tab">Audit log</button>
        </div>
      </div>
      {tab === "audit" ? <AuditLog /> : <>
        <div className="overflow-auto border border-line rounded-lg bg-panel">
          <table className="border-collapse text-[13px] w-full" data-testid="policy-list">
            <thead className="bg-panel-2"><tr>{["Policy", "Status", "Owner", "Agent", "Expires", "Scope", "Verdict", ""].map((h) =>
              <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {(list.data ?? []).length === 0 && <tr><td colSpan={8} className="p-3 text-ink-faint">No policies yet. Write one in Author.</td></tr>}
              {(list.data ?? []).map((p) => {
                const on = sel && sel.policy_id === p.policy_id && sel.version === p.version;
                return (
                  <tr key={`${p.policy_id}@${p.version}`} className={on ? "bg-panel-2" : ""} data-testid={`row-${p.policy_id}@${p.version}`}>
                    <td className="grid-cell px-2 py-1"><button className="text-left hover:underline" onClick={() => go("registry", { policy: p.policy_id, version: p.version })}>
                      <b>{p.name}</b><br /><span className="mono text-[11.5px] text-ink-faint">{p.policy_id} v{p.version}</span></button></td>
                    <td className={`grid-cell px-2 font-semibold ${STATUS_CLS[p.status] ?? ""}`}>{p.status}</td>
                    <td className="grid-cell px-2">{p.owner}</td>
                    <td className="grid-cell px-2 mono text-[12px]">{p.agent_id}</td>
                    <td className={`grid-cell px-2 whitespace-nowrap ${p.expired ? "text-bad" : ""}`} data-testid="expires">{new Date(p.expires_at).toLocaleDateString()}{p.expired ? " · expired" : ""}</td>
                    <td className="grid-cell px-2 text-[12px] text-ink-dim">{scopeText(p.scope)}</td>
                    <td className="grid-cell px-2 text-[12px]">{p.latest_verdict?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="grid-cell px-2 text-warn text-[12px]">{p.needs_retest ? "re-test needed" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sel && <Detail key={`${sel.policy_id}@${sel.version}`} p={sel} onChanged={() => qc.invalidateQueries()} notify={s.notify} />}
      </>}
    </div>
  );
}

function Detail({ p, onChanged, notify }: { p: Summary; onChanged: () => void; notify: (t: string) => void }) {
  const ref = `${p.policy_id}@${p.version}`;
  const blockers = useQuery({ queryKey: ["blockers", ref], queryFn: () => api.blockers(p.policy_id, p.version) });
  const evals = useQuery({ queryKey: ["evaluations", p.policy_id, p.version], queryFn: () => api.evaluations(p.policy_id, p.version) });
  const versions = useQuery({ queryKey: ["versions-p", p.policy_id], queryFn: () => api.policyVersions(p.policy_id) });
  const audit = useQuery({ queryKey: ["audit", ref], queryFn: () => api.audit(ref) });
  const mandate = useQuery({ queryKey: ["mandate", p.agent_id, p.status], queryFn: () => api.agentMandate(p.agent_id),
    enabled: p.status === "deployed", retry: false });
  const [note, setNote] = useState("");
  const [cmp, setCmp] = useState<number | null>(null);
  useEffect(() => { const vs = versions.data ?? []; if (vs.length > 1 && cmp === null) setCmp(vs[vs.length - 2].version === p.version ? vs[vs.length - 1].version : vs[vs.length - 2].version); }, [versions.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const diff = useQuery({ queryKey: ["pdiff", ref, cmp], queryFn: () => api.policyDiff(p.policy_id, Math.min(cmp!, p.version), Math.max(cmp!, p.version)),
    enabled: cmp !== null && cmp !== p.version });
  const act = useMutation({
    mutationFn: async (what: "approve" | "deploy" | "retire") => {
      if (what === "approve") await api.approve(p.policy_id, p.version, note);
      if (what === "deploy") await api.deploy(p.policy_id, p.version);
      if (what === "retire") await api.retire(p.policy_id, p.version, note);
      return what;
    },
    onSuccess: (what) => { notify(`${ref}: ${what === "approve" ? "approved" : what === "deploy" ? "deployed" : "retired"}`); setNote(""); onChanged(); },
    onError: (e) => notify((e as Error).message),
  });
  const blocked = (blockers.data ?? []).length > 0;

  return (
    <section className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="policy-detail">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-head font-bold uppercase tracking-wider text-[17px] m-0">{p.name}</h2>
          <span className={`font-semibold ${STATUS_CLS[p.status]}`} data-testid="detail-status">{p.status}</span>
          {p.latest_verdict && <VerdictBadge decision={p.latest_verdict} />}
        </div>
        <div className="text-[13px] text-ink-dim">Owner {p.owner} · approver {p.approver} · agent <span className="mono">{p.agent_id}</span> · mandate
          expires {new Date(p.expires_at).toLocaleString()} · network {p.network_ref}</div>
        {p.status === "tested" && (blocked
          ? <ul className="m-0 pl-4 text-warn text-[13px]" data-testid="blockers">{blockers.data!.map((b, i) => <li key={i}>{b}</li>)}</ul>
          : <p className="text-ok text-[13px] m-0">Nothing blocks approval: the latest evaluation of this version says approve.</p>)}
        <div className="flex flex-wrap items-center gap-2">
          <input className="inp flex-1 min-w-[200px]" placeholder="note (recorded in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <button className="btn btn-primary" data-testid="approve" disabled={p.status !== "tested" || blocked || act.isPending} onClick={() => act.mutate("approve")}>Approve</button>
          <button className="btn" data-testid="deploy" disabled={p.status !== "approved" || act.isPending} onClick={() => act.mutate("deploy")}>Deploy</button>
          <button className="btn" data-testid="retire" disabled={!["approved", "deployed"].includes(p.status) || act.isPending} onClick={() => act.mutate("retire")}>Retire</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn no-underline" href={formatRoute("stress", { policy: p.policy_id, version: p.version })}>Stress test</a>
          <a className="btn no-underline" href={formatRoute("author", { policy: p.policy_id, version: p.version })}>Edit in Author</a>
        </div>
        {mandate.data && (
          <div className="border border-ok rounded-lg p-2" data-testid="agent-mandate">
            <div className="lbl text-ok">What the agent reads: GET /agents/{p.agent_id}/mandate</div>
            <pre className="m-0 text-[11.5px] mono whitespace-pre-wrap max-h-[220px] overflow-auto">{JSON.stringify(mandate.data, null, 2)}</pre>
          </div>
        )}
        <div>
          <div className="lbl mb-1">Evaluations of this version</div>
          {(evals.data ?? []).length === 0 ? <p className="text-[13px] text-ink-faint m-0">None yet.</p> : (
            <ul className="m-0 pl-4 text-[13px]">{evals.data!.map((e) => (
              <li key={e.id}><a href={formatRoute("stress", { policy: p.policy_id, version: p.version })}>#{e.id}</a> · {e.verdict.replace(/_/g, " ")} ·
                {" "}{e.replications} futures · {e.constitution_ref} · {e.network_ref} · {new Date(e.created_at).toLocaleString()}</li>))}</ul>
          )}
        </div>
        {(versions.data ?? []).length > 1 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="lbl">Compare v{p.version} with</span>
              <select className="inp" value={cmp ?? ""} onChange={(e) => setCmp(Number(e.target.value))} aria-label="Compare with version">
                {versions.data!.filter((v) => v.version !== p.version).map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
              </select>
            </div>
            {diff.data && <ChangeTable changes={diff.data} testid="policy-diff" />}
          </div>
        )}
      </div>
      <div>
        <div className="lbl mb-1">Audit trail of {ref}</div>
        <AuditTable entries={audit.data ?? []} testid="policy-audit" />
      </div>
    </section>
  );
}

function AuditTable({ entries, testid }: { entries: { seq: number; ts: string; actor: string; action: string; object_ref: string; payload: any; hash: string }[]; testid: string }) {
  return (
    <div className="overflow-auto border border-line rounded-lg bg-panel max-h-[520px]">
      <table className="border-collapse text-[12.5px] w-full" data-testid={testid}>
        <thead className="bg-panel-2 sticky top-0"><tr>{["#", "When", "Who", "What", "Object", "Hash"].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
        <tbody>{entries.map((e) => (
          <tr key={e.seq}>
            <td className="grid-cell px-2 mono">{e.seq}</td>
            <td className="grid-cell px-2 whitespace-nowrap">{new Date(e.ts).toLocaleString()}</td>
            <td className="grid-cell px-2">{e.actor}</td>
            <td className="grid-cell px-2 mono">{e.action}</td>
            <td className="grid-cell px-2 mono text-[11.5px]">{e.object_ref}</td>
            <td className="grid-cell px-2 mono text-[11px] text-ink-faint" title={JSON.stringify(e.payload)}>{e.hash.slice(0, 10)}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

function AuditLog() {
  const log = useQuery({ queryKey: ["audit", "all"], queryFn: () => api.audit(undefined, 500) });
  const verify = useMutation({ mutationFn: api.verifyAudit });
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button className="btn" data-testid="verify-chain" onClick={() => verify.mutate()}>Verify the chain</button>
        {verify.data && (verify.data.ok
          ? <span className="text-ok text-[13px]" data-testid="chain-ok">Intact: {verify.data.entries} entries, head {verify.data.head?.slice(0, 16)}</span>
          : <span className="err">Broken at entry {verify.data.first_bad_seq}: {verify.data.reason}</span>)}
      </div>
      <AuditTable entries={log.data ?? []} testid="audit-log" />
    </section>
  );
}
