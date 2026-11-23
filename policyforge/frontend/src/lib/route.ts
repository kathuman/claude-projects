// Hash routes ("#/author?policy=x"), so the app works under /app on the API and as files on GitHub Pages.

export type Area = "network" | "constitution" | "author" | "stress" | "registry" | "monitor";

export const AREAS: { area: Area; label: string; hint: string }[] = [
  { area: "network", label: "Network", hint: "Build and check the supply network (the Network Studio)" },
  { area: "constitution", label: "Constitution", hint: "The organisation's hard limits, priorities and risk attitude" },
  { area: "author", label: "Author", hint: "Turn an intent into a policy" },
  { area: "stress", label: "Stress test", hint: "Test a policy against thousands of futures" },
  { area: "registry", label: "Registry", hint: "Versions, approvals, deployment and the audit log" },
  { area: "monitor", label: "Monitor", hint: "The live stream, drift monitors and the escalation inbox" },
];

export interface Route { area: Area; params: Record<string, string> }

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  const area = (AREAS.find((a) => a.area === path)?.area ?? "network") as Area;
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return { area, params };
}

export function formatRoute(area: Area, params: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return `#/${area}${qs ? `?${qs}` : ""}`;
}
