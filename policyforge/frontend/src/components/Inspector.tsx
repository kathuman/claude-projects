// The inspector: a form generated from the network's JSON Schema, so it shows every field the model has, with its
// bounds and description, and can never fall out of step with the Python models. Reference fields become pickers.

import { useEffect, useState } from "react";
import type { Shared } from "../App";
import { NETWORK_SCHEMA } from "../checks";
import { curve, mean, quantile, sd } from "../lib/distribution";
import { findNode, removeLane, removeNode, removeSku, renameNode, renameSku, renormalise, round, suggestDistance } from "../lib/edits";
import { getAt, setAt } from "../lib/paths";
import { targetOf } from "../lib/targets";
import { bounds, fieldsAt, type Field } from "../lib/schema";
import type { AnyNode, Dist, Issue, Network } from "../lib/types";
import { NODE_GROUPS } from "../lib/types";
import { selectionPath, useStore } from "../store";
import { GROUP_LABEL } from "./Toolbar";

const S = NETWORK_SCHEMA;
const LISTS = ["skus", "suppliers", "plants", "dcs", "markets", "lanes", "demand_overrides"]; // edited in their own views

export default function Inspector({ shared }: { shared: Shared }) {
  const s = useStore();
  const sel = s.selection;
  const path = selectionPath(s.net, sel);

  if (!sel || path === null) {
    return (
      <div className="p-3 flex flex-col gap-3">
        <h2 className="font-head font-bold text-[15px] tracking-wider uppercase m-0">Network</h2>
        <p className="text-[12.5px] text-ink-faint m-0">Select a node or lane to edit it. Fields come straight from the
          model’s JSON Schema, with their bounds and units.</p>
        <Counts net={s.net} />
        <Form path="" shared={shared} skip={LISTS} />
      </div>
    );
  }

  const key = sel.kind === "network" ? "network" : `${sel.kind}:${sel.id}`;
  const issues = sel.kind === "network"
    ? shared.checks.issues.filter((i) => ["network", "override"].includes(targetOf(s.net, i.path).kind))
    : shared.byElement.get(key) ?? [];
  const health = shared.health.get(key) ?? [];
  const title = sel.kind === "lane" ? "Lane" : sel.kind === "sku" ? "SKU"
    : sel.kind === "node" ? GROUP_LABEL[findNode(s.net, sel.id)!.group] : "Network";
  const del = () => {
    if (sel.kind === "node") s.edit((n) => removeNode(n, sel.id));
    if (sel.kind === "lane") s.edit((n) => removeLane(n, sel.id));
    if (sel.kind === "sku") s.edit((n) => removeSku(n, sel.id));
    s.select(null);
  };
  return (
    <div className="p-3 flex flex-col gap-2" data-testid="inspector">
      <div className="flex items-center gap-2">
        <h2 className="font-head font-bold text-[15px] tracking-wider uppercase m-0">{title}</h2>
        <span className="mono text-[13px] text-accent">{"id" in sel ? sel.id : ""}</span>
        <button className="btn ml-auto" onClick={() => s.select(null)}>Close</button>
        {sel.kind !== "network" && <button className="btn" onClick={del} title="Delete (Del)">Delete</button>}
      </div>
      {issues.length > 0 && (
        <ul className="list-none m-0 p-2 rounded border border-bad" data-testid="inspector-issues">
          {issues.map((i, k) => <li key={k} className="err">{i.message}</li>)}
        </ul>
      )}
      {health.length > 0 && (
        <ul className="list-none m-0 p-2 rounded border border-warn text-[12px] text-warn">
          {health.map((m, k) => <li key={k}>{m}</li>)}
        </ul>
      )}
      {sel.kind === "lane" && <LaneTools path={path} />}
      <Form path={path} shared={shared} skip={path === "" ? LISTS : []} />
    </div>
  );
}

function Counts({ net }: { net: Network }) {
  const items: [string, number][] = [["SKUs", net.skus.length], ...NODE_GROUPS.map((g) => [`${GROUP_LABEL[g]}s`, (net[g] as AnyNode[]).length] as [string, number]),
    ["Lanes", net.lanes.length], ["Overrides", net.demand_overrides.length]];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {items.map(([k, v]) => (
        <div key={k} className="border border-line-soft rounded px-2 py-1">
          <div className="mono text-[15px] text-ink">{v}</div><div className="lbl">{k}</div></div>
      ))}
    </div>
  );
}

function LaneTools({ path }: { path: string }) {
  const s = useStore();
  const lane = getAt(s.net, path) as Network["lanes"][number];
  const sug = suggestDistance(s.net, lane.origin, lane.destination);
  if (sug === null || sug === lane.distance_km) return null;
  return (
    <div className="text-[12px] text-ink-faint flex items-center gap-2">
      From the map: {sug} km (great circle × 1.25).
      <button className="btn" data-testid="use-suggested" onClick={() => s.edit((n) => setAt(n, `${path}.distance_km`, sug))}>Use it</button>
    </div>
  );
}

