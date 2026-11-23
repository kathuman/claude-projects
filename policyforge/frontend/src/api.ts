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

/** Who is acting: recorded in the audit log with every change (the API's single-user mode, D044). */
export function getActor(): string {
  try { return localStorage.getItem("pf.actor") || "Planning manager"; } catch { return "Planning manager"; }
}
export function setActor(name: string): void {
  try { localStorage.setItem("pf.actor", name); } catch { /* ignore */ }
}

async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "X-Actor": getActor().replace(/[^\x20-\x7e]/g, "?"),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let b: any = null;
    try { b = await r.json(); } catch { /* not JSON */ }
    throw new ApiError(r.status, b);
  }
  if (raw) return (await r.blob()) as T;
  if (r.status === 204) return null as T; // FastAPI labels empty 204s as JSON
  const type = r.headers.get("content-type") ?? "";
  const text = await r.text();
  return (type.includes("json") ? (text ? JSON.parse(text) : null) : text) as T;
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

export interface Job {
  id: string; kind: string; title: string; status: "queued" | "running" | "done" | "failed"; progress: number;
  message: string; result: Record<string, any> | null; error: string | null;
}
export interface ConstitutionVersion { id: string; version: number; name: string; active: boolean; created_at: string; actor: string }
export interface Issue { severity: "error" | "warning"; path: string; message: string; code: string }
export interface CompileResult {
  policy: any; clarifying_questions: string[]; interpretation_notes: string;
  confidence: Record<string, number>; back_translation: string; warnings: Issue[]; attempts: any[]; model: string;
  prompt_hash: string;
}
export interface Summary {
  policy_id: string; version: number; name: string; status: string; owner: string; approver: string; agent_id: string;
  expires_at: string; expired: boolean; scope: any; network_ref: string; latest_verdict: string | null; needs_retest: boolean;
}
export interface EvaluationSummary {
  id: number; report_id: string; policy_id: string; policy_version: number; verdict: string; network_ref: string;
  constitution_ref: string; replications: number; created_at: string;
}
export interface AuditEntry { seq: number; ts: string; actor: string; action: string; object_type: string; object_ref: string; payload: any; hash: string }
export interface MonitorState {
  id: string; kind: string; subject: string; policy_id: string | null; status: string; description: string;
  value: number | null; threshold: number | null; statistic: number | null; limit: number | null; alarm_weeks: number[];
  series: (number | null)[];
}
export interface StreamView {
  id: number; network_ref: string; policies: string[]; scenario_id: string; seed: number; horizon: number; week: number;
  switches: any[] | null; monitors: MonitorState[]; service: (number | null)[]; cost: (number | null)[]; open_alerts: number;
}
export interface Alert {
  id: number; stream_id: number; monitor_id: string; kind: string; policy_id: string | null; policy_version: number | null;
  subject: string; week: number; message: string; evidence: Record<string, any>; update: Record<string, any> | null;
  severity: string; reversibility: number; exposure_eur_per_week: number; score: number; basis: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed"; note: string; retest_id: number | null;
}
export interface RetestView {
  id: number; alert_id: number; policy_id: string; policy_version: number; verdict: string;
  retest: { changes: { path: string; before: any; after: any; why: string }[]; notes: string[]; report: any };
}

const enc = encodeURIComponent;

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

  // P7: constitutions
  constitutions: () => call<ConstitutionVersion[]>("GET", "/constitutions"),
  constitution: (id: string, v: number) => call<any>("GET", `/constitutions/${enc(id)}/${v}`),
  activeConstitution: () => call<any>("GET", "/constitutions/active"),
  saveConstitution: (c: unknown, activate: boolean) =>
    call<{ id: string; version: number; created: boolean }>("POST", `/constitutions?activate=${activate}`, c),
  activateConstitution: (id: string, v: number) => call<null>("POST", `/constitutions/${enc(id)}/${v}/activate`),
  // authoring
  compile: (intent: string, answers?: Record<string, string>) => call<CompileResult>("POST", "/compile", { intent, answers }),
  validatePolicy: (p: unknown) => call<{ valid: boolean; issues: Issue[] }>("POST", "/policies/validate", p),
  createPolicy: (p: unknown) => call<{ id: string; version: number; created: boolean }>("POST", "/policies", p),
  editPolicy: (id: string, p: unknown) => call<{ id: string; version: number; created: boolean }>("PUT", `/policies/${enc(id)}`, p),
  // registry
  summaries: () => call<Summary[]>("GET", "/policies"),
  policy: (id: string, v?: number) => call<any>("GET", v ? `/policies/${enc(id)}/${v}` : `/policies/${enc(id)}`),
  policyVersions: (id: string) => call<VersionInfo[]>("GET", `/policies/${enc(id)}/versions`),
  policyDiff: (id: string, a: number, b: number) => call<Change[]>("GET", `/policies/${enc(id)}/diff?from=${a}&to=${b}`),
  evaluations: (id: string, v: number) => call<EvaluationSummary[]>("GET", `/policies/${enc(id)}/${v}/evaluations`),
  blockers: (id: string, v: number) => call<string[]>("GET", `/policies/${enc(id)}/${v}/approval-blockers`),
  approve: (id: string, v: number, note = "") => call<null>("POST", `/policies/${enc(id)}/${v}/approve`, { note }),
  deploy: (id: string, v: number) => call<{ agent_id: string }>("POST", `/policies/${enc(id)}/${v}/deploy`),
  retire: (id: string, v: number, note = "") => call<null>("POST", `/policies/${enc(id)}/${v}/retire`, { note }),
  audit: (objectRef?: string, limit = 200) =>
    call<AuditEntry[]>("GET", `/audit?limit=${limit}${objectRef ? `&object_ref=${enc(objectRef)}` : ""}`),
  verifyAudit: () => call<{ ok: boolean; entries: number; first_bad_seq: number | null; reason: string; head: string | null }>("GET", "/audit/verify"),
  agentMandate: (agent: string) => call<any>("GET", `/agents/${enc(agent)}/mandate`),
  // stress tests
  evaluate: (id: string, v: number, body: unknown) => call<Job>("POST", `/policies/${enc(id)}/${v}/evaluate?background=true`, body),
  job: (id: string) => call<Job>("GET", `/jobs/${id}`),
  report: (eid: number) => call<any>("GET", `/evaluations/${eid}`),
  reportMarkdown: (eid: number) => call<string>("GET", `/evaluations/${eid}/markdown`),
  // monitoring
  streams: () => call<{ id: number; week: number; horizon: number; policies: string[]; scenario_id: string; seed: number }[]>("GET", "/streams"),
  createStream: (body: unknown) => call<StreamView>("POST", "/streams", body),
  stream: (id: number, reveal = false) => call<StreamView>("GET", `/streams/${id}?reveal=${reveal}`),
  step: (id: number, weeks: number) => call<{ stream: StreamView; raised: Alert[] }>("POST", `/streams/${id}/step`, { weeks }),
  inject: (id: number, component: unknown, note = "") => call<StreamView>("POST", `/streams/${id}/inject`, { component, note }),
  alerts: (status?: string, streamId?: number) =>
    call<Alert[]>("GET", `/alerts?${status ? `status=${status}&` : ""}${streamId ? `stream_id=${streamId}` : ""}`),
  moveAlert: (id: number, to: "acknowledge" | "resolve" | "dismiss", note = "") => call<Alert>("POST", `/alerts/${id}/${to}`, { note }),
  retest: (id: number, body: unknown) => call<Job>("POST", `/alerts/${id}/retest?background=true`, body),
  getRetest: (id: number) => call<RetestView>("GET", `/retests/${id}`),
};
