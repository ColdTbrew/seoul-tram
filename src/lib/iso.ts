/** 등시선 코어: 격자 도달 시간 필드 + closed-ring marching squares. DOM/MapLibre를 모른다.
 *
 * 정의(올바른 것): 격자 셀 시간 = min over 승강장 (승강장 도달시간 + 셀 중심까지 직선거리/75),
 * 단 승강장에서 도보 반경(1.2 km) 밖은 Infinity(도달 불가). 출발지가 역이 아니면 출발지에서
 * 직접 도보(75 m/분)하는 시간도 후보로 섞는다. v0의 평활화 단계는 제거 — 그것이
 * "출발지와 무관한 먼 곳에 섬 윤곽"을 만든 버그의 원흉이었다.
 *
 * 등시선 T = "시간 ≤ T 인 영역"의 경계. 격자 해상도(250 m)의 계단형 잘림을 매끄럽게 보이게
 * 하려면: (1) 경계 교차점은 인접 셀쌍의 변 위에서 선형보간(미도달은 999분으로 취급 —
 * v0처럼 무한대를 건너뛰지 않음 → 출발지 주변 원형 영역과 등시선이 정확히 닫힌다),
 * (2) 변 단위로 얻은 교차점 체인을 닫힌 링으로 잇고, (3) Chaikin 코너 컷 2회 스무딩,
 * (4) 아주 작은 링(섬)은 버린다. */
import { ACCESS_RADIUS, GRID_CELL_M, WALK_SPEED } from "./constants.ts";
import { toLL } from "./graph.ts";
import type { GraphModel, IsoGrid, LngLat, Solution } from "./types.ts";
import type { Feature, FeatureCollection, LineString } from "geojson";

/** 미도달 셀의 "의석 시간". 보간에서만 쓰이며 등시선 T(≤60)와는 항상 크다. */
const FAR_T = 999;

/** 셀 인덱스 키 → 경계 세그먼트를 잇는 데 쓰는 점 키(소수 4자리 ≈ 0.1 m 격자) */
const pKey = (p: LngLat) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 희소 스캐터 시딩: 승강장 주변 + (임의 지점이면) 출발지 주변만 쓴다. O(승장 × 주변 칸). */
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

/** 닫힌 링 하나를 Chaikin 코너 컷으로 매끄럽게 (끝점 고정 유지). */
function chaikinOpen(pts: LngLat[]): LngLat[] {
  if (pts.length < 3) return pts;
  let cur = pts;
  for (let it = 0; it < 2; it += 1) {
    const out: LngLat[] = [cur[0]!];
    for (let i = 1; i < cur.length - 1; i += 1) {
      const a = cur[i - 1]!, b = cur[i]!, c = cur[i + 1]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([b[0] * 0.75 + c[0] * 0.25, b[1] * 0.75 + c[1] * 0.25]);
    }
    out.push(cur[cur.length - 1]!);
    cur = out;
  }
  return cur;
}

/** 닫힌 링을 시계/반시계 순회로 복원: 세그먼트 체인을 연결 → 닫히면 스무딩.
 * 크기가 아주 작거나(대각선 < 750 m) 체인이 닫히지 않으면 버린다. */
function chainRings(segments: LngLat[][]): LngLat[][] {
  const byPoint = new Map<string, number[]>();
  const push = (segIdx: number, p: LngLat) => {
    const k = pKey(p);
    let list = byPoint.get(k);
    if (!list) { list = []; byPoint.set(k, list); }
    list.push(segIdx);
  };
  segments.forEach((seg, i) => { push(i, seg[0]!); push(i, seg[1]!); });

  const used = new Array<boolean>(segments.length).fill(false);
  const rings: LngLat[][] = [];

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue;
    const chain: LngLat[] = [...segments[i]!];
    used[i] = true;
    let closed = false;

    for (let guard = 0; guard < 10_000; guard += 1) {
      const head = chain[0]!;
      const tail = chain[chain.length - 1]!;
      if (pKey(head) === pKey(tail)) { closed = true; break; }
      // 끝에서부터 두 번 연장 (한쪽이 막히면 반대쪽)
      const grow = (fromEnd: boolean): boolean => {
        const end = fromEnd ? chain[chain.length - 1]! : chain[0]!;
        const cands = byPoint.get(pKey(end)) ?? [];
        for (const j of cands) {
          if (used[j]) continue;
          used[j] = true;
          const seg = segments[j]!;
          const next = pKey(seg[0]!) === pKey(end) ? seg[1]! : seg[0]!;
          if (fromEnd) chain.push(next);
          else chain.unshift(next);
          return true;
        }
        return false;
      };
      if (!grow(false) && !grow(true)) break;
    }

    if (closed && chain.length >= 6) {
      const xs = chain.map((p) => p[0]);
      const ys = chain.map((p) => p[1]);
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (diag < 750) continue; // 아주 작은 섬 제거
      const smoothed = chaikinOpen(chain);
      if (pKey(smoothed[0]!) !== pKey(smoothed[smoothed.length - 1]!)) smoothed.push(smoothed[0]!);
      rings.push(smoothed);
    }
  }
  return rings;
}

