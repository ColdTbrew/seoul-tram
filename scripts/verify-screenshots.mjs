/** E2E 시각 검증 (유닛 테스트 대체 — 감독 지시). 사용:
 *   (터미널A) npx vite preview --port 4173   (터미널B) node scripts/verify-screenshots.mjs
 *   다른 base:  VERIFY_BASE=http://localhost:4173/seoul-tram/ node scripts/verify-screenshots.mjs
 * 슷마다 검사: canvas + 속성문구 + (스크립트용) 커스텀 레이어 4종 존재/iso 피처 좌표범위(경도↔위도 스왑 감지)
 *   + queryRenderedFeatures 수 + 마커 수. 다크 슷은 setStyle 재로딩 후 재-check까지 해서 테마 전환 구멍을 잡는다.
 * 요구: npm i --no-save puppeteer-core, 시스템 Chrome, SwiftShader WebGL. */
import { mkdirSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:4173/seoul-tram/";
const OUT = process.env.VERIFY_OUT ?? "/tmp/shots";
const CHROME = process.env.CHROME_BIN ?? "/usr/bin/google-chrome-stable";
const STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
mkdirSync(OUT, { recursive: true });

const enc = (s) => encodeURIComponent(s);

/** [id, URL, 폭, 높이, DPR, 테마(localStorage "seoul-tram-theme"), 기대 마커 수, 설명] */
const SHOTS = [
  ["01-light-default", BASE, 1440, 900, 1, null, 1, "데스크톱 라이트 — 시청 출발 기본 뷰 (T30 전체)"],
  ["02-light-route", `${BASE}?from=${enc("시청")}&to=${enc("강남")}`, 1440, 900, 1, null, 2, "라이트 — 시청→강남 경로"],
  ["03-dark-default", BASE, 1440, 900, 1, "dark", 1, "다크 — dark-matter 전환 후 재-check 포함"],
  ["04-dark-route", `${BASE}?from=${enc("시청")}&to=${enc("인천국제공항2")}`, 1440, 900, 1, "dark", 2, "다크 — 장거리 공항공항선 경로"],
  ["05-mobile-light", `${BASE}?from=${enc("시청")}&to=${enc("강남")}`, 390, 844, 2, null, 2, "모바일 — 풀블리드 + 부상 검색 카드"],
];

/** 페이지 안에서 도는 진단 함수 — 레이어/피처/qrf/마커 수치를 한 번에 모은다.
 * 주의: v6에서 geojson 소스의 _data/getData()는 신뢰측정이 아니다(렌더되도 비어보일 수 있음) —
 *피처 존재는 querySourceFeatures(소스 전체 + viewport bbox 두 방식)와 queryRenderedFeatures(viewport)로 이중 측정한다. */
const DIAG_FN = () => {
  const map = window.__seoulMap;
  if (!map) return { error: "window.__seoulMap 없음 (expose 실패)" };
  const ids = map.getStyle().layers.map((l) => l.id);
  const want = ["iso-fill", "iso-line", "lines", "stations"];
  const present = {};
  for (const id of want) present[id] = ids.includes(id);
  const qsf = (layerId) => {
    try {
      const s = map.getLayer(layerId);
      if (!s) return -2;
      return map.querySourceFeatures(s.source, { limit: 8000 }).length;
    } catch (e) {
      return -1; // 소스 전체 쿼리 미지원/오류
    }
  };
  const qv = (layerId) => {
    try {
      return map.queryRenderedFeatures({ layers: [layerId] }).length;
    } catch (e) {
      return -1;
    }
  };
  const qb = (layerId) => {
    try {
      return map.queryRenderedFeatures(map.getBounds(), { layers: [layerId] }).length;
    } catch (e) {
      return -1;
    }
  };
  let coords = [];
  try {
    const src = map.getSource("iso");
    const d = src ? (src._data ?? src.getData?.()) : null;
    if (d && d.features) for (const f of d.features) for (const poly of f.geometry.coordinates) for (const ring of poly) if (coords.length < 40) coords.push(ring[0]);
  } catch {
    /* noop */
  }
  const bad = coords.filter((c) => !(c[0] > 126.2 && c[0] < 127.6 && c[1] > 37.2 && c[1] < 38.0)).length;
  return {
    present,
    layerCoordsSampled: coords.length,
    coordsOutOfWorkd: bad,
    qsf: { iso: qsf("iso-fill"), lines: qsf("lines"), stations: qsf("stations") },
    qrf: { isoFill: qv("iso-fill"), isoLine: qv("iso-line"), lines: qv("lines"), stations: qv("stations") },
    qb: { isoFill: qb("iso-fill"), lines: qb("lines"), stations: qb("stations") },
    markers: document.querySelectorAll('[data-pt="dot"]').length,
    zoom: Number(map.getZoom().toFixed(2)),
  };
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--hide-scrollbars",
  ],
});

