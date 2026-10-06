/* js/map.js — Leaflet 지도/레이어: 노선 선, 히트맵 래스터, 등시선 등고선,
 * 정류장 점, 출발/도착 마커, 경로 폴리라인, 툴팁. */
"use strict";

const HIT_RADIUS = { mouse: 16, touch: 26 };   // 지도 클릭 시 역 판정 반경 (px)

/** 현재 화면에서 1 px ≈ 몇 m (단위 축소를 위한 근사) */
function metersPerPixel() {
  return (156543.0339280410 / Math.pow(2, app.map.getZoom())) *
         Math.cos((app.map.getCenter().lat * Math.PI) / 180);
}

function initMap(data, initialView) {
  const map = L.map("map", {
    center: initialView.center,
    zoom: initialView.zoom,
    minZoom: 7,
    maxZoom: 18,
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 90,
  });
  app.map = map;

  const canvasRenderer = L.canvas({ padding: 0.5 });

  // 바닥지도: OpenStreetMap 래스터 타일 (attribution 필수 표기)
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    maxNativeZoom: 19,
    crossOrigin: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  // 노선 선 (노선별 1 path = 1 polyline, canvas 렌더러)
  app.layers.lines = L.layerGroup().addTo(map);
  for (const line of data.lines) {
    for (const path of line.paths) {
      if (!path || path.length < 2) continue;
      L.polyline(path.map(([lon, lat]) => [lat, lon]), {
        color: line.color, weight: 3.5, opacity: 0.72,
        interactive: false, renderer: canvasRenderer,
      }).addTo(app.layers.lines);
    }
  }

  // 등시선 (채움 래스터 + 등고선) · 정류장 점 · 경로선
  app.layers.heat = null;
  app.layers.contours = null;
  app.layers.stops = L.layerGroup().addTo(map);
  app.layers.route = L.layerGroup().addTo(map);

  // 출발/도착 마커
  const icon = (color, size) => L.divIcon({
    className: "pt-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:100%;height:100%;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>`,
  });
  app.markers.from = L.marker([0, 0], { icon: icon("#3aa70b", 16), draggable: true, zIndexOffset: 1200, keyboard: false }).addTo(map);
  app.markers.from.on("dragend", () => {
    const ll = app.markers.from.getLatLng();
    setOrigin({ point: [ll.lng, ll.lat], label: nearestClusterName([ll.lng, ll.lat]), isPoint: true });
  });
  app.markers.to = L.marker([0, 0], { icon: icon("#111111", 14), zIndexOffset: 1100, keyboard: false });

  // 지도 클릭 → 도착지 선택 (근처 역이 있으면 그 역, 없으면 그 지점)
  map.on("click", (e) => {
    const [lon, lat] = [e.latlng.lng, e.latlng.lat];
    const hitM = HIT_RADIUS[mouseIsTouch() ? "touch" : "mouse"] * metersPerPixel();
    const near = nearestStops([lon, lat], 1, hitM);
    if (near.length) {
      const i = near[0][0];
      setDestination({ point: [STOPS[i].lon, STOPS[i].lat], label: STOPS[i].n, cluster: true });
    } else {
      setDestination({ point: [lon, lat], label: `${lon.toFixed(3)}, ${lat.toFixed(3)}`, isPoint: true });
    }
  });

  // 정류장 이름/시간 툴팁 (마우스 추적)
  const tooltip = $("tooltip");
  let tipStop = -1;
  map.on("mousemove", (e) => {
    const lonlat = [e.latlng.lng, e.latlng.lat];
    const near = nearestStops(lonlat, 1, 24 * metersPerPixel());
    const wrap = $("mapArea").getBoundingClientRect();
    if (!near.length || !app.solution || !Number.isFinite(app.solution.timeAt[near[0][0]])) {
      tooltip.hidden = true;
      tipStop = -1;
      return;
    }
    const i = near[0][0];
    const t = app.solution.timeAt[i];
    if (i !== tipStop) {
      tooltip.textContent = `${STOPS[i].n} · ${fmtTime(t)} (도보 접근 포함)`;
      tipStop = i;
    }
    tooltip.style.left = `${e.containerPoint.x}px`;
    tooltip.style.top = `${e.containerPoint.y - 8}px`;
    tooltip.hidden = false;
  });
  map.on("mouseout", () => { tooltip.hidden = true; });

  // 줌이 바뀌면 점 크기를 다시 맞춰 다시 그림 (줌이 크면 점도 함께 커지는 것 방지)
  map.on("zoomend", () => { if (app.solution) rebuildStopsLayer(); });

  // 드래그 중에는 등시선 레이어를 옅게 (원본과 같은 동작)
  map.on("dragstart", () => { if (app.layers.heat) app.layers.heat.setOpacity(0.25); });
  map.on("dragend", () => { if (app.layers.heat) app.layers.heat.setOpacity(0.55); });

  return map;
}

