/** E2E 시각 검증: 실행 중인 preview(또는 any base)에 headless Chrome로 접근해
 * 스크린샷을 찍고 콘솔/네트워크 오류를 수집한다. 유닛 테스트 대체용 최소 회로 (감독 지시).
 * 사용: (터미널A) npx vite preview  (터미널B) VERIFY_BASE=http://localhost:4173/seoul-tram/ node scripts/verify-screenshots.mjs
 * 요구: npm i --no-save puppeteer-core, 시스템 Chrome, SwiftShader WebGL. */
import { mkdirSync, existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE ?? "http://localhost:4173/seoul-tram/";
const OUT = process.env.VERIFY_OUT ?? "/tmp/shots";
const CHROME = process.env.CHROME_BIN ?? "/usr/bin/google-chrome-stable";
mkdirSync(OUT, { recursive: true });

const enc = (s) => encodeURIComponent(s);

/** 각 슷: [id, URL, 폭, 높이, DPR, 테마(localStorage "seoul-tram-theme"), 설명] */
const SHOTS = [
  ["01-light-default", BASE, 1440, 900, 1, null, "데스크톱 라이트 — 시청 출발 기본 뷰"],
  ["02-light-route", `${BASE}?from=${enc("시청")}&to=${enc("강남")}`, 1440, 900, 1, null, "라이트 — 시청→강남 경로"],
  ["03-dark-default", BASE, 1440, 900, 1, "dark", "데스크톱 다크 — dark-matter 스타일"],
  ["04-dark-route", `${BASE}?from=${enc("시청")}&to=${enc("인천국제공항2")}`, 1440, 900, 1, "dark", "다크 — 장거리 공항공항선 경로"],
  ["05-mobile-light", `${BASE}?from=${enc("시청")}&to=${enc("강남")}`, 390, 844, 2, null, "모바일 — 풀블리드 + 부상 검색 카드"],
];

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
for (const [id, url, w, h, dpr, theme, desc] of SHOTS) {
  const ctx = await browser.createBrowserContext(); // 컨텍스트 격리 (테마 localStorage 오염 방지)
  const page = await ctx.newPage();
  const issues = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") issues.push(`${m.type()}: ${m.text().slice(0, 140)}`);
  });
  page.on("pageerror", (e) => issues.push(`pageerror: ${String(e.message).slice(0, 140)}`));
  page.on("requestfailed", (r) => issues.push(`reqfail: ${String(r.url()).slice(0, 110)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) issues.push(`res${r.status()}: ${r.url().slice(0, 110)}`);
  });

  if (theme) await page.evaluateOnNewDocument((t) => localStorage.setItem("seoul-tram-theme", t), theme);
  // headless Chrome의 prefers-color-scheme은 기본값이 불안정 — 테마를 명시해 맵 스타일과 항상 짝짓는다
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme === "dark" ? "dark" : "light" }]);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90_000 }).catch((e) => issues.push(`goto: ${e.message}`));
  const canvas = await page
    .waitForFunction(() => !!document.querySelector("canvas"), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  const mapDom = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const a = document.querySelector(".maplibregl-ctrl-attrib");
    return { canvas: !!c, attrib: (a?.textContent ?? "").slice(0, 110) };
  });
  await new Promise((r) => setTimeout(r, 3500)); // 타일/레이어 최종 페인트 유예

  const file = `${OUT}/${id}.png`;
  await page.screenshot({ path: file });
  const dark = theme === "dark";
  const darkClass = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log(`- ${id} (${desc})\n  canvas=${canvas ? "y" : "N"} attrib="${mapDom.attrib}" darkClass=${darkClass ? "y" : "n"} → ${file}`);
  const bad = issues.filter((i) => !i.includes("ReadPixels") && !i.includes("GroupMarkerNotSet") && !i.includes("favicon.ico"));
  if (bad.length) console.log(`  issues:\n   ${bad.join("\n   ")}`);
  if (!canvas || bad.length) fail += 1;
  await ctx.close();
}

await browser.close();
if (!existsSync(`${OUT}/01-light-default.png`)) fail += 1;
console.log(fail ? `\nFAIL — ${fail} 슷 문제` : "\nALL PASS");
process.exit(fail ? 1 : 0);
