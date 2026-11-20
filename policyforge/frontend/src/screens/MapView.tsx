import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type WheelEvent as RWE } from "react";
import type { Shared } from "../App";
import { GROUP_LABEL } from "../components/Toolbar";
import { addNode, connect, findNode, laneRefusal, removeLane, removeNode, round } from "../lib/edits";
import { heat } from "../lib/layout";
import { fit, greatCirclePoints, pan, project, unproject, zoomAt, type View } from "../lib/projection";
import type { AnyNode, NodeGroup } from "../lib/types";
import { NODE_GROUPS } from "../lib/types";
import { useStore } from "../store";

type Rings = [number, number][][];
let landCache: Promise<Rings> | null = null;
function loadLand(): Promise<Rings> {
  landCache ??= fetch("./land.json").then((r) => r.json()).then((d) => d.rings as Rings).catch(() => []);
  return landCache;
}

const SHAPE: Record<NodeGroup, (r: number) => string> = {
  suppliers: (r) => `M0,${-r} L${r},${r * 0.8} L${-r},${r * 0.8} Z`,
  plants: (r) => `M${-r},${-r} H${r} V${r} H${-r} Z`,
  dcs: (r) => `M0,${-r * 1.2} L${r * 1.2},0 L0,${r * 1.2} L${-r * 1.2},0 Z`,
  markets: (r) => `M${r},0 A${r},${r} 0 1,1 ${-r},0 A${r},${r} 0 1,1 ${r},0`,
};

type Drag =
  | { kind: "pan"; x: number; y: number; moved: boolean }
  | { kind: "move"; id: string; moved: boolean }
  | { kind: "link"; from: string; x: number; y: number };

