/** MapLibre 래퍼: React 트리는 이 컴포넌트에게 props만 흘려보내고, MapLibre와의 모든 명령형
 * 상호작용(스타일 재로딩·레이어 페인트·마커·히트테스트)은 이 파일과 layers.ts 안에만 있다.
 *
 * ⚠ 레이스 버그 (2026-07-08 실측): setStyle()/최초 로딩에서 styledata·idle가 나보다 먼저 style.load가
 * 늦게 오는 날이 있다 → styledata 한 번 + 지체 없이는 setStyle에서 style.load가 안 돌아 페인트가 영영
 * 안 돌아 레이어가 통째로 사라진다. 그래서 (1) 페인트는 style.load(메인 체인)·styledata(ready 판정 짝)·idle
 * 안전망 세 곳에서 스타일 준비 완료 때만 실행하고, 페인트 체인은 매번 커스텀 레이어를 지우고 다시 올린다
 * (addLayer 충돌·미로딩 얹기_both 차단), (2) styleReadyRef.current 로
 * '이번 스타일 페인트가 미완료'를 판정(지체 카운트 없음 — 느린 회피에서도 정확), (3) styleReadyRef.current
 * 가 false인 동안 styledata가 오면 styleReadyRef.current = false 를 복원한다. */
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

/** 감독 지정 마커 스타일: 16px 원형 — 배경 #000(다크 #fff) + 테두리 3px #fff(다크 #000) + 그림자 1px. */
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

  /** 전체 레이어/마커 재페인트 — MapLibre API 호출의 유일한 진입점.
   * 페인트 체인 하나가 모든 레이어를 통째로 다시 올리므로 마커만 따로 갱신할 필요가 없다. */
  /** 이번 스타일 페인트 '미완료' 여부 (컴포넌트 최상위 — 테마/데이터 체인과 공유). style.load 때 true.
   * 페인트가 throw 하면 false로 복원해 idle에서 재시도 (isStyleLoaded는 타일까지 기다려 가드로 쓰면 안 됨). */
  const styleReadyRef = useRef(false);

  repaintRef.current = () => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || !styleReadyRef.current) return;

    try {
      resetCustomLayers(map);
    paintIso(map, p.contours, p.maxMinutes, p.resolved === "dark");
    paintLines(map, p.model, p.resolved === "dark");
    paintStops(map, p.stopsFC, p.maxMinutes, p.resolved === "dark");
    if (p.route) paintRoute(map, p.model, p.route, p.resolved === "dark");

    const dark = p.resolved === "dark";
    const syncMarker = (
      ref: React.MutableRefObject<MLMarker | null>,
      ll: LngLat | null,
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
    syncMarker(markerFromRef, p.origin, true);
    syncMarker(markerToRef, p.dest, false);

    if (p.route) {
      const pts = p.route.steps.flatMap((s) => s.points);
      if (pts.length >= 2) {
        const bounds = new LngLatBounds(pts[0]!, pts[0]!);
        for (const pt of pts) bounds.extend(pt);
        map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 350 });
      }
      }
    } catch (e) {
      console.warn("[repaint] deferred:", e);
      styleReadyRef.current = false; // 스타일/소스 미준비 — idle 때 한 번 더 시도한다 (크래시 대신 지연)
      map.once("idle", () => {
        styleReadyRef.current = true;
        repaintRef.current();
      });
    }
  };

  // 1) 지도 생성 + 이벤트 연결 (마운트 때 한 번)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const p = propsRef.current;
    const start = p.origin ?? [p.model.data.meta.defaultFrom.lon, p.model.data.meta.defaultFrom.lat];

    let styleTimer = 0;

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

    /** 스타일 페인트 진입점(전체 재페인트). 3초 단독 1회 타이머가 뒤따라, style.load가 styledata보다
     * 늦게 오는 날에도 페인트가 살아 있다(지체 카운트 재시도는 전부 제거 — 레이스의 원인). */
    const paintNow = () => {
      repaintRef.current(); // 체인 최상단 resetCustomLayers가 이전 테마의 잔재를 항상 지운다 (addLayer 충돌 방지)
      window.clearTimeout(styleTimer);
      styleTimer = window.setTimeout(() => {
        if (mapRef.current) repaintRef.current(); // 3초 단독 1회 → 12초 무한 루프 아님
      }, 3000);
    };

    // 메인 체인: style.load = 스타일 JSON 파싱 완료 직후 — 여기서 addSource/addLayer가 안전하다
    // (타일까지 기다리는 판정은 가드로 쓰지 않는다. styledata 핸들러는 제거 — style.load가 메인).

    const onStyleLoaded = () => {
      styleReadyRef.current = true;
      paintNow();
    };

    // 안전망: 스타일 준비가 됐는데 커스텀 레이어가 하나도 없으면(레이스) idle에서 한 번 더 올린다.
    const onIdle = () => {
      if (styleReadyRef.current && !map.getLayer("stations")) repaintRef.current();
    };

    map.on("style.load", onStyleLoaded);
    map.on("idle", onIdle);

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
      window.clearTimeout(styleTimer);
      map.off("style.load", onStyleLoaded);
      map.off("idle", onIdle);
      markerFromRef.current?.remove();
      markerToRef.current?.remove();
      markerFromRef.current = null;
      markerToRef.current = null;
      if (win.__seoulMap === map) delete win.__seoulMap;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 2) 테마 변경 → 베이스 스타일 재로딩(positron↔dark-matter). diff:false 으로 완전 재로딩하면
  // 스타일 id가 바뀌어 styledata가 무조건 1회 이상 발화 → style.load가 조용히 끝나도 styledata 단독
  // 발화가 한 번은 반드시 온다. 타이머를 지우지 않는 게 핵심 — 지우면 style.load 단독 발화가 무력화된다.
  const firstRender = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstRender.current) {
      firstRender.current = false;
      return; // 최초 생성은 현재 테마로 됐고, styledata/style.load 체인이 그림
    }
    styleReadyRef.current = false; // 재로딩 '중' 표시 — style.load가 true로 되돌리고 페인트한다
    map.setStyle(basemapUrl(props.resolved, false), { diff: false });
    // 재시도 타이머 없음 — style.load(메인 체인)가 늦게 돌아도 발화하고, 그보다 idle이 먼저 오면
    // 안전망(idle 게이트)이 받는다. setStyle은 반드시 diff:false — diff:true 면 styledata 단독 발화가
    // 아예 안 일어나고 style.load 도 조용히 끝나 페인트가 영영 안 도는 레이스가 재발한다.
  }, [props.resolved]);

  // 3) 데이터/설정 변경 → 전체 재페인트 (스타일 로딩이 진행 중이면 styledata/style.load/idle 체인이 그린다)
  useEffect(() => {
    repaintRef.current();
  }, [props.grid, props.maxMinutes, props.contours, props.stopsFC, props.route, props.origin, props.dest]);

  // 4) 초기화 버튼 → 전체 등시선 영역이 보이게 다시 맞춤
  useEffect(() => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || !p.grid || !styleReadyRef.current) return;
    const g = p.grid;
    const sw = toLL(p.model, [g.x0, g.y0]);
    const ne = toLL(p.model, [g.x0 + g.cols * g.cell, g.y0 + g.rows * g.cell]);
    map.fitBounds([sw, ne], { padding: 24, duration: 350 });
  }, [props.resetSignal]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 인라인 absolute: maplibre-gl.css의 .maplibregl-map{position:relative}보다 우선 — 높이 0 방지 */}
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
