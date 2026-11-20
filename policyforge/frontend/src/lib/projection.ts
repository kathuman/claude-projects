// The map: Tierwise's equirectangular projection (lon/lat straight onto x/y), a zoom-and-pan view on top, and
// great-circle geometry for lanes. Distances match backend/core/domain/network_health.py.

export const ROAD_FACTOR = 1.25;
const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Points along the great circle from a to b ([lon, lat] pairs), for drawing a lane as the plane flies. */
export function greatCirclePoints(lat1: number, lon1: number, lat2: number, lon2: number, n = 24): [number, number][] {
  const p1 = [Math.cos(rad(lat1)) * Math.cos(rad(lon1)), Math.cos(rad(lat1)) * Math.sin(rad(lon1)), Math.sin(rad(lat1))];
  const p2 = [Math.cos(rad(lat2)) * Math.cos(rad(lon2)), Math.cos(rad(lat2)) * Math.sin(rad(lon2)), Math.sin(rad(lat2))];
  const omega = Math.acos(Math.max(-1, Math.min(1, p1[0] * p2[0] + p1[1] * p2[1] + p1[2] * p2[2])));
  if (omega < 1e-9) return [[lon1, lat1], [lon2, lat2]];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = Math.sin((1 - t) * omega) / Math.sin(omega);
    const b = Math.sin(t * omega) / Math.sin(omega);
    const x = a * p1[0] + b * p2[0];
    const y = a * p1[1] + b * p2[1];
    const z = a * p1[2] + b * p2[2];
    out.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))]);
  }
  return out;
}

/** World units: the whole world is 360 × 180, x = lon + 180, y = 90 − lat. */
export const toWorld = (lon: number, lat: number): [number, number] => [lon + 180, 90 - lat];
export const fromWorld = (x: number, y: number): [number, number] => [x - 180, 90 - y];

/** A view: screen = (world − origin) × scale. */
export interface View { scale: number; ox: number; oy: number }

export function project(v: View, lon: number, lat: number): [number, number] {
  const [x, y] = toWorld(lon, lat);
  return [(x - v.ox) * v.scale, (y - v.oy) * v.scale];
}

export function unproject(v: View, sx: number, sy: number): { lon: number; lat: number } {
  const [lon, lat] = fromWorld(sx / v.scale + v.ox, sy / v.scale + v.oy);
  return { lon: clamp(lon, -180, 180), lat: clamp(lat, -90, 90) };
}

/** Zoom by `factor` keeping the screen point (sx, sy) fixed. */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const scale = clamp(v.scale * factor, 0.5, 400);
  const wx = sx / v.scale + v.ox;
  const wy = sy / v.scale + v.oy;
  return { scale, ox: wx - sx / scale, oy: wy - sy / scale };
}

export const pan = (v: View, dx: number, dy: number): View => ({ ...v, ox: v.ox - dx / v.scale, oy: v.oy - dy / v.scale });

/** The view that shows all points with a margin; the whole world when there are none. */
export function fit(points: { lat: number; lon: number }[], width: number, height: number, margin = 0.15): View {
  if (points.length === 0) return { scale: Math.min(width / 360, height / 180), ox: 0, oy: 0 };
  const xs = points.map((p) => p.lon + 180);
  const ys = points.map((p) => 90 - p.lat);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 4);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  [x0, x1, y0, y1] = [cx - span / 2, cx + span / 2, cy - span / 2, cy + span / 2];
  const scale = Math.min(width / ((x1 - x0) * (1 + 2 * margin)), height / ((y1 - y0) * (1 + 2 * margin)));
  return { scale, ox: cx - width / 2 / scale, oy: cy - height / 2 / scale };
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
