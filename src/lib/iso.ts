/** 등시선 코어: 격자 도달 시간 필드 + marching squares 매끄러운 닫힌 링. DOM/지도 라이브러리를 모른다.
 *
 * 정의(올바른 것): 격자 셀 시간 = min over 승강장 (승강장 도달시간 + 셀 중심까지 직선거리/75),
 * 단 승강장/출발지에서 도보 반경(1.2 km) 밖은 Infinity(도달 불가).
 *
 * 등시선 T = "시간 ≤ T 인 영역"의 경계 — marching squares:
 *  1) 셀 중심을 격자점으로 변 교차점을 구한다. 변 양 끝이 안/밖이 갈리면 선형 보간.
 *     미도달(Infinity)은 **의석 시간 999분으로 취급**해 보간한다 (v0는 이 변을 건너뛰어
 *     윤곽이 조각나고 무관한 먼 곳에 섬이 생겼다). 유한값 쪽이 안쪽이면 교차점은
 *     무한대 쪽으로 97%만큼 밀려나 링이 영역을 실제로 에워싼다.
 *  2) 변 교차점 세그먼트를 끝점 키(4자리 고정 소수)로 연결해 닫힌 링으로 잇는다 —
 *     공용 변의 교차점은 두 사각형이 같은 계산을 해 같은 점이 나오므로 체인이 닫힌다.
 *  3) 대각선 750 m 미만 초소 링(섬)을 버리고 4) 코너 컷(Chaikin) 2회로 매끄럽게 —
 *     각 링은 첫 점 = 마지막 점(닫힘)으로 출력한다 (naver/MapLibre 폴리곤 paths에 그대로 투입). */
import { ACCESS_RADIUS, GRID_CELL_M, WALK_SPEED } from "./constants.ts";
import { toLL, toWorld } from "./graph.ts";
import type { GraphModel, IsoGrid, LngLat, Solution } from "./types.ts";

/** 미도달 셀의 의석 시간 (분). T ≤ 60과 항상 비교 가능해 보간이 뭉개지지 않는다. */
const FAR_T = 999;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 승강장 주변 + (임의 지점이면) 출발지 주변만 시딩하는 희소 스캐터.
 * "min over 승강장" 정의와 집합적으로 동치이며 O(승강장 × 주변 칸)으로 선형. */
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

/** 격자 좌표계(평면 m)의 "시간 ≤ threshold" 영역 경계 → 매끄러운 **닫힌** 링들 (경도/위도,
 * 각 링은 첫 점 = 마지막 점). MapLibre/GeoJSON Polygon coordinates로 바로 쓸 수 있다. */
export function contourRings(g: GraphModel, grid: IsoGrid, threshold: number): LngLat[][] {
  const { cols, rows, cell, x0, y0, times } = grid;
  const value = (r: number, c: number) => times[r * cols + c]!;
  const inside = (v: number) => v <= threshold; // Infinity(미도달)는 항상 바깥
  const center = (r: number, c: number): LngLat => [x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell];
  const segments: Array<[LngLat, LngLat]> = [];

  /** 변 양 끝 (rA,cA)-(rB,cB) 위의 등시선 교차점. 안/밖이 갈리면 안쪽에서 f만큼 떨어진 점. */
  const crossing = (rA: number, cA: number, rB: number, cB: number): LngLat | null => {
    const vA = value(rA, cA);
    const vB = value(rB, cB);
    if (inside(vA) === inside(vB)) return null;
    const aInside = inside(vA);
    const vIn = aInside ? vA : vB;
    const vOut = aInside ? vB : vA;
    const vOutEff = Number.isFinite(vOut) ? vOut : FAR_T;
    const f = clamp01((threshold - vIn) / (vOutEff - vIn));
    const pIn = center(rA, cA);
    const pO = center(rB, cB);
    return [pIn[0] + (pO[0] - pIn[0]) * f, pIn[1] + (pO[1] - pIn[1]) * f];
  };

  // 사각형 4변의 교차점 → 세그먼트 (2개면 대각 쌍 하나, 4개면 두 개 — 애매한 사각형도 닫힘 유지)
  const quadEdges: Array<[number, number, number, number]> = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      quadEdges.length = 0;
      quadEdges.push([r, c, r, c + 1], [r, c + 1, r + 1, c + 1], [r + 1, c + 1, r + 1, c], [r + 1, c, r, c]);
      const pts: LngLat[] = [];
      for (const [rA, cA, rB, cB] of quadEdges) {
        const p = crossing(rA, cA, rB, cB);
        if (p) pts.push(p);
      }
      if (pts.length === 2) segments.push([pts[0]!, pts[1]!]);
      else if (pts.length === 4) segments.push([pts[0]!, pts[1]!], [pts[2]!, pts[3]!]);
    }
  }

  // 끝점 키로 세그먼트를 연결해 체인을 만들고, 체인이 첫 점으로 돌아오면 닫힌 링이 된다.
  const byPoint = new Map<string, number[]>();
  const key = (p: LngLat) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  segments.forEach((seg, i) => {
    for (const p of seg) {
      const list = byPoint.get(key(p)) ?? [];
      list.push(i);
      byPoint.set(key(p), list);
    }
  });

  const rings: LngLat[][] = [];
  const used = new Array<boolean>(segments.length).fill(false);

  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) continue;
    used[i] = true;
    const chain: LngLat[] = [segments[i]![0]!, segments[i]![1]!];

    const grow = (fromEnd: boolean): boolean => {
      const end = fromEnd ? chain[chain.length - 1]! : chain[0]!;
      const cands = byPoint.get(key(end));
      if (!cands) return false;
      for (const j of cands) {
        if (used[j]) continue;
        used[j] = true;
        const seg = segments[j]!;
        const other = key(seg[0]!) === key(end) ? seg[1]! : seg[0]!;
        if (fromEnd) chain.push(other);
        else chain.unshift(other);
        return true;
      }
      return false;
    };

    let closed = false;
    for (let guard = 0; guard < 20_000; guard += 1) {
      if (chain.length >= 4 && key(chain[0]!) === key(chain[chain.length - 1]!)) {
        closed = true;
        break;
      }
      if (!grow(false) && !grow(true)) break;
    }
    if (!closed) continue; // 열린 체인(드문 사이드 경우)은 버린다 — 조각/계단형 조각이 줄어 보인다

    // 초소 섬 버림 (대각선 기준) — 45분 이상 먼 곳의 노이즈 링
    const first = chain[0]!;
    let diag = 0;
    for (const p of chain) diag = Math.max(diag, Math.hypot(p[0] - first[0], p[1] - first[1]));
    if (diag * 2 < 750) continue;

    // 닫힌 랩어라운드 Chaikin 코너 컷 ×2 — 격자 해상도의 계단형 잘림을 부드럽게
    let ring = chain.slice(0, -1);
    for (let iter = 0; iter < 2; iter += 1) {
      const next: LngLat[] = [];
      const n = ring.length;
      for (let a = 0; a < n; a += 1) {
        const p = ring[a]!;
        const q = ring[(a + 1) % n]!;
        next.push([p[0] + (q[0] - p[0]) * 0.25, p[1] + (q[1] - p[1]) * 0.25]);
        next.push([p[0] + (q[0] - p[0]) * 0.75, p[1] + (q[1] - p[1]) * 0.75]);
      }
      ring = next;
    }
    ring.push(ring[0]!); // 닫힘으로 출력 (첫 점 = 마지막 점)
    rings.push(ring.map((p) => toLL(g, p)));
  }
  return rings;
}
