/** 등시선 코어: 격자 도달 시간 필드 + 스캔라인 채움 영역 생성. DOM/네이버맵스를 모른다.
 *
 * 정의(올바른 것): 격자 셀 시간 = min over 승강장 (승강장 도달시간 + 셀 중심까지 직선거리/75),
 * 단 승강장에서 도보 반경(1.2 km) 밖은 Infinity(도달 불가). 출발지가 역이 아니면 출발지에서
 * 직접 도보(75 m/분)하는 시간도 후보로 섞는다. v0의 평활화 단계는 제거 — 그것이
 * "출발지와 무관한 먼 곳에 섬 모양 윤곽"을 만든 버그의 원흉이었다.
 *
 * 채움 영역 생성(네이버 Polygon용): 열(column) 단위 스캔라인 — 각 열에서 시간 ≤ T 인 연속 칸을
 * 직사각형으로 합친다(칸 경계가 격자선과 수직이라 채움/미도달 경계가 항상 직선이므로 정확).
 * 등시선 T = "시간 ≤ T 인 영역"이며, 모든 채움 사각형은 반드시 시간 ≤ T 인 칸만 덮는다. */
import { ACCESS_RADIUS, GRID_CELL_M, WALK_SPEED } from "./constants.ts";
import type { GraphModel, IsoGrid, LngLat, Solution } from "./types.ts";

/** 승강장 주변 + (임의 지점이면) 출발지 주변만 시딩하는 희소 스캐터. O(승장 × 주변 칸). */
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
    const ox = (origin[0] - g.proj.lon0) * g.proj.mLon;
    const oy = (origin[1] - g.proj.lat0) * g.proj.mLat;
    seedAround(ox, oy, 0); // 출발지 근처 직접 도보 영역
  }
  return { x0: minX, y0: minY, cell: GRID_CELL_M, cols, rows, times };
}

/** 스캔라인: threshold 이하 영역의 수직 연속 구간을 평면 m 직사각형([x, y, w, h], y=남쪽 끝)으로.
 * v0의 "먼 곳 섬 윤곽" 회귀 방지: 무한대(미도달) 칸은 어떤 사각형에도 들지 않는다. */
export function regionRects(grid: IsoGrid, threshold: number): number[][] {
  const { cols, rows, cell, x0, y0, times } = grid;
  const rects: number[][] = [];
  for (let c = 0; c < cols; c += 1) {
    let runStart = -1;
    for (let r = 0; r <= rows; r += 1) {
      const inside = r < rows && times[r * cols + c]! <= threshold;
      if (inside && runStart === -1) runStart = r;
      if (!inside && runStart !== -1) {
        rects.push([x0 + c * cell, y0 + runStart * cell, cell, (r - runStart) * cell]);
        runStart = -1;
      }
    }
  }
  return rects;
}
