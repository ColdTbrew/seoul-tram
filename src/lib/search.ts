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
  if (Math.abs(lat - data.meta.defaultFrom.lat) > 2 || Math.abs(lon - data.meta.defaultFrom.lon) > 2) return null;
  return [lon, lat];
}

/** 검색어/좌표를 Place로 해석 (URL의 ?from=&to= 역 이름도 여기서 파싱).
 * 역 이름은 항상 stations의 클러스터 좌표로 해석한다 — 검색창 입력이든 ?from= 이든 같은 이름을
 * 같은 지점으로 풀어야 등시선 수치가 같아진다. */
export function resolveQuery(data: NetworkData, text: string): Place | null {
  const coords = parseCoords(data, text);
  if (coords) return { label: `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`, point: coords };
  const hits = searchStations(data.stations, text, 1);
  if (hits.length) return { label: hits[0]!.n, point: [hits[0]!.lon, hits[0]!.lat] };
  return null;
}

/** 기본 출발지(meta.defaultFrom)도 역 이름과 같은 규칙으로 해석한다.
 * defaultFrom의 좌표는 그 역의 승강장 하나(2호선 시청)를 가리키므로, ?from=시청 처럼 이름으로
 * 들어온 경우와 출발지가 어긋난다(= 등시선 범위가 달라진다). 그래서 이름 해석을 먼저 쓰고
 * 실패할 때만 그 좌표로 되돌린다. */
export function defaultOrigin(data: NetworkData): Place {
  const d = data.meta.defaultFrom;
  return resolveQuery(data, d.name) ?? { label: d.name, point: [d.lon, d.lat] };
}
