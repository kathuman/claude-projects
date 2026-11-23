import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import SchemaForm from "../components/SchemaForm";
import { jsonDiff } from "../lib/diff";
import { setAt } from "../lib/paths";
import { FieldChecker } from "../lib/schema";
import { useStore } from "../store";
import { ChangeTable } from "./Versions";
import constitutionSchema from "../../../backend/schemas/constitution.schema.json";

const SCHEMA = constitutionSchema as Record<string, any>;
const checker = new FieldChecker(SCHEMA);

export default function ConstitutionScreen() {
  const s = useStore();
  const qc = useQueryClient();
  const active = useQuery({ queryKey: ["constitution", "active"], queryFn: api.activeConstitution });
  const versions = useQuery({ queryKey: ["constitutions"], queryFn: api.constitutions });
  const [draft, setDraft] = useState<any>(null);
  const [activate, setActivate] = useState(true);
  useEffect(() => { if (active.data && !draft) setDraft(active.data); }, [active.data, draft]);

  const issues = useMemo(() => (draft ? checker.check(draft) : []), [draft]);
  const changes = useMemo(() => (draft && active.data
    ? jsonDiff(strip(active.data), strip(draft)) : []), [draft, active.data]);
  const save = useMutation({
    mutationFn: () => api.saveConstitution(draft, activate),
    onSuccess: (r) => {
      s.notify(r.created ? `Saved ${r.id} version ${r.version}${activate ? ", now active" : ""}` : `No change: the same as version ${r.version}`);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["constitution"] });
      qc.invalidateQueries({ queryKey: ["constitutions"] });
      qc.invalidateQueries({ queryKey: ["summaries"] });
    },
    onError: (e) => s.notify((e as Error).message),
  });
  const makeActive = useMutation({
    mutationFn: ({ id, v }: { id: string; v: number }) => api.activateConstitution(id, v),
    onSuccess: () => { qc.invalidateQueries(); setDraft(null); s.notify("Active constitution changed: policies tested on another one need a re-test"); },
  });

  if (!draft) return <p className="p-6 text-ink-faint">Loading the constitution…</p>;
  const refs = (key: string) => (key === "node" ? [...s.net.plants, ...s.net.dcs, ...s.net.markets].map((n) => n.id)
    : key === "sku" ? s.net.skus.map((k) => k.id) : null);

  return (
    <div className="p-4 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 max-w-[1300px]">
      <section className="flex flex-col gap-3">
        <div>
          <h1 className="font-head font-bold text-[22px] tracking-wider uppercase m-0">Constitution</h1>
          <p className="text-ink-dim text-[13.5px] m-0 max-w-[760px]">The organisation's rules every policy is tested against:
            hard limits that may be breached in at most α of the futures, the order of priorities when policies differ,
            the weights for a tie-break, and how bad an outcome counts as the acceptable worst case.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border border-line rounded-lg bg-panel p-2 sticky top-0 z-10">
          <span className="mono text-[12.5px]">{draft.id} · editing from v{active.data?.version}</span>
          <span className={`mono text-[12px] ${issues.length ? "text-bad" : "text-ok"}`}>
            {issues.length ? `${issues.length} problem${issues.length > 1 ? "s" : ""}` : "fields valid"}</span>
          <label className="flex items-center gap-1 text-[12.5px] ml-auto">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> make it active</label>
          <button className="btn" onClick={() => setDraft(active.data)} disabled={!changes.length}>Discard changes</button>
          <button className="btn btn-primary" data-testid="save-constitution" disabled={issues.length > 0 || save.isPending}
            onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save as new version"}</button>
        </div>
        <div className="border border-line rounded-lg bg-panel p-3" data-testid="constitution-form">
          <SchemaForm root={SCHEMA} doc={draft} path="" issues={issues} refs={refs} skip={["id", "version", "created_at"]}
            onChange={(path, v) => setDraft((d: any) => setAt(d, path, v))} />
        </div>
      </section>
      <aside className="flex flex-col gap-4">
        <section>
          <h2 className="font-head font-bold uppercase tracking-wider text-[15px] m-0 mb-1">Unsaved changes</h2>
          <ChangeTable changes={changes} testid="constitution-changes" />
        </section>
        <section>
          <h2 className="font-head font-bold uppercase tracking-wider text-[15px] m-0 mb-1">Versions</h2>
          <table className="border-collapse text-[13px] w-full" data-testid="constitution-versions">
            <tbody>
              {(versions.data ?? []).map((c) => (
                <tr key={`${c.id}@${c.version}`}>
                  <td className="grid-cell px-2 py-1 mono">v{c.version}</td>
                  <td className="grid-cell px-2">{c.active ? <span className="text-ok">active</span> : ""}</td>
                  <td className="grid-cell px-2 text-ink-dim">{c.actor}<br /><span className="text-[11px] text-ink-faint">{new Date(c.created_at).toLocaleString()}</span></td>
                  <td className="grid-cell px-2 whitespace-nowrap">
                    <button className="btn" onClick={async () => setDraft(await api.constitution(c.id, c.version))}>Load</button>
                    {!c.active && <button className="btn ml-1" onClick={() => makeActive.mutate({ id: c.id, v: c.version })}>Make active</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[12px] text-ink-faint">Changing the active constitution flags every policy tested against another one for re-test.</p>
        </section>
      </aside>
    </div>
  );
}

function strip(c: any): any {
  const { version: _v, created_at: _c, ...rest } = c;
  return rest;
}
