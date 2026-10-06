/** 역 검색(한글 부분일치·괄호 부역명 포함)과 "경도, 위도" 좌표 입력 처리. React/MapLibre를 모른다. */
import type { LngLat, NetworkData, Place, RawStation } from "./types.ts";

/** 이름 부분일치로 역 후보를 찾는다 — 예: "광교" → "광교(경기대)", "을지로입구"도 "을지로"로 찾음. */
export function searchStations(stations: RawStation[], query: string, limit = 12): RawStation[] {
  const q = query.trim();
  if (!q) return [];
  const exact: RawStation[] = [];
  const partial: RawStation[] = [];
  for (const c of stations) {
    const base = c.n.split("(")[0]!;
    if (c.n === q) exact.push(c);
    else if (c.n.includes(q) || q.includes(base) || base.includes(q)) partial.push(c);
    if (exact.length >= limit) break;
  }
  return [...exact, ...partial].slice(0, limit);
}

/** "127.1, 37.5" 형태의 좌표 입력 해석 (범위 밖이면 null) */
export function parseCoords(data: NetworkData, text: string): LngLat | null {
  const m = text.match(/^\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*$/);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat - data.defaultFrom.lat) > 2 || Math.abs(lon - data.defaultFrom.lon) > 2) return null;
  return [lon, lat];
}

/** 검색어/좌표를 Place로 해석 (URL의 ?from=&to= 역 이름도 여기서 파싱) */
export function resolveQuery(data: NetworkData, text: string): Place | null {
  const coords = parseCoords(data, text);
  if (coords) return { label: `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`, point: coords };
  const hits = searchStations(data.stations, text, 1);
  if (hits.length) return { label: hits[0]!.n, point: [hits[0]!.lon, hits[0]!.lat] };
  return null;
}
