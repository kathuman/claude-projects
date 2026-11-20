import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Shared } from "../App";
import { api, type Change } from "../api";
import { jsonDiff } from "../lib/diff";
import { useStore } from "../store";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "network";
const show = (v: unknown) => (v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function ChangeTable({ changes, testid }: { changes: Change[] | { path: string; op: string; before?: unknown; after?: unknown }[]; testid?: string }) {
  if (changes.length === 0) return <p className="text-ink-faint text-[13px] m-0" data-testid={testid}>No differences.</p>;
  return (
    <div className="overflow-auto scroll-thin border border-line rounded-lg bg-panel max-h-[340px]">
      <table className="border-collapse text-[12.5px] w-full" data-testid={testid}>
        <thead className="bg-panel-2 sticky top-0"><tr>
          {["Field", "Change", "Before", "After"].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={i}>
              <td className="grid-cell px-2 mono text-accent">{c.path}</td>
              <td className={`grid-cell px-2 ${c.op === "removed" ? "text-bad" : c.op === "added" ? "text-ok" : ""}`}>{c.op}</td>
              <td className="grid-cell px-2 mono max-w-[260px] truncate" title={show(c.before)}>{show(c.before)}</td>
              <td className="grid-cell px-2 mono max-w-[260px] truncate" title={show(c.after)}>{show(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Versions({ shared }: { shared: Shared }) {
  const s = useStore();
  const qc = useQueryClient();
  const [nid, setNid] = useState(s.saved?.id ?? slug(s.net.name));
  useEffect(() => { if (s.saved) setNid(s.saved.id); }, [s.saved]);
  const [pair, setPair] = useState<[number, number] | null>(null);

  const nets = useQuery({ queryKey: ["networks"], queryFn: api.networks, enabled: shared.online });
  const versions = useQuery({ queryKey: ["versions", nid], queryFn: () => api.versions(nid), enabled: shared.online && !!nid, retry: false });
  const policies = useQuery({ queryKey: ["policies"], queryFn: api.policies, enabled: shared.online });
  const diff = useQuery({ queryKey: ["diff", nid, pair], queryFn: () => api.diff(nid, pair![0], pair![1]),
    enabled: shared.online && !!pair && pair[0] !== pair[1] });

  const save = useMutation({
    mutationFn: () => api.saveNetwork(s.net, nid),
    onSuccess: (r) => {
      s.dispatch({ type: "saved", saved: { id: r.id, version: r.version, network: s.net } });
      s.notify(r.created ? `Saved ${r.id} version ${r.version}` : `No change: the same as ${r.id} version ${r.version}`);
      qc.invalidateQueries({ queryKey: ["versions"] });
      qc.invalidateQueries({ queryKey: ["networks"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e) => s.notify((e as Error).message),
  });

  const openVersion = async (id: string, v: number) => {
    const net = await api.network(id, v);
    s.dispatch({ type: "load", network: net, saved: { id, version: v, network: net } });
    s.notify(`Opened ${id} version ${v}`);
  };

  if (!shared.online) {
    return <div className="p-4 max-w-[680px]"><h2 className="font-head font-bold uppercase tracking-wider">Versions</h2>
      <p className="text-ink-dim">Versions live in the PolicyForge registry, so this view needs the API. Start it with
        <code className="mono"> uvicorn api.app:app</code> in <code className="mono">policyforge/backend</code>. Your draft is
        kept in this browser meanwhile.</p></div>;
  }

  const unsaved = s.saved ? jsonDiff(s.saved.network, s.net) : null;
  const blocked = shared.checks.issues.length > 0;
  const onThis = (policies.data ?? []).filter((p) => p.network_ref.startsWith(`${nid}@`));
  const vs = versions.data ?? [];

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[980px]">
      <section className="flex flex-col gap-2">
        <h2 className="font-head font-bold uppercase tracking-wider m-0">Save</h2>
        <p className="text-[13px] text-ink-dim m-0">Saving stores a new version in the registry only when the content
          changed. Reports record the network version they ran on; policies evaluated on an older version are flagged
          for re-test.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="lbl" htmlFor="nid">Network id</label>
          <input id="nid" className="inp w-56" value={nid} onChange={(e) => setNid(e.target.value)} data-testid="network-id" />
          <button className="btn btn-primary" data-testid="save-version" disabled={blocked || !nid || save.isPending}
            onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save version"}</button>
          {blocked && <span className="text-[12px] text-warn">fix the issues first: only consistent networks are saved</span>}
          {s.saved && <span className="mono text-[12px] text-ink-faint">draft based on {s.saved.id} v{s.saved.version}</span>}
        </div>
        {unsaved && (<>
          <div className="lbl">Unsaved changes since v{s.saved!.version} ({unsaved.length})</div>
          <ChangeTable changes={unsaved} testid="unsaved-changes" />
        </>)}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-head font-bold uppercase tracking-wider m-0">History of {nid}</h2>
        {versions.isError && <p className="text-ink-faint text-[13px] m-0">No saved versions yet.</p>}
        {vs.length > 0 && (
          <table className="border-collapse text-[13px]" data-testid="versions">
            <thead><tr>{["Version", "Saved", "By", "Hash", ""].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>{vs.map((v) => (
              <tr key={v.version}>
                <td className="grid-cell px-2 mono">v{v.version}</td>
                <td className="grid-cell px-2">{new Date(v.created_at).toLocaleString()}</td>
                <td className="grid-cell px-2">{v.actor}</td>
                <td className="grid-cell px-2 mono text-ink-faint">{v.content_hash.slice(0, 12)}</td>
                <td className="grid-cell px-2"><button className="btn" onClick={() => openVersion(nid, v.version)}>Open</button></td>
              </tr>))}</tbody>
          </table>
        )}
        {vs.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="lbl">Compare</span>
            {[0, 1].map((k) => (
              <select key={k} className="inp" aria-label={k ? "to version" : "from version"}
                value={pair ? pair[k] : vs[vs.length - 2 + k].version}
                onChange={(e) => {
                  const cur = pair ?? [vs[vs.length - 2].version, vs[vs.length - 1].version];
                  const next: [number, number] = [...cur] as [number, number];
                  next[k] = Number(e.target.value);
                  setPair(next);
                }}>
                {vs.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
              </select>
            ))}
            {!pair && <button className="btn" data-testid="compare-latest"
              onClick={() => setPair([vs[vs.length - 2].version, vs[vs.length - 1].version])}>Show changes</button>}
          </div>
        )}
        {pair && diff.data && <ChangeTable changes={diff.data} testid="version-diff" />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-head font-bold uppercase tracking-wider m-0">Policies on {nid}</h2>
        {onThis.length === 0 ? <p className="text-ink-faint text-[13px] m-0">No policies refer to this network.</p> : (
          <table className="border-collapse text-[13px]" data-testid="policies">
            <thead><tr>{["Policy", "Version", "Status", "Tested on", "Verdict", ""].map((h) => <th key={h} className="grid-cell lbl px-2 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>{onThis.map((p) => (
              <tr key={`${p.policy_id}@${p.version}`}>
                <td className="grid-cell px-2">{p.name}</td>
                <td className="grid-cell px-2 mono">v{p.version}</td>
                <td className="grid-cell px-2">{p.status}</td>
                <td className="grid-cell px-2 mono">{p.network_ref}</td>
                <td className="grid-cell px-2">{p.latest_verdict ?? "—"}</td>
                <td className="grid-cell px-2">{p.needs_retest && <span className="text-warn" data-testid="retest">re-test needed</span>}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

      {(nets.data ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-head font-bold uppercase tracking-wider m-0">All networks in the registry</h2>
          <div className="flex flex-wrap gap-2">
            {nets.data!.map((n) => (
              <button key={n.network_id} className="btn" aria-pressed={n.network_id === nid} onClick={() => { setNid(n.network_id); setPair(null); }}>
                {n.network_id} · v{n.version}</button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
