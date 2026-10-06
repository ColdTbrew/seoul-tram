/** 등시선 코어: 격자 도달 시간 필드 + 밴드(등치선) 링 추출. DOM/React/MapLibre를 모른다.
 *
 * 정의: 격자 셀 시간 = min over 승강장 (승강장 도달시간 + 셀 중심까지 직선거리/75),
 * 단 승강장/출발지 주변 도보 반경(1.2 km) 밖은 도달 불가(Infinity = 어떤 밴드에도 안 든다).
 *
 * 등시선 T = "시간 ≤ T 인 영역"의 경계. d3-contour는 "값 ≥ threshold" 영역을 감싸므로 값을 **뒤집어**
 * 넣는다: v' = ISO_CAP − min(t, ISO_CAP), threshold' = ISO_CAP − T. 미도달은 v' = 0이라 어떤 등시선
 * 영역에도 들지 않는다. 등치선을 뽑기 전에 가우시안 블러(분리형, 경계는 clamp)로 계단형 경계를 뭉개고
 * 뽑힌 링은 면적 필터(작은 섬·구멍 버림) + Chaikin 2회로 다듬는다 — 150 m 격자의 계단형이 화면에
 * 보이지 않게 하기 위해서다. 격자 단위 좌표 (X, Y)의 셀 중심은 (c+0.5, r+0.5)이므로
 * m = (x0 + X·cell, y0 + Y·cell)로 되돌린 뒤 toLL로 경위도화한다 (probe-rings.ts로 실측 확인). */
import { contours } from "d3-contour";
import {
  ACCESS_RADIUS,
  GRID_CELL_M,
  ISO_BLUR_SIGMA,
  ISO_CAP,
  ISO_MIN_HOLE_M2,
  ISO_MIN_ISLAND_M2,
  WALK_SPEED,
} from "./constants.ts";
import { toLL, toWorld } from "./graph.ts";
import type { GeoFC, GeoMultiPolygon, GraphModel, IsoGrid, LngLat, Solution } from "./types.ts";

/** 격자 여백: 도보 반경 + 블러 커널 반경(4셀) + 3셀. 이만큼 바깥까지 격자에 담는다. */
const PAD_M = ACCESS_RADIUS + (Math.ceil(ISO_BLUR_SIGMA * 3) + 3) * GRID_CELL_M;

/** 원시 시간 격자 (Infinity = 도달 불가). "maxT 분 안에 도달인 승강장 + 출발지" 주변만 담는다 —
 * 등시선은 최대 90분이라 그 바깥의 빈 칸을 채우는 것은 그릴 때나 조사할 때나 전부 낭비다. */
export function computeGrid(
  g: GraphModel,
  sol: Solution,
  origin: LngLat | null,
  maxT = ISO_CAP,
): IsoGrid {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (let i = 0; i < g.x.length; i += 1) if (sol.timeAt[i]! <= maxT) grow(g.x[i]!, g.y[i]!);
  if (origin) grow(...(toWorld(g, origin) as [number, number])); // 출발지 근처 직접 도보 영역
  if (!Number.isFinite(minX)) for (let i = 0; i < g.x.length; i += 1) grow(g.x[i]!, g.y[i]!);

  minX -= PAD_M;
  minY -= PAD_M;
  maxX += PAD_M;
  maxY += PAD_M;
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
  if (origin) seedAround(...(toWorld(g, origin) as [number, number]), 0);
  return { x0: minX, y0: minY, cell: GRID_CELL_M, cols, rows, times };
}

