/** MapLibre 커스텀 페인트 팩토리. MapLibre API 잔기술(소스/레이어키/expression)은
 * 이 파일과 MapCanvas.tsx 안에 봉인한다. 좌표는 LngLat=[경도,위도] = GeoJSON 순서와 동일해 변환 불필요. */
import type { Map as MLMap } from "maplibre-gl";
import { PALETTE, FAR_COLOR } from "@/lib/constants.ts";
import { rgb } from "@/lib/format.ts";
import type { GeoFC, GeoPoint, GeoPolygon, GraphModel, Route } from "@/lib/types.ts";

export const LAYER_IDS = ["pt-heat-fill", "pt-heat-line", "pt-stops", "pt-route"] as const;
const SOURCE_IDS = ["pt-heat", "pt-stops", "pt-route"] as const;

/** 테마 전환(setStyle) 전 커스텀 레이어 제거 — 재로딩된 스타일엔 커스텀 레이어가 사라진 뒤다. */
export function resetCustomLayers(map: MLMap) {
  for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const sid of SOURCE_IDS) if (map.getSource(sid)) map.removeSource(sid);
}

/** 등시선: 스무딩된 닫힌 링 GeoJSON → fill(반투명) + line(테두리 강조) 레이어 2개. */
export function paintIso(map: MLMap, fc: GeoFC<GeoPolygon, { t: number }>, max: number, dark: boolean) {
  if (!fc.features.length) return;
  map.addSource("pt-heat", { type: "geojson", data: fc as never });
  const ramp = ["interpolate", ["linear"], ["/", ["get", "t"], max], ...PALETTE.flatMap(([f, c]) => [f, rgb(c)])];
  map.addLayer({
    id: "pt-heat-fill",
    type: "fill",
    source: "pt-heat",
    paint: {
      "fill-color": ramp as never,
      "fill-opacity": dark ? 0.3 : 0.24,
    } as never,
  });
  map.addLayer({
    id: "pt-heat-line",
    type: "line",
    source: "pt-heat",
    paint: {
      "line-color": ramp as never,
      "line-width": 1.2,
      "line-opacity": dark ? 0.8 : 0.75,
    } as never,
  });
}

/** 정류장 점: 원(circle) 레이이어, 색 = 도달 시간 램프 (음수 t = 미도달 = 회색). */
export function paintStops(map: MLMap, fc: GeoFC<GeoPoint, { t: number; name: string }>, max: number) {
  if (!fc.features.length) return;
  if (map.getSource("pt-stops")) return;
  map.addSource("pt-stops", { type: "geojson", data: fc as never });
  map.addLayer({
    id: "pt-stops",
    type: "circle",
    source: "pt-stops",
    paint: {
      "circle-radius": 3.2,
      "circle-color": [
        "case",
        ["<", ["get", "t"], 0],
        rgb(FAR_COLOR),
        [">", ["get", "t"], max],
        rgb(FAR_COLOR),
        ["interpolate", ["linear"], ["/", ["get", "t"], max], ...PALETTE.flatMap(([f, c]) => [f, rgb(c)])],
      ] as never,
      "circle-opacity": 0.6,
    } as never,
  });
}

/** 경로 하이라이트: 도보 = 얇은 흑(다크=백)색, 승차 = 공식 노선색 굵은 선. */
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
  map.addSource("pt-route", { type: "geojson", data: { type: "FeatureCollection", features } as never });
  map.addLayer({
    id: "pt-route",
    type: "line",
    source: "pt-route",
    minzoom: 10,
    paint: {
      "line-color": ["get", "color"] as never,
      "line-width": 3.5,
      "line-opacity": 0.9,
    } as never,
  } as never);
}
