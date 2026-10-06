/** MapLibre 커스텀 페인트 팩토리. MapLibre API 잔기술(소스/레이어키/expression)은
 * 이 파일과 MapCanvas.tsx 안에 봉인한다. 좌표는 LngLat=[경도,위도] = GeoJSON 순서와 동일해 변환 불필요.
 * 레이어 추가 순서(아래→위): iso-fill → iso-line → iso-focus → iso-label → lines → stations → route-casing → route. */
import type { ExpressionSpecification, Map as MLMap } from "maplibre-gl";
import { BANDS, BAND_COLORS_DARK, BAND_COLORS_LIGHT, FAR_HEX_DARK, FAR_HEX_LIGHT } from "@/lib/constants.ts";
import type { GeoFC, GeoLine, GeoMultiPolygon, GeoPoint, GraphModel, Route } from "@/lib/types.ts";

export const LAYER_IDS = ["iso-fill", "iso-line", "iso-focus", "iso-label", "lines", "stations", "route-casing", "route"] as const;
const SOURCE_IDS = ["iso", "lines", "stations", "route"] as const;

/** 테마 전환(setStyle)·재페인트 전 커스텀 레이어 제거 — 재로딩된 스타일엔 커스텀 레이어가 사라진 뒤다. */
export function resetCustomLayers(map: MLMap) {
  for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const sid of SOURCE_IDS) if (map.getSource(sid)) map.removeSource(sid);
}

/** 밴드별 투명도 (band 0 = 15분이 가장 진함, 4 = 90분이 가장 옅음). 드래그 중(dim)에는 절반으로 옅게.
 * YlOrRd/Viridis 는 연한 색이 투명하면 안 보이므로 Vercel 램프 때보다 올렸다. */
const ALPHA_LIGHT = [0.5, 0.45, 0.4, 0.35, 0.28];
const ALPHA_DARK = [0.45, 0.42, 0.4, 0.38, 0.35];
const half = (v: number) => Number((v / 2).toFixed(3));

export function isoFillOpacity(dark: boolean, dim = false): ExpressionSpecification {
  const A = (dark ? ALPHA_DARK : ALPHA_LIGHT).map((a) => (dim ? half(a) : a));
  return ["match", ["get", "band"], 0, A[0], 1, A[1], 2, A[2], 3, A[3], A[4]] as unknown as ExpressionSpecification;
}

export function isoLineOpacity(dark: boolean, dim = false): number {
  const base = dark ? 0.85 : 0.9;
  return dim ? half(base) : base;
}

/** 등시선 5밴드(15/30/45/60/90분)를 아래에서 위로 쌓는다: fill(중첩될수록 진함) → 얇은 윤곽 →
 * 강조 밴드 → 경계 라벨. 링은 스무딩된 닫힌 MultiPolygon(구멍 포함 가능)이고 features는 T 큰 순서.
 * fill은 밴드별로 옅게(바깥이 가장 옅게) 깔리고, 라벨은 강조 중인 밴드 경계에만 붙는다. */
export function paintIso(
  map: MLMap,
  fc: GeoFC<GeoMultiPolygon, { t: number; band: number }>,
  focus: number,
  dark: boolean,
) {
  if (!fc.features.length) return;
  const C = dark ? BAND_COLORS_DARK : BAND_COLORS_LIGHT;
  const focusBand = BANDS.indexOf(focus);
  const focusColor = C[focusBand >= 0 ? focusBand : 0];
  const bandColor = ["match", ["get", "band"], 0, C[0], 1, C[1], 2, C[2], 3, C[3], C[4]];
  const join = { "line-join": "round", "line-cap": "round" };

  map.addSource("iso", { type: "geojson", data: fc as never } as never);
  map.addLayer({
    id: "iso-fill",
    type: "fill" as const,
    source: "iso",
    paint: {
      "fill-color": bandColor,
      "fill-opacity": isoFillOpacity(dark),
      "fill-antialias": true,
    },
  } as never);
  map.addLayer({
    id: "iso-line",
    type: "line" as const,
    source: "iso",
    paint: {
      "line-color": bandColor,
      "line-width": 1.25,
      "line-opacity": isoLineOpacity(dark),
    },
    layout: join,
  } as never);
  map.addLayer({
    id: "iso-focus",
    type: "line" as const,
    source: "iso",
    filter: ["==", ["get", "t"], focus],
    paint: { "line-color": focusColor, "line-width": 2.5, "line-opacity": 1 },
    layout: join,
  } as never);
  // 밴드 경계를 따라 "15분" … — 폰트 스택은 CARTO 스타일이 실제로 쓰는 것 (다른 이름은 글리프 404).
  // 작은 섬마다 라벨이 붙어 지저분해지므로 강조 중인 밴드(focus)의 경계에만, 600px마다 하나씩 붙인다.
  map.addLayer({
    id: "iso-label",
    type: "symbol" as const,
    source: "iso",
    minzoom: 10,
    filter: ["==", ["get", "t"], focus],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 600,
      "text-field": ["concat", ["to-string", ["get", "t"]], "분"],
      "text-font": ["Montserrat Medium", "Open Sans Bold", "Noto Sans Regular", "HanWangHeiLight Regular", "NanumBarunGothic Regular"],
      "text-size": 11,
      "text-keep-upright": true,
      "text-max-angle": 30,
    },
    paint: {
      "text-color": dark ? (focus === 15 ? "#fde725" : "#e5e7eb") : "#7a0177",
      "text-halo-color": dark ? "#000000" : "#ffffff",
      "text-halo-width": 1.5,
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
/** 정류장 점: 원(circle) 레이어, 색 = 밴드와 같은 계단식 색 (음수/90분 초과 = 회색).
 * 반경은 줌 10:2.5 → 12:4 → 14:6 보간 + 1px 흰 테두리 — 노선 선층 바로 위에 떠서 구분된다. */
export function paintStops(map: MLMap, fc: GeoFC<GeoPoint, { t: number; name: string }>, dark: boolean) {
  if (!fc.features.length) return;
  const C = dark ? BAND_COLORS_DARK : BAND_COLORS_LIGHT;
  const FAR = dark ? FAR_HEX_DARK : FAR_HEX_LIGHT;
  const steps: unknown[] = ["case", ["<", ["get", "t"], 0], FAR];
  for (let i = 0; i < BANDS.length; i += 1) steps.push(["<=", ["get", "t"], BANDS[i]], C[i]);
  steps.push(FAR);
  map.addSource("stations", { type: "geojson", data: fc as never } as never);
  map.addLayer({
    id: "stations",
    type: "circle" as const,
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 12, 4, 14, 6] as never,
      "circle-color": steps,
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
