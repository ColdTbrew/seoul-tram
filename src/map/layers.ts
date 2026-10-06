/** NAVER Maps v3 오버레이 생성기. 네이버 API 잔기술(좌표 순서/폴리곤 링 닫기 등)은
 * 이 파일과 naver.ts 안에 봉인한다. 오버레이 총량은 항상 4(등시선) + 경로 단계 수 이하. */
import { toLL } from "@/lib/graph.ts";
import { regionRects } from "@/lib/iso.ts";
import { DEFAULT_MAX } from "@/lib/constants.ts";
import { paletteColor, rgb } from "@/lib/format.ts";
import type { GraphModel, IsoGrid, LngLat, Route } from "@/lib/types.ts";

export type NaverNS = Record<string, any>;
export type NaverMap = unknown;
export type Overlay = { setMap: (m: NaverMap) => void };

/** 등시선 채움: 스캔라인 직사각형 → threshold당 Polygon 1개 (옅은 채움 + 같은 색 얇은 테두리).
 * 정의상 "시간 ≤ T 인 영역"만 덮는다 — 미도달/반경 밖 칸은 절대 포함되지 않는다 (v0 섬 버그 회귀 방지). */
export function buildIsoOverlays(nm: NaverNS, model: GraphModel, grid: IsoGrid, isos: number[]): Overlay[] {
  const out: Overlay[] = [];
  for (const t of isos) {
    if (t <= 0) continue;
    const rects = regionRects(grid, t);
    if (!rects.length) continue;
    const paths = rects.map((r) => {
      const [x, y, w, h] = r;
      const ring: LngLat[] = [
        [x!, y!],
        [x! + w!, y!],
        [x! + w!, y! + h!],
        [x!, y! + h!],
        [x!, y!],
      ].map(([px, py]) => toLL(model, [px!, py!]));
      // toLL은 [경도, 위도], naver.maps.LatLng는 (위도, 경도) — 여기서 최종 변환
      return ring.map((ll) => new nm.LatLng(ll[1], ll[0]) as never);
    });
    const color = rgb(paletteColor(Math.min(1, t / DEFAULT_MAX)));
    out.push(
      new nm.Polygon({
        paths,
        fillColor: color,
        fillOpacity: 0.24,
        strokeColor: color,
        strokeOpacity: 0.6,
        strokeWeight: 1,
        clickable: false,
        zIndex: 10,
      }) as Overlay,
    );
  }
  return out;
}

/** 경로 하이라이트: 도보 = 얇은 흑색, 승차 = 공식 노선색 굵은 선. */
export function buildRouteOverlays(nm: NaverNS, model: GraphModel, route: Route): Overlay[] {
  const out: Overlay[] = [];
  for (const step of route.steps) {
    if (step.points.length < 2) continue;
    const color = step.kind === "ride" ? model.data.lines[step.line]?.color ?? "#111111" : "#111111";
    out.push(
      new nm.Polyline({
        path: step.points.map((p) => new nm.LatLng(p[1], p[0]) as never),
        strokeColor: color,
        strokeWeight: step.kind === "ride" ? 4 : 2.5,
        strokeOpacity: step.kind === "ride" ? 0.9 : 0.55,
        strokeStyle: "solid",
        clickable: false,
        zIndex: 30,
      }) as Overlay,
    );
  }
  return out;
}

/** 출발/도착 점 표시용 HTML 마커 (색으로 구분; 출발 마커는 드래그 가능) */
export function makeDotMarker(nm: NaverNS, color: string, draggable: boolean): { setMap: (m: NaverMap) => void } & {
  setPosition(p: unknown): void;
} {
  const html =
    `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};` +
    'border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></span>';
  return new nm.Marker({
    position: new nm.LatLng(37.56, 126.98),
    icon: { content: html },
    draggable: draggable,
    clickable: true,
    zIndex: 40,
  });
}

export function clearOverlays(list: Overlay[]): void {
  for (const o of list) {
    try {
      o.setMap(null);
    } catch {
      /* 이미 제거된 오버레이는 무시 */
    }
  }
  list.length = 0;
}

export function addToMap(map: NaverMap, list: Overlay[]): void {
  for (const o of list) o.setMap(map);
}
