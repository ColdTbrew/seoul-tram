# 서울 지하철로 몇 분? (Seoul metro isochrone map)

서울·경기·인천 수도권 전철 네트워크의 **등시선(isochrone) 지도**.
지도에서 역이나 아무 곳이나 누르면, 그 지점에서 **걸어서+대기+탑승+환승**까지
몇 분 안에 어디까지 갈 수 있는지 색과 등시선으로 보여 준다.
특정 역을 고르면 그 역까지의 **최단 경로와 시간**(도보 → 승차 → 환승 → 도보)도 계산한다.

`À portée de tram` — 프랑스 트랑뫼/트랑베이 사이트
([tram.camilleroux.com](https://tram.camilleroux.com/), MIT © Camille Roux)의
아이디어와 계산 모델을 서울·수도권 전철 데이터에 맞게 새로 옮긴 것이다.
아이디어 원작자 Anthony Castrio, 구현/디자인 Camille Roux,영감의 원천 Jules Grandin에게 감사를 표한다
(크레딧 각주는 [원본 저장소](https://github.com/camilleroux/montpellier-temps-transport)와 아래 크레딧 절 참조).

![스크린샷 자리 — GitHub Pages 배포 전 로컬에서 `python3 -m http.server 8195`로 띄우고
http://localhost:8195/ 을 열어 확인. 메인 화면: 등시선+역 점+출발 마커.](docs/screenshot.png)

## 쓰는 법

- `index.html` — 지도. 검색창/지도 클릭/드래그로 출발지를, 지도 클릭으로 도착지를 정한다.
  출발지를 바꾸면 등시선과 역 점 색이 다시 계산되고, 지도를 드래그하면 등시선이 함께 이동한다.
- `rankings.html` — 순위 페이지 (노선별 배차간격 추정, 열차가 가장 많이 지나는 역,
  끝에서 끝까지 가장 오래 걸리는 노선 주행, 시청에서 가장 먼 역).
- URL 공유: `?from=<역이름 또는 lon,lat>&to=<...>` — 예 `/index.html?from=시청&to=강남`.
  주소창만 공유하면 다른 사람이 같은 출발지/도착지로 열 수 있다.

## 실행

정적 사이트라 서버가 필요 없다. GitHub Pages에 올리면 `index.html`이 바로 서비스된다.
로컬에서 볼 때 **OSM 타일과 `data/*.json`을 파일 시스템에서 직접 못 읽을 수 있으므로(fetch/CORS)**
간단한 서버로 띄우는 것을 권한다:

```bash
# 1) 데이터 생성 (data/raw/GTFS_Korea.zip이 있으면; 이미 생성된 data/*.json은 커밋되어 있음)
python3 scripts/build_data.py

# 2) 보기
python3 -m http.server 8195 --bind 127.0.0.1
# → http://localhost:8195/
```

## 파일 구조

```
index.html            지도 페이지 (Leaflet 1.9.4 CDN + ./js/*.js + ./styles.css)
rankings.html         순위 페이지 (./data/rankings.json을 fetch해 렌더)
styles.css            공통 스타일
js/graph.js         공통 상수/헬퍼 + 그래프 모델 + (정류장,노선) 상태 Dijkstra + 경로 복원
js/iso.js           400 m 격자 시간 필드 + 등시선 등고선 추출 + 히트맵 래스터
js/map.js           Leaflet 지도/레이어 (노선 선, 등시선, 정류장 점, 마커, 툴팁)
js/ui.js            검색·패널·버튼·URL 상태 + 초기화 오케스트레이션
scripts/            build_data.py (GTFS → data/*.json), explore1.py (데이터 탐색)
data/network.json   정류장·간선·노선 데이터 (약 0.14 MB)
data/rankings.json  순위 페이지 데이터
data/raw/           원본 GTFS zip (수 GB — 커밋하지 않음, .gitignore됨)
```

## 계산 모델

원본 트랑뫼 사이트와 **같은 가정**을 서울 데이터에 적용했다:

- **평일 주간(07–20시) 계획 시간표만** 사용한다. (출근 첨두/야간 구분 없음 — 한계 참조)
- **역 간 소요시간** = 두 승강장을 오가는 모든 계획 운행의 구간 소요 **중앙값**.
  두 승강장을 실제로 오가는 열차가 하나도 없으면 두 승강장은 연결되지 않는다.
- **대기 시간**: 각 승강장에서 열차를 탈 때마다 그 정류장의 배차간격의 절반(1~15분 클램프)을 더한다.
  배차간격 추정 = 07–20시 출발 시각의 연속 간격 중앙값(동일 `(route, stop, departure_time)` 중복 제거 후),
  정류장별로 노선당 중앙값 → 노선 전체 중앙값. **환승 시에는 환승 도보 + 다음 노선 대기를 다시 물린다.**
  같은 노선 안의 연속 이동에는 대기를 물지 않는다 (한 번 탑승하면 하차까지 승차 유지).
- **도보 연결** = 두 승강장이 450 m 미만이고 다른 어떤 노선으로도 직접 연결되지 않을 때만
  (같은 역의 반대 방향 승강장은 항상 연결). 도보 속도는 **분당 75 m (시속 4.5 km), 직선거리**.
- **출발지/도착지 = 아무 지점이나**. 출발지 주변 1.2 km(최대) 안에서 가장 가까운 승강장까지
  직선 도보로 접근한 뒤 대기+탑승한다. 도착지도 반경 1.2 km 내 가장 빠른 승강장까지의 도보로 마무리한다.
- **환승역 처리**: 같은 이름(괄호 내부 포함)이고 350 m 이내인 승강장들은 하나의 "역"으로 묶어
  세고 라벨을 붙인다 (예: 시청 1·2호선 승강장, 서울역).
- **등시선**: 400 m 격자 각 칸까지의 최소 도달 시간(도보 접근 포함)을 계산해 3×3 평균으로 매끄럽게 한 후,
  임계 시간(15/30분, 선택 시 45/60분) 이하 영역의 경계를 marching-squares 방식으로 그린다.

## 가정과 한계 — 수치는 어디까지나 추정치다

- **KTDB GTFS는 단순화된 계획 시간표다.** 트립 하나가 실제 열차 한 대가 아니라
  여러 루프를 도는 "주행 패턴"일 수 있고, 정차 시각 간격이 실제 배차보다 짧게 잡히는 경향이 있다.
  따라서 **배차간격(과 대기 시간)은 낙관적(짧게)으로 추정되는 경향**이 있다 — 환승·대기 포함
  총 시간은 실제 체감 시간보다 짧게 나온다. 순위 페이지의 배차 수치는 GTFS에서 **추정한 것**이며
  공식 발표 배차간격이 아니다.
- **GTX 계열(`GTX_*`)은 제외했다.** 부분 개통/계획 데이터라 검증이 어렵고, 전체망을 왜곡한다.
  자기부상열차(`RR_ACC1_S-1-ET`, 폐지된 인천공항 자기부상)도 제외했다.
- **직선 거리 기반이므로 도보 장애물을 무시한다.** 한강·철도 방호벽·산을 넘는 직선이 계산상
  연결될 수 있다 (원본 사이트도 같은 한계를 가진다). 반대로 환승 통로의 실제 도보 거리는
  450 m/직선 근사로 대체된다.
- **급행/완행, 본선/지선을 구분하지 않는다.** 급행의 정차 누락은 정차 시간 평균에 희석된다.
- 시간대는 하루 중 **07–20시 표본만** 사용한다. 첨두 시간대 배차는 이보다 조밀할 수 있다.
- 개별 수치를 공식 정보처럼 믿지 말 것. 큰 그림(어디가 가깝고 먼가)을 위한 시각화다.

## 데이터와 크레딧 (모두 실제 공개 데이터)

- **노선·역·시간표**: KTDB 국가교통DB 전역 GTFS
  (Hugging Face `Digital-Twin-Urban-Mobility/GTFS-Korea` 미러,
  https://huggingface.co/datasets/Digital-Twin-Urban-Mobility/GTFS-Korea).
  수도권 광역철도 계통(`RR_ACC1_S-1-*`, route_type=1)과 광역급행(`GTX_*`, 제외됨)만 추출.
- **지도 타일**: © OpenStreetMap contributors, [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) (ODbL) —
  렌더링은 Leaflet 1.9.4 (BSD-2-Clause, unpkg CDN).
- **원본 사이트와 계산 모델**: « À portée de tram » MIT © Camille Roux
  ([저장소](https://github.com/camilleroux/montpellier-temps-transport)) — 아이디어 Anthony Castrio,
  구현/디자인 Camille Roux, 영감의 원천 Jules Grandin
  ([paris-temps-transport](https://github.com/JulesGrandin/paris-temps-transport)). 코드와 모델 접근을 상당 부분 차용했으며
  원본의 가정을 서울 상황에 맞게 조정했다 (노선색은 서울 공식 계열색의 대표 색).

## 검증 메모

`python3 scripts/build_data.py`는 생성 후 상식 점검용 표본을 출력한다
(시청→강남, 시청→인천공항1터미널, 서울역→인천공항2터미널 등; 모두 45–75분대로 상식선).
`data/network.json`의 그래프는 단일 연결 성분(모든 승강장이 이론상 도달 가능)이며
734개 승강장 노드와 936개 간선(도보 128개 포함)을 담고 있다.

## 라이선스

MIT (LICENSE 참조). 원본 « À portée de tram »(MIT © Camille Roux)의 계산 모델·코드 구조를 따랐으며, 원본도 MIT다.
