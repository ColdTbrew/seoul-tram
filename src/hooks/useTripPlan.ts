/** 출발지 하나의 파생 계산 전체: Dijkstra → 격자 → 등시선 링 → 정류장 색 → 요약.
 *  파생만 여기 있고 앱 트리는 결과를 렌더만 한다 (unidirectional data flow). */
import { useMemo } from "react";
import { REACH } from "@/lib/constants.ts";
import { dijkstraFrom, timeToPoint } from "@/lib/graph.ts";
import { computeGrid, contourRings } from "@/lib/iso.ts";
import type { GeoFC, GeoMultiPolygon, GeoPoint, GraphModel, IsoGrid, Place, Solution } from "@/lib/types.ts";

export interface TripPlan {
  solution: Solution | null;
  grid: IsoGrid | null;
  /** 등시선 (MultiPolygon = 바깥링+구멍; T 큰 순서로 그려 작은 링이 위에 온다) */
  contours: GeoFC<GeoMultiPolygon, { t: number }>;
  /** 정류장 점 (properties.t = 도달 시간 분, 음수 = 미도달) */
  stopsFC: GeoFC<GeoPoint, { t: number; name: string }>;
  summary: {
    withinReach: number;
    totalStations: number;
    reachMinutes: number;
    farthest: { name: string; minutes: number } | null;
  } | null;
}

function buildContours(model: GraphModel, grid: IsoGrid, isos: number[]): GeoFC<GeoMultiPolygon, { t: number }> {
  // T 큰 것부터 그려 작은 링이 위에 오게 한다 (T=30 영역 ⊂ T=45 영역이므로 순서가 색의 기준).
  const ts = [...new Set(isos.filter((t) => t > 0))].sort((a, b) => b - a);
  const features: GeoFC<GeoMultiPolygon, { t: number }>["features"] = [];
  for (const t of ts) {
    const coordinates = contourRings(model, grid, t);
    if (coordinates.length) {
      features.push({ type: "Feature", geometry: { type: "MultiPolygon", coordinates }, properties: { t } });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildStopsFC(model: GraphModel, solution: Solution): GeoFC<GeoPoint, { t: number; name: string }> {
  return {
    type: "FeatureCollection",
    features: model.data.stops.map((s, i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] as [number, number] },
      // 미도달은 -1 (레이어에서 회색), 유한값은 반올림해 페이로드 축소
      properties: {
        t: Number.isFinite(solution.timeAt[i]!) ? Math.round(solution.timeAt[i]! * 10) / 10 : -1,
        name: s.n,
      },
    })),
  };
}

const EMPTY_FC: GeoFC<GeoMultiPolygon, { t: number }> = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: GeoFC<GeoPoint, { t: number; name: string }> = { type: "FeatureCollection", features: [] };

export function useTripPlan(
  model: GraphModel | null,
  origin: Place | null,
  bounds: { max: number; isos: number[] },
): TripPlan {
  const originKey = origin ? `${origin.point[0].toFixed(5)},${origin.point[1].toFixed(5)}` : null;

  const solution = useMemo(() => {
    if (!model || !origin) return null;
    return dijkstraFrom(model, origin.point);
    // originKey로 원점이 실제로 바뀌었을 때만 재계산 (Place 객체 동일성 의존 제거)
  }, [model, originKey]);

  const grid = useMemo(() => {
    if (!model || !solution || !origin) return null;
    return computeGrid(model, solution, origin.point);
  }, [model, solution, originKey]);

  const contours = useMemo(() => {
    if (!model || !grid) return EMPTY_FC;
    return buildContours(model, grid, bounds.isos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, grid, bounds.isos.join(",")]);

  const stopsFC = useMemo(() => {
    if (!model || !solution) return EMPTY_POINTS;
    return buildStopsFC(model, solution);
  }, [model, solution]);

  const summary = useMemo(() => {
    if (!model || !solution) return null;
    let withinReach = 0;
    let farthest: { name: string; minutes: number } | null = null;
    for (const st of model.data.stations) {
      const t = timeToPoint(model, solution, [st.lon, st.lat]);
      if (!Number.isFinite(t)) continue;
      if (t <= REACH) withinReach += 1;
      if (!farthest || t > farthest.minutes) farthest = { name: st.n, minutes: t };
    }
    return { withinReach, totalStations: model.data.stations.length, reachMinutes: REACH, farthest };
  }, [model, solution]);

  return { solution, grid, contours, stopsFC, summary };
}
