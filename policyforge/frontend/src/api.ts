// The PolicyForge API. Served by the API itself (at /app) it is the same origin; in development Vite proxies it;
// anywhere else (GitHub Pages) the Studio looks for a local API on port 8000. `?api=` overrides all of these.

import type { Network } from "./lib/types";

function detectBase(): string {
  try {
    const q = new URLSearchParams(window.location.search).get("api");
    if (q !== null) {
      localStorage.setItem("pf.api", q);
      return q.replace(/\/$/, "");
    }
    const saved = localStorage.getItem("pf.api");
    if (saved !== null) return saved;
  } catch { /* storage may be blocked */ }
  const { pathname, port } = window.location;
  if (pathname.startsWith("/app") || port === "5173" || port === "4173") return "";
  return "http://127.0.0.1:8000";
}

export const API_BASE = typeof window === "undefined" ? "" : detectBase();

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: any) {
    super(typeof body?.detail?.message === "string" ? body.detail.message
      : typeof body?.message === "string" ? body.message : `HTTP ${status}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Actor": "studio-user" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let b: any = null;
    try { b = await r.json(); } catch { /* not JSON */ }
    throw new ApiError(r.status, b);
  }
  if (raw) return (await r.blob()) as T;
  const type = r.headers.get("content-type") ?? "";
  return (type.includes("json") ? r.json() : r.text()) as Promise<T>;
}

export interface ServerError { path: string; message: string; type: string; level: "field" | "reference" }
export interface Finding { severity: "info" | "warning"; target: string | null; message: string; value: number | null }
export interface Health { findings: Finding[]; plant_load: Record<string, number>; supplier_load: Record<string, number> }
export interface Check { valid: boolean; errors: ServerError[]; health: Health | null }
export interface QuickTest {
  replications: number; periods: number; fill_rate: number; fill_by_market: Record<string, number>;
  fill_by_dc: Record<string, number>; plant_utilisation: Record<string, number>;
  supplier_utilisation: Record<string, number>; cost_per_week: number; seconds: number;
}
export interface TableError { table: string | null; row: number | null; column: string | null; message: string }
export interface VersionInfo { version: number; content_hash: string; actor: string; created_at: string }
export interface Change { path: string; op: "added" | "removed" | "changed"; before: any; after: any }
export interface PolicySummary {
  policy_id: string; version: number; name: string; status: string; network_ref: string;
  latest_verdict: string | null; needs_retest: boolean;
}
export interface Preview {
  periods: number; demand: Record<string, number[]>; supplier_capacity: Record<string, number[]>;
  supplier_lead_time: Record<string, number[]>; plant_capacity: Record<string, number[]>; shock_share: number[];
  signal_noise: number; extra_delay: number;
}

export const api = {
  health: () => call<{ ok: boolean; version: string }>("GET", "/health"),
  check: (network: Network) => call<Check>("POST", "/networks/check", { network }),
  quickTest: (network: Network, replications = 100, periods = 52) =>
    call<QuickTest>("POST", "/networks/quick-test", { network, replications, periods }),
  toYaml: (network: Network) => call<string>("POST", "/networks/to-yaml", { network }),
  fromYaml: (text: string) => call<{ network: Network | null; errors: ServerError[]; draft: Network | null }>("POST", "/networks/from-yaml", { text }),
  csvZip: (network: Network) => call<Blob>("POST", "/networks/csv-zip", { network }, true),
  fromCsv: (tables: Record<string, string>) =>
    call<{ network: Network | null; errors: TableError[]; draft: Network | null }>("POST", "/networks/from-csv", { tables }),
  networks: () => call<{ network_id: string; version: number; name: string; content_hash: string }[]>("GET", "/networks"),
  network: (id: string, version?: number) => call<Network>("GET", `/networks/${id}${version ? `?version=${version}` : ""}`),
  saveNetwork: (network: Network, id?: string) =>
    call<{ id: string; version: number; created: boolean }>("POST", `/networks${id ? `?network_id=${encodeURIComponent(id)}` : ""}`, network),
  versions: (id: string) => call<VersionInfo[]>("GET", `/networks/${id}/versions`),
  diff: (id: string, a: number, b: number) => call<Change[]>("GET", `/networks/${id}/diff?from=${a}&to=${b}`),
  policies: () => call<PolicySummary[]>("GET", "/policies"),
  scenarioSets: () => call<{ set_id: string; version: number; name: string; builtin: boolean; scenarios: number }[]>("GET", "/scenario-sets"),
  scenarioSet: (id: string) => call<any>("GET", `/scenario-sets/${id}`),
  saveScenarioSet: (set: unknown) => call<{ id: string; version: number; created: boolean }>("POST", "/scenario-sets", set),
  preview: (scenario: unknown, network: Network, periods = 52) =>
    call<Preview>("POST", "/scenarios/preview", { scenario, network, periods }),
};
