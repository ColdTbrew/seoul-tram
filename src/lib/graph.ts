/** 그래프 모델 + (정류장, 승차 노선) 상태 Dijkstra + 경로 복원.
 * 아이디어/모델은 « À portée de tram » (tram.camilleroux.com, MIT © Camille Roux)에서 가져왔다.
 * v0-static의 js/graph.js를 순수 함수로 포팅 (전역 상태 금지 — 인자로만 주고받는다). */
import { ACCESS_RADIUS, BUCKET_M, WALK_SPEED } from "./constants.ts";
import { dist2 } from "./format.ts";
import type { AdjEdge, GraphModel, LngLat, NetworkData, Route, RouteStep, Solution } from "./types.ts";
/* ---------- 좌표/인덱스 ---------- */

/** 짧은 거리용 평면 근사 (m). 지도 중심을 원점으로. */
export function prepareNetwork(data: NetworkData): GraphModel {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const s of data.stops) {
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
  }
  const lon0 = (minLon + maxLon) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const proj = { lon0, lat0, mLat: 111320, mLon: 111320 * Math.cos((lat0 * Math.PI) / 180) };

  const x = new Float64Array(data.stops.length);
  const y = new Float64Array(data.stops.length);
  for (let i = 0; i < data.stops.length; i += 1) {
    x[i] = (data.stops[i]!.lon - lon0) * proj.mLon;
    y[i] = (data.stops[i]!.lat - lat0) * proj.mLat;
  }

  const adj: AdjEdge[][] = Array.from({ length: data.stops.length }, () => [] as AdjEdge[]);
  for (const [a, b, minutes, lineIdx] of data.edges) {
    adj[a]!.push([b, minutes, lineIdx]);
    adj[b]!.push([a, minutes, lineIdx]); // 모든 간선은 양방향
  }

  const bucket = new Map<string, number[]>();
  for (let i = 0; i < data.stops.length; i += 1) {
    const key = `${Math.floor(x[i]! / BUCKET_M)},${Math.floor(y[i]! / BUCKET_M)}`;
    let list = bucket.get(key);
    if (!list) { list = []; bucket.set(key, list); }
    list.push(i);
  }

  return { data, stride: data.lines.length + 1, adj, x, y, bucket, proj };
}

export const toWorld = (g: GraphModel, [lon, lat]: LngLat): LngLat => [
  (lon - g.proj.lon0) * g.proj.mLon,
  (lat - g.proj.lat0) * g.proj.mLat,
];

export const toLL = (g: GraphModel, [x, y]: LngLat): LngLat => [
  g.proj.lon0 + x / g.proj.mLon,
  g.proj.lat0 + y / g.proj.mLat,
];

/** 반경 안의 정류장 후보: [[인덱스, 거리 m], …] 거리순. 버킷 스캔으로 좁힌다. */
export function nearestStops(
  g: GraphModel,
  lonlat: LngLat,
  count: number,
  radiusM: number,
): Array<[number, number]> {
  const [x, y] = toWorld(g, lonlat);
  const bx = Math.floor(x / BUCKET_M);
  const by = Math.floor(y / BUCKET_M);
  const ring = Math.ceil((radiusM + BUCKET_M) / BUCKET_M);
  const seen = new Set<number>();
  const found: Array<[number, number]> = [];
  for (let dx = -ring; dx <= ring; dx += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      const list = g.bucket.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        const d = Math.hypot(g.x[i]! - x, g.y[i]! - y);
        if (d <= radiusM) found.push([i, d]);
      }
    }
  }
  found.sort((a, b) => a[1] - b[1]);
  return found.slice(0, count);
}

/* ---------- 최단 시간 (대기/환승 포함) ---------- */
/* 상태 = (정류장, 승차 중인 노선). slot = line+1 (0 = 보행 중).
 * 승차 간선은 "탈 때"만 그 정류장의 대기 시간(배차간격의 절반)을 더한다 —
 * 같은 노선 안의 이동에는 대기를 물지 않으므로 환승 시에만 새 대기가 붙는다. */

function heapPush(heap: Array<[number, number]>, cost: number, state: number): void {
  heap.push([cost, state]);
  let c = heap.length - 1;
  while (c > 0) {
    const p = (c - 1) >> 1;
    if (heap[p]![0] <= heap[c]![0]) break;
    [heap[p], heap[c]] = [heap[c], heap[p]];
    c = p;
  }
}

function heapPop(heap: Array<[number, number]>): [number, number] {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let m = k;
      if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
      if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
      if (m === k) break;
      [heap[m], heap[k]] = [heap[k], heap[m]];
      k = m;
    }
  }
  return top;
}

