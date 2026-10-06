/** 링 생성 프로브 (유닛 테스트 대체 — 감독 지시). 실행: node scripts/probe-rings.ts
 * 1) 합성 필드: 셀 (50,50) 중심에서 t=0, 반경 2250 m까지 선형 증가하는 원형 필드 → T=30 등시선은 반지름 2250 m 원.
 *    링 bbox 중심이 격자단위 ≈(50.5, 50.5)이고 반지름 ≈2250 m면 배치를 올바르게 통과.
 * 2) 실제 network.json + 시청 출발: T=15/30/45/60 폴리곤/링 개수·꼭짓점 수·첫 좌표 (경도↔위도 스왑 감지). */
import { readFileSync } from "node:fs";
import { computeGrid, contourRings } from "../src/lib/iso.ts";
import { prepareNetwork, dijkstraFrom } from "../src/lib/graph.ts";

const CELL = 250;
const proj = { lon0: 126.97, lat0: 37.55, mLat: 111320, mLon: 111320 * Math.cos((37.55 * Math.PI) / 180) };
const dummy = { data: { stops: [], lines: [] }, stride: 1, adj: [], x: new Float64Array(0), y: new Float64Array(0), bucket: new Map(), proj };

const GX = (p) => ((p[0] - proj.lon0) * proj.mLon - GX.x0) / CELL; // toLL의 정확한 역변환 (격자 단위 X)
const GY = (p) => ((p[1] - proj.lat0) * proj.mLat - GX.y0) / CELL;

/* ---- 1) 합성 필드 ---- */
const cols = 100, rows = 100, x0 = -12500, y0 = -12500;
GX.x0 = x0; GX.y0 = y0;
const times = new Float32Array(cols * rows).fill(Infinity);
const cxm = 50.5 * CELL, cym = 50.5 * CELL; // 셀 (50,50)의 "중심" (격자 m)
for (let r = 0; r < rows; r += 1)
  for (let c = 0; c < cols; c += 1) {
    const d = Math.hypot((c + 0.5) * CELL - cxm, (r + 0.5) * CELL - cym);
    if (d <= 2250) times[r * cols + c] = d / 75;
  }
const grid = { x0, y0, cell: CELL, cols, rows, times };
console.log("[synthetic] r=2250 m 원형 필드, T=30 → 통과 기준: bbox 중심 ≈ (50.5, 50.5), r ≈ 2250 m");
for (const poly of contourRings(dummy, grid, 30)) {
  for (const ring of poly) {
    const gx0 = Math.min(...ring.map(GX));
    const gx1 = Math.max(...ring.map(GX));
    const gy0 = Math.min(...ring.map(GY));
    const gy1 = Math.max(...ring.map(GY));
    const cx = (gx0 + gx1) / 2;
    const cy = (gy0 + gy1) / 2;
    const rmax = Math.max(...ring.map((p) => Math.hypot(GX(p) - cx, GY(p) - cy))) * CELL;
    const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
    console.log(`  ring: pts=${ring.length} closed=${closed} bbox중심=(${cx.toFixed(2)}, ${cy.toFixed(2)}) r≈${rmax.toFixed(0)} m`);
  }
}

/* ---- 2) 실제 데이터 (시청 출발) ---- */
const data = JSON.parse(readFileSync(new URL("../public/data/network.json", import.meta.url), "utf8"));
const model = prepareNetwork(data);
const o = data.meta.defaultFrom;
const sol = dijkstraFrom(model, [o.lon, o.lat]);
const grid2 = computeGrid(model, sol, [o.lon, o.lat]);
const finite = Array.from(grid2.times).filter((v) => Number.isFinite(v)).length;
console.log(`\n[real] 시청 출발 finite cells = ${finite}/${grid2.times.length}`);
for (const T of [15, 30, 45, 60]) {
  const t0 = performance.now();
  const polys = contourRings(model, grid2, T);
  const ms = performance.now() - t0;
  const rings = polys.flat();
  const pts = rings.reduce((n, r) => n + r.length, 0);
  const closed = rings.filter((r) => r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]).length;
  const first = rings[0]?.[0];
  const inBox = rings.filter((r) => {
    const c = r[0];
    return c[0] > 126.2 && c[0] < 127.6 && c[1] > 37.2 && c[1] < 38.0;
  }).length;
  console.log(
    `T=${T}: polys=${polys.length} rings=${rings.length} pts=${pts} closed=${closed}/${rings.length} ` +
      `first=[${first ? first.map((v) => v.toFixed(4)).join(", ") : "n/a"}] bbox범위내링=${inBox} (${ms.toFixed(0)} ms)`,
  );
}