/** 등시선 T 이하 영역의 경계(닫힌 링)를 FeatureCollection(경도/위도)으로 뽑는다. */
export function contourFeatures(g: GraphModel, grid: IsoGrid, thresholds: number[]): FeatureCollection<LineString, { t: number }> {
  const { cols, rows, cell, x0, y0, times } = grid;
  const cx = (c: number) => x0 + (c + 0.5) * cell;
  const cy = (r: number) => y0 + (r + 0.5) * cell;
  const value = (r: number, c: number) => times[r * cols + c]!;
  const features: Feature<LineString, { t: number }>[] = [];

  for (const threshold of thresholds) {
    if (threshold <= 0) continue;
    const segments: LngLat[][] = [];

    // 셀 중심 사각형(r,c)(r,c+1)(r+1,c+1)(r+1,c)의 네 변 위에서 교차점을 구한다.
    // 교차점 위치는 "변의 양 끝 셀 시간"만으로 결정되므로, 인접 사각형이 같은 값을
    // 같은 방식으로 계산 → 체인이 닫힌 링으로 이어진다. 미도달(Infinity)은 999분으로 취급.
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const v0 = value(r, c), v1 = value(r, c + 1), v2 = value(r + 1, c + 1), v3 = value(r + 1, c);
        if (v0 > threshold && v1 > threshold && v2 > threshold && v3 > threshold) continue; // 빠른 경로

        const cross = (rA: number, cA: number, rB: number, cB: number): LngLat | null => {
          const vA = value(rA, cA), vB = value(rB, cB);
          if (vA <= threshold === (vB <= threshold)) return null;
          const [inA, outB] = vA <= threshold ? [vA, vB] : [vB, vA];
          const [cIn, rIn] = vA <= threshold ? [cA, rA] : [cB, rB];
          const [cO, rO] = vA <= threshold ? [cB, rB] : [cA, rA];
          const outEff = Number.isFinite(outB) ? outB : FAR_T;
          const f = clamp((threshold - inA) / (outEff - inA), 0.02, 0.98);
          // 안쪽 점에서 바깥쪽으로 f만큼 떨어진 지점 (평면 m)
          const pInx = cx(cIn), pIny = cy(rIn), pOx = cx(cO), pOy = cy(rO);
          return [pInx + (pOx - pInx) * f, pIny + (pOy - pIny) * f];
        };

        const edges: Array<[number, number, number, number]> = [
          [r, c, r, c + 1], [r, c + 1, r + 1, c + 1], [r + 1, c + 1, r + 1, c], [r + 1, c, r, c],
        ];
        const pts: LngLat[] = [];
        for (const [rA, cA, rB, cB] of edges) {
          const p = cross(rA, cA, rB, cB);
          if (p) pts.push(p);
        }
        if (pts.length === 2) segments.push([pts[0]!, pts[1]!]);
        else if (pts.length === 4) segments.push([pts[0]!, pts[1]!], [pts[2]!, pts[3]!]);
      }
    }

    for (const ring of chainRings(segments)) {
      features.push({
        type: "Feature",
        // 평면좌표(m) → 경도/위도 (MapLibre는 lng,lat 순서)
        geometry: { type: "LineString", coordinates: ring.map((p) => toLL(g, p)) },
        properties: { t: threshold },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
