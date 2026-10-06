/** 등시선 코어: 격자 도달 시간 필드 + d3-contour 링 추출. DOM/지도 라이브러리를 모른다.
 *
 * 정의: 격자 셀 시간 = min over 승강장 (승강장 도달시간 + 셀 중심까지 직선거리/75),
 * 단 승강장/출발지 주변 도보 반경(1.2 km) 밖은 도달 불가(=0으로 채운다).
 *
 * 등시선 T = "시간 ≤ T 인 영역"의 경계. d3-contour는 "값 ≥ threshold" 영역을 감싸므로
 * **값을 뒤집어** 넣는다: v' = 999 − time, threshold' = 999 − T. 미도달 셀은 v' = 0이라
 * 어떤 등시선 영역에도 들지 않는다 (예전 방식처럼 먼 곳에 무관한 섬이 생기지 않는다).
 * 링은 구조적으로 닫혀 있고(smoothed), Polygon은 구멍(hole)을 포함할 수 있어 채우기 레이어에
 * 그대로 넘긴다. 격자 단위 좌표 (X, Y)에서 셀 (c, r)의 중심은 (c+0.5, r+0.5)이므로
 * m = (x0 + X·cell, y0 + Y·cell)로 되돌린 뒤 toLL로 경위도화 — probe-rings.ts로 실측 확인. */
import { contours } from "d3-contour";
import { ACCESS_RADIUS, GRID_CELL_M, WALK_SPEED } from "./constants.ts";
import { toLL, toWorld } from "./graph.ts";
import type { GraphModel, IsoGrid, LngLat, Solution } from "./types.ts";

/** 미도달 셀의 변환 후 값 (FAR_T − 999 = 0). 등시선 threshold(999−T ≤ 984)보다 항상 작다. */
const FAR_T = 999;

/** 승강장 주변 + (임의 지점이면) 출발지 주변만 시딩하는 희소 스캐터.
 * "min over 승강장" 정의와 집합적으로 동치이며 O(승장 × 주변 칸)으로 선형. */
export function computeGrid(g: GraphModel, sol: Solution, origin: LngLat | null): IsoGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < g.x.length; i += 1) {
    const x = g.x[i]!, y = g.y[i]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = ACCESS_RADIUS + GRID_CELL_M * 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const cols = Math.ceil((maxX - minX) / GRID_CELL_M);
  const rows = Math.ceil((maxY - minY) / GRID_CELL_M);
  const times = new Float32Array(cols * rows).fill(Infinity);

  const seedAround = (cx: number, cy: number, baseTime: number) => {
    const c0 = Math.floor((cx - minX) / GRID_CELL_M);
    const r0 = Math.floor((cy - minY) / GRID_CELL_M);
    const step = Math.ceil((ACCESS_RADIUS + GRID_CELL_M) / GRID_CELL_M);
    for (let r = r0 - step; r <= r0 + step; r += 1) {
      if (r < 0 || r >= rows) continue;
      for (let c = c0 - step; c <= c0 + step; c += 1) {
        if (c < 0 || c >= cols) continue;
        const d = Math.hypot((c + 0.5) * GRID_CELL_M - (cx - minX), (r + 0.5) * GRID_CELL_M - (cy - minY));
        if (d > ACCESS_RADIUS) continue; // 도보 반경 밖 = 도달 불가 (정의대로)
        const t = baseTime + d / WALK_SPEED;
        const k = r * cols + c;
        if (t < times[k]!) times[k] = t;
      }
    }
  };

  for (let i = 0; i < g.x.length; i += 1) {
    const t0 = sol.timeAt[i]!;
    if (Number.isFinite(t0)) seedAround(g.x[i]!, g.y[i]!, t0);
  }
  if (origin) {
    seedAround(...(toWorld(g, origin) as [number, number]), 0); // 출발지 근처 직접 도보 영역
  }
  return { x0: minX, y0: minY, cell: GRID_CELL_M, cols, rows, times };
}

/** 격자 위의 "시간 ≤ threshold" 영역 → 닫힌 링들 (경도/위도, [바깥링, 구멍...]). */
export function contourRings(g: GraphModel, grid: IsoGrid, threshold: number): LngLat[][][] {
  const { cols, rows, cell, x0, y0, times } = grid;

  // 뒤집어 넣기: time ≤ T ⟺ 999 − time ≥ 999 − T. 미도달(Infinity)은 0 = 항상 바깥.
  const values = new Array<number>(cols * rows);
  for (let i = 0; i < values.length; i += 1) {
    const t = times[i]!;
    values[i] = Number.isFinite(t) ? FAR_T - t : 0;
  }
  const gen = contours().size([cols, rows]).thresholds([FAR_T - threshold]).smooth(true);

  const polys: LngLat[][][] = [];
  for (const contour of gen(values)) {
    for (const poly of contour.coordinates as Array<Array<Array<[number, number]>>>) {
      // 초소 섬(4셀 미만 = 해상도 노이즈) 버림 — 외곽링 신발끈 면적(격자 단위², ×2) 기준
      const outer = poly[0]!;
      let a = 0;
      for (let i = 1; i < outer.length - 1; i += 1) {
        const p = outer[i]!, q = outer[i + 1]!;
        a += p[0] * q[1] - q[0] * p[1];
      }
      if (Math.abs(a) / 2 < 4) continue;
      polys.push(poly.map((ring) => ring.map(([X, Y]) => toLL(g, [x0 + X * cell, y0 + Y * cell]))));
    }
  }
  return polys;
}
