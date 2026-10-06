/* js/iso.js — 등시선: 400 m 격자 시간 필드 + 등고선 추출 + 히트맵 래스터.
 * 격자/등고선 발상은 원본 사이트(tram.camilleroux.com, MIT)의 방식을 단순화해 옮긴 것. */
"use strict";

/**
 * grid = 정류장 주변에서 유한 시간인 칸만 저장하는 희소 맵(Map).
 * key = r * cols + c, value = 그 칸 중심까지의 최소 시간(분).
 * 정류장 → 칸 "뿌리기" 방식이라 행렬 전체 검색보다 빠르고 메모리가 작다.
 */
function computeGrid(sol) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of STOPS) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x > maxX) maxX = s.x;
    if (s.y > maxY) maxY = s.y;
  }
  const pad = 3000;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const cols = Math.ceil((maxX - minX) / GRID_CELL_M);
  const rows = Math.ceil((maxY - minY) / GRID_CELL_M);

  // 1) 정류장 반경까지 시간 뿌리기 (칸당 검색 대신 정류장당 주변 칸만)
  const times = new Map();
  const reach = ACCESS_RADIUS + GRID_CELL_M * 1.5;
  const step = Math.ceil(reach / GRID_CELL_M);
  const setCell = (r, c, v) => {
    const k = r * cols + c;
    if (!times.has(k) || times.get(k) > v) times.set(k, v);
  };
  for (let i = 0; i < STOPS.length; i += 1) {
    const t0 = sol.timeAt[i];
    if (!Number.isFinite(t0)) continue;
    const c0 = Math.floor((STOPS[i].x - minX) / GRID_CELL_M);
    const r0 = Math.floor((STOPS[i].y - minY) / GRID_CELL_M);
    for (let r = r0 - step; r <= r0 + step; r += 1) {
      if (r < 0 || r >= rows) continue;
      for (let c = c0 - step; c <= c0 + step; c += 1) {
        if (c < 0 || c >= cols) continue;
        const d = Math.hypot((c + 0.5) * GRID_CELL_M - (STOPS[i].x - minX),
                             (r + 0.5) * GRID_CELL_M - (STOPS[i].y - minY));
        if (d <= reach) setCell(r, c, t0 + d / WALK_SPEED);
      }
    }
  }

  // 2) 등시선이 계단 모양으로 보이지 않게 한 번 평활화 (주변 유한 값 평균)
  const copy = new Map(times);
  for (const [k] of times) {
    const r = Math.floor(k / cols);
    const c = k % cols;
    let sum = 0;
    let count = 0;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const v = copy.get((r + dr) * cols + (c + dc));
        if (v !== undefined) { sum += v; count += 1; }
      }
    }
    if (count >= 5) setCell(r, c, sum / count);
  }

  app.grid = { x0: minX, y0: minY, cell: GRID_CELL_M, cols, rows, times: times, contours: null };
}

/**
 * grid에서 threshold 이하 영역의 경계 세그먼트를 뽑는다 (단순 marching squares).
 * 각 사각형에서 4 모서리 값이 threshold 안/밖으로 갈리는 변을 찾아 교차점을 잇는다.
 */
function contourSegments(threshold) {
  const { cols, rows, cell, x0, y0, times } = app.grid;
  const cellValue = (r, c) => {
    const v = times.get(r * cols + c);
    return v === undefined ? Infinity : v;
  };
  const between = (p1, v1, p2, v2) => {
    if (Number.isFinite(v1) === Number.isFinite(v2)) return null;
    const inVal = Number.isFinite(v1) ? v1 : v2;
    const outVal = Number.isFinite(v1) ? v2 : v1;
    let t = clamp((threshold - inVal) / (outVal - inVal), 0, 1);
    if (!Number.isFinite(t)) t = 0.5;
    const pOut = Number.isFinite(v1) ? p2 : p1;
    const pIn = Number.isFinite(v1) ? p1 : p2;
    return [pIn[0] + (pOut[0] - pIn[0]) * t, pIn[1] + (pOut[1] - pIn[1]) * t];
  };

  const segments = [];
  for (let r = 0; r < rows - 1; r += 1) {
    const y1 = y0 + (r + 1) * cell;
    for (let c = 0; c < cols - 1; c += 1) {
      const x1 = x0 + (c + 1) * cell;
      // 사각형 4모서리: (r,c) (r,c+1) (r+1,c+1) (r+1,c) — 변의 안/밖 짝을 본다
      const vTL = cellValue(r, c);
      const vTR = cellValue(r, c + 1);
      const vBR = cellValue(r + 1, c + 1);
      const vBL = cellValue(r + 1, c);
      const pTL = [x0 + c * cell, y0 + r * cell];
      const pTR = [x1, y0 + r * cell];
      const pBR = [x1, y1];
      const pBL = [x0 + c * cell, y1];
      const edges = [[pTL, vTL, pTR, vTR], [pTR, vTR, pBR, vBR], [pBR, vBR, pBL, vBL], [pBL, vBL, pTL, vTL]];
      const pts = [];
      for (const [p1, v1, p2, v2] of edges) {
        const p = between(p1, v1, p2, v2);
        if (p) pts.push(p);
      }
      if (pts.length === 2) segments.push([pts[0], pts[1]]);
      else if (pts.length === 4) segments.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  }
  return segments;
}

/* ---------- 히트맵 래스터 (시간 필드를 canvas로 직접 렌더) ---------- */

const heatCache = { canvas: null, key: "" };

/** 시간 필드를 OFF×OFF px 래스터로 굽힌다(캐시). 1 px = GRID_CELL_M m. */
function getHeatCanvas() {
  const grid = app.grid;
  if (!grid) return null;
  const key = `${app.solutionKey ?? ""}|${app.maxMinutes}|${grid.cols}x${grid.rows}`;
  if (heatCache.canvas && heatCache.key === key) return heatCache.canvas;

  const { cols, rows, times } = grid;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cols, rows);
  const data = img.data;
  const max = app.maxMinutes;
  for (let i = 0; i < data.length; i += 4) {
    const t = times.get(i >> 2);
    if (t === undefined) continue;
    const color = t > max ? FAR_COLOR : paletteColor(t / max);
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = t > max ? 60 : 165;   // max 초과 지역은 옅은 회색
  }
  ctx.putImageData(img, 0, 0);
  heatCache.canvas = canvas;
  heatCache.key = key;
  return canvas;
}
