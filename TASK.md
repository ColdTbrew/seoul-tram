# 과제: "서울 지하철로 몇 분?" — tram.camilleroux.com 의 서울(수도권 전철) 버전 만들기

너는 이 저장소(~/projects/seoul-tram)에서 혼자 끝까지 구현하는 코딩 에이전트다. 질문하지 말고 합리적으로 결정하고 진행해라. 결정한 내용은 README에 기록.

## 원본
- 원본 사이트: https://tram.camilleroux.com/ ("À portée de tram", Camille Roux, MIT 라이선스)
- 원본 코드가 로컬에 클론되어 있음: `~/projects/ref-montpellier-tram/` (README.md, build_data.py, site/app.js, templates/city.html 등). 기능/모델/UX를 참고하되 서울용으로 새로 작성해라 (Python 빌드 스크립트 + 정적 프론트엔드). 필요하면 코드 일부를 차용해도 되지만(MIT) README에 출처 표기.
- 원본 모델(README "Modèle" 절): 평일 7~20시 기준, 역간 소요 = 계획된 소요시간의 중앙값, 대기 = 평균 배차간격의 1/2 (1~15분으로 제한), 환승 = 환승 도보 + 다음 노선 대기, 가까운 역끼리 도보 연결(<450m), 도보 75 m/분 직선거리.

## 만들 것 (정적 사이트, GitHub Pages 배포 예정)
1. 인터랙티브 지도 (MapLibre GL JS 또는 Leaflet, CDN 사용 + OSM 래스터 타일, 저작권 표기 필수)에 수도권 전철 역 전체 표시, 노선은 공식 노선색으로 선 표시.
2. 출발지 선택: 역 검색(한글 역명 자동완성), 지도 클릭, 드래그 가능한 출발 마커, (선택) 현재 위치. 기본 출발지 = 서울시청(시청역).
3. 출발지에서 모든 역까지 최단 소요시간을 브라우저에서 계산(Dijkstra) → 각 역 점을 소요시간 색상으로 칠하고(범례 표시), 15분/30분 등시선(isochrone) 윤곽 표시 (예: 역별 도달시간 + 남은 시간만큼 도보 반경 원들의 합집합, 또는 그리드 기반 contour — 간단하고 확실한 방법 선택).
4. 도착지 클릭(역 또는 지도 위 임의 지점) → 총 소요시간 + 경로 상세: 도보 → 승차역, 탈 노선(노선명/색/방면), 환승역과 환승 시간, 하차역 → 도보. 지도에 경로 하이라이트.
5. 출발지가 임의 지점이면: 그 지점에서 근처 역들까지 도보(75 m/분, 최대 ~1.2km) 후 대기+탑승.
6. 공유 링크: URL 쿼리/해시에 출발/도착 저장 (?from=...&to=...).
7. 한국어 UI. 상단에 요약 통계 (예: "시청 출발 30분 이내 역 N개 / 전체의 X%").
8. 순위 페이지 `rankings.html` (가능하면): 배차간격이 가장 짧은 노선, 가장 많은 열차가 지나는 역, 끝에서 끝까지 가장 오래 걸리는 노선, 시청에서 가장 먼 역 등 — GTFS에서 계산.
9. 소개/FAQ 섹션: 시간 계산 방법, 데이터 출처, 한계(실시간 아님, 급행/직결 단순화 등), 원본(Camille Roux, Jules Grandin, Anthony Castrio) 크레딧.

