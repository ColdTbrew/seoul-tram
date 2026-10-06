# 아키텍처 스케치 (v1 리디자인: Vite + React + TS + Tailwind v4 + shadcn/ui + MapLibre)

v0-static(태그 `v0-static`)은 전역 `app` 객체 + 명령형 DOM/Leaflet 코드였다. v1의 목표는
같은 기능(등시선/히트맵/경로/검색/URL 공유/다크모드)을 React+TS 위에 올리고, v0의 등시선
버그(출발지와 무관하게 먼 곳에 섬 모양 윤곽 — 평활화 단계가 무한대 칸과 평균을 섞어 윤곽을
뭉개는 문제 + 격자 정의가 "정류장 뿌리기"에 가까웠음)를 올바른 정의(칸 시간 =
min over 역 (역 도달시간 + 셀까지 직선거리/75, 도보 반경 밖 = Infinity, 출발지 근처는
직접 도보도 후보))로 바로잡는 것이다.

## 사용법 스케치 (주요 사용자 흐름)

```tsx
// App.tsx 의 의사코드
const { data, error } = useNetworkData();                 // fetch(BASE_URL + 'data/network.json') → prepareNetwork()
const [origin, setOrigin] = useState<Place>(...);         // Place = {kind:'stop',stopIdx} | {kind:'point',lon,lat}
const [dest, setDest] = useState<Place | null>(null);
const [bounds, setBounds] = useState({max: 45, isos: [15, 30]});
const plan = useTripPlan(data, origin, bounds);           // useMemo: solution + grid + contour GeoJSON
// <MapCanvas data={data} plan={plan} origin={origin} dest={dest} theme={theme} .../>
// <TripPanel> = 출발/도착 Command 검색 + 등시선 ToggleGroup + 요약 Badge + 경로 카드
```

## 타입 스케치

```ts
// src/lib/types.ts
export type LngLat = [number, number];
export interface RawStop { n: string; lon: number; lat: number; w: number; s: number; l: number[] } // l = line index
export interface NetworkData {
  version: number;
  stops: RawStop[];                       // 승강장 단위 노드
  edges: [a: number, b: number, minutes: number, lineIdx: number][]; // lineIdx = -1 이면 도보 간선
  lines: { id: string; name: string; color: string; paths: LngLat[][] }[];
  stations: { n: string; lon: number; lat: number }[];  // 역 클러스터 (라벨/통계)
  meta: { walkSpeed: number; accessRadius: number; defaultFrom: { name: string; lon: number; lat: number } };
}
export interface GraphModel {               // prepareNetwork() 결과 — 앱生命周期 동안 1개
  data: NetworkData;
  adj: Float64Array[];                      // 인접 리스트 (압축 표현: [to, minutes, lineIdx] triples)
  bucketIndex: Map<string, number[]>;       // BUCKET_M 버킷 공간 인덱스
  proj: { lon0: number; lat0: number; mLon: number; mLat: number };
}
export interface Solution {                 // dijkstraFrom() 결과
  dist: Float64Array;                       // state = stopIdx * stride + (line+1), 0 = 도보 상태
  prev: Int32Array;
  timeAt: Float64Array;                     // 역당 최소 도달 시간 (요약/색/등시선/도보 반경의 근거)
  stride: number;
}
export interface IsoGrid { x0: number; y0: number; cell: number; cols: number; rows: number;
  times: Float32Array }                     // 희소 Map 대신 dense 배열 + Infinity = 도달 불가
// src/lib/iso.ts
export function computeGrid(g: GraphModel, sol: Solution): IsoGrid;   // 스캐터 방식 + 평활화 없음
export function contourFeatures(grid: IsoGrid, threshold: number): Feature<MultiLineString>[]; // marching squares

// src/hooks/useTripPlan.ts
export function useTripPlan(g: GraphModel | null, origin: Place | null,
  bounds: { max: number; isos: number[] }): {
    solution: Solution | null; grid: IsoGrid | null;
    contours: FeatureCollection<Geometry, { t: number }>; stopsColor: FeatureCollection<Point, { t: number }>;
    summary: { reached: number; total: number; farthest: { name: string; minutes: number } | null };
  }

// src/map/MapCanvas.tsx — MapLibre 래퍼. 테마가 바뀌면 style.json 재로딩 후 layer 재구성.
interface MapCanvasProps {
  theme: 'light' | 'dark'; grid: IsoGrid | null; maxMinutes: number;
  contours: FeatureCollection<Geometry, { t: number }>;
  stopsColor: FeatureCollection<Point, { t: number }>;
  route: LngLat[] | null; origin: LngLat | null; dest: LngLat | null;
  onMapClick(ll: LngLat): void;
}
// src/map/layers.ts — addMapLayers(map, ...)/updateMapLayers(map, props) 커맨드. MapLibre의
// source·layer API 하위 호환 트릭이 이 파일 안에만 존재한다.

// src/hooks/useNetworkData.ts — fetch(import.meta.env.BASE_URL + 'data/network.json') → prepareNetwork()
// src/hooks/useTheme.tsx — ThemeProvider(html.dark + localStorage + matchMedia)
// src/components/* — TripPanel(검색 Command+Popover, 등시선 ToggleGroup, 요약 Badge, 경로 카드),
//   MapSheet(모바일 드로어), Header(Tabs/테마/GitHub), RankingsView, AboutView, LineLegend
```

