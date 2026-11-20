// Live checks: field errors at once in the browser (JSON Schema), then the server's reference checks and health
// findings for the same network, debounced. Each result is tied to the network it was computed for.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type Check } from "./api";
import { FieldChecker } from "./lib/schema";
import type { Issue, Network } from "./lib/types";
import networkSchema from "../../backend/schemas/network.schema.json";

export const NETWORK_SCHEMA = networkSchema as Record<string, any>;
const checker = new FieldChecker(NETWORK_SCHEMA);

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useApiStatus() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, retry: false, refetchInterval: 15000,
    refetchOnWindowFocus: true });
}

export interface Checks {
  issues: Issue[]; // field (browser or server) and reference errors
  health: Check["health"];
  serverChecked: boolean; // the server has checked the network as it is now
  pending: boolean;
}

export function useChecks(net: Network, online: boolean): Checks {
  const fieldIssues = useMemo(() => checker.check(net), [net]);
  const debounced = useDebounced(net, 350);
  const q = useQuery({
    queryKey: ["check", debounced], queryFn: () => api.check(debounced), enabled: online,
    staleTime: Infinity, gcTime: 60_000, retry: false, placeholderData: (prev) => prev,
  });
  return useMemo(() => {
    const issues: Issue[] = fieldIssues.map((f) => ({ ...f, level: "field", severity: "error" }));
    const seen = new Set(issues.map((i) => `${i.path}|${i.message}`));
    const current = q.data && debounced === net && !q.isPlaceholderData;
    if (q.data && (current || fieldIssues.length === 0)) {
      for (const e of q.data.errors) {
        const k = `${e.path}|${e.message}`;
        // a field error the browser already shows (same path) is not repeated
        if (seen.has(k) || (e.level === "field" && fieldIssues.some((f) => f.path === e.path))) continue;
        seen.add(k);
        issues.push({ path: e.path, message: e.message, level: e.level, severity: "error" });
      }
    }
    return { issues, health: q.data?.health ?? null, serverChecked: !!current, pending: online && !current };
  }, [fieldIssues, q.data, q.isPlaceholderData, debounced, net, online]);
}