## 데이터 (실제 공개 데이터만 사용, 지어낸 숫자를 공식처럼 제시 금지)
- 이미 다운로드됨: `data/raw/GTFS_Korea.zip` (KTDB 국가교통DB 전국 GTFS, Hugging Face `Digital-Twin-Urban-Mobility/GTFS-Korea` 미러, https://huggingface.co/datasets/Digital-Twin-Urban-Mobility/GTFS-Korea). 내부 경로 `GTFS_Korea/*.txt`. 압축 해제하면 3GB (shapes.txt 1.5GB, stop_times.txt 1.5GB) → 전부 풀지 말고 `unzip -p` 로 스트리밍하면서 필요한 행만 필터링해라.
  - routes.txt: 수도권 전철은 `route_id` 가 `RR_ACC1_S-1-` 로 시작 (route_type=1). 예: `RR_ACC1_S-1-02-1I` 서울2호선(본선)<내선>, `S-1-01-*` 서울1호선(여러 계통, 급행 포함), `S-1-09-2*` 9호선 급행, AP 공항철도, SB 신분당선, SD 수인분당선, KJ 경의중앙선, GC 경춘선, KK 경강선, SH 서해선, I1/I2 인천1·2호선, WS 우이신설, UI 의정부경전철, EB 용인경전철, KP 김포골드라인, ET 자기부상(폐지됨 → 제외 고려). 다른 S-2..S-5 는 부산/대구/광주/대전이므로 제외.
  - trips.txt(route_id,service_id,trip_id,shape_id), stop_times.txt(trip_id,...,stop_id,stop_sequence), stops.txt(stop_id,stop_name,stop_lat,stop_lon), calendar.txt, shapes.txt(노선 선형 — 필요하면 해당 shape_id만 필터).
  - 먼저 데이터를 탐색해서 실제 구조를 확인해라 (트립 수가 실제 운행 횟수를 반영하는지, 같은 역이 노선별로 다른 stop_id 인지 등). 노선별 하루 트립 수가 비현실적으로 적거나 시간대 정보가 이상하면, 역간 소요시간은 GTFS를 쓰고 배차간격은 각 운영사가 공개한 대표 배차(출처 명시)나 GTFS 기반 추정으로 하고, README에 "가정"으로 명확히 적어라.
  - 같은 이름(또는 매우 가까운 좌표)의 역을 환승역으로 묶고 환승 도보시간(기본 3분 + 대기, 가정임을 명시)을 적용.
- 보조: OpenStreetMap (Overpass API, `https://overpass-api.de/api/interpreter`, User-Agent 헤더 필수, 504 나면 `https://overpass.kumi.systems/api/interpreter` 시도) — 노선 선형이나 역 좌표 보정이 필요할 때만. 강/한강 다리 처리는 생략해도 됨.
- 빌드 스크립트(`build_data.py` 등)가 raw 데이터 → `site/data/*.json` (역, 노선, 그래프 엣지, 배차, 노선 선형 단순화) 을 생성. 생성된 site/data 는 git에 커밋 (원본 raw 는 .gitignore). JSON 크기는 합리적으로(수 MB 이하, 좌표 소수점 5자리, 선형 단순화).

## 배포 요건 (GitHub Pages, 공개 저장소)
- 순수 정적 사이트: `site/` 대신 저장소 루트 또는 `docs/` 중 하나에 index.html 을 두되, GitHub Pages "branch main / path /" 로 바로 서비스되게 **저장소 루트에 index.html, rankings.html, data/, app.js** 등을 두는 구조를 권장 (빌드 스크립트는 scripts/ 에). 모든 경로는 상대경로(`./data/...`). 서버 코드 없음. `.nojekyll` 파일 추가.
- README.md (한국어): 소개, 스크린샷 자리, 실행법(`python3 scripts/build_data.py`, `python3 -m http.server`), 계산 모델, 데이터 출처와 라이선스(KTDB GTFS, OSM ODbL, 원본 MIT 크레딧), 가정과 한계.
- LICENSE (MIT).
- 나중에 `gh auth status` 확인 후 GitHub 공개 저장소로 올릴 예정이지만, 지금은 **push 하지 말고** 로컬 git 커밋만 해라. (인증은 내가 처리)

## 진행 방식
- 단계별로 진행하고 각 단계 끝날 때마다 `git add -A && git commit -m ...` 로 커밋.
  1) 데이터 탐색 → 메모(NOTES.md) 2) build_data.py 로 site 데이터 생성 + 검증(예: 시청→강남, 시청→인천 소요시간이 상식적인지 출력) 3) 프론트엔드 지도/히트맵/등시선/경로 4) 순위 페이지 5) README/FAQ 마무리.
- 확인: `python3 -m http.server 8195 --bind 127.0.0.1` 같은 걸로 띄워서 `curl` 로 페이지와 data JSON 로드 확인 (서버는 확인 후 종료). 브라우저 JS 오류가 없도록 `node --check app.js` 등으로 문법 체크.
- 오래 걸리는 명령은 타임아웃을 두고, 3GB 파일 전체를 메모리에 올리지 마라.
- 다 끝나면 마지막에 "DONE" 과 함께 구현 요약을 출력.