export function dijkstraFrom(g: GraphModel, origin: LngLat): Solution {
  const { stride, data } = g;
  const n = data.stops.length * stride;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap: Array<[number, number]> = [];

  // 출발지 주변 정류장까지 직선 도보로 시작 (도보 속도로 접근 시간 계산)
  for (const [i, d] of nearestStops(g, origin, 8, ACCESS_RADIUS)) {
    const state = i * stride; // 보행 상태
    const cost = d / WALK_SPEED;
    if (cost < dist[state]!) {
      dist[state] = cost;
      heapPush(heap, cost, state);
    }
  }

  while (heap.length) {
    const [cost, state] = heapPop(heap);
    if (cost > dist[state]! + 1e-9) continue;
    const i = Math.floor(state / stride);
    const line = (state % stride) - 1;
    for (const [j, minutes, line2] of g.adj[i]!) {
      const toWalk = line2 === -1;
      let add = minutes;
      if (!toWalk && line !== line2) add += data.stops[i]!.w; // 탑승/환승 대기
      const next = j * stride + (toWalk ? 0 : line2 + 1);
      if (cost + add < dist[next]! - 1e-9) {
        dist[next] = cost + add;
        prev[next] = state;
        heapPush(heap, cost + add, next);
      }
    }
  }

  const timeAt = new Float64Array(data.stops.length).fill(Infinity);
  for (let i = 0; i < data.stops.length; i += 1) {
    let best = Infinity;
    const base = i * stride;
    for (let s = 0; s < stride; s += 1) if (dist[base + s]! < best) best = dist[base + s]!;
    timeAt[i] = best;
  }
  return { dist, prev, timeAt, stride };
}

/** 임의의 점까지의 최소 총 시간 (마지막 도보 포함). 도달 불가면 Infinity. */
export function timeToPoint(g: GraphModel, sol: Solution, lonlat: LngLat): number {
  let best = Infinity;
  for (const [i, d] of nearestStops(g, lonlat, 6, ACCESS_RADIUS)) {
    const t = sol.timeAt[i]! + d / WALK_SPEED;
    if (t < best) best = t;
  }
  return best;
}

/* ---------- 경로 복원 ---------- */

/** 출발지 점 → 도착지 점 경로. 경로가 없으면 null. */
export function routeTo(
  g: GraphModel,
  sol: Solution,
  fromPoint: LngLat,
  toPoint: LngLat,
): Route | null {
  const { stride, data } = g;
  const stopLL = (i: number): LngLat => toLL(g, [g.x[i]!, g.y[i]!]);

  const cands = nearestStops(g, toPoint, 8, ACCESS_RADIUS);
  if (!cands.length) return null;

  let best: { total: number; state: number } | null = null;
  for (const [stopIdx, d] of cands) {
    for (let line = -1; line < data.lines.length; line += 1) {
      const state = stopIdx * stride + (line + 1);
      const total = sol.dist[state]! + d / WALK_SPEED;
      if (!best || total < best.total) best = { total, state };
    }
  }
  if (!best || !Number.isFinite(best.total)) return null;

  const chain: number[] = [];
  for (let s = best.state; s !== -1; s = sol.prev[s]!) chain.push(s);
  chain.reverse();
  if (chain.length < 2) return null;

  const steps: RouteStep[] = [];
  const firstLL = stopLL(Math.floor(chain[0]! / stride));
  const entryWalk = dist2(fromPoint, firstLL) / WALK_SPEED;
  if (entryWalk > 0.02) {
    steps.push({ kind: "walk", points: [fromPoint, firstLL], minutes: entryWalk });
  }

  for (let k = 1; k < chain.length; k += 1) {
    const a = chain[k - 1]!;
    const b = chain[k]!;
    const ia = Math.floor(a / stride);
    const ib = Math.floor(b / stride);
    const lineB = (b % stride) - 1;
    const edge = g.adj[ia]!.find((e) => e[0] === ib && e[2] === lineB);
    if (!edge) continue;
    const minutes = edge[1]!;
    if (lineB === -1) {
      steps.push({ kind: "walk", points: [stopLL(ia), stopLL(ib)], minutes });
    } else {
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.kind === "ride" && lastStep.line === lineB) {
        lastStep.to = ib;
        lastStep.minutes += minutes;
        lastStep.points.push(stopLL(ib));
      } else {
        steps.push({ kind: "ride", line: lineB, from: ia, to: ib, minutes, points: [stopLL(ia), stopLL(ib)] });
      }
    }
  }

  const last = steps[steps.length - 1];
  if (last && last.kind === "ride") {
    const endLL = stopLL(last.to);
    const d = dist2(endLL, toPoint);
    if (d > 0.02) steps.push({ kind: "walk", points: [endLL, toPoint], minutes: d / WALK_SPEED });
  }
  return { total: best.total, steps };
}
