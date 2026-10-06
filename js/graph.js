/* js/graph.js — 공통 상수/헬퍼 + 그래프 모델 + Dijkstra + 경로 복원.
 * 아이디어/모델은 « À portée de tram » (tram.camilleroux.com, MIT © Camille Roux)에서 가져왔다. */
"use strict";

/* ---------- 상수 ---------- */
const WALK_SPEED = 75;            // m/분 (직선거리 기준)
const ACCESS_RADIUS = 1200;       // 출발지/도착지에서 도보로 역을 잡는 최대 반경 (m)
const REACH = 30;                 // 요약 통계 기준 시간 (분)
const DEFAULT_MAX = 45;           // 등시선/색 상한 (분)
const GRID_CELL_M = 400;          // 등시선 격자 크기 (m)
const BUCKET_M = 800;             // 정류장 공간 인덱스 버킷 크기 (m)

const PALETTE = [
  [0, [47, 150, 18]], [0.25, [126, 200, 80]], [0.5, [226, 228, 120]],
  [0.75, [244, 182, 112]], [1, [230, 120, 120]],
];
const FAR_COLOR = [154, 160, 166];

/* ---------- 헬퍼 ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function fmtTime(m) {
  if (!Number.isFinite(m)) return "—";
  if (m < 1) return "1분 미만";
  if (m < 60) return `${Math.round(m)}분`;
  const h = Math.floor(m / 60);
  return `${h}시간 ${String(Math.round(m - h * 60)).padStart(2, "0")}분`;
}

function paletteColor(t) {
  if (t > 1) return FAR_COLOR;
  for (let i = 1; i < PALETTE.length; i += 1) {
    const [stop, color] = PALETTE[i];
    if (t <= stop) {
      const [p, prev] = PALETTE[i - 1];
      const f = (t - p) / (stop - p);
      return prev.map((c, k) => Math.round(c + (color[k] - c) * f));
    }
  }
  return FAR_COLOR;
}

/* ---------- world 좌표(m): 짧은 거리용 평면 근사 ---------- */
const proj = { lon0: 127.0, lat0: 37.4, mLat: 111320, mLon: 88500 };
const toWorld = ([lon, lat]) => [(lon - proj.lon0) * proj.mLon, (lat - proj.lat0) * proj.mLat];
const toLL = ([x, y]) => [proj.lon0 + x / proj.mLon, proj.lat0 + y / proj.mLat];

/* ---------- 전역 상태 ---------- */
const app = {
  data: null,
  map: null,
  layers: {},          // Leaflet layer 모음
  markers: {},
  from: null,          // {point:[lon,lat], label, isPoint}
  to: null,
  maxMinutes: DEFAULT_MAX,
  isochrones: [15, 30],
  solution: null,      // dijkstraFrom() 결과
  grid: null,          // {x0,y0,cell,cols,rows,times,contours,fills}
};

let STOPS = [];        // {n, lon, lat, w, s, x, y} — 승강장 단위 노드
let ADJ = [];          // ADJ[i] = [[j, 분, lineIdx|-1], …] (양방향)
let LINES = [];        // {id, name, color}
let CLUSTERS = [];     // {n, lon, lat} — 역 클러스터(라벨/셀 수)
let bucketIndex = new Map();

/* ---------- 공간 인덱스 ---------- */

function buildBuckets() {
  bucketIndex = new Map();
  for (let i = 0; i < STOPS.length; i += 1) {
    const key = `${Math.floor(STOPS[i].x / BUCKET_M)},${Math.floor(STOPS[i].y / BUCKET_M)}`;
    let list = bucketIndex.get(key);
    if (!list) { list = []; bucketIndex.set(key, list); }
    list.push(i);
  }
}

/** 반경 안의 정류장 후보: [[idx, 거리 m], …] 거리순 (버킷 스캔) */
function nearestStops(lonlat, count, radiusM) {
  const [x, y] = toWorld(lonlat);
  const bx = Math.floor(x / BUCKET_M);
  const by = Math.floor(y / BUCKET_M);
  const ring = Math.ceil((radiusM + BUCKET_M) / BUCKET_M);
  const seen = new Set();
  const found = [];
  for (let dx = -ring; dx <= ring; dx += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      const list = bucketIndex.get(`${bx + dx},${by + dy}`);
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        const d = Math.hypot(STOPS[i].x - x, STOPS[i].y - y);
        if (d <= radiusM) found.push([i, d]);
      }
    }
  }
  found.sort((a, b) => a[1] - b[1]);
  return found.slice(0, count);
}

