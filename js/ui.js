/* js/ui.js — 데이터 준비, 재계산 오케스트레이션, 검색/패널/버튼/URL, 초기화. */
"use strict";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- 데이터 준비 ---------- */

function prepareData(data) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const s of data.stops) {
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
  }
  proj.lon0 = (minLon + maxLon) / 2;
  proj.lat0 = (minLat + maxLat) / 2;
  proj.mLon = 111320 * Math.cos((proj.lat0 * Math.PI) / 180);

  STOPS = data.stops.map((s) => ({ ...s, x: (s.lon - proj.lon0) * proj.mLon, y: (s.lat - proj.lat0) * proj.mLat }));

  ADJ = Array.from({ length: STOPS.length }, () => []);
  for (const [a, b, minutes, lineIdx] of data.edges) {
    ADJ[a].push([b, minutes, lineIdx]);
    ADJ[b].push([a, minutes, lineIdx]);       // 모든 간선은 양방향
  }

  LINES = data.lines;
  CLUSTERS = data.stations;
  buildBuckets();
}

/* ---------- 위치 설정 ---------- */

function setOrigin(place) {
  app.from = place;
  if (app.markers.from) app.markers.from.setLatLng([place.point[1], place.point[0]]);
  recomputeAll();
}

function setDestination(place) {
  app.to = place;
  if (app.markers.to) app.markers.to.setLatLng([place.point[1], place.point[0]]);
  recomputeAll({ solution: false, grid: false, heat: false, contours: false, stops: false, summary: false });
}

function recomputeAll(opts = {}) {
  const o = { solution: true, grid: true, heat: true, contours: true, stops: true, route: true, summary: true, ...opts };
  if (o.solution && app.from && app.solution) {
    // 출발지가 크게 바뀌면视图 다시 맞춤 (원본 동작)
    const d = dist2(toWorld(app.from.point), toWorld(app.lastOriginPoint ?? app.from.point));
    if (d > 1000) o.grid = o.stops = o.heat = o.contours = true;
  }
  if (o.solution && app.from) {
    app.lastOriginPoint = app.from.point;
    app.solution = dijkstraFrom(app.from);
    app.solutionKey = `${app.from.point[0].toFixed(5)},${app.from.point[1].toFixed(5)}`;
    if (o.grid) computeGrid(app.solution);
    if (o.heat) rebuildHeatLayer();
    if (o.contours) rebuildContourLayers();
    if (o.stops) rebuildStopsLayer();
    if (o.summary) renderSummary();
  }
  if (o.route) renderRouteDetails();
  updateUrl();
}

/* ---------- 요약 통계 ---------- */

function renderSummary() {
  const el = $("summary");
  if (!app.from || !app.solution) { el.textContent = "지도를 클릭하거나 역을 검색해 출발지를 정해 보세요."; return; }
  let reached = 0;
  let far = { t: -1, n: null };
  for (const c of CLUSTERS) {
    const t = timeToPoint(app.solution, [c.lon, c.lat]);
    if (Number.isFinite(t)) {
      if (t <= REACH) reached += 1;
      if (t > far.t) far = { t, n: c.n };
    }
  }
  const pct = Math.round((reached / CLUSTERS.length) * 100);
  el.innerHTML = `출발지 <b>${esc(app.from.label)}</b>에서 <b>${REACH}분</b> 이내 역 <b>${reached}</b>개 (전체 ${CLUSTERS.length}개 중 ${pct}%)` +
    (far.n ? ` — 가장 먼 역: <b>${esc(far.n)}</b> ${fmtTime(far.t)}` : "");
}

/* ---------- 경로 상세 ---------- */

function routeStepHtml(step) {
  if (step.kind === "walk") return `도보 ${fmtTime(step.minutes)}`;
  const line = LINES[step.line];
  return `<span class="chip"><span class="swatch" style="background:${line.color}"></span>${esc(line.name)}</span> ` +
    `${esc(STOPS[step.from].n)} 승차 → ${esc(STOPS[step.to].n)} 하차`;
}

function renderRouteDetails() {
  const el = $("routeDetails");
  if (!app.to || !app.solution || !app.from) { el.hidden = true; showRouteLine(null); return; }
  const route = routeTo(app.solution, app.from.point, app.to.point);
  el.hidden = false;
  if (!route) {
    el.innerHTML = `<p><b>${esc(app.from.label)} → ${esc(app.to.label)}</b> — 지하철로 갈 수 없습니다 (반경 ${ACCESS_RADIUS} m 안에 승강장이 없음).</p>`;
    showRouteLine(route);
    return;
  }
  const rides = route.steps.filter((s) => s.kind === "ride").length;
  el.innerHTML =
    `<p><b>${esc(app.from.label)} → ${esc(app.to.label)}</b>: 총 <b>${fmtTime(route.total)}</b>${rides > 1 ? ` · 환승 ${rides - 1}회` : ""}</p>` +
    `<div class="leg">${route.steps.map(routeStepHtml).join(" → ")}</div>`;
  showRouteLine(route);
}

/* ---------- 검색 (자동 제안) ---------- */

/** 이름 부분일치(괄호 내부 포함)로 역 후보를 찾는다 — 예: "광교" → "광교(경기대)" */
function searchStations(query, limit = 12) {
  const q = query.trim();
  if (q.length < 1) return [];
  const exact = [];
  const partial = [];
  for (const c of CLUSTERS) {
    const base = c.n.split("(")[0];
    if (c.n === q) exact.push(c);
    else if (c.n.includes(q) || q.includes(base) || base.includes(q)) partial.push(c);
    if (exact.length >= limit) break;
  }
  return [...exact, ...partial].slice(0, limit);
}

