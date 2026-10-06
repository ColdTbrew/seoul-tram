/** 출발지 하나의 파생 계산 전체: Dijkstra → 격자 → 등시선 링 → 정류장 색 → 요약.
 *  파생만 여기 있고 앱 트리는 결과를 렌더만 한다 (unidirectional data flow). */
import { useMemo } from "react";
import { BANDS, ISO_BLUR_SIGMA } from "@/lib/constants.ts";
import { dijkstraFrom, timeToPoint } from "@/lib/graph.ts";
import { computeGrid, contourBands } from "@/lib/iso.ts";
import type { GeoFC, GeoMultiPolygon, GeoPoint, GraphModel, IsoGrid, Place, Solution } from "@/lib/types.ts";

export interface TripPlan {
  solution: Solution | null;
  grid: IsoGrid | null;
  /** 등시선 밴드 (MultiPolygon = 바깥링+구멍; T 큰 순서로 그려 작은 링이 위에 온다) */
  contours: GeoFC<GeoMultiPolygon, { t: number; band: number }>;
  /** 정류장 점 (properties.t = 도달 시간 분, 음수 = 미도달) */
  stopsFC: GeoFC<GeoPoint, { t: number; name: string }>;
  summary: {
    withinReach: number;
    totalStations: number;
    reachMinutes: number;
    farthest: { name: string; minutes: number } | null;
  } | null;
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

const EMPTY_FC: GeoFC<GeoMultiPolygon, { t: number; band: number }> = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: GeoFC<GeoPoint, { t: number; name: string }> = { type: "FeatureCollection", features: [] };

export function useTripPlan(model: GraphModel | null, origin: Place | null, focus: number): TripPlan {
  const originKey = origin ? `${origin.point[0].toFixed(5)},${origin.point[1].toFixed(5)}` : null;

  const solution = useMemo(() => {
    if (!model || !origin) return null;
    return dijkstraFrom(model, origin.point);
    // originKey로 원점이 실제로 바뀌었을 때만 재계산 (Place 객체 동일성 의존 제거)
  }, [model, originKey]);

  // 등시선 5개 밴드는 항상 전부 그린다 → 격자와 링은 출발지가 바뀔 때만 함께 다시 계산한다.
  const iso = useMemo(() => {
    if (!model || !solution || !origin) return { grid: null as IsoGrid | null, contours: EMPTY_FC };
    const t0 = performance.now();
    const grid = computeGrid(model, solution, origin.point, BANDS[BANDS.length - 1]!);
    const contours = contourBands(model, grid, BANDS, ISO_BLUR_SIGMA);
    console.info(`[iso] grid ${grid.cols}x${grid.rows} bands ${(performance.now() - t0).toFixed(1)}ms`);
    return { grid: grid as IsoGrid | null, contours };
  }, [model, solution, originKey]);

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
      if (t <= focus) withinReach += 1;
      if (!farthest || t > farthest.minutes) farthest = { name: st.n, minutes: t };
    }
    return { withinReach, totalStations: model.data.stations.length, reachMinutes: focus, farthest };
  }, [model, solution, focus]);

  return { solution, grid: iso.grid, contours: iso.contours, stopsFC, summary };
}