/* ---------- 최단 시간 (대기/환승 포함) ---------- */
/*
 * 상태 = (정류장, 승차 중인 노선). slot = line+1 (0 = 보행 중).
 * 승차 간선을 "탈 때"만 그 정류장의 대기 시간(배차간격의 절반)을 더한다.
 * 같은 노선 안의 이동에는 대기를 물지 않는다 → 환승 시에만 새 대기가 붙는다.
 */
function dijkstraFrom(origin) {
  const stride = LINES.length + 1;
  const n = STOPS.length * stride;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);

  const heap = [];
  const push = (cost, state) => {
    heap.push([cost, state]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  // 출발지 주변 정류장까지 직선 도보로 시작 (도보 속도로 접근 시간 계산)
  for (const [i, d] of nearestStops(origin.point, 8, ACCESS_RADIUS)) {
    const state = i * stride;          // 보행 상태
    const cost = d / WALK_SPEED;
    if (cost < dist[state]) { dist[state] = cost; push(cost, state); }
  }

  while (heap.length) {
    const [cost, state] = pop();
    if (cost > dist[state] + 1e-9) continue;
    const i = Math.floor(state / stride);
    const line = (state % stride) - 1;
    for (const [j, minutes, line2] of ADJ[i]) {
      const toWalk = line2 === -1;
      let add = minutes;
      if (!toWalk && line !== line2) add += STOPS[i].w;   // 탑승/환승 대기
      const next = j * stride + (toWalk ? 0 : line2 + 1);
      if (cost + add < dist[next] - 1e-9) {
        dist[next] = cost + add;
        prev[next] = state;
        push(cost + add, next);
      }
    }
  }

  const timeAt = new Float64Array(STOPS.length).fill(Infinity);
  for (let i = 0; i < STOPS.length; i += 1) {
    let best = Infinity;
    const base = i * stride;
    for (let s = 0; s < stride; s += 1) if (dist[base + s] < best) best = dist[base + s];
    timeAt[i] = best;
  }
  return { dist, prev, timeAt, stride };
}

/** 임의의 점까지의 최소 총 시간 (마지막 도보 포함) */
function timeToPoint(sol, lonlat) {
  let best = Infinity;
  for (const [i, d] of nearestStops(lonlat, 6, ACCESS_RADIUS)) {
    const t = sol.timeAt[i] + d / WALK_SPEED;
    if (t < best) best = t;
  }
  return best;
}

/* ---------- 경로 복원 ---------- */

const stopLL = (i) => toLL([STOPS[i].x, STOPS[i].y]);

/** 출발지 점 → 도착지 점 경로: {total, steps:[{kind:"walk"|"ride", …}]}. 없으면 null */
function routeTo(sol, fromPoint, toPoint) {
  const stride = LINES.length + 1;
  const cands = nearestStops(toPoint, 8, ACCESS_RADIUS);
  if (!cands.length) return null;

  let best = null;
  for (const [stopIdx, d] of cands) {
    for (let line = -1; line < LINES.length; line += 1) {
      const state = stopIdx * stride + (line + 1);
      const total = sol.dist[state] + d / WALK_SPEED;
      if (!best || total < best.total) best = { total, state };
    }
  }
  if (!best || !Number.isFinite(best.total)) return null;

  const chain = [];
  for (let s = best.state; s !== -1; s = sol.prev[s]) chain.push(s);
  chain.reverse();
  if (chain.length < 2) return null;

  const steps = [];
  const firstLL = stopLL(Math.floor(chain[0] / stride));
  const entryWalk = dist2(fromPoint, firstLL) / WALK_SPEED;
  if (entryWalk > 0.02) steps.push({ kind: "walk", points: [fromPoint, firstLL], minutes: entryWalk });

  for (let k = 1; k < chain.length; k += 1) {
    const a = chain[k - 1];
    const b = chain[k];
    const ia = Math.floor(a / stride);
    const ib = Math.floor(b / stride);
    const lineB = (b % stride) - 1;
    const edge = ADJ[ia].find((e) => e[0] === ib && e[2] === lineB);
    if (!edge) continue;
    const minutes = edge[1];
    if (lineB === -1) {
      steps.push({ kind: "walk", points: [stopLL(ia), stopLL(ib)], minutes: minutes });
    } else {
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.kind === "ride" && lastStep.line === lineB) {
        lastStep.to = ib;
        lastStep.minutes += minutes;
        lastStep.points.push(stopLL(ib));
      } else {
        steps.push({ kind: "ride", line: lineB, from: ia, to: ib, minutes: minutes,
                     points: [stopLL(ia), stopLL(ib)] });
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
