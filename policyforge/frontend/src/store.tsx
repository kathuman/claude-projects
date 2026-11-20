// The Studio's state: the network with its undo history, what is selected, the editing mode, and the colouring.
// Every change to the network goes through `edit`, so every change can be undone.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { QuickTest } from "./api";
import * as H from "./lib/history";
import type { MeasureName } from "./lib/measure";
import type { Network, NodeGroup } from "./lib/types";
import foodnetJson from "../../backend/data/foodnet/network.json";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "lane"; id: string }
  | { kind: "sku"; id: string }
  | { kind: "network" };

export type Mode = "select" | "add" | "connect" | "delete";
export type View = "diagram" | "map" | "tables" | "scenarios" | "versions";

export interface Saved { id: string; version: number; network: Network }

interface State {
  hist: H.History<Network>;
  selection: Selection | null;
  mode: Mode;
  addGroup: NodeGroup;
  measure: MeasureName;
  view: View;
  quick: { result: QuickTest; network: Network } | null;
  saved: Saved | null; // the registry version this draft started from
  toast: string | null;
}

type Action =
  | { type: "edit"; fn: (n: Network) => Network; key?: string | null }
  | { type: "load"; network: Network; saved?: Saved | null }
  | { type: "undo" } | { type: "redo" }
  | { type: "select"; selection: Selection | null }
  | { type: "mode"; mode: Mode; addGroup?: NodeGroup }
  | { type: "measure"; measure: MeasureName }
  | { type: "view"; view: View }
  | { type: "quick"; result: QuickTest; network: Network }
  | { type: "saved"; saved: Saved | null }
  | { type: "toast"; text: string | null };

export const FOODNET = foodnetJson as unknown as Network;
const DRAFT_KEY = "pf.studio.draft.v1";

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "edit": {
      const next = a.fn(s.hist.present);
      return next === s.hist.present ? s : { ...s, hist: H.push(s.hist, next, a.key ?? null, Date.now()) };
    }
    case "load": return { ...s, hist: H.reset(s.hist, a.network), selection: null, quick: null,
      saved: a.saved === undefined ? s.saved : a.saved };
    case "undo": return { ...s, hist: H.undo(s.hist) };
    case "redo": return { ...s, hist: H.redo(s.hist) };
    case "select": return { ...s, selection: a.selection };
    case "mode": return { ...s, mode: a.mode, addGroup: a.addGroup ?? s.addGroup };
    case "measure": return { ...s, measure: a.measure };
    case "view": return { ...s, view: a.view };
    case "quick": return { ...s, quick: { result: a.result, network: a.network } };
    case "saved": return { ...s, saved: a.saved };
    case "toast": return { ...s, toast: a.text };
  }
}

function initial(): State {
  let network = FOODNET;
  let saved: Saved | null = null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d?.network?.skus) { network = d.network; saved = d.saved ?? null; }
    }
  } catch { /* no storage, or a broken draft: start from FoodNet */ }
  const view = (() => {
    try { return (new URLSearchParams(window.location.search).get("view") as View) || "diagram"; } catch { return "diagram"; }
  })();
  return { hist: H.start(network), selection: null, mode: "select", addGroup: "plants", measure: "none",
    view: ["diagram", "map", "tables", "scenarios", "versions"].includes(view) ? view : "diagram",
    quick: null, saved, toast: null };
}

interface Store extends State {
  net: Network;
  dispatch: React.Dispatch<Action>;
  edit: (fn: (n: Network) => Network, key?: string | null) => void;
  select: (s: Selection | null) => void;
  notify: (text: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const edit = useCallback((fn: (n: Network) => Network, key: string | null = null) => dispatch({ type: "edit", fn, key }), []);
  const select = useCallback((selection: Selection | null) => dispatch({ type: "select", selection }), []);
  const notify = useCallback((text: string) => dispatch({ type: "toast", text }), []);

  useEffect(() => { // keep the draft across reloads
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ network: state.hist.present, saved: state.saved })); } catch { /* ignore */ }
    }, 400);
    return () => clearTimeout(t);
  }, [state.hist.present, state.saved]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: "toast", text: null }), 4000);
    return () => clearTimeout(t);
  }, [state.toast]);

  const value = useMemo<Store>(() => ({ ...state, net: state.hist.present, dispatch, edit, select, notify }),
    [state, edit, select, notify]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** The dotted path of the selected element in the network, or null. */
export function selectionPath(net: Network, sel: Selection | null): string | null {
  if (!sel) return null;
  if (sel.kind === "network") return "";
  if (sel.kind === "lane") { const i = net.lanes.findIndex((l) => l.id === sel.id); return i < 0 ? null : `lanes.${i}`; }
  if (sel.kind === "sku") { const i = net.skus.findIndex((s) => s.id === sel.id); return i < 0 ? null : `skus.${i}`; }
  for (const g of ["suppliers", "plants", "dcs", "markets"] as const) {
    const i = (net[g] as { id: string }[]).findIndex((n) => n.id === sel.id);
    if (i >= 0) return `${g}.${i}`;
  }
  return null;
}
