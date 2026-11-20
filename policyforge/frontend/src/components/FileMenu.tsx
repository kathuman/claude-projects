// New, open and export. YAML and JSON are read and written in the browser (they work offline); CSV templates go
// through the API, which reports errors by table, row and column. A broken file still opens, so its errors can be
// fixed in place.

import { useRef, useState } from "react";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { api, type TableError } from "../api";
import { emptyNetwork } from "../lib/edits";
import type { Network } from "../lib/types";
import { FOODNET, useStore } from "../store";

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "network";

export default function FileMenu({ online }: { online: boolean }) {
  const s = useStore();
  const file = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const [problems, setProblems] = useState<{ title: string; items: string[] } | null>(null);
  const close = () => menu.current?.removeAttribute("open");

  const load = (net: Network, note: string) => {
    s.dispatch({ type: "load", network: net, saved: null });
    s.notify(note);
  };

  const open = async (files: FileList) => {
    const list = [...files];
    if (list.length === 0) return;
    const csv = list.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    try {
      if (csv.length) {
        if (!online) { s.notify("Reading CSV files needs the API"); return; }
        const tables = Object.fromEntries(await Promise.all(csv.map(async (f) => [f.name.replace(/\.csv$/i, ""), await f.text()])));
        const r = await api.fromCsv(tables);
        const net = r.network ?? r.draft;
        if (net) load(net, `Opened ${csv.length} CSV file${csv.length > 1 ? "s" : ""}`);
        if (r.errors.length) setProblems({ title: "Some cells could not be used", items: r.errors.map(fmtTableError) });
        return;
      }
      const f = list[0];
      const text = await f.text();
      const doc = f.name.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseYaml(text);
      if (!doc || typeof doc !== "object" || !Array.isArray(doc.skus)) {
        setProblems({ title: `${f.name} is not a network`, items: ["A network file has name, skus, suppliers, plants, dcs, markets and lanes."] });
        return;
      }
      load(fill(doc), `Opened ${f.name}`);
    } catch (e) {
      setProblems({ title: "The file could not be read", items: [(e as Error).message] });
    }
  };

  const exportCsv = async () => {
    try { download(`${slug(s.net.name)}-csv.zip`, await api.csvZip(s.net)); } catch (e) { s.notify((e as Error).message); }
  };

  return (
    <>
      <details ref={menu} className="relative">
        <summary className="btn list-none" data-testid="file-menu">File</summary>
        <div className="absolute z-10 mt-1 w-60 bg-panel border border-line rounded-lg shadow-lg p-1 flex flex-col">
          <MenuItem onClick={() => { load(emptyNetwork(), "A new, empty network"); close(); }}>New empty network</MenuItem>
          <MenuItem onClick={() => { load(FOODNET, "FoodNet, the reference network"); close(); }}>Load FoodNet</MenuItem>
          <MenuItem testid="open-file" onClick={() => { file.current?.click(); close(); }}>Open file… (YAML, JSON or CSVs)</MenuItem>
          <hr className="border-line-soft my-1" />
          <MenuItem testid="export-yaml" onClick={() => { download(`${slug(s.net.name)}.yaml`, toYaml(s.net), "application/yaml"); close(); }}>
            Export YAML</MenuItem>
          <MenuItem onClick={() => { download(`${slug(s.net.name)}.json`, `${JSON.stringify(s.net, null, 2)}\n`, "application/json"); close(); }}>
            Export JSON</MenuItem>
          <MenuItem disabled={!online} onClick={() => { exportCsv(); close(); }}>Export CSV templates (zip){online ? "" : " · API"}</MenuItem>
        </div>
      </details>
      <input ref={file} type="file" multiple accept=".yaml,.yml,.json,.csv" className="hidden" data-testid="file-input"
        onChange={(e) => { if (e.target.files) open(e.target.files); e.target.value = ""; }} />
      {problems && (
        <div className="fixed inset-0 z-20 bg-black/40 flex items-center justify-center" onClick={() => setProblems(null)}>
          <div className="bg-panel border border-line rounded-lg p-4 max-w-[560px] max-h-[70vh] overflow-auto" onClick={(e) => e.stopPropagation()}
            data-testid="import-problems">
            <h3 className="font-head font-bold uppercase tracking-wider m-0 mb-2">{problems.title}</h3>
            <ul className="err pl-4">{problems.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <p className="text-[12.5px] text-ink-faint">What could be read is open in the Studio; the remaining problems show on their elements.</p>
            <button className="btn" onClick={() => setProblems(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

function MenuItem({ children, onClick, disabled, testid }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; testid?: string }) {
  return <button className="text-left px-2 py-1.5 rounded hover:bg-panel-2 disabled:opacity-40" disabled={disabled}
    onClick={onClick} data-testid={testid}>{children}</button>;
}

function fmtTableError(e: TableError): string {
  return [e.table, e.row != null ? `row ${e.row}` : null, e.column].filter(Boolean).join(", ") + `: ${e.message}`;
}

/** Fill the lists a hand-written file may leave out, so the editor can work on it. */
function fill(doc: any): Network {
  const base = emptyNetwork(doc.name ?? "Imported network");
  return { ...base, ...doc, demand_overrides: doc.demand_overrides ?? [] };
}
