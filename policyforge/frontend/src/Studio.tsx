import { useEffect, useMemo } from "react";
import type { Shared } from "./App";
import { useApiStatus, useChecks } from "./checks";
import FileMenu from "./components/FileMenu";
import Inspector from "./components/Inspector";
import SidePanel from "./components/SidePanel";
import Toolbar from "./components/Toolbar";
import { removeLane, removeNode, removeSku } from "./lib/edits";
import * as H from "./lib/history";
import { measure } from "./lib/measure";
import { healthKey, issuesByElement } from "./lib/targets";
import Diagram from "./screens/Diagram";
import MapView from "./screens/MapView";
import Scenarios from "./screens/Scenarios";
import Tables from "./screens/Tables";
import Versions from "./screens/Versions";
import { useStore, type View } from "./store";


const VIEWS: { view: View; label: string }[] = [
  { view: "diagram", label: "Diagram" }, { view: "map", label: "Map" }, { view: "tables", label: "Tables" },
  { view: "scenarios", label: "Scenarios" }, { view: "versions", label: "Versions" },
];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function Studio() {
  const s = useStore();
  const status = useApiStatus();
  const online = status.isSuccess;
  const checks = useChecks(s.net, online);

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

  const errors = checks.issues.length;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-1.5 border-b border-line bg-panel-2">
        <span className="font-head font-semibold text-[13px] tracking-wider uppercase text-ink-dim">Network Studio</span>
        <input aria-label="Network name" className="inp w-48" value={s.net.name}
          onChange={(e) => s.edit((n) => ({ ...n, name: e.target.value }), "name")} />
        <div className="flex gap-1.5">
          <button className="btn" disabled={!H.canUndo(s.hist)} onClick={() => s.dispatch({ type: "undo" })}
            title="Undo (Ctrl+Z)">Undo</button>
          <button className="btn" disabled={!H.canRedo(s.hist)} onClick={() => s.dispatch({ type: "redo" })}
            title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
        <FileMenu online={online} />
        <span data-testid="issue-count" className={`ml-auto mono text-[12px] ${errors ? "text-bad" : "text-ok"}`}
          title={checks.pending ? "the server is still checking" : ""}>
          {errors ? `${errors} problem${errors > 1 ? "s" : ""}` : checks.serverChecked ? "consistent ✓" : "fields valid"}
        </span>
      </div>
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
    </div>
  );
}
