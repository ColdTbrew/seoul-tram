# 과제 2: Vercel 스타일 + shadcn/ui 로 리디자인 (React/TS 재작성)

현재 정적 버전(태그 `v0-static`)은 동작한다. 이를 **Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui** 앱으로 재작성한다. 데이터 파이프라인(`scripts/build_data.py` → `data/network.json`, `data/rankings.json`)과 계산 모델(도보 75 m/분, 대기=배차/2, 환승 등)은 그대로 유지. 질문하지 말고 진행, 결정은 `docs/architecture.md` 에 기록.

## 디자인 (Vercel 스타일)
- Geist Sans / Geist Mono 폰트 (`npm i geist` 또는 `@fontsource-variable/geist` + `@fontsource-variable/geist-mono`), 한글은 시스템 폰트 fallback (Pretendard 없으면 `system-ui, "Apple SD Gothic Neo", "Noto Sans KR"`).
- 흑백 위주, 얇은 1px 경계(`border-border`), 넉넉한 여백, 작은 radius, 그림자 최소. 라이트/다크 모드 둘 다 + 토글(라이트/다크/시스템; `html.dark` 클래스, localStorage 저장).
- 지도 베이스맵: MapLibre GL (`maplibre-gl`, 필요하면 `react-map-gl/maplibre`) + CARTO 벡터 스타일 — 라이트 `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`, 다크 `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (테마 따라 전환). 표기: © OpenStreetMap contributors © CARTO.
- 시간 색상 램프는 절제된 순차 팔레트(가까움=진함 → 멂=옅음 또는 green→amber→red 중 하나, 범례 필수). 노선 선은 공식 노선색(얇게).

## shadcn/ui 셋업 (정확히 이 순서로, 저장소 루트에서)
1. `npm create vite@latest /tmp/seoul-vite -- --template react-ts` 로 만든 뒤 `package.json, tsconfig*.json, vite.config.ts, index.html, src/, eslint.config.js` 를 저장소 루트로 복사 (기존 `index.html, rankings.html, js/, styles.css` 는 삭제 — `v0-static` 태그에 보존됨). `data/` 는 `public/data/` 로 옮기고 build_data.py 출력 경로도 `public/data/` 로 수정. `.gitignore` 에 `node_modules/ dist/` 추가.
2. `npm i` → `npm i tailwindcss @tailwindcss/vite` → `npm i -D @types/node`.
3. `vite.config.ts`: `plugins: [react(), tailwindcss()]`, `resolve.alias: { "@": path.resolve(__dirname, "./src") }`, **`base: '/seoul-tram/'`**. `tsconfig.json` 과 `tsconfig.app.json` 에 `"baseUrl": "."`, `"paths": { "@/*": ["./src/*"] }`. `src/index.css` 는 `@import "tailwindcss";` 로 시작.
4. `npx shadcn@latest init -d` (기본값, base color neutral) → `npx shadcn@latest add button input card command popover tabs badge checkbox toggle-group tooltip sheet separator scroll-area`.
5. 데이터 로딩은 반드시 `fetch(import.meta.env.BASE_URL + 'data/network.json')` (하드코딩된 `/data/...` 금지 — Pages 하위경로에서 깨짐).

## 기능 (기존 기능 유지 + 개선)
- 레이아웃: 상단 헤더(제목 "서울 지하철로 몇 분?", Tabs: 지도 / 순위 / 소개, 테마 토글, GitHub 링크), 데스크톱은 좌측 패널(Card) + 우측 지도, 모바일은 지도 전체 + `Sheet` 로 패널.
- 출발/도착 역 검색: shadcn `Command` + `Popover` 콤보박스(한글 역명, 부역명 괄호 포함 부분일치). 지도 클릭으로 출발/도착 지정, 현재 위치 버튼, 출발↔도착 교환, URL 쿼리 `?from=&to=` 동기화. 기본 출발 = 시청.
- 역 점 = 소요시간 색, 15/30/45/60분 등시선 토글(`ToggleGroup` 또는 `Checkbox`), 요약 통계 `Badge`(30분 이내 역 수/비율, 가장 먼 역).
- 도착지 선택 시 경로 카드: 총 시간 + 단계(도보 → 노선 Badge(노선색) 승차 → 환승(시간) → 하차 → 도보), 지도에 경로 하이라이트.
- 순위 탭: rankings.json 내용을 Card/표로. 소개 탭: 계산 방법, 데이터 출처(KTDB GTFS, OSM, CARTO), 한계, 원본 크레딧(Camille Roux, Jules Grandin, Anthony Castrio).
- **버그 수정 필수**: v0 의 등시선은 출발지와 무관하게 먼 지역 곳곳에 섬 모양 윤곽이 생긴다. 올바른 정의: 격자 셀 시간 = min over 역 (역 도달시간 + 셀까지 직선거리/75), 도보 반경(예: 1.2km) 밖은 Infinity, 출발지 근처는 직접 도보시간도 포함. 등시선 T = `time <= T` 인 영역의 경계 (marching squares, Infinity 는 T 초과로 취급). 결과를 GeoJSON 으로 MapLibre layer 에 표시. 단위 테스트(작은 격자)로 확인.
- 기존 `js/graph.js`, `js/iso.js` 로직은 `git show v0-static:js/graph.js` 등으로 참고해서 `src/lib/graph.ts`, `src/lib/iso.ts` 로 타입과 함께 포팅. 데이터 타입은 `src/lib/types.ts` 한 곳에.

## GitHub Pages (Actions 배포)
- `.github/workflows/deploy.yml`: `on: push: branches: [main]` + `workflow_dispatch`; `permissions: contents: read, pages: write, id-token: write`; `concurrency: group: pages`; job build: `actions/checkout@v4`, `actions/setup-node@v4` (node 22, cache npm), `npm ci`, `npm run build`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3` (path: dist); job deploy: `environment: github-pages`, `actions/deploy-pages@v4`.
- `package-lock.json` 커밋 필수. push 는 하지 마 (감독자가 함).

## 진행 방식 (pstack 스킬 사용)
1. `/skill:architect` 절차로 먼저 설계: `docs/architecture.md` (짧게, 1~2쪽: 모듈 맵, 타입 스케치, 후보 2개 비교, 결정). 커밋.
2. 셋업(위 shadcn 순서) → `npm run build` 통과 확인 → 커밋.
3. lib 포팅(types/graph/iso + 테스트, `npx tsx` 또는 vitest 로 실행) → 커밋.
4. UI 컴포넌트(각 파일 200줄 이하, 파일마다 별도 write — 응답당 출력 한도 32k 토큰) → 커밋.
5. `/skill:create-verification-skill` 로 `.agents/skills/verify-seoul-tram/` 생성: `npm run build && npx vite preview --host 127.0.0.1 --port 4173` 후 `google-chrome --headless=new --no-sandbox --window-size=1400,900 --virtual-time-budget=15000 --screenshot=... http://127.0.0.1:4173/seoul-tram/` (라이트/다크 둘 다, `?from=시청&to=강남` 경로 화면도) — 스크린샷은 `docs/screenshots/` 에 저장. 직접 스크린샷 PNG 를 read 해서 눈으로 확인하고 문제 있으면 고쳐. 커밋.
6. README 갱신(스택, `npm run dev/build`, 데이터 빌드, 배포, 출처/가정). 마지막에 "DONE" + 요약.