export default function MapView({ shared }: { shared: Shared }) {
  const s = useStore();
  const box = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 600 });
  const [land, setLand] = useState<Rings>([]);
  const [view, setView] = useState<View | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null); // a node without coordinates, to place by clicking

  useEffect(() => { loadLand().then(setLand); }, []);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const located = useMemo(() => NODE_GROUPS.flatMap((g) => (s.net[g] as AnyNode[])
    .filter((n) => n.location.lat != null && n.location.lon != null)
    .map((n) => ({ id: n.id, group: g, lat: n.location.lat!, lon: n.location.lon!, name: n.name }))), [s.net]);
  const unplaced = NODE_GROUPS.flatMap((g) => (s.net[g] as AnyNode[])
    .filter((n) => n.location.lat == null || n.location.lon == null).map((n) => ({ id: n.id, group: g })));

  const v: View = view ?? fit(located, dims.w, dims.h);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const landPaths = useMemo(() => land.map((ring) => ring.map(([lon, lat], i) => {
    const [x, y] = project(v, lon, lat);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join("") + "Z"), [land, v]);

  const onWheel = (e: RWE) => {
    const p = at(e);
    setView(zoomAt(v, p.x, p.y, e.deltaY < 0 ? 1.2 : 1 / 1.2));
  };

  const onBgDown = (e: RPE) => {
    if (!view) setView(v); // keep the frame while the network changes under it
    const p = at(e);
    if (placing) {
      const ll = unproject(v, p.x, p.y);
      const id = placing;
      s.edit((n) => setLocation(n, id, ll.lat, ll.lon));
      setPlacing(null);
      return;
    }
    if (s.mode === "add") {
      const ll = unproject(v, p.x, p.y);
      let id = "";
      s.edit((n) => { const [next, nid] = addNode(n, s.addGroup, ll); id = nid; return next; });
      if (id) s.select({ kind: "node", id });
      return;
    }
    setDrag({ kind: "pan", ...p, moved: false });
  };

  const onNodeDown = (e: RPE, id: string) => {
    e.stopPropagation();
    if (!view) setView(v);
    if (s.mode === "delete") { s.edit((n) => removeNode(n, id)); s.select(null); return; }
    if (s.mode === "connect") { setDrag({ kind: "link", from: id, ...at(e) }); return; }
    setDrag({ kind: "move", id, moved: false });
  };

  const onMove = (e: RPE) => {
    if (!drag) return;
    const p = at(e);
    if (drag.kind === "pan") {
      setView(pan(v, p.x - drag.x, p.y - drag.y));
      setDrag({ ...drag, ...p, moved: true });
    } else if (drag.kind === "link") setDrag({ ...drag, ...p });
    else if (s.mode === "select") {
      const ll = unproject(v, p.x, p.y);
      s.edit((n) => setLocation(n, drag.id, ll.lat, ll.lon), `move:${drag.id}`);
      if (!drag.moved) setDrag({ ...drag, moved: true });
    }
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === "link" && hover && hover !== drag.from) {
      const r = connect(s.net, drag.from, hover);
      if (typeof r === "string") s.notify(r);
      else { s.edit(() => r[0]); s.select({ kind: "lane", id: r[1] }); }
    } else if (drag.kind === "move" && !drag.moved) s.select({ kind: "node", id: drag.id });
    else if (drag.kind === "pan" && !drag.moved && s.mode === "select") s.select(null);
    setDrag(null);
  };

  const pos = new Map(located.map((n) => [n.id, n]));
  const sel = s.selection;
  const linkOk = drag?.kind === "link" && hover && hover !== drag.from ? !laneRefusal(s.net, drag.from, hover) : null;

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-[12px] text-ink-faint border-b border-line-soft">
        <span>Scroll to zoom, drag to pan.</span>
        <button className="btn" onClick={() => setView(null)}>Fit</button>
        <button className="btn" onClick={() => setView(fit([], dims.w, dims.h))}>World</button>
        {unplaced.length > 0 && (
          <span className="flex flex-wrap items-center gap-1" data-testid="unplaced">
            <span className="text-warn">Not on the map:</span>
            {unplaced.map((u) => (
              <button key={u.id} className="btn" aria-pressed={placing === u.id}
                onClick={() => setPlacing(placing === u.id ? null : u.id)}
                title="Click, then click the map to place it">{u.id}</button>
            ))}
            {placing && <span className="text-accent">click the map to place {placing}</span>}
          </span>
        )}
        <span className="ml-auto flex gap-3">
          {NODE_GROUPS.map((g) => (
            <span key={g} className="flex items-center gap-1">
              <svg width={12} height={12} viewBox="-7 -7 14 14"><path d={SHAPE[g](5)} fill={`var(--g-${g})`} /></svg>
              {GROUP_LABEL[g]}</span>
          ))}
        </span>
      </div>
      <div ref={box} className="flex-1 min-h-0 relative overflow-hidden" style={{ background: "var(--pf-sea)" }}>
        <svg width={dims.w} height={dims.h} data-testid="map" onWheel={onWheel} onPointerDown={onBgDown}
          onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setDrag(null)}
          style={{ cursor: placing || s.mode === "add" ? "copy" : drag?.kind === "pan" ? "grabbing" : "grab" }}>
          <g>{landPaths.map((d, i) => <path key={i} d={d} fill="var(--pf-land)" stroke="var(--pf-line-soft)" strokeWidth={0.5} />)}</g>
          {s.net.lanes.map((l) => {
            const a = pos.get(l.origin);
            const b = pos.get(l.destination);
            if (!a || !b) return null;
            const key = `lane:${l.id}`;
            const val = shared.values.get(key);
            const bad = shared.byElement.has(key);
            const on = sel?.kind === "lane" && sel.id === l.id;
            const d = greatCirclePoints(a.lat, a.lon, b.lat, b.lon, 16)
              .map(([lon, lat], i) => { const [x, y] = project(v, lon, lat); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("");
            return (
              <g key={l.id} data-testid={`maplane-${l.id}`} style={{ cursor: "pointer" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (s.mode === "delete") { s.edit((n) => removeLane(n, l.id)); s.select(null); } else s.select({ kind: "lane", id: l.id });
                }}>
                <title>{`${l.id}: ${l.origin} → ${l.destination}, ${l.distance_km} km${val ? ` · ${val.label}` : ""}`}</title>
                <path d={d} stroke="transparent" strokeWidth={9} fill="none" />
                <path d={d} fill="none" stroke={on ? "var(--pf-accent)" : bad ? "var(--pf-bad)" : val ? heat(val.t) : "var(--pf-ink-faint)"}
                  strokeOpacity={on || val || bad ? 1 : 0.55} strokeWidth={on ? 2.5 : val ? 2 : 1.2} strokeDasharray={bad ? "5 3" : undefined} />
              </g>
            );
          })}
          {located.map((n) => {
            const [x, y] = project(v, n.lon, n.lat);
            const key = `node:${n.id}`;
            const val = shared.values.get(key);
            const errs = shared.byElement.get(key)?.length ?? 0;
            const on = sel?.kind === "node" && sel.id === n.id;
            const target = drag?.kind === "link" && hover === n.id && hover !== drag.from;
            return (
              <g key={n.id} data-testid={`mapnode-${n.id}`} transform={`translate(${x},${y})`}
                onPointerDown={(e) => onNodeDown(e, n.id)} onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))} style={{ cursor: "pointer" }}>
                <title>{[`${n.id} · ${n.name}`, val?.label, ...(shared.byElement.get(key) ?? []).map((i) => i.message)].filter(Boolean).join("\n")}</title>
                <path d={SHAPE[n.group](on || target ? 9 : 7)} fill={val ? heat(val.t) : `var(--g-${n.group})`}
                  stroke={on ? "var(--pf-accent)" : target ? (linkOk ? "var(--pf-ok)" : "var(--pf-bad)") : errs ? "var(--pf-bad)" : "var(--pf-bg)"}
                  strokeWidth={on || target || errs ? 2.5 : 1.2} />
                <text x={10} y={4} fontSize={11} className="mono" fill="var(--pf-ink)" stroke="var(--pf-sea)" strokeWidth={3}
                  paintOrder="stroke">{n.id}{val ? ` ${val.label}` : ""}</text>
              </g>
            );
          })}
          {drag?.kind === "link" && pos.get(drag.from) && (() => {
            const a = pos.get(drag.from)!;
            const [x, y] = project(v, a.lon, a.lat);
            return <line x1={x} y1={y} x2={drag.x} y2={drag.y} stroke="var(--pf-accent)" strokeDasharray="4 3" pointerEvents="none" />;
          })()}
        </svg>
      </div>
    </div>
  );
}

function setLocation<N extends { suppliers: AnyNode[] }>(net: N, id: string, lat: number, lon: number): N {
  const f = findNode(net as never, id);
  if (!f) return net;
  const list = ((net as any)[f.group] as AnyNode[]).map((n) => (n.id === id
    ? { ...n, location: { ...n.location, lat: round(lat, 2), lon: round(lon, 2) } } : n));
  return { ...net, [f.group]: list };
}
