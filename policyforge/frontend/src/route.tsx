import { useCallback, useEffect, useState } from "react";
import { formatRoute, parseRoute, type Area, type Route } from "./lib/route";

export function useRoute(): [Route, (area: Area, params?: Record<string, string | number | undefined>) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((area: Area, params: Record<string, string | number | undefined> = {}) => {
    window.location.hash = formatRoute(area, params);
  }, []);
  return [route, go];
}