function parseCoords(text) {
  const m = text.match(/^\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,6})?)\s*$/);
  if (!m) return null;
  const [lon, lat] = [Number(m[1]), Number(m[2])];
  if (Math.abs(lat - proj.lat0) > 2 || Math.abs(lon - proj.lon0) > 2) return null;
  return [lon, lat];
}

function setupSearch(inputId, suggestId, onPick) {
  const input = $(inputId);
  const list = $(suggestId);

  const close = () => { list.hidden = true; list.textContent = ""; };

  const pick = (station) => {
    input.value = "";
    close();
    onPick({ point: [station.lon, station.lat], label: station.n, cluster: true });
  };

  const render = () => {
    const q = input.value;
    const coords = parseCoords(q);
    const candidates = coords ? [{ lon: coords[0], lat: coords[1], n: `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}` }]
                              : searchStations(q);
    list.textContent = "";
    if (!candidates.length) { close(); return; }
    for (const s of candidates) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s.n;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(s); });
      list.appendChild(b);
    }
    list.hidden = false;
  };

  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter") {
      const first = list.querySelector("button");
      if (first) { e.preventDefault(); pick(searchStations(input.value, 1)[0] ?? { point: parseCoords(input.value), label: input.value, isPoint: true }); }
    }
  });
}

/* ---------- URL 상태 ---------- */

function resolvePlace(text) {
  const coords = parseCoords(text);
  if (coords) return { point: coords, label: text, isPoint: true };
  const hits = searchStations(text, 1);
  if (hits.length) return { point: [hits[0].lon, hits[0].lat], label: hits[0].n, cluster: true };
  return null;
}

function updateUrl() {
  const p = new URLSearchParams();
  if (app.from) p.set("from", app.from.label);
  if (app.to) p.set("to", app.to.label);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

/* ---------- 범례 ---------- */

function buildLineLegend() {
  const el = $("lineLegend");
  el.innerHTML = LINES.map((l) =>
    `<span class="chip"><span class="swatch" style="background:${l.color}"></span>${esc(l.name)}</span>`).join("");
}

function setupIsoToggles() {
  const box = $("isoToggles");
  const sync = () => {
    app.isochrones = [...box.querySelectorAll("input:checked")].map((i) => Number(i.value));
    const label = $("isoLabelText");
    if (label) label.textContent = app.isochrones.length ? `${app.isochrones.join("분 / ")}분` : "없음";
    recomputeAll({ solution: false, grid: false, heat: false, stops: false, route: false, summary: false });
  };
  box.addEventListener("change", sync);
  sync();
}

/* ---------- 버튼 ---------- */

function setupButtons() {
  $("locateButton").addEventListener("click", () => {
    if (!navigator.geolocation) { $("summary").textContent = "이 브라우저는 위치 정보를 지원하지 않습니다."; return; }
    $("summary").textContent = "현재 위치를 부르는 중…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = [pos.coords.longitude, pos.coords.latitude];
        setOrigin({ point, label: nearestClusterName(point), isPoint: true });
      },
      () => { $("summary").textContent = "위치를 얻을 수 없습니다."; },
      { timeout: 6000, maximumAge: 60000, enableHighAccuracy: false },
    );
  });

  $("swapButton").addEventListener("click", () => {
    if (!app.from || !app.to) return;
    const [f, t] = [app.from, app.to];
    app.markers.from.setLatLng([t.point[1], t.point[0]]);
    app.markers.to.setLatLng([f.point[1], f.point[0]]);
    app.from = t;
    app.to = f;
    recomputeAll();
  });

  $("resetButton").addEventListener("click", () => {
    app.to = null;
    if (app.markers.to) app.markers.to.removeFrom(app.map);
    app.map.fitBounds(L.latLngBounds(STOPS.map((s) => [s.lat, s.lon])), { padding: [20, 20] });
    recomputeAll();
  });
}

/* ---------- 초기화 ---------- */

async function init() {
  try {
    const response = await fetch("./data/network.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    app.data = await response.json();
  } catch (error) {
    $("summary").textContent = `데이터를 불러오지 못했습니다 (${error.message}). build_data.py로 data/network.json을 먼저 만드세요.`;
    return;
  }

  prepareData(app.data);
  const params = new URLSearchParams(location.search);
  const view = { center: [proj.lat0, proj.lon0], zoom: 8 };
  if (params.get("from")) {
    const f = resolvePlace(params.get("from"));
    if (f) view.center = [f.point[1], f.point[0]];
  }
  if (params.get("to")) {
    const t = resolvePlace(params.get("to"));
    if (t) view.center = [(view.center[0] + t.point[1]) / 2, (view.center[1] + t.point[0]) / 2];
  }

  initMap(app.data, view);
  if (app.markers.from) { /* 마커는 setOrigin에서 위치시킴 */ }
  buildLineLegend();
  setupIsoToggles();
  setupButtons();
  setupSearch("fromSearch", "fromSuggest", (place) => setOrigin(place));
  setupSearch("toSearch", "toSuggest", (place) => setDestination(place));

  let origin = params.get("from") ? resolvePlace(params.get("from")) : null;
  if (!origin && app.data.meta?.defaultFrom) {
    const d = app.data.meta.defaultFrom;
    const near = nearestStops([d.lon, d.lat], 1, 1200);
    origin = near.length
      ? { point: [d.lon, d.lat], label: near[0][0] !== undefined ? STOPS[near[0][0]].n : "시청", isPoint: true }
      : { point: [d.lon, d.lat], label: "시청", isPoint: true };
  }
  if (origin) setOrigin(origin);

  const destParam = params.get("to");
  if (destParam) {
    const dest = resolvePlace(destParam);
    if (dest) setDestination(dest);
  }
}

window.addEventListener("error", (e) => {
  const el = $("summary");
  if (el) el.textContent = `오류가 났습니다: ${e.message}`;
});

init();
