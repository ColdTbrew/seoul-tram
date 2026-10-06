/** MapLibre 래퍼: React 트리는 이 컴포넌트에게 props만 흘려보내고, MapLibre와의 모든 명령형
 * 상호작용(스타일 재로딩·레이어 페인트·마커·히트테스트)은 이 파일과 layers.ts 안에만 있다. */
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import { fmtTime } from "@/lib/format.ts";
import type { GraphModel, IsoGrid, LngLat, Route } from "@/lib/types.ts";
import { basemapUrl } from "./basemap.ts";
import { paintContours, paintHeat, paintRoute, paintStops, resetCustomLayers } from "./layers.ts";
import type { Resolved } from "@/hooks/useTheme.tsx";

export type MapPick = { kind: "stop"; ll: LngLat; name: string } | { kind: "point"; ll: LngLat };

interface Props {
  model: GraphModel;
  resolved: Resolved;
  grid: IsoGrid | null;
  maxMinutes: number;
  contours: FeatureCollection<LineString, { t: number }>;
  stopsFC: FeatureCollection<Point, { t: number; name: string }>;
  route: Route | null;
  origin: LngLat | null;
  dest: LngLat | null;
  onPick: (pick: MapPick) => void;
  resetSignal: number;
}

function makeMarker(ll: LngLat, color: string, draggable: boolean): maplibregl.Marker {
  const el = document.createElement("div");
  el.className = "size-4 shrink-0 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,.45)]";
  el.style.background = color;
  return new maplibregl.Marker({ element: el, draggable: draggable, rotationAlignment: "map" }).setLngLat(
    [ll[0], ll[1]],
  );
}

export function MapCanvas(props: Props) {
  const { model, resolved, grid, maxMinutes, contours, stopsFC, route, origin, dest, onPick, resetSignal } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerFromRef = useRef<maplibregl.Marker | null>(null);
  const markerToRef = useRef<maplibregl.Marker | null>(null);
  const styleLoadedRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [styleGen, setStyleGen] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  /** 전체 레이어/마커 재페인트 — MapLibre API 호출의 유일한 진입점 */
  const repaint = () => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || !styleLoadedRef.current || !map.isStyleLoaded()) return;

    paintHeat(map, p.model, p.grid, p.maxMinutes);
    paintContours(map, p.contours);
    paintStops(map, p.stopsFC, p.maxMinutes);
    paintRoute(map, p.route);

    const syncMarker = (
      ref: React.MutableRefObject<maplibregl.Marker | null>,
      ll: LngLat | null,
      color: string,
      draggable: boolean,
    ) => {
      if (ll) {
        if (!ref.current) {
          ref.current = makeMarker(ll, color, draggable);
          if (draggable) {
            ref.current.on("dragend", () => {
              const ll2 = ref.current!.getLngLat();
              propsRef.current.onPick({ kind: "point", ll: [ll2.lng, ll2.lat] });
            });
          }
          ref.current.setMap(map);
        } else ref.current.setLngLat([ll[0], ll[1]]);
      } else if (ref.current) {
        ref.current.remove();
        ref.current = null;
      }
    };
    syncMarker(markerFromRef, p.origin, "#3aa70b", true);
    syncMarker(markerToRef, p.dest, "#111111", false);

    if (p.route) {
      const pts = p.route.steps.flatMap((s) => s.points);
      const bounds = new maplibregl.LngLatBounds(pts[0]!, pts[pts.length - 1]!);
      for (const pt of pts) bounds.extend(pt);
      if (bounds.getBounds().length > 0) map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 350 });
    }
  };

  // 1) 지도 생성 (마운트 때 한 번)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const start = props.origin ?? [model.data.meta.defaultFrom.lon, model.data.meta.defaultFrom.lat];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemapUrl("light", false), // 즉시 갱신은 styleGen 효과에서
      center: start,
      zoom: 11,
      minZoom: 7,
      maxZoom: 17,
      attributionControl: true,
    });
    mapRef.current = map;
    styleLoadedRef.current = false;

    map.on("load", () => {
      styleLoadedRef.current = true;
      setStyleGen((v) => v + 1);
    });

    map.on("click", (e) => {
      if (!map.getLayer("pt-stops")) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["pt-stops"] });
      if (hit.length && hit[0]!.geometry?.type === "Point") {
        const c = hit[0]!.geometry.coordinates as [number, number];
        onPick({ kind: "stop", ll: [c[0], c[1]], name: (hit[0]!.properties?.name as string) ?? "이 지점" });
      } else {
        onPick({ kind: "point", ll: [e.lngLat.lng, e.lngLat.lat] });
      }
    });

    let lastTip = 0;
    map.on("mousemove", (e) => {
      const now = performance.now();
      if (now - lastTip < 80) return;
      lastTip = now;
      if (!map.getLayer("pt-stops")) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["pt-stops"] });
      const f = hit[0];
      if (!f || f.properties!.t === undefined || f.properties!.t < 0) {
        setTooltip((t) => (t ? null : t));
        return;
      }
      setTooltip({
        x: e.point.x,
        y: e.point.y,
        text: `${f.properties!.name as string} · ${fmtTime(f.properties!.t as number)} (도보 접근 포함)`,
      });
    });
    map.on("mouseout", () => setTooltip(null));

    // 드래그 중 등시선 옅게 (v0 동작 유지)
    map.on("dragstart", () => {
      if (map.getLayer("pt-heat")) map.setPaintProperty("pt-heat", "raster-opacity", 0.25);
    });
    map.on("dragend", () => {
      if (map.getLayer("pt-heat")) map.setPaintProperty("pt-heat", "raster-opacity", 0.55);
    });

    return () => {
      markerFromRef.current?.remove();
      markerToRef.current?.remove();
      markerFromRef.current = null;
      markerToRef.current = null;
      map.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 테마 변경 → 베이스 스타일 재로딩, 끝나면 styleGen으로 레이어 복원
  const styleFirst = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (styleFirst.current) {
      styleFirst.current = false;
      map.setCenter(props.origin ?? [model.data.meta.defaultFrom.lon, model.data.meta.defaultFrom.lat]);
      return;
    }
    styleLoadedRef.current = false;
    map.setStyle(basemapUrl(resolved, resolved === "dark"));
    map.once("style.load", () => {
      styleLoadedRef.current = true;
      setStyleGen((v) => v + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  // 3) 데이터/설정 변경(+스타일 재로딩 직후) → 전체 재페인트
  useEffect(() => {
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleGen, grid, maxMinutes, contours, stopsFC, route, origin, dest]);

  // 4) 초기화 버튼 → 전체 등시선 영역이 보이게 다시 맞춤
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !grid) return;
    const sw = toLLLocal(model, grid.x0, grid.y0);
    const ne = toLLLocal(model, grid.x0 + grid.cols * grid.cell, grid.y0 + grid.rows * grid.cell);
    map.fitBounds([sw, ne], { padding: 24, duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="absolute inset-0" />
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

/** grid.x0/y0는 평면 m (proj 원점 상대) → 경도/위도 */
function toLLLocal(model: GraphModel, x: number, y: number): [number, number] {
  return [model.proj.lon0 + x / model.proj.mLon, model.proj.lat0 + y / model.proj.mLat];
}