function fieldIssues(issues: Issue[], p: string): Issue[] {
  return issues.filter((i) => i.path === p);
}

function Form({ path, shared, skip = [] }: { path: string; shared: Shared; skip?: string[] }) {
  const s = useStore();
  const fields = fieldsAt(S, s.net, path).filter((f) => !skip.includes(f.key));
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => <FieldRow key={f.key} f={f} path={path ? `${path}.${f.key}` : f.key} shared={shared} />)}
    </div>
  );
}

const REF: Record<string, (n: Network) => string[]> = {
  served_by: (n) => n.dcs.map((d) => d.id),
  supplier: (n) => n.suppliers.map((x) => x.id),
  origin: (n) => [...n.suppliers, ...n.plants, ...n.dcs].map((x) => x.id),
  destination: (n) => [...n.plants, ...n.dcs, ...n.markets].map((x) => x.id),
  market: (n) => n.markets.map((x) => x.id),
  sku: (n) => n.skus.map((x) => x.id),
};

function FieldRow({ f, path, shared }: { f: Field; path: string; shared: Shared }) {
  const s = useStore();
  const value = getAt(s.net, path) as any;
  const errs = fieldIssues(shared.checks.issues, path);
  const set = (v: unknown, merge = true) => s.edit((n) => setAt(n, path, v), merge ? `field:${path}` : null);
  const parts = path.split(".");
  const isTopId = f.key === "id" && parts.length === 3;

  let control: React.ReactNode;
  if (isTopId) {
    return <IdInput path={path} value={value} />;
  } else if (REF[f.key] && f.kind === "string") {
    const options = REF[f.key](s.net);
    control = (
      <select className={`inp w-full ${errs.length ? "bad" : ""}`} value={value ?? ""} aria-label={f.key}
        onChange={(e) => set(e.target.value, false)}>
        {!options.includes(value) && <option value={value}>{value || "—"}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.key === "skus" && parts[0] === "plants") {
    control = (
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {s.net.skus.map((k) => (
          <label key={k.id} className="flex items-center gap-1 mono text-[12.5px]">
            <input type="checkbox" checked={(value ?? []).includes(k.id)}
              onChange={(e) => set(e.target.checked ? [...(value ?? []), k.id] : (value ?? []).filter((x: string) => x !== k.id), false)} />
            {k.id}</label>
        ))}
        {(value ?? []).filter((x: string) => !s.net.skus.some((k) => k.id === x)).map((x: string) => (
          <span key={x} className="err mono">{x}?</span>))}
      </div>
    );
  } else if (f.kind === "enum") {
    control = (
      <select className={`inp w-full ${errs.length ? "bad" : ""}`} value={value ?? ""} aria-label={f.key}
        onChange={(e) => set(e.target.value === "" ? null : e.target.value, false)}>
        {(f.nullable || !f.schema.enum.includes(value)) && <option value="">{value && !f.schema.enum.includes(value) ? value : "—"}</option>}
        {f.schema.enum.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.kind === "number" || f.kind === "integer") {
    control = <NumberInput value={value} nullable={f.nullable} bad={errs.length > 0} label={f.key}
      onChange={(v) => set(v)} hint={bounds(f.schema)} />;
  } else if (f.kind === "string") {
    control = <input className={`inp w-full ${errs.length ? "bad" : ""}`} value={value ?? ""} aria-label={f.key}
      onChange={(e) => set(e.target.value)} />;
  } else if (f.kind === "boolean") {
    control = <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked, false)} />;
  } else if (f.kind === "union") {
    return <DistField label={f.label} path={path} shared={shared} />;
  } else if (f.kind === "object") {
    if (value == null) {
      return (
        <div className="flex items-center gap-2">
          <span className="lbl">{f.label}</span>
          <span className="text-ink-faint text-[12px]">none</span>
          {f.key === "expedite" && <button className="btn ml-auto" onClick={() => set({ mode: "express_road",
            lead_time_days: { kind: "gamma", mu: 3, cv: 0.1 }, cost_multiplier: 2 }, false)}>Add</button>}
        </div>
      );
    }
    return (
      <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0">
        <legend className="lbl px-1 flex items-center gap-2">{f.label}
          {f.nullable && <button className="text-ink-faint hover:text-bad" title="Remove" onClick={() => set(null, false)}>×</button>}</legend>
        <Form path={path} shared={shared} />
      </fieldset>
    );
  } else if (f.kind === "array" && f.key === "sourcing") {
    return <Sourcing path={path} shared={shared} />;
  } else if (f.kind === "array") {
    control = <input className={`inp w-full ${errs.length ? "bad" : ""}`} aria-label={f.key}
      value={(value ?? []).join(" ")} onChange={(e) => set(e.target.value.split(/[\s,]+/).filter(Boolean)
        .map((x) => (f.schema.items?.type === "number" ? Number(x) : x)))} />;
  } else {
    control = <span className="mono text-[12px] text-ink-faint">{JSON.stringify(value)}</span>;
  }
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-2 items-start" data-testid={`field-${path}`}>
      <label className="lbl pt-1 leading-tight" title={f.description}>{f.label}
        {f.description && <div className="normal-case tracking-normal font-body font-normal text-[11px] text-ink-faint">{f.description}</div>}
      </label>
      <div className="min-w-0">
        {control}
        {errs.map((e, k) => <div key={k} className="err" data-testid="field-error">{e.message}</div>)}
      </div>
    </div>
  );
}

export function NumberInput({ value, nullable, bad, onChange, hint, label, testid, placeholder }: {
  value: number | null; nullable: boolean; bad: boolean; onChange: (v: number | null) => void; hint: string; label: string;
  testid?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText((t) => (t.trim() !== "" && Number(t) === value ? t : value == null ? "" : String(value)));
  }, [value]);
  const [local, setLocal] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <input className={`inp w-28 ${bad || local ? "bad" : ""}`} value={text} inputMode="decimal" aria-label={label}
        placeholder={placeholder ?? (nullable ? "none" : "")} data-testid={testid}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim() === "") { if (nullable) { onChange(null); setLocal(null); } else setLocal("a number is required"); return; }
          const v = Number(t.replace(",", "."));
          if (Number.isNaN(v)) { setLocal("not a number"); return; }
          setLocal(null);
          onChange(v);
        }} />
      <span className="mono text-[11px] text-ink-faint">{local ?? hint}</span>
    </div>
  );
}