let fail = 0;
for (const [id, url, w, h, dpr, theme, wantMarkers, desc] of SHOTS) {
  const ctx = await browser.createBrowserContext(); // 컨텍스트 격리 (테마 localStorage 오염 방지)
  const page = await ctx.newPage();
  const issues = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") issues.push(`${m.type()}: ${m.text().slice(0, 140)}`);
  });
  page.on("pageerror", (e) => issues.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  page.on("requestfailed", (r) => {
    const u = String(r.url());
    if (!u.includes("cartocdn.com")) issues.push(`reqfail: ${u.slice(0, 110)}`); // 실행환경이 외부 타일망단절이면 환경문제(코드결함 아님)
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) issues.push(`res${r.status()}: ${r.url().slice(0, 110)}`);
  });

  if (theme) await page.evaluateOnNewDocument((t) => localStorage.setItem("seoul-tram-theme", t), theme);
  // headless Chrome의 prefers-color-scheme은 기본값이 불안정 — 테마를 명시해 맵 스타일과 항상 짝짓는다
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme === "dark" ? "dark" : "light" }]);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 }).catch((e) => issues.push(`goto: ${e.message}`));
  await page
    .waitForFunction(() => !!document.querySelector("canvas"), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await new Promise((r) => setTimeout(r, 3500)); // 스타일/타일/레이어 최종 페인트 유예

  const main = await page.evaluate(DIAG_FN);
  await page.screenshot({ path: `${OUT}/${id}.png` });

  // 다크 슷: 테마 전환(dark→light) 후 레이어가 다시 추가되는지 — 전환 타이밍 구멍 검증
  let after = null;
  if (theme === "dark") {
    await page.evaluate((u) => window.__seoulMap.setStyle(u), STYLE_LIGHT);
    await new Promise((r) => setTimeout(r, 2600));
    after = await page.evaluate(DIAG_FN);
    await page.screenshot({ path: `${OUT}/${id}b-after-setStyle.png` });
  }

  /** 진단 결과 → 문제점 목록 (빈 배열 = 통과) */
  const problems = (d, tag) => {
    if (!d || d.error) return [`${tag}: ${d?.error ?? "진단 실패"}`];
    const p = [];
    for (const [layer, ok] of Object.entries(d.present)) if (!ok) p.push(`${tag}: 레이어 없음 ${layer}`);
    if (d.coordsOutOfWorkd > 0) p.push(`${tag}: 링 좌표 ${d.coordsOutOfWorkd}개 서울 영역 밖 — 경도/위도 스왐 의심`);
    if (d.qsf.stations === 0) p.push(`${tag}: stations 소스에 피처 없음`);
    if (d.qsf.lines === 0) p.push(`${tag}: lines 소스에 피처 없음 (노선 선형 미도입)`);
    if (d.qsf.iso === 0 || d.qsf.iso === -2) p.push(`${tag}: iso 소스에 피처 없음/레이어 없음`);
    if (d.qrf.stations === 0) p.push(`${tag}: qrf stations = 0 (점이 렌더 안 됨 — zoom ${d.zoom})`);
    if (d.qrf.isoFill === 0) p.push(`${tag}: qrf iso-fill = 0 (등시선 미렌더)`);
    if (d.qrf.lines === 0) p.push(`${tag}: qrf lines = 0 (노선선이 화면에 안 보임 — zoom ${d.zoom}, minzoom 9 확인)`);
    if (d.qrf.lines === -1) p.push(`# qrf(lines) 쿼리 자체가 오류`);
    if (d.markers !== wantMarkers) p.push(`${tag}: 마커 ${d.markers}개 (기대 ${wantMarkers}개)`);
    return p;
  };

  const problems_ = [...problems(main, "main"), ...(after ? problems(after, "after setStyle") : [])];
  const bad = issues.filter((i) => !i.includes("ReadPixels") && !i.includes("GroupMarkerNotSet") && !i.includes("favicon.ico"));

  console.log(`- ${id} (${desc})`);
  console.log(`  main: qsf(iso/lines/st)=${main ? Object.values(main.qsf).join("/") : "?"} qrf(fill/line/lines/st)=${main ? Object.values(main.qrf).join("/") : "?"} qb(fill/lines/st)=${main ? Object.values(main.qb).join("/") : "?"}`);
  console.log(`        coords표본=${main?.layerCoordsSampled} 밖=${main?.coordsOutOfWorkd} markers=${main?.markers} zoom=${main?.zoom}`);
  if (after) console.log(`  전환후: layers=${Object.values(after.present).every(Boolean) ? "OK" : "누락!"} qrf=${Object.values(after.qrf).join("/")}`);
  if (problems_.length || bad.length) {
    fail += 1;
    for (const x of [...problems_, ...bad]) console.log(`   ✗ ${x}`);
  } else {
    console.log(`   ✓ PASS`);
  }
  await ctx.close();
}

await browser.close();
if (!existsSync(`${OUT}/01-light-default.png`)) fail += 1;
console.log(fail ? `\nFAIL — ${fail} 슷 문제` : "\nALL PASS");
process.exit(fail ? 1 : 0);
