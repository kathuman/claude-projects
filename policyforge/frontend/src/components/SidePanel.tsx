import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Shared } from "../App";
import { api, ApiError } from "../api";
import { heat } from "../lib/layout";
import { targetOf, type Target } from "../lib/targets";
import type { Network } from "../lib/types";
import { useStore, type Selection } from "../store";

type Tab = "issues" | "health" | "quick";

export function selectionFor(t: Target): Selection {
  if (t.kind === "node") return { kind: "node", id: t.id };
  if (t.kind === "lane") return { kind: "lane", id: t.id };
  if (t.kind === "sku") return { kind: "sku", id: t.id };
  return { kind: "network" };
}

export default function SidePanel({ shared }: { shared: Shared }) {
  const [tab, setTab] = useState<Tab>("issues");
  const n = shared.checks.issues.length;
  const h = shared.checks.health?.findings.length ?? 0;
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex gap-1 px-2 pt-2" role="tablist">
        <button role="tab" className="btn" aria-pressed={tab === "issues"} onClick={() => setTab("issues")}>
          Issues {n > 0 && <span className="text-bad">{n}</span>}</button>
        <button role="tab" className="btn" aria-pressed={tab === "health"} onClick={() => setTab("health")}>
          Health {h > 0 && <span className="text-warn">{h}</span>}</button>
        <button role="tab" className="btn" aria-pressed={tab === "quick"} onClick={() => setTab("quick")}>Quick test</button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin p-2">
        {tab === "issues" && <Issues shared={shared} />}
        {tab === "health" && <HealthView shared={shared} />}
        {tab === "quick" && <Quick shared={shared} />}
      </div>
    </div>
  );
}

function Issues({ shared }: { shared: Shared }) {
  const s = useStore();
  const { issues, serverChecked, pending } = shared.checks;
  if (issues.length === 0) {
    return (
      <p className="text-[13px] text-ok m-0" data-testid="no-issues">
        {serverChecked ? "No problems: every field is valid and the parts fit together." : shared.online
          ? "Fields are valid; the server is checking how the parts fit together…"
          : "Fields are valid. Start the API to check how the parts fit together."}</p>
    );
  }
  return (
    <ul className="list-none m-0 p-0 flex flex-col gap-1" data-testid="issues">
      {issues.map((i, k) => {
        const t = targetOf(s.net, i.path);
        const where = t.kind === "network" ? t.field : t.kind === "override" ? `override ${t.index + 1}`
          : `${t.id}${t.field ? `.${t.field}` : ""}`;
        return (
          <li key={k}>
            <button className="text-left w-full rounded px-2 py-1 hover:bg-panel-2 border border-transparent hover:border-line"
              onClick={() => s.select(selectionFor(t))}>
              <span className="mono text-[11.5px] text-accent">{where}</span>
              <span className="mono text-[10px] text-ink-faint ml-2 uppercase">{i.level}</span>
              <div className="err">{i.message}</div>
            </button>
          </li>
        );
      })}
      {pending && <li className="text-[11.5px] text-ink-faint px-2">The server is re-checking…</li>}
    </ul>
  );
}

