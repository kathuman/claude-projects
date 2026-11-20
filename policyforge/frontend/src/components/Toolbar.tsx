import type { Shared } from "../App";
import { heat } from "../lib/layout";
import { MEASURES, type MeasureName } from "../lib/measure";
import type { NodeGroup } from "../lib/types";
import { useStore, type Mode } from "../store";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "select", label: "Select", hint: "Click to inspect; drag to reorder (diagram) or move (map)" },
  { mode: "add", label: "Add", hint: "Click a column (diagram) or the map to add a node" },
  { mode: "connect", label: "Connect", hint: "Drag from one node to the next to draw a lane" },
  { mode: "delete", label: "Delete", hint: "Click a node or lane to delete it" },
];

export const GROUP_LABEL: Record<NodeGroup, string> = { suppliers: "Supplier", plants: "Plant", dcs: "DC", markets: "Market" };

export default function Toolbar({ shared }: { shared: Shared }) {
  const s = useStore();
  const m = MEASURES.find((x) => x.name === s.measure)!;
  const missing = m.needs === "health" && !shared.checks.health ? "needs the API and a consistent network"
    : m.needs === "quick" && !s.quick ? "run the quick test first" : "";
  return (
    <div className="flex flex-wrap items-center gap-2 ml-3">
      <div className="flex gap-1" role="group" aria-label="Editing mode">
        {MODES.map((x) => (
          <button key={x.mode} className="btn" aria-pressed={s.mode === x.mode} title={x.hint}
            onClick={() => s.dispatch({ type: "mode", mode: x.mode })}>{x.label}</button>
        ))}
      </div>
      {s.mode === "add" && (
        <select aria-label="Node type to add" className="inp" value={s.addGroup}
          onChange={(e) => s.dispatch({ type: "mode", mode: "add", addGroup: e.target.value as NodeGroup })}>
          {(Object.keys(GROUP_LABEL) as NodeGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 ml-2">
        <span className="lbl">Colour by</span>
        <select aria-label="Colour by" className="inp" value={s.measure}
          onChange={(e) => s.dispatch({ type: "measure", measure: e.target.value as MeasureName })}>
          {MEASURES.map((x) => <option key={x.name} value={x.name}>{x.label}</option>)}
        </select>
      </label>
      {s.measure !== "none" && (
        <span className="flex items-center gap-1 text-[11px] text-ink-faint mono">
          {missing || <>good <span className="inline-block w-16 h-2 rounded"
            style={{ background: `linear-gradient(90deg, ${heat(0)}, ${heat(0.5)}, ${heat(1)})` }} /> bad</>}
        </span>
      )}
    </div>
  );
}
