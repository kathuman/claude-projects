import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Shared } from "../App";
import { removeLane, removeNode, removeSku, renameNode, renameSku, round } from "../lib/edits";
import { blankRow, COLUMNS, copy, demandGrid, paste, parseTsv, setDemand, type CellError, type Column,
  type TableName } from "../lib/tables";
import type { Issue, Network } from "../lib/types";
import { useStore, type Selection } from "../store";

type Tab = TableName | "demand";
const TABS: { tab: Tab; label: string }[] = [
  { tab: "skus", label: "SKUs" }, { tab: "suppliers", label: "Suppliers" }, { tab: "plants", label: "Plants" },
  { tab: "dcs", label: "DCs" }, { tab: "markets", label: "Markets" }, { tab: "lanes", label: "Lanes" },
  { tab: "demand", label: "Demand grid" }, { tab: "demand_overrides", label: "Overrides" },
];

const fieldPath = (key: string) => (["lat", "lon", "x_km", "y_km"].includes(key) ? `location.${key}`
  : key === "expedite_mode" ? "expedite.mode" : key === "expedite_lead_time_days" ? "expedite.lead_time_days"
    : key === "expedite_cost_multiplier" ? "expedite.cost_multiplier" : key);

function Cell({ value, onCommit, onPaste, bad, title, testid, wide }: {
  value: string; onCommit: (text: string) => void; onPaste?: (text: string) => void; bad?: boolean; title?: string;
  testid?: string; wide?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
    if (e.key === "Escape") { setText(value); (e.target as HTMLInputElement).blur(); }
  };
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData("text/plain");
    if (onPaste && /[\t\n]/.test(t.replace(/\n$/, ""))) { e.preventDefault(); onPaste(t); }
  };
  return (
    <input className={`inp w-full border-transparent bg-transparent ${bad ? "bad" : ""}`} value={text} title={title}
      data-testid={testid} style={{ minWidth: wide ? 150 : 70 }}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={onKey} onPaste={handlePaste} />
  );
}

export default function Tables({ shared }: { shared: Shared }) {
  const s = useStore();
  const [tab, setTab] = useState<Tab>("skus");
  const [cellErrors, setCellErrors] = useState<CellError[]>([]);
  useEffect(() => setCellErrors([]), [tab]);

  const doPaste = (table: TableName, row: number, col: number, text: string) => {
    const r = paste(s.net, table, row, col, parseTsv(text));
    s.edit(() => r.net);
    setCellErrors(r.errors);
    s.notify(`Pasted ${r.rows} row${r.rows === 1 ? "" : "s"}${r.errors.length ? `, ${r.errors.length} cell${r.errors.length > 1 ? "s" : ""} not read` : ""}`);
  };

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => {
          const n = t.tab === "demand" ? 0 : shared.checks.issues.filter((i) => i.path.startsWith(`${t.tab}.`)).length;
          return (
            <button key={t.tab} role="tab" aria-selected={tab === t.tab} aria-pressed={tab === t.tab} className="btn"
              onClick={() => setTab(t.tab)}>{t.label}{t.tab !== "demand" && ` (${(s.net[t.tab] as unknown[]).length})`}
              {n > 0 && <span className="text-bad"> · {n}</span>}</button>
          );
        })}
      </div>
      {tab === "demand" ? <DemandGrid /> : (
        <Table key={tab} table={tab} issues={shared.checks.issues} cellErrors={cellErrors} setCellErrors={setCellErrors}
          onPaste={doPaste} />
      )}
    </div>
  );
}