function Bars({ title, data }: { title: string; data: Record<string, number> }) {
  return (
    <div className="mb-3">
      <div className="lbl mb-1">{title}</div>
      {Object.entries(data).map(([id, v]) => (
        <div key={id} className="grid grid-cols-[80px_1fr_44px] items-center gap-2 text-[12px]">
          <span className="mono truncate">{id}</span>
          <span className="h-2 rounded bg-panel-2 relative overflow-hidden">
            <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.min(100, v * 100)}%`,
              background: heat(Math.max(0, (v - 0.7) / 0.3)) }} /></span>
          <span className="mono text-right">{Math.round(v * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

function HealthView({ shared }: { shared: Shared }) {
  const s = useStore();
  const h = shared.checks.health;
  if (!h) {
    return <p className="text-[13px] text-ink-faint m-0">{shared.online
      ? "Health is computed once the network is consistent (see Issues)." : "Health needs the API."}</p>;
  }
  return (
    <div data-testid="health">
      <p className="text-[12px] text-ink-faint mt-0">Load at mean demand: what the plants must make and the suppliers
        must ship, against capacity.</p>
      <Bars title="Plants" data={h.plant_load} />
      <Bars title="Suppliers" data={h.supplier_load} />
      {h.findings.length > 0 && <div className="lbl mb-1">Findings</div>}
      <ul className="list-none m-0 p-0 flex flex-col gap-1">
        {h.findings.map((f, k) => (
          <li key={k}>
            <button className="text-left w-full rounded px-2 py-1 hover:bg-panel-2 text-[12.5px]"
              onClick={() => f.target && s.select(findSelection(s.net, f.target))}>
              <span className={f.severity === "warning" ? "text-warn" : "text-ink-dim"}>
                {f.severity === "warning" ? "⚠ " : "ℹ "}</span>{f.message}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function findSelection(net: Network, id: string): Selection {
  if (net.skus.some((x) => x.id === id)) return { kind: "sku", id };
  if (net.lanes.some((x) => x.id === id)) return { kind: "lane", id };
  return { kind: "node", id };
}

function Quick({ shared }: { shared: Shared }) {
  const s = useStore();
  const run = useMutation({
    mutationFn: (net: Network) => api.quickTest(net),
    onSuccess: (result, net) => {
      s.dispatch({ type: "quick", result, network: net });
      if (s.measure === "none") s.dispatch({ type: "measure", measure: "fill_rate" });
    },
  });
  const q = s.quick;
  const stale = q && q.network !== s.net;
  const blocked = shared.checks.issues.length > 0;
  const err = run.error instanceof ApiError ? run.error.message : run.error ? String(run.error) : null;
  return (
    <div className="flex flex-col gap-2" data-testid="quick">
      <p className="text-[12px] text-ink-faint m-0">A couple of seconds of simulation with the incumbent policy (100 futures,
        a year): does this network work at all? The full stress test is an evaluation.</p>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary" data-testid="run-quick" disabled={!shared.online || blocked || run.isPending}
          onClick={() => run.mutate(s.net)}>{run.isPending ? "Running…" : "Run quick test"}</button>
        {!shared.online && <span className="text-[12px] text-warn">needs the API</span>}
        {shared.online && blocked && <span className="text-[12px] text-warn">fix the issues first</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {q && (
        <div className={stale ? "opacity-60" : ""}>
          {stale && <div className="text-[12px] text-warn mb-1">The network changed since this run.</div>}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <Stat label="Fill rate" value={`${(q.result.fill_rate * 100).toFixed(1)}%`} testid="quick-fill" />
            <Stat label="Cost / week" value={`€${Math.round(q.result.cost_per_week).toLocaleString("en")}`} />
            <Stat label="Seconds" value={q.result.seconds.toFixed(1)} />
          </div>
          <Table title="Fill rate by DC" data={q.result.fill_by_dc} good />
          <Table title="Fill rate by market" data={q.result.fill_by_market} good />
          <Bars title="Plant utilisation" data={q.result.plant_utilisation} />
          <Bars title="Supplier utilisation" data={q.result.supplier_utilisation} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return <div className="border border-line-soft rounded px-2 py-1"><div className="mono text-[15px]" data-testid={testid}>{value}</div><div className="lbl">{label}</div></div>;
}

function Table({ title, data }: { title: string; data: Record<string, number>; good?: boolean }) {
  return (
    <div className="mb-2">
      <div className="lbl mb-1">{title}</div>
      <div className="grid grid-cols-3 gap-x-3 text-[12px]">
        {Object.entries(data).map(([id, v]) => (
          <div key={id} className="flex justify-between gap-1"><span className="mono">{id}</span>
            <span className="mono" style={{ color: heat(Math.max(0, Math.min(1, (0.99 - v) / 0.09))) }}>{(v * 100).toFixed(1)}%</span></div>
        ))}
      </div>
    </div>
  );
}
