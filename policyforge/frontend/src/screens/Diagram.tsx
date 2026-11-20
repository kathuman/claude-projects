import { useRef, useState, type PointerEvent as RPE } from "react";
import type { Shared } from "../App";
import { GROUP_LABEL } from "../components/Toolbar";
import { addNode, connect, laneRefusal, moveNode, removeLane, removeNode } from "../lib/edits";
import { COL_W, diagramSize, heat, lanePath, NODE_H, NODE_W, placeNodes, rowAt, TOP } from "../lib/layout";
import type { AnyNode, NodeGroup } from "../lib/types";
import { NODE_GROUPS } from "../lib/types";
import { useStore } from "../store";

type Drag =
  | { kind: "move"; id: string; group: NodeGroup; index: number; dy: number; y: number; moved: boolean }
  | { kind: "link"; from: string; x: number; y: number };

export default function Diagram({ shared }: { shared: Shared }) {
  const s = useStore();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const placed = placeNodes(s.net);
  const size = diagramSize(s.net);
  const sel = s.selection;

  const pt = (e: RPE) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const add = (group: NodeGroup) => {
    let id = "";
    s.edit((n) => { const [next, nid] = addNode(n, group); id = nid; return next; });
    if (id) s.select({ kind: "node", id });
  };

  const onNodeDown = (e: RPE, id: string) => {
    e.stopPropagation();
    const p = placed.get(id)!;
    if (s.mode === "delete") { s.edit((n) => removeNode(n, id)); s.select(null); return; }
    if (s.mode === "connect") { setDrag({ kind: "link", from: id, ...pt(e) }); return; }
    setDrag({ kind: "move", id, group: p.group, index: p.index, dy: pt(e).y - p.y, y: p.y, moved: false });
  };

  const onMove = (e: RPE) => {
    if (!drag) return;
    const q = pt(e);
    if (drag.kind === "link") setDrag({ ...drag, ...q });
    else {
      const y = q.y - drag.dy;
      setDrag({ ...drag, y, moved: drag.moved || Math.abs(y - placed.get(drag.id)!.y) > 4 });
    }
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === "link") {
      if (hover && hover !== drag.from) {
        const r = connect(s.net, drag.from, hover);
        if (typeof r === "string") s.notify(r);
        else { s.edit(() => r[0]); s.select({ kind: "lane", id: r[1] }); }
      }
    } else if (drag.moved) {
      const to = rowAt(drag.y + NODE_H / 2,(s.net[drag.group] as AnyNode[]).length);
      if (to !== drag.index) s.edit((n) => moveNode(n, drag.group, drag.index, to));
    } else s.select({ kind: "node", id: drag.id });
    setDrag(null);
  };

  const onBackground = (e: RPE) => {
    if (s.mode === "add") {
      const { x } = pt(e);
      const col = Math.max(0, Math.min(3, Math.floor((x - 20 + (COL_W - NODE_W) / 2) / COL_W)));
      add(NODE_GROUPS[col]);
    } else if (s.mode === "select") s.select(null);
  };

  const linkOk = drag?.kind === "link" && hover && hover !== drag.from ? !laneRefusal(s.net, drag.from, hover) : null;

  return (
    <div className="p-3">
      <svg ref={svg} width={size.width} height={size.height} data-testid="diagram" className="block select-none"
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setDrag(null)} onPointerDown={onBackground}
        style={{ cursor: s.mode === "add" ? "copy" : s.mode === "connect" ? "crosshair" : "default" }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--pf-ink-faint)" />
          </marker>
        </defs>
        {NODE_GROUPS.map((g, c) => (
          <g key={g}>
            <rect x={20 + c * COL_W - 8} y={4} width={NODE_W + 16} height={size.height - 8} rx={8}
              fill="var(--pf-panel-2)" opacity={0.5} />
            <text x={20 + c * COL_W} y={24} className="font-head" fontSize={13} fontWeight={700} letterSpacing=".08em"
              fill={`var(--g-${g})`}>{GROUP_LABEL[g].toUpperCase()}S · {(s.net[g] as AnyNode[]).length}</text>
            <g data-testid={`add-${g}`} onPointerDown={(e) => { e.stopPropagation(); add(g); }} style={{ cursor: "pointer" }}>
              <title>{`Add a ${GROUP_LABEL[g].toLowerCase()}`}</title>
              <rect x={20 + c * COL_W + NODE_W - 22} y={10} width={22} height={20} rx={4} fill="transparent" stroke="var(--pf-line)" />
              <text x={20 + c * COL_W + NODE_W - 11} y={25} textAnchor="middle" fontSize={15} fill="var(--pf-ink-dim)">+</text>
            </g>
          </g>
        ))}
        {s.net.lanes.map((l) => {
          const a = placed.get(l.origin);
          const b = placed.get(l.destination);
          if (!a || !b) return null;
          const key = `lane:${l.id}`;
          const v = shared.values.get(key);
          const bad = shared.byElement.has(key);
          const on = sel?.kind === "lane" && sel.id === l.id;
          return (
            <g key={l.id} data-testid={`lane-${l.id}`} style={{ cursor: "pointer" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (s.mode === "delete") { s.edit((n) => removeLane(n, l.id)); s.select(null); } else s.select({ kind: "lane", id: l.id });
              }}>
              <title>{`${l.id}: ${l.origin} → ${l.destination}${v ? ` · ${v.label}` : ""}${bad ? ` · ${shared.byElement.get(key)![0].message}` : ""}`}</title>
              <path d={lanePath(a, b)} stroke="transparent" strokeWidth={10} fill="none" />
              <path d={lanePath(a, b)} fill="none" markerEnd="url(#arrow)"
                stroke={on ? "var(--pf-accent)" : bad ? "var(--pf-bad)" : v ? heat(v.t) : "var(--pf-line)"}
                strokeWidth={on ? 2.5 : v ? 2 : 1.3} strokeDasharray={bad ? "5 3" : undefined} />
            </g>
          );
        })}
        {[...placed.values()].map((p) => {
          const node = (s.net[p.group] as AnyNode[])[p.index];
          const key = `node:${p.id}`;
          const v = shared.values.get(key);
          const errs = shared.byElement.get(key)?.length ?? 0;
          const warn = shared.health.get(key)?.length ?? 0;
          const on = sel?.kind === "node" && sel.id === p.id;
          const y = drag?.kind === "move" && drag.id === p.id && drag.moved ? drag.y : p.y;
          const target = drag?.kind === "link" && hover === p.id && hover !== drag.from;
          return (
            <g key={p.id} data-testid={`node-${p.id}`} transform={`translate(${p.x},${y})`}
              onPointerDown={(e) => onNodeDown(e, p.id)} onPointerEnter={() => setHover(p.id)}
              onPointerLeave={() => setHover((h) => (h === p.id ? null : h))}
              style={{ cursor: s.mode === "select" ? "grab" : "pointer" }}>
              <title>{[`${p.id} · ${node.name}`, v?.label, ...(shared.byElement.get(key) ?? []).map((i) => i.message),
                ...(shared.health.get(key) ?? [])].filter(Boolean).join("\n")}</title>
              <rect width={NODE_W} height={NODE_H} rx={7}
                fill={v ? heat(v.t) : "var(--pf-panel)"} fillOpacity={v ? 0.28 : 1}
                stroke={on ? "var(--pf-accent)" : target ? (linkOk ? "var(--pf-ok)" : "var(--pf-bad)") : `var(--g-${p.group})`}
                strokeWidth={on || target ? 2.5 : 1.3} />
              <text x={9} y={18} fontSize={12.5} className="mono" fontWeight={500} fill="var(--pf-ink)">{p.id}</text>
              <text x={9} y={35} fontSize={11.5} fill="var(--pf-ink-dim)">{node.name.length > 20 ? `${node.name.slice(0, 19)}…` : node.name}</text>
              {v && <text x={NODE_W - 8} y={35} textAnchor="end" fontSize={11} className="mono" fill="var(--pf-ink)">{v.label}</text>}
              {errs > 0 && (<g><circle cx={NODE_W - 4} cy={4} r={8} fill="var(--pf-bad)" />
                <text x={NODE_W - 4} y={8} textAnchor="middle" fontSize={10.5} fill="#fff" fontWeight={700}>{errs}</text></g>)}
              {errs === 0 && warn > 0 && <circle cx={NODE_W - 4} cy={4} r={5} fill="var(--pf-warn)" />}
            </g>
          );
        })}
        {drag?.kind === "link" && (() => {
          const a = placed.get(drag.from)!;
          return <line x1={a.x + NODE_W} y1={a.y + NODE_H / 2} x2={drag.x} y2={drag.y} stroke="var(--pf-accent)"
            strokeDasharray="4 3" pointerEvents="none" />;
        })()}
        {s.net.suppliers.length + s.net.plants.length + s.net.dcs.length + s.net.markets.length === 0 && (
          <text x={size.width / 2} y={TOP + 60} textAnchor="middle" fill="var(--pf-ink-faint)" fontSize={14}>
            An empty network: add nodes with + above each column, or paste tables in Tables.</text>
        )}
      </svg>
    </div>
  );
}
