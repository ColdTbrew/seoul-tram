/** MapLibre 래퍼: React 트리는 이 컴포넌트에게 props만 흘려보내고, MapLibre와의 모든 명령형
 * 상호작용(스타일 재로딩·레이어 페인트·마커·히트테스트)은 이 파일과 layers.ts 안에만 있다. */
import { useEffect, useRef, useState } from "react";
import { LngLatBounds, Marker as MLMarker, Map as MLMap, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { fmtTime } from "@/lib/format.ts";
import { nearestStops, timeToPoint, toLL } from "@/lib/graph.ts";
import type { GeoFC, GeoMultiPolygon, GeoPoint, GraphModel, IsoGrid, LngLat, Route, Solution } from "@/lib/types.ts";
import { basemapUrl } from "./basemap.ts";
import { paintIso, paintLines, paintRoute, paintStops, resetCustomLayers } from "./layers.ts";
import type { Resolved } from "@/hooks/useTheme.tsx";

export type MapPick = { kind: "stop"; ll: LngLat; name: string } | { kind: "point"; ll: LngLat };

interface Props {
  model: GraphModel;
  resolved: Resolved;
  solution: Solution | null;
  grid: IsoGrid | null;
  maxMinutes: number;
  contours: GeoFC<GeoMultiPolygon, { t: number }>;
  stopsFC: GeoFC<GeoPoint, { t: number; name: string }>;
  route: Route | null;
  origin: LngLat | null;
  dest: LngLat | null;
  onPick: (pick: MapPick) => void;
  resetSignal: number;
}

/** 줌/위도 → 화면 16px 상당의 m 반경 (클릭·호버 히트 반경, v0과 같은 근사식) */
function hitRadius(zoom: number, lat: number): number {
  const mPerPx = (156543.033928041 / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180);
  return Math.max(16 * mPerPx, 120);
}

// MapLibre v6는 워커 URL을 명시해야 한다 — 지정 없으면 번들된 워커가 404(지도가 텅 빔). 파일 상단 = 생성 전 보장.
setWorkerUrl(workerUrl);

/** 감독 지정 마커 스타일: 16px 원형 — 배경 #000(다크 #fff) + 테두리 3px #fff(다크 #000) + 그림자 1px.
 * 테마 전환 시에도 이 함수로 재생성/갱신되므로 다크 매터 위에서 흰 점이 사라지는 법이 없다. */
function markerCss(dark: boolean): string {
  return `width:16px;height:16px;border-radius:50%;background:${dark ? "#ffffff" : "#000000"};border:3px solid ${dark ? "#000000" : "#ffffff"};box-shadow:0 0 0 1px rgba(0,0,0,.3);`;
}

function makeMarker(ll: LngLat, dark: boolean, draggable: boolean): MLMarker {
  const el = document.createElement("div");
  el.dataset.pt = "dot"; // 검증 스크립트용 셀렉터: [data-pt="dot"]
  el.style.cssText = markerCss(dark);
  return new MLMarker({ element: el, anchor: "center", draggable: draggable }).setLngLat(ll);
}

export function MapCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markerFromRef = useRef<MLMarker | null>(null);
  const markerToRef = useRef<MLMarker | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const repaintRef = useRef<() => void>(() => {});
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  /** 전체 레이어/마커 재페인트 — MapLibre API 호출의 유일한 진입점 (스타일 준비 완료 때만) */
  repaintRef.current = () => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || !map.isStyleLoaded()) return;

    resetCustomLayers(map);
    paintIso(map, p.contours, p.maxMinutes, p.resolved === "dark");
    paintLines(map, p.model, p.resolved === "dark");
    paintStops(map, p.stopsFC, p.maxMinutes, p.resolved === "dark");
    if (p.route) paintRoute(map, p.model, p.route, p.resolved === "dark");

    const syncMarker = (
      ref: React.MutableRefObject<MLMarker | null>,
      ll: LngLat | null,
      dark: boolean,
      draggable: boolean,
    ) => {
      if (ll) {
        if (!ref.current) {
          ref.current = makeMarker(ll, dark, draggable);
          if (draggable) {
            ref.current.on("dragend", () => {
              const m = ref.current;
              if (!m) return;
              const ll2 = m.getLngLat();
              propsRef.current.onPick({ kind: "point", ll: [ll2.lng, ll2.lat] });
            });
          }
          ref.current.addTo(map);
        } else {
          ref.current.setLngLat(ll);
          const el = ref.current.getElement();
          if (el.dataset.pt === "dot") el.style.cssText = markerCss(dark); // 테마 전환 후에도 대비 유지
        }
      } else if (ref.current) {
        ref.current.remove();
        ref.current = null;
      }
    };
    syncMarker(markerFromRef, p.origin, p.resolved === "dark", true);
    syncMarker(markerToRef, p.dest, p.resolved === "dark", false);

    if (p.route) {
      const pts = p.route.steps.flatMap((s) => s.points);
      if (pts.length >= 2) {
        const bounds = new LngLatBounds(pts[0]!, pts[0]!);
        for (const pt of pts) bounds.extend(pt);
        map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 350 });
      }
    }
  };

  // 1) 지도 생성 + 이벤트 연결 (마운트 때 한 번)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const p = propsRef.current;
    const start = p.origin ?? [p.model.data.meta.defaultFrom.lon, p.model.data.meta.defaultFrom.lat];
    const map = new MLMap({
      container: containerRef.current,
      style: basemapUrl(p.resolved, false),
      center: start,
      zoom: 11,
      minZoom: 7,
      maxZoom: 17,
      attributionControl: { compact: true }, // © OpenStreetMap contributors © CARTO (style attribution)
    });
    mapRef.current = map;
    const win = window as unknown as { __seoulMap?: MLMap };
    win.__seoulMap = map; // E2E 검증 스크립트용 훅 — 언마운트 때 지운다

    // 스타일 로딩은 비동기(테마 전환 재로딩 포함, 오프라인에선 타일 실패로 더 느려짐) —
    // 여러 지점에서 재시도 페인트: styledata 직후 + 지연 재시도. 가드 없는 페인트는 스타일 준비 전엔 skip 된다.
    const repaintSoon = () => {
      for (const d of [200, 900, 2600, 4200]) window.setTimeout(() => repaintRef.current(), d);
    };
    map.on("load", repaintSoon); // 최초 로딩 + setStyle 재로딩마다 발화

    // 스타일 재로딩 중 styledata가 뜨면: 준비 완료 시 즉시, 아직이면 1.5초 뒤 재시도 (테마 전환 타이밍 구멍 차단)
    const onStyle = () => {
      if (map.isStyleLoaded()) {
        repaintRef.current();
        return;
      }
      // 재로딩 미완료(소스 pending) 동안 200ms마다 폴링 → 준비되면 페인트하고 멈춤 (최대 ~8초).
      // 마지막 styledata가 로딩 완료 '중'에 떠도 레이어가 영구 누락되지 않는다 (간헐적 전체 미렌더 = 레이스 버그).
      let n = 0;
      const tick = () => {
        if (map.isStyleLoaded()) repaintRef.current();
        else if (++n < 40) window.setTimeout(tick, 200);
      };
      window.setTimeout(tick, 200);
    };
    map.on("styledata", onStyle);

    // 클릭/호버 히트테스트: 16px 반경 내 최단 정류장 (버킷 인덱스 기반 — queryRenderedFeatures 반경 옵션보다 정확)
    map.on("click", (e) => {
      const p = propsRef.current;
      const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const near = nearestStops(p.model, ll, 1, hitRadius(map.getZoom(), e.lngLat.lat));
      if (near.length) {
        const s = p.model.data.stops[near[0]![0]]!;
        p.onPick({ kind: "stop", ll: [s.lon, s.lat], name: s.n });
      } else {
        p.onPick({ kind: "point", ll });
      }
    });

    let lastTip = 0;
    map.on("mousemove", (e) => {
      const now = performance.now();
      if (now - lastTip < 80) return;
      lastTip = now;
      const p = propsRef.current;
      const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const near = nearestStops(p.model, ll, 1, hitRadius(map.getZoom(), e.lngLat.lat));
      const hit = near[0];
      const t = hit && p.solution ? timeToPoint(p.model, p.solution, ll) : Infinity;
      if (!hit || !Number.isFinite(t)) {
        setTooltip((prev) => (prev ? null : prev));
        map.getCanvas().style.cursor = "";
        return;
      }
      const name = p.model.data.stops[hit[0]!]!.n;
      setTooltip({ x: e.point.x, y: e.point.y, text: `${name} · ${fmtTime(t)} (도보 접근 포함)` });
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseout", () => setTooltip(null));

    // 드래그 중 등시선 옅게 (v0 동작 유지)
    const setHeatOpacity = (fill: number, line: number) => {
      if (!map.getLayer("iso-fill")) return;
      map.setPaintProperty("iso-fill", "fill-opacity", fill);
      map.setPaintProperty("iso-line", "line-opacity", line);
    };
    map.on("dragstart", () => setHeatOpacity(0.1, 0.15));
    map.on("dragend", () => {
      const dark = propsRef.current.resolved === "dark";
      setHeatOpacity(dark ? 0.36 : 0.3, dark ? 0.8 : 0.75);
    });

    return () => {
      map.off("styledata", onStyle);
      markerFromRef.current?.remove();
      markerToRef.current?.remove();
      markerFromRef.current = null;
      markerToRef.current = null;
      if (win.__seoulMap === map) delete win.__seoulMap;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2) 테마 변경 → 베이스 스타일 재로딩(positron↔dark-matter). styledata 리스너가 로딩 완료 짝에 재構築한다.
  const firstRender = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstRender.current) {
      firstRender.current = false;
      return; // 최초 생성은 현재 테마로 됐고, load 시점에 repaintSoon이 그림
    }
    map.setStyle(basemapUrl(props.resolved, false));
    const t1 = window.setTimeout(() => repaintRef.current(), 600);
    const t2 = window.setTimeout(() => repaintRef.current(), 3000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [props.resolved]);

  // 3) 데이터/설정 변경 → 전체 재페인트 (스타일 재로딩 직후 유예 재시도 포함)
  const originKey = props.origin?.join(",") ?? "";
  const destKey = props.dest?.join(",") ?? "";
  useEffect(() => {
    repaintRef.current();
    const t = window.setTimeout(() => repaintRef.current(), 700);
    return () => window.clearTimeout(t);
  }, [props.grid, props.maxMinutes, props.contours, props.stopsFC, props.route, originKey, destKey]);

  // 4) 초기화 버튼 → 전체 등시선 영역이 보이게 다시 맞춤
  useEffect(() => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || !p.grid || !map.isStyleLoaded()) return;
    const g = p.grid;
    const sw = toLL(p.model, [g.x0, g.y0]);
    const ne = toLL(p.model, [g.x0 + g.cols * g.cell, g.y0 + g.rows * g.cell]);
    map.fitBounds([sw, ne], { padding: 24, duration: 350 });
  }, [props.resetSignal]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
          style={{ left: tooltip.x + 12, top: Math.max(4, tooltip.y - 10) }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