function IdInput({ path, value }: { path: string; value: string }) {
  const s = useStore();
  const [text, setText] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(value); setErr(null); }, [value]);
  const commit = () => {
    const next = text.trim();
    if (next === value) return;
    const group = path.split(".")[0];
    if (group === "lanes") {
      if (s.net.lanes.some((l) => l.id === next)) { setErr(`${next} is already used`); return; }
      s.edit((n) => setAt(n, path, next));
      s.select({ kind: "lane", id: next });
      return;
    }
    const r = group === "skus" ? renameSku(s.net, value, next) : renameNode(s.net, value, next);
    if (typeof r === "string") { setErr(r); return; }
    s.edit(() => r);
    s.select(group === "skus" ? { kind: "sku", id: next } : { kind: "node", id: next });
  };
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-2 items-start">
      <label className="lbl pt-1">Id<div className="normal-case tracking-normal font-body font-normal text-[11px] text-ink-faint">renaming updates every reference</div></label>
      <div>
        <input className={`inp w-full ${err ? "bad" : ""}`} value={text} aria-label="id" data-testid="id-input"
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setText(value); }} />
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

function Sourcing({ path, shared }: { path: string; shared: Shared }) {
  const s = useStore();
  const list = (getAt(s.net, path) ?? []) as { supplier: string; share: number }[];
  const total = list.reduce((a, x) => a + x.share, 0);
  const errs = shared.checks.issues.filter((i) => i.path === path);
  return (
    <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0">
      <legend className="lbl px-1">Sourcing</legend>
      {list.map((x, i) => {
        const p = `${path}.${i}`;
        const rowErr = shared.checks.issues.filter((e) => e.path.startsWith(`${p}.`));
        return (
          <div key={i} className="flex items-center gap-2 mb-1">
            <select className={`inp ${rowErr.length ? "bad" : ""}`} value={x.supplier} aria-label="supplier"
              title={rowErr.map((e) => e.message).join("\n")}
              onChange={(e) => s.edit((n) => setAt(n, `${p}.supplier`, e.target.value))}>
              {!s.net.suppliers.some((y) => y.id === x.supplier) && <option>{x.supplier}</option>}
              {s.net.suppliers.map((y) => <option key={y.id}>{y.id}</option>)}
            </select>
            <NumberInput value={x.share} nullable={false} bad={false} label="share" hint=""
              onChange={(v) => s.edit((n) => setAt(n, `${p}.share`, v ?? 0), `field:${p}.share`)} />
            <button className="text-ink-faint hover:text-bad" title="Remove"
              onClick={() => s.edit((n) => setAt(n, path, list.filter((_, j) => j !== i)))}>×</button>
          </div>
        );
      })}
      {rowErrs(shared, path).map((e, k) => <div key={k} className="err">{e}</div>)}
      <div className="flex items-center gap-2 mt-1">
        <span className={`mono text-[12px] ${Math.abs(total - 1) > 1e-6 ? "text-bad" : "text-ink-faint"}`}>sum {round(total, 4)}</span>
        <button className="btn" onClick={() => s.edit((n) => setAt(n, path, [...list, { supplier: s.net.suppliers[0]?.id ?? "", share: 0 }]))}>Add</button>
        <button className="btn" disabled={list.length === 0 || Math.abs(total - 1) < 1e-9}
          onClick={() => s.edit((n) => setAt(n, path, renormalise(list)))}>Make it sum to 1</button>
      </div>
      {errs.map((e, k) => <div key={k} className="err">{e.message}</div>)}
    </fieldset>
  );
}