/** 분리형 가우시안 블러 (가로 패스 → 세로 패스, 가장자리는 clamp). */
function blur(src: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  const R = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * R + 1);
  let s = 0;
  for (let i = -R; i <= R; i += 1) {
    k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma));
    s += k[i + R]!;
  }
  for (let i = 0; i < k.length; i += 1) k[i] = (k[i] ?? 0) / s;

  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      let a = 0;
      for (let j = -R; j <= R; j += 1) {
        const cc = Math.min(cols - 1, Math.max(0, c + j));
        a += src[r * cols + cc]! * k[j + R]!;
      }
      tmp[r * cols + c] = a;
    }
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1) {
      let a = 0;
      for (let j = -R; j <= R; j += 1) {
        const rr = Math.min(rows - 1, Math.max(0, r + j));
        a += tmp[rr * cols + c]! * k[j + R]!;
      }
      out[r * cols + c] = a;
    }
  return out;
}

/** 닫힌 링을 코너 절단 2회로 매끈하게 (GeoJSON 링은 닫혀 있어야 한다). */
function chaikin(ring: LngLat[], iters = 2): LngLat[] {
  let pts = ring.slice(0, -1); // 닫는 점 제거
  for (let it = 0; it < iters; it += 1) {
    const nx: LngLat[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
      nx.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    pts = nx;
  }
  if (pts.length) pts.push([pts[0]![0], pts[0]![1]]);
  return pts;
}

/** 링의 신발끈 면적 (절대값, 격자 단위²). ×cell² 하면 m². */
function ringArea(ring: LngLat[]): number {
  let a = 0;
  for (let i = 1; i < ring.length - 1; i += 1) {
    const p = ring[i]!, q = ring[i + 1]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** 밴드별 등시선 (T 큰 것부터 → 작은 밴드가 위에 그려진다). props = {t, band} — fill/line/label이 같이 쓴다. */
export function contourBands(
  g: GraphModel,
  grid: IsoGrid,
  bands: number[],
  sigma: number,
): GeoFC<GeoMultiPolygon, { t: number; band: number }> {
  const { cols, rows, cell, x0, y0, times } = grid;
  const features: GeoFC<GeoMultiPolygon, { t: number; band: number }>["features"] = [];
  if (cols < 2 || rows < 2 || times.length !== cols * rows) return { type: "FeatureCollection", features };

  const f = new Float32Array(cols * rows);
  for (let i = 0; i < f.length; i += 1) {
    const t = times[i]!;
    f[i] = Number.isFinite(t) ? Math.min(t, ISO_CAP) : ISO_CAP;
  }
  const blurred = blur(f, cols, rows, sigma);
  const values = new Array<number>(cols * rows);
  for (let i = 0; i < values.length; i += 1) values[i] = ISO_CAP - blurred[i]!;

  // 한 번의 contours() 호출이 밴드 5개를 다 만든다 (임계값은 d3가 오름차순으로 다시 고른다).
  const gen = contours().size([cols, rows]).smooth(true).thresholds(bands.map((t) => ISO_CAP - t));
  // 큰 T 먼저: 임계값(= ISO_CAP − T)이 작을수록 시간이 크다.
  const want = bands.map((t, i) => ({ t, band: i })).sort((a, b) => b.t - a.t);

  for (const contour of gen(values)) {
    const spec = want.find((w) => Math.abs(ISO_CAP - w.t - contour.value) < 1e-6);
    if (!spec) continue;
    for (const poly of contour.coordinates as unknown as LngLat[][][]) {
      const [outer, ...holes] = poly;
      if (!outer || ringArea(outer) * cell * cell < ISO_MIN_ISLAND_M2) continue; // 너무 작은 섬
      const keep = [outer, ...holes.filter((h) => ringArea(h) * cell * cell >= ISO_MIN_HOLE_M2)];
      const rings = keep.map((ring) =>
        chaikin(ring).map(([X, Y]) => toLL(g, [x0 + X * cell, y0 + Y * cell] as LngLat)),
      );
      features.push({
        type: "Feature",
        // 한 feature = 한 polygon(바깥링 + 남은 구멍들). MultiPolygon 좌표는 polygon[].
        geometry: { type: "MultiPolygon", coordinates: [rings] },
        properties: { t: spec.t, band: spec.band },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
