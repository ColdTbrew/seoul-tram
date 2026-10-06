/** MapLibre 커스텀 페인트 팩토리. MapLibre API 잔기술(소스/레이어키/expression)은
 * 이 파일과 MapCanvas.tsx 안에 봉인한다. 좌표는 LngLat=[경도,위도] = GeoJSON 순서와 동일해 변환 불필요.
 * 레이어 추가 순서(아래→위): iso-fill → iso-line → lines → stations → route. */
import type { Map as MLMap } from "maplibre-gl";
import { PALETTE, FAR_COLOR } from "@/lib/constants.ts";
import { rgb } from "@/lib/format.ts";
import type { GeoFC, GeoLine, GeoMultiPolygon, GeoPoint, GraphModel, Route } from "@/lib/types.ts";

export const LAYER_IDS = ["iso-fill", "iso-line", "lines", "stations", "route-casing", "route"] as const;
const SOURCE_IDS = ["iso", "lines", "stations", "route"] as const;

/** 테마 전환(setStyle)·재페인트 전 커스텀 레이어 제거 — 재로딩된 스타일엔 커스텀 레이어가 사라진 뒤다. */
export function resetCustomLayers(map: MLMap) {
  for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const sid of SOURCE_IDS) if (map.getSource(sid)) map.removeSource(sid);
}

/** 시간 → 색 램프 (t/max 정규화, 음수/초과는 회색). */
const ramp = (max: number) =>
  ["interpolate", ["linear"], ["/", ["get", "t"], max], ...PALETTE.flatMap(([f, c]) => [f, rgb(c)])];

/** 등시선: 스무딩된 닫힌 링 MultiPolygon(구멍 포함 가능) → fill(반투명) + line(테두리 강조). */
export function paintIso(map: MLMap, fc: GeoFC<GeoMultiPolygon, { t: number }>, max: number, dark: boolean) {
  if (!fc.features.length) return;
  map.addSource("iso", { type: "geojson", data: fc as never });
  map.addLayer({
    id: "iso-fill",
    type: "fill" as const,
    source: "iso",
    paint: {
      "fill-color": ramp(max) as never,
      "fill-opacity": dark ? 0.36 : 0.3,
    },
  } as never);
  map.addLayer({
    id: "iso-line",
    type: "line" as const,
    source: "iso",
    paint: {
      "line-color": ramp(max) as never,
      "line-width": 1.2,
      "line-opacity": dark ? 0.8 : 0.75,
    },
  } as never);
}

/** 지하철 노선망 전체(22개 노선 82개 path) — 공식 노선색. 등시선 fill 위·역 점 아래에 깔아야
 * 양쪽 테마에서 베이스맵과 구분된다 (직전 빌드엔 이 레이어가 통째로 빠져 노선색이 안 보였다). */
export function paintLines(map: MLMap, model: GraphModel, dark: boolean) {
  const features: Array<{ type: "Feature"; geometry: GeoLine; properties: { color: string } }> = [];
  for (const line of model.data.lines) {
    for (const path of line.paths) {
      if (path.length >= 2) {
        // network.json의 paths는 [lat,lng] 저장(GTFS 관행) — GeoJSON/MapLibre는 [lng,lat]이므로 스왑.
        features.push({
          type: "Feature" as const,
          geometry: { type: "LineString" as const, coordinates: path.map(([lat, lng]) => [lng, lat] as [number, number]) },
          properties: { color: line.color },
        });
      }
    }
  }
  if (!features.length) return;
  map.addSource("lines", { type: "geojson", data: { type: "FeatureCollection", features } as never });
  map.addLayer({
    id: "lines",
    type: "line" as const,
    source: "lines",
    minzoom: 7,
    paint: {
      "line-color": ["get", "color"] as never,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 3] as never,
      "line-opacity": dark ? 0.55 : 0.8,
    },
  } as never);
}

/** 정류장 점: 원(circle) 레이어, 색 = 도달 시간 램프(음수/초과 = 회색).
 * 반경은 줌 10:2.5 → 12:4 → 14:6 보간 + 1px 흰 테두리 — 노선 선층 바로 위에 떠서 구분된다. */
export function paintStops(map: MLMap, fc: GeoFC<GeoPoint, { t: number; name: string }>, max: number, dark: boolean) {
  if (!fc.features.length) return;
  map.addSource("stations", { type: "geojson", data: fc as never });
  map.addLayer({
    id: "stations",
    type: "circle" as const,
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 12, 4, 14, 6] as never,
      "circle-color": [
        "case",
        ["<", ["get", "t"], 0],
        rgb(FAR_COLOR),
        [">", ["get", "t"], max],
        rgb(FAR_COLOR),
        ramp(max),
      ] as never,
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-opacity": dark ? 0.25 : 0.9,
    },
  } as never);
}

/** 경로 하이라이트 (가장 마지막에 추가 = 최상단, minzoom 없음):
 * 두께 6px 본선 + 그 아래 8px 케asing(라이트=흰색/다크=검정). 케싱 덕에 다크 매터 위에서도 대비가 산다. */
export function paintRoute(map: MLMap, model: GraphModel, route: Route, dark: boolean) {
  const features = route.steps
    .filter((s) => s.points.length >= 2)
    .map((s) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: s.points },
      properties: {
        color:
          s.kind === "ride"
            ? model.data.lines[s.line]?.color ?? (dark ? "#fafafa" : "#111111")
            : dark
              ? "#fafafa"
              : "#111111",
      },
    }));
  if (!features.length) return;
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features } as never });
  map.addLayer({
    id: "route-casing",
    type: "line" as const,
    source: "route",
    paint: {
      "line-color": (dark ? "#000000" : "#ffffff") as never,
      "line-width": 8,
      "line-opacity": 1,
    },
  } as never);
  map.addLayer({
    id: "route",
    type: "line" as const,
    source: "route",
    paint: {
      "line-color": ["get", "color"] as never,
      "line-width": 6,
      "line-opacity": 0.95,
    },
  } as never);
}