function rowErrs(shared: Shared, path: string): string[] {
  return shared.checks.issues.filter((e) => e.path.startsWith(`${path}.`)).map((e) => `${e.path.split(".").slice(-2).join(".")}: ${e.message}`);
}

function convert(d: Dist, kind: Dist["kind"]): Dist {
  const m = round(mean(d), 4) || 1;
  const v = round(sd(d), 4);
  switch (kind) {
    case "deterministic": return { kind, value: m };
    case "normal": return { kind, mu: m, sigma: v || round(m * 0.1, 4) };
    case "gamma": return { kind, mu: m, cv: v ? round(v / m, 4) : 0.1 };
    case "triangular": return { kind, low: round(m * 0.8, 4), mode: m, high: round(m * 1.3, 4) };
    case "discrete": return { kind, values: [m], probs: [1] };
  }
}

function DistField({ label, path, shared }: { label: string; path: string; shared: Shared }) {
  const s = useStore();
  const d = getAt(s.net, path) as Dist;
  const kinds: Dist["kind"][] = ["deterministic", "normal", "gamma", "triangular", "discrete"];
  return (
    <fieldset className="border border-line-soft rounded-md px-2 pb-2 pt-0" data-testid={`dist-${path}`}>
      <legend className="lbl px-1">{label}</legend>
      <div className="flex items-center gap-2 mb-2">
        <select className="inp" value={d.kind} aria-label="distribution"
          onChange={(e) => s.edit((n) => setAt(n, path, convert(d, e.target.value as Dist["kind"])))}>
          {kinds.map((k) => <option key={k}>{k}</option>)}
        </select>
        <span className="text-[11px] text-ink-faint">switching keeps the mean (and spread where it can)</span>
      </div>
      <FormNoKind path={path} shared={shared} />
      <DistPreview d={d} />
    </fieldset>
  );
}

function FormNoKind({ path, shared }: { path: string; shared: Shared }) {
  const s = useStore();
  const fields = fieldsAt(S, s.net, path).filter((f) => f.key !== "kind");
  return <div className="flex flex-col gap-1.5">{fields.map((f) => <FieldRow key={f.key} f={f} path={`${path}.${f.key}`} shared={shared} />)}</div>;
}

export function DistPreview({ d }: { d: Dist }) {
  let pts: { x: number; y: number }[] = [];
  let ok = true;
  try { pts = curve(d, 80); ok = pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)); } catch { ok = false; }
  if (!ok || pts.length === 0) return null;
  const W = 300;
  const Hh = 64;
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y)) || 1;
  const sx = (x: number) => (x1 > x0 ? ((x - x0) / (x1 - x0)) * (W - 20) + 10 : W / 2);
  const sy = (y: number) => Hh - 14 - (y / y1) * (Hh - 22);
  const bars = d.kind === "discrete" || d.kind === "deterministic";
  const m = mean(d);
  const p95 = quantile(d, 0.95);
  return (
    <div className="mt-2" data-testid="dist-preview">
      <svg width={W} height={Hh} className="block">
        {bars ? pts.map((p, i) => <line key={i} x1={sx(p.x)} x2={sx(p.x)} y1={sy(0)} y2={sy(p.y)} stroke="var(--pf-accent)" strokeWidth={4} />)
          : <path d={`M${pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("L")}`} fill="none" stroke="var(--pf-accent)" strokeWidth={1.6} />}
        <line x1={sx(m)} x2={sx(m)} y1={6} y2={sy(0)} stroke="var(--pf-ink-dim)" strokeDasharray="3 2" />
        <line x1={10} x2={W - 10} y1={sy(0)} y2={sy(0)} stroke="var(--pf-line)" />
        <text x={10} y={Hh - 2} fontSize={10} className="mono" fill="var(--pf-ink-faint)">{round(x0, 1)}</text>
        <text x={W - 10} y={Hh - 2} fontSize={10} className="mono" fill="var(--pf-ink-faint)" textAnchor="end">{round(x1, 1)} d</text>
      </svg>
      <div className="mono text-[11.5px] text-ink-dim">mean {round(m, 2)} d · sd {round(sd(d), 2)} · 95% within {round(p95, 1)} d</div>
    </div>
  );
}
