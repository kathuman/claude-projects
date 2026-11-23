// The PolicyForge app: one shell, six areas. The Network area is the Network Studio (P5b); the rest are P7's screens.

import { useState } from "react";
import type { Checks } from "./checks";
import { getActor, setActor } from "./api";
import { useApiStatus } from "./checks";
import type { Value } from "./lib/measure";
import { AREAS, formatRoute } from "./lib/route";
import type { Issue } from "./lib/types";
import { useRoute } from "./route";
import Author from "./screens/Author";
import ConstitutionScreen from "./screens/Constitution";
import Monitor from "./screens/Monitor";
import Registry from "./screens/Registry";
import StressTest from "./screens/StressTest";
import Studio from "./Studio";
import { useStore } from "./store";

export const VERSION = "0.8.0";

/** What the Studio's screens share (checks, issues by element, health, the colouring measure). */
export interface Shared {
  checks: Checks;
  online: boolean;
  byElement: Map<string, Issue[]>;
  health: Map<string, string[]>; // element key → health findings
  values: Map<string, Value>; // the colouring measure
}

export function Offline({ what }: { what: string }) {
  return (
    <div className="p-6 max-w-[680px]" data-testid="offline">
      <p className="text-ink-dim">{what} works with the PolicyForge API. Start it with
        <code className="mono"> uvicorn api.app:app</code> in <code className="mono">policyforge/backend</code> and open
        <code className="mono"> http://127.0.0.1:8000/app/</code>.</p>
    </div>
  );
}

export default function App() {
  const s = useStore();
  const status = useApiStatus();
  const online = status.isSuccess;
  const [route] = useRoute();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");
  const [actor, setActorState] = useState(getActor);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("pf.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-line bg-panel">
        <div className="flex items-baseline gap-2">
          <a href="https://kathuman.github.io/claude-projects/policyforge/"
            className="font-head font-bold text-[20px] tracking-[.06em] uppercase text-ink no-underline">
            Policy<span className="text-accent">Forge</span></a>
          <span className="mono text-[10.5px] text-ink-faint border border-line rounded px-1.5">v{VERSION}</span>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Areas">
          {AREAS.map((a) => (
            <a key={a.area} href={formatRoute(a.area)} title={a.hint} data-testid={`area-${a.area}`}
              aria-current={route.area === a.area ? "page" : undefined}
              className={`btn no-underline ${route.area === a.area ? "text-accent border-accent" : ""}`}>{a.label}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[12px] text-ink-faint" title="Recorded in the audit log with every change">
            acting as <input className="inp w-36" value={actor} aria-label="Acting as" data-testid="actor"
              onChange={(e) => { setActorState(e.target.value); setActor(e.target.value); }} /></label>
          <span data-testid="api-status" className={`mono text-[11px] px-2 py-0.5 rounded border ${online
            ? "border-ok text-ok" : "border-warn text-warn"}`}
            title={online ? "Connected to the PolicyForge API"
              : "The Network Studio edits and checks fields offline; everything else needs the API"}>
            {online ? `API ${status.data?.version}` : "API offline"}</span>
          <button className="btn" onClick={toggleTheme} title="Switch theme">{theme === "light" ? "Dark" : "Light"}</button>
          <a className="btn no-underline" href="https://kathuman.github.io/claude-projects/policyforge/">About</a>
        </div>
      </header>
      {route.area === "network" && <Studio />}
      {route.area !== "network" && (
        <main className="flex-1 min-h-0 overflow-auto scroll-thin">
          {!online && !status.isPending ? <Offline what={AREAS.find((a) => a.area === route.area)!.label} /> : <>
            {route.area === "constitution" && <ConstitutionScreen />}
            {route.area === "author" && <Author params={route.params} />}
            {route.area === "stress" && <StressTest params={route.params} />}
            {route.area === "registry" && <Registry params={route.params} />}
            {route.area === "monitor" && <Monitor params={route.params} />}
          </>}
        </main>
      )}
      {s.toast && (
        <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 bg-panel border border-accent text-ink px-4 py-2 rounded-lg shadow-lg max-w-[80vw]">
          {s.toast}</div>
      )}
    </div>
  );
}