function Table({ table, issues, cellErrors, setCellErrors, onPaste }: {
  table: TableName; issues: Issue[]; cellErrors: CellError[]; setCellErrors: (e: CellError[]) => void;
  onPaste: (table: TableName, row: number, col: number, text: string) => void;
}) {
  const s = useStore();
  const rows = s.net[table] as Record<string, any>[];
  const cols = COLUMNS[table];

  const selOf = (r: Record<string, any>): Selection | null => (table === "skus" ? { kind: "sku", id: r.id }
    : table === "lanes" ? { kind: "lane", id: r.id } : table === "demand_overrides" ? null : { kind: "node", id: r.id });

  const commit = (i: number, c: Column, text: string) => {
    const old = rows[i];
    if (c.key === "id" && old.id && table !== "lanes") {
      const next = text.trim();
      const r = table === "skus" ? renameSku(s.net, old.id, next) : renameNode(s.net, old.id, next);
      if (typeof r === "string") { setCellErrors([{ row: i, column: "id", message: r }]); return; }
      s.edit(() => r);
      setCellErrors(cellErrors.filter((e) => !(e.row === i && e.column === "id")));
      return;
    }
    try {
      const row = c.set(old, text);
      s.edit((n) => ({ ...n, [table]: (n[table] as unknown[]).map((x, j) => (j === i ? row : x)) }), `${table}.${i}.${c.key}`);
      setCellErrors(cellErrors.filter((e) => !(e.row === i && e.column === c.key)));
    } catch (e) {
      setCellErrors([...cellErrors.filter((x) => !(x.row === i && x.column === c.key)),
        { row: i, column: c.key, message: (e as Error).message }]);
    }
  };

  const remove = (i: number) => {
    const r = rows[i];
    s.edit((n): Network => {
      if (table === "skus" && r.id) return removeSku(n, r.id);
      if (table === "lanes" && r.id) return removeLane(n, r.id);
      if (table !== "demand_overrides" && table !== "skus" && table !== "lanes" && r.id) return removeNode(n, r.id);
      return { ...n, [table]: (n[table] as unknown[]).filter((_, j) => j !== i) };
    });
  };

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(copy(s.net, table)); s.notify("Copied with a header row: paste into Excel"); }
    catch { s.notify("The browser did not allow copying"); }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-faint">
        <button className="btn" data-testid="add-row"
          onClick={() => s.edit((n) => ({ ...n, [table]: [...(n[table] as unknown[]), blankRow(table)] }))}>Add row</button>
        <button className="btn" onClick={copyAll}>Copy table</button>
        <span>Paste a block from Excel into any cell. A first row with these column names is read as a header.
          Lead times are written like <code className="mono">gamma(21, 0.08)</code>; sourcing as <code className="mono">SUP_A=0.5 SUP_B=0.5</code>.</span>
      </div>
      <div className="overflow-auto scroll-thin border border-line rounded-lg bg-panel" data-testid={`table-${table}`}>
        <table className="border-collapse text-[13px]">
          <thead className="sticky top-0 bg-panel-2 z-[1]">
            <tr>
              <th className="grid-cell px-2 py-1 lbl text-left">#</th>
              {cols.map((c) => <th key={c.key} className="grid-cell px-2 py-1 lbl text-left whitespace-nowrap">{c.key}</th>)}
              <th className="grid-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 2} className="p-3 text-ink-faint">No rows yet. Click a cell after
                “Add row”, or paste a block from Excel into the first cell.</td></tr>
            )}
            {rows.map((r, i) => {
              const rowIssues = issues.filter((x) => x.path === `${table}.${i}`);
              const sel = selOf(r);
              const on = sel && s.selection && JSON.stringify(sel) === JSON.stringify(s.selection);
              return (
                <tr key={i} className={on ? "bg-panel-2" : ""}>
                  <td className="grid-cell px-2 mono text-ink-faint whitespace-nowrap">
                    <button className={`underline-offset-2 hover:underline ${rowIssues.length ? "text-bad" : ""}`}
                      title={rowIssues.map((x) => x.message).join("\n") || "Inspect"}
                      onClick={() => sel && s.select(sel)}>{i + 1}{rowIssues.length ? " !" : ""}</button>
                  </td>
                  {cols.map((c, j) => {
                    const fp = `${table}.${i}.${fieldPath(c.key)}`;
                    const own = cellErrors.filter((e) => e.row === i && e.column === c.key);
                    const sch = issues.filter((x) => x.path === fp || x.path.startsWith(`${fp}.`));
                    const msgs = [...own.map((e) => e.message), ...sch.map((x) => x.message)];
                    return (
                      <td key={c.key} className="grid-cell p-0">
                        <Cell value={c.get(r)} bad={msgs.length > 0} title={msgs.join("\n") || undefined}
                          testid={`cell-${table}-${i}-${c.key}`} wide={c.type === "dist" || c.key === "name" || c.type === "sourcing" || c.type === "list"}
                          onCommit={(t) => commit(i, c, t)} onPaste={(t) => onPaste(table, i, j, t)} />
                      </td>
                    );
                  })}
                  <td className="grid-cell px-1">
                    <button className="text-ink-faint hover:text-bad px-1" title="Delete row" onClick={() => remove(i)}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cellErrors.length > 0 && (
        <ul className="err list-none p-0 m-0" data-testid="cell-errors">
          {cellErrors.map((e, k) => <li key={k}>Row {e.row + 1}, {e.column}: {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function DemandGrid() {
  const s = useStore();
  const grid = demandGrid(s.net);
  const num = (t: string) => { const v = Number(t.trim().replace(",", ".")); return Number.isNaN(v) || t.trim() === "" ? null : v; };

  const pasteBlock = (r0: number, c0: number, text: string) => {
    const cells = parseTsv(text);
    s.edit((n) => {
      let out = n;
      cells.forEach((row, i) => row.forEach((t, j) => {
        const m = n.markets[r0 + i];
        const k = n.skus[c0 + j];
        const v = num(t);
        if (m && k && v !== null) out = setDemand(out, m.id, k.id, v);
      }));
      return out;
    });
  };

  if (!s.net.markets.length || !s.net.skus.length) {
    return <p className="text-ink-faint">The grid needs markets and SKUs: add them in their tables first.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-ink-faint m-0">Mean demand per period. Each cell is the SKU’s base demand × the market’s
        size factor, unless you type another value: that becomes an override (highlighted). Typing the base value back
        removes the override.</p>
      <div className="overflow-auto scroll-thin border border-line rounded-lg bg-panel" data-testid="demand-grid">
        <table className="border-collapse text-[13px]">
          <thead className="sticky top-0 bg-panel-2">
            <tr>
              <th className="grid-cell px-2 lbl text-left">Market</th>
              <th className="grid-cell px-2 lbl text-left">Size factor</th>
              {s.net.skus.map((k) => <th key={k.id} className="grid-cell px-2 lbl text-left">{k.id}</th>)}
            </tr>
            <tr>
              <th className="grid-cell px-2 lbl text-left" colSpan={2}>Base demand</th>
              {s.net.skus.map((k, j) => (
                <th key={k.id} className="grid-cell p-0">
                  <Cell value={String(k.base_demand)} testid={`base-${k.id}`} onCommit={(t) => {
                    const v = num(t);
                    if (v !== null) s.edit((n) => ({ ...n, skus: n.skus.map((x, i) => (i === j ? { ...x, base_demand: v } : x)) }));
                  }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.net.markets.map((m, i) => (
              <tr key={m.id}>
                <td className="grid-cell px-2 mono">{m.id}</td>
                <td className="grid-cell p-0">
                  <Cell value={String(m.size_factor)} testid={`size-${m.id}`} onCommit={(t) => {
                    const v = num(t);
                    if (v !== null) s.edit((n) => ({ ...n, markets: n.markets.map((x, k) => (k === i ? { ...x, size_factor: v } : x)) }));
                  }} />
                </td>
                {s.net.skus.map((k, j) => {
                  const c = grid[i][j];
                  return (
                    <td key={k.id} className="grid-cell p-0" style={c.overridden ? { background: "color-mix(in srgb, var(--pf-warn) 18%, transparent)" } : undefined}>
                      <Cell value={String(round(c.mean, 4))} testid={`demand-${m.id}-${k.id}`}
                        title={c.overridden ? `override (base × size = ${c.base})` : "base × size factor"}
                        onCommit={(t) => s.edit((n) => setDemand(n, m.id, k.id, num(t)))}
                        onPaste={(t) => pasteBlock(i, j, t)} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