## 데이터 플로우 (불변 스키마)

```
data/raw/GTFS_Korea.zip → scripts/build_data.py → public/data/network.json, public/data/rankings.json
(network.json 은 이미 v0에서 생성되어 있음 — 스키마 불변, `version` 키만 추가)
fetch → prepareNetwork() (정리 + 버킷 인덱스) → dijkstraFrom(origin) → computeGrid + contourFeatures
→ MapLibre source 갱신 (raster heat = 오프스크린 캔버스 toDataURL, 등시선/점/경로 = GeoJSON)
```

## 후보 비교

### 후보 A — "그대로 이식" (얇은 React)
v0 모듈을 `src/lib/*.ts`에 1:1 이식하고, 전역 `app` 싱글톤을 유지한 채 `Map.tsx`가
useEffect 안에서 Leaflet 대신 MapLibre를 명령형으로 굴린다. React state는 거의 쓰지 않고
`rerender()` 이벤트 버스로 DOM/레이어를 갱신한다.
- 장점: 이식 비용 최소, v0 동작과 1:1 대응 가능성 높음.
- 레드 플래그: (1) 컴포넌트가 재사용되려면 추상화 내부(app 전역, layer 키 규칙)를 알아야 함 —
  "콜러가 내부 규칙을 알아야 쓰는" 구조가 v0에 이어 살아남음. (2) 테마 토글·등시선 토글이
  전부 수동 DOM 조작이어서 React/MapLibre 양쪽의 선언형 이점을 다 버림. (3) next contributor가
  가장 먼저 "가장 가까운 예시 복붙"으로 망칠 확률이 가장 큰 형태.

### 후보 B — "순수 코어 + 지도 래퍼 + 얇은 훅" (합성에서 채택)
- `src/lib/` = 프레임워크 독립 순수 계산(types/proj/graph/iso/format). DOM·React·MapLibre 모를
  때 테스트 가능(vitest). `computeGrid`/`contourFeatures`는 **함수 인자/반환만 받고 전역을 안 읽는다.**
- `src/map/` = MapLibre를 `MapCanvas.tsx` 한 파일 + `layers.ts`에 봉인. props(테마, 등시선
  threshold, stopsColor, route, origin/dest) → MapLibre 소스/레이어 갱신은 전부 이 경계 안에서만.
  히트맵은 v0과 같은 오프스크린 캔버스→raster source 방식(GeoJSON 셀 4만 개보다 작고 선명).
- `src/hooks/` = useNetworkData / useTripPlan(useMemo로 origin→solution→grid→contours 파생) /
  useTheme. 앱 트리는 unidirectional: origin·bounds·theme가 바뀌면 plan이 재계산되고 MapCanvas는
  props만 따라간다.
- 장점: 테스트 가능한 등시선 코어(버그 수정의 근거지), 테마 전환 시 style.json 재로딩 지점이
  한 곳, 파일 200줄 이하 규칙과 "한 파일만 보면 옳은 변경"이 쉽게 성립.
- 단점: MapLibre 래퍼의 props→layer 매핑 동기화 코드는 주의 필요(스케일 0.14MB 데이터에서
  재렌더 비용은 무시 가능). 등시선 재계산은 origin 변경 시에만.

### 공통으로 지킨 성능 선택 (A에서 Borrow)
- Dijkstra: (정류장, 승차 노선) 상태 공간 + Float64Array dist + 이진힙 (v0 방식 포팅, O(V·L)를 피함).
- 등시선: 정류장당 주변 칸만 시드하는 scatter 시딩 — "min over 역" 정의와 집합적으로 동치.
- 평활화(smoothing) 단계는 **제거**: v0 섬 버그의 원흉. 경계가 잘리는 건 smoothing 때문이 아니라
  정의 자체가 격자 해상도(400 m)에서 계단형으로 잘리기 때문 — marching squares가 Infinity를
  정상 처리하게 한다.

## 합성 결정

**B를 채택, 단 v0의 데이터 구조(스키마 불변 + GraphModel로 래핑)와 A의 계산 루틴을 그대로 이식.**
핵심 근거: 이번 리디자인의 최대 리스크인 "등시선 정의 오류"를 잡으려면 격자 코어가 **단위
테스트 가능한 순수 함수**(작은 격자 위에서 섬/구멍/Infinity 경계 검증)여야 하고, MapLibre
테마 전환은 style.json 전체를 갈아끼워 layer가 사라지는 구조이므로 layer 복원 지점을 한 파일로
묶어야 한다. v0의 전역 상태 + 명령형 DOM 방식은 이 두 요구와 충돌한다. 파일당 ≤200줄, 파일
마다 개별 작성(pi 출력 한도). 램프 팔레트는 v0과 같은 green→amber→red 계열(등시선/점 공통,
범례 표시).
