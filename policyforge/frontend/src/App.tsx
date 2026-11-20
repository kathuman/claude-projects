import { useEffect, useMemo, useState } from "react";
import { useApiStatus, useChecks, type Checks } from "./checks";
import FileMenu from "./components/FileMenu";
import Inspector from "./components/Inspector";
import SidePanel from "./components/SidePanel";
import Toolbar from "./components/Toolbar";
import { removeLane, removeNode, removeSku } from "./lib/edits";
import * as H from "./lib/history";
import { measure, type Value } from "./lib/measure";
import { healthKey, issuesByElement } from "./lib/targets";
import type { Issue } from "./lib/types";
import Diagram from "./screens/Diagram";
import MapView from "./screens/MapView";
import Scenarios from "./screens/Scenarios";
import Tables from "./screens/Tables";
import Versions from "./screens/Versions";
import { useStore, type View } from "./store";

export const VERSION = "0.7.0";

export interface Shared {
  checks: Checks;
  online: boolean;
  byElement: Map<string, Issue[]>;
  health: Map<string, string[]>; // element key → health findings
  values: Map<string, Value>; // the colouring measure
}

const VIEWS: { view: View; label: string }[] = [
  { view: "diagram", label: "Diagram" }, { view: "map", label: "Map" }, { view: "tables", label: "Tables" },
  { view: "scenarios", label: "Scenarios" }, { view: "versions", label: "Versions" },
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function App() {
  const s = useStore();
  const status = useApiStatus();
  const online = status.isSuccess;
  const checks = useChecks(s.net, online);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");

  const shared = useMemo<Shared>(() => {
    const health = new Map<string, string[]>();
    for (const f of checks.health?.findings ?? []) {
      if (!f.target) continue;
      const k = healthKey(s.net, f.target);
      health.set(k, [...(health.get(k) ?? []), f.message]);
    }
    const quickNow = s.quick && s.quick.network === s.net ? s.quick.result : s.quick?.result;
    const values = measure(s.net, s.measure, {
      plantLoad: checks.health?.plant_load, supplierLoad: checks.health?.supplier_load,
      fillByMarket: quickNow?.fill_by_market, fillByDc: quickNow?.fill_by_dc,
    });
    return { checks, online, byElement: issuesByElement(s.net, checks.issues), health, values };
  }, [checks, online, s.net, s.measure, s.quick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !isTyping(e)) {
        e.preventDefault();
        s.dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y" && !isTyping(e)) {
        e.preventDefault();
        s.dispatch({ type: "redo" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && !isTyping(e) && s.selection) {
        const sel = s.selection;
        if (sel.kind === "node") s.edit((n) => removeNode(n, sel.id));
        if (sel.kind === "lane") s.edit((n) => removeLane(n, sel.id));
        if (sel.kind === "sku") s.edit((n) => removeSku(n, sel.id));
        s.select(null);
      } else if (e.key === "Escape" && !isTyping(e)) {
        s.dispatch({ type: "mode", mode: "select" });
        s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s]);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pf.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  const errors = checks.issues.length;
  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-line bg-panel">
        <div className="flex items-baseline gap-2">
          <a href="https://kathuman.github.io/claude-projects/policyforge/" className="font-head font-bold text-[20px] tracking-[.06em] uppercase text-ink no-underline">
            Policy<span className="text-accent">Forge</span></a>
          <span className="font-head font-semibold text-[15px] tracking-wider uppercase text-ink-dim">Network Studio</span>
          <span className="mono text-[10.5px] text-ink-faint border border-line rounded px-1.5">v{VERSION}</span>
        </div>
        <input aria-label="Network name" className="inp w-48" value={s.net.name}
          onChange={(e) => s.edit((n) => ({ ...n, name: e.target.value }), "name")} />
        <div className="flex gap-1.5">
          <button className="btn" disabled={!H.canUndo(s.hist)} onClick={() => s.dispatch({ type: "undo" })}
            title="Undo (Ctrl+Z)">Undo</button>
          <button className="btn" disabled={!H.canRedo(s.hist)} onClick={() => s.dispatch({ type: "redo" })}
            title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
        <FileMenu online={online} />
        <div className="ml-auto flex items-center gap-2">
          <span data-testid="issue-count" className={`mono text-[12px] ${errors ? "text-bad" : "text-ok"}`}
            title={checks.pending ? "the server is still checking" : ""}>
            {errors ? `${errors} problem${errors > 1 ? "s" : ""}` : checks.serverChecked ? "consistent ✓" : "fields valid"}
          </span>
          <span data-testid="api-status" className={`mono text-[11px] px-2 py-0.5 rounded border ${online
            ? "border-ok text-ok" : "border-warn text-warn"}`}
            title={online ? "Reference checks, health, quick test, versions and scenarios are available"
              : "Field checks work offline; start the API (uvicorn api.app:app in policyforge/backend) for the rest"}>
            {online ? `API ${status.data?.version}` : "API offline"}</span>
          <button className="btn" onClick={toggleTheme} title="Switch theme">{theme === "light" ? "Dark" : "Light"}</button>
          <a className="btn no-underline" href="https://kathuman.github.io/claude-projects/policyforge/#studio">About</a>
        </div>
      </header>
      <nav className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-b border-line bg-panel-2">
        <div role="tablist" className="flex gap-1">
          {VIEWS.map((v) => (
            <button key={v.view} role="tab" aria-selected={s.view === v.view} aria-pressed={s.view === v.view}
              className="btn" onClick={() => s.dispatch({ type: "view", view: v.view })}>{v.label}</button>
          ))}
        </div>
        {(s.view === "diagram" || s.view === "map") && <Toolbar shared={shared} />}
      </nav>
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <main className="flex-1 min-w-0 min-h-[60vh] lg:min-h-0 overflow-auto scroll-thin">
          {s.view === "diagram" && <Diagram shared={shared} />}
          {s.view === "map" && <MapView shared={shared} />}
          {s.view === "tables" && <Tables shared={shared} />}
          {s.view === "scenarios" && <Scenarios shared={shared} />}
          {s.view === "versions" && <Versions shared={shared} />}
        </main>
        <aside className="w-full lg:w-[370px] shrink-0 border-t lg:border-t-0 lg:border-l border-line bg-panel flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-auto scroll-thin"><Inspector shared={shared} /></div>
          <div className="h-[42%] min-h-[220px] border-t border-line flex flex-col"><SidePanel shared={shared} /></div>
        </aside>
      </div>
      {s.toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-accent text-ink px-4 py-2 rounded-lg shadow-lg max-w-[80vw]">
          {s.toast}</div>
      )}
    </div>
  );
}