const mouseIsTouch = () => window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

/* ---------- 등시선 렌더 ---------- */

function rebuildHeatLayer() {
  if (app.layers.heat) {
    app.map.removeLayer(app.layers.heat);
    app.layers.heat = null;
  }
  const grid = app.grid;
  if (!grid) return;
  const canvas = getHeatCanvas();
  if (!canvas) return;
  const bounds = L.latLngBounds(
    toLL([grid.x0, grid.y0]).reverse(),           // [lat, lon] 남서쪽
    toLL([grid.x0 + grid.cols * GRID_CELL_M, grid.y0 + grid.rows * GRID_CELL_M]).reverse(),
  );
  const url = canvas.toDataURL("image/png");
  app.layers.heat = L.imageOverlay(url, bounds, { opacity: 0.55, interactive: false, className: "heat" }).addTo(app.map);
}

function rebuildContourLayers() {
  if (app.layers.contours) {
    app.map.removeLayer(app.layers.contours);
    app.layers.contours = null;
  }
  const grid = app.grid;
  if (!grid) return;
  const features = [];
  for (const threshold of app.isochrones) {
    if (threshold > app.maxMinutes + 15) continue;
    const segments = contourSegments(threshold);
    for (const seg of segments) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [toLL(seg[0]), toLL(seg[1])] },
        properties: { t: threshold },
      });
    }
  }
  app.layers.contours = L.geoJSON({ type: "FeatureCollection", features }, {
    interactive: false,
    renderer: L.svg({ padding: 0.5 }),
    style: { color: "#000", weight: 2, opacity: 0.85, fill: false, interactive: false },
  }).addTo(app.map);
}

/* ---------- 정류장 점 색상 ---------- */

function rebuildStopsLayer() {
  app.layers.stops.clearLayers();
  if (!app.solution) return;
  if (!app.layers.stopRenderer) app.layers.stopRenderer = L.canvas({ padding: 0.5 });
  const zoom = app.map.getZoom();
  const r = zoom >= 13 ? 4 : zoom >= 11 ? 3 : 2.4;          // 줌이 낮을수록 점을 작게 (밀집 시 뭉침 방지)
  const stroke = zoom >= 13 ? 0.8 : 0.45;                     // 테두리는 얇게/옅게
  for (let i = 0; i < STOPS.length; i += 1) {
    const s = STOPS[i];
    const t = app.solution.timeAt[i];
    const finite = Number.isFinite(t);
    L.circleMarker([s.lat, s.lon], {
      radius: r,
      color: "#111111",
      weight: stroke,
      opacity: finite ? 0.45 : 0.15,
      fillOpacity: finite ? 0.85 : 0.3,
      fillColor: finite ? `rgb(${paletteColor(clamp(t / app.maxMinutes, 0, 1)).join(",")})` : "#7d848b",
      interactive: false,
      renderer: app.layers.stopRenderer,
    }).addTo(app.layers.stops);
  }
}

/* ---------- 경로 선 ---------- */

function showRouteLine(route) {
  app.layers.route.clearLayers();
  if (!route || !route.steps.length) return;
  const pts = [];
  for (const step of route.steps) pts.push(...step.points);
  L.polyline(pts.map(([lon, lat]) => [lat, lon]), {
    color: "#111111", weight: 3.4, opacity: 0.85,
    interactive: false, renderer: L.svg({ padding: 0.5 }),
  }).addTo(app.layers.route);

  const latlngs = pts.map(([lon, lat]) => [lat, lon]);
  const bounds = L.latLngBounds(latlngs);
  if (route.fit !== false && bounds.isValid()) app.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
}

/** 이름과 가장 가까운 역 클러스터 라벨 (툴팁/마커용) */
function nearestClusterName(lonlat) {
  const near = nearestStops(lonlat, 1, 400);
  if (near.length) return STOPS[near[0][0]].n;
  let best = null;
  for (const c of CLUSTERS) {
    const d = dist2(toWorld(lonlat), [c.lon, c.lat]);
    if (!best || d < best.d) best = { d, n: c.n };
  }
  return best ? best.n : "현재 위치";
}
