---
name: verify-seoul-tram
description: seoul-tram 사이트의 E2E 시각 검증 — 지도/레이어/테마/레이아웃을 건드린 뒤 커밋하기 전에 실행. headless Chrome으로 5개 스크린샷(라이트/다크/경로/모바일) + 콘솔·네트워크 오류 수집.
---

# seoul-tram 검증 (E2E 스크린샷, 유닛 테스트 없음)

유닛 테스트는 감독 지시로 제거됨 — **시각·기능 검증은 아래 회로가 유일한 게이트다.**
PNG는 코딩 에이전트가 육안 판독할 수 없으므로 **스크립트 출력(JSON/DOM 검사 문자열)으로 판정**하고,
판독이 필요하면 감독에게 스크린샷 경로만 넘긴다.

## 준비
```bash
npm i --no-save puppeteer-core     # 시스템 Chrome(/usr/bin/google-chrome-stable)과 짝
# 서버 중이면 확인, 아니면 켠다:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/seoul-tram/   # 200이 아니면:
npx vite preview --port 4173 &   # (백그라운드; 킬은 `fuser -k 4173/tcp` — pkill -f "vite"는 자기 셸을 잡는다!)
```

## 실행
```bash
node scripts/verify-screenshots.mjs
# 다른 베이스면: VERIFY_BASE=http://100.112.179.83:8195/seoul-tram/ node scripts/verify-screenshots.mjs
# 스크린샷은 스크립트가 --use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader --ignore-gpu-blocklist
# 플래그로 Chrome을 띄운다 (SwiftShader WebGL 없으면 headless에서 맵이 안 그려짐).
```

## 통과 기준 (ALL PASS가 아니면 머지/커밋 금지)
1. `ALL PASS` + 각 슷 `canvas=y`.
2. 각 슷 `attrib="© CARTO, © OpenStreetMap contributors"` — 이 텍스트가 빠지면 **베이스맵 스타일/타일 미로드**.
3. 라이트 슷 `darkClass=n` / 다크 슷(03,04) `darkClass=y` — 테마와 맵 스타일(posatron↔dark-matter) 짝 확인.

## 실패 시 원인 지도
- `Worker failed to load` 또는 맵이 텅 빔 → **MapLibre v6 워커 URL 파손**. 복구 3종: (a) `MapCanvas.tsx` 상단
  `setWorkerUrl(workerUrl)` + `?worker&url` 임포트 유지, (b) `vite.config.ts`의 `optimizeDeps.exclude: ["maplibre-gl"]` 유지,
  (c) 빌드 산출물에 `dist/assets/maplibre-gl-worker-*.js` 존재 확인 (`npm run build` 후 ls).
- `layers.pt-*: unknown property` → MapLibre v6가 라인 키를 정리함 (line-join/line-cap 삭제됨). layers.ts의 paint 키를 v6 스펙과 대조.
- 다크에서 맵만 하얗게/반대로 → `basemapUrl(resolved,...)` 호출부 또는 `documentElement.dark` 토글(useTheme.tsx) 확인.
- 스크린샷 자체가 타임아웃 → Chrome에 `--use-angle=swiftshader-webgl --enable-unsafe-swiftshader`가 빠져있거나
  `--virtual-time-budget`를 쓴 경우(과거 120초 하드킹 원인). **puppeteer 스크립트 방식 유지.**

## 산출물
`/tmp/shots/*.png` 5장 (01~02 라이트 데스크톱, 03~04 다크, 05 모바일 390×844) — 감독이 육안 확인용.
