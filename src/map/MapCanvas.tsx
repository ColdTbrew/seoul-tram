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
import { LngLatBounds, Marker as MLMarker, Map as MLMap, setWorkerUrl, type MapMovementEvent } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { fmtTime } from "@/lib/format.ts";
import { nearestStops, timeToPoint, toLL } from "@/lib/graph.ts";
import type { GeoFC, GeoMultiPolygon, GeoPoint, GraphModel, IsoGrid, LngLat, Route, Solution } from "@/lib/types.ts";
import { basemapUrl } from "./basemap.ts";
import { paintIso, paintLines, paintRoute, paintStops, resetCustomLayers, isoFillOpacity, isoLineOpacity } from "./layers.ts";
import type { Resolved } from "@/hooks/useTheme.tsx";

export type MapPick = { kind: "stop"; ll: LngLat; name: string } | { kind: "point"; ll: LngLat };

interface Props {
  model: GraphModel;
  resolved: Resolved;
  solution: Solution | null;
  grid: IsoGrid | null;
  /** 강조 중인 밴드 (분). 등시선 5개는 항상 다 그려지고, 이 밴드만 윤곽/라벨로 강조한다. */
  focus: number;
  contours: GeoFC<GeoMultiPolygon, { t: number; band: number }>;
  stopsFC: GeoFC<GeoPoint, { t: number; name: string }>;
  route: Route | null;
  origin: LngLat | null;
  dest: LngLat | null;
  onPick: (pick: MapPick) => void;
  resetSignal: number;
  /** 사용자가 지도를 직접 움직였을 때(드래그/핀치/휠 줌/회전). 프로그램적 이동을 originalEvent 유무로 가린다. */
  onUserMove?: () => void;
  /** 열려 있는 패널이 가리는 픽셀 폭 (left = 데스크톱 패널, bottom = 모바일 시트) — 중심을 그만큼 밀어내는 데 쓴다. */
  padding?: { left: number; bottom: number };
}

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
    paintIso(map, p.contours, p.focus, p.resolved === "dark");
    paintLines(map, p.model, p.resolved === "dark");
    paintStops(map, p.stopsFC, p.resolved === "dark");
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
        // 여백은 "패널을 뺀 남은 영역"의 18% (최소 32px) — maxZoom은 한 단계 덜 확대.
        const c = map.getContainer();
        const pp = p.padding ?? { left: 0, bottom: 0 }; // 패널이 가리는 몫 (이미 map padding으로 걸려 있음)
        const freeW = Math.max(1, c.clientWidth - pp.left);
        const freeH = Math.max(1, c.clientHeight - pp.bottom);
        const padX = Math.max(32, Math.round(freeW * 0.18));
        const padY = Math.max(32, Math.round(freeH * 0.18));
        map.fitBounds(bounds, {
          padding: { top: padY, bottom: padY, left: padX, right: padX },
          maxZoom: 14,
          duration: 350,
        });
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
      setTooltip({ x: e.point.x, y: e.point.y, text: `${name} · ${fmtTime(t)} (도보 포함)` });
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseout", () => setTooltip(null));

    // 드래그 중 등시선 옅게 (v0 동작 유지) — 밴드별 match 식을 그대로 절반으로 줄인다 (숫자로 바꾸면 램프가 사라진다)
    const setIsoOpacity = (dim: boolean) => {
      if (!map.getLayer("iso-fill")) return;
      const dark = propsRef.current.resolved === "dark";
      map.setPaintProperty("iso-fill", "fill-opacity", isoFillOpacity(dark, dim));
      map.setPaintProperty("iso-line", "line-opacity", isoLineOpacity(dark, dim));
    };
    map.on("dragstart", () => setIsoOpacity(true));
    map.on("dragend", () => setIsoOpacity(false));

    // 사용자 조작과 프로그램적 이동을 originalEvent 유무로 가린다 (fitBounds/flyTo 는 originalEvent 없음).
    // 접히기 전의 뷰 조작과 달리 프로그램적 맞춤(경로 fitBounds·초기화)은 패널을 닫지 않는다.
    const onMoveStart = (e: MapMovementEvent) => {
      if (e.originalEvent) propsRef.current.onUserMove?.();
    };
    map.on("movestart", onMoveStart);
    map.on("zoomstart", onMoveStart);
    map.on("rotatestart", onMoveStart);

    return () => {
      window.clearTimeout(styleTimer);
      map.off("style.load", onStyleLoaded);
      map.off("idle", onIdle);
      map.off("movestart", onMoveStart);
      map.off("zoomstart", onMoveStart);
      map.off("rotatestart", onMoveStart);
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
  }, [props.grid, props.focus, props.contours, props.stopsFC, props.route, props.origin, props.dest]);

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

  // 5) 열려 있는 패널(데스크톱 왼쪽/모바일 아래)이 가리는 폭만큼 중심을 밀어낸다 — 키가 문자열이라
  // 페인트 체인(style.load/idle)과는 독립적으로 돌고, 키가 안 바뀌면 재발화하지 않는다.
  const paddingKey = props.padding ? `${props.padding.left},${props.padding.bottom}` : "";
  useEffect(() => {
    const map = mapRef.current;
    const p = propsRef.current.padding;
    if (!map || !p) return;
    map.easeTo({ padding: { top: 0, right: 0, left: p.left, bottom: p.bottom }, duration: 300 });
  }, [paddingKey]);

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
