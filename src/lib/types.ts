/** 공용 데이터 타입 — network.json 스키마와 1:1 대응한다 (스키마 변경 시 build_data.py도 함께 변경). */

/** [경도, 위도] — MapLibre/GeoJSON 좌표 순서와 동일. */
export type LngLat = [number, number];

/** network.json stops 항목. 승강장(platform) 단위 노드 하나 = 그래프 노드 하나. */
export interface RawStop {
  /** 역 이름 (부역명 포함, 예: "시청", "을지로입구(명동)") */
  n: string;
  lon: number;
  lat: number;
  /** 이 승강장의 평균 배차간격의 절반 = 승차/환승 대기 시간 (분, 1~15 클램프) */
  w: number;
  /** 원본 GTFS stop_id 인덱스 (디버그용, 로직에서 사용하지 않음) */
  s: number;
  /** 이 승강장에 정차하는 노선의 lines 배열 인덱스 */
  l: number[];
}

/** [정류장 a, 정류장 b, 소요 분, 노선 인덱스(-1 = 도보 연결)] — 양방향. */
export type RawEdge = [a: number, b: number, minutes: number, lineIdx: number];

export interface RawLine {
  id: string;
  name: string;
  /** 공식 노선색 (#rrggbb) */
  color: string;
  /** 노선 선형 (Path[] = 좌표열의 나열, shapes 단순화 결과) */
  paths: LngLat[][];
}

export interface RawStation {
  n: string;
  lon: number;
  lat: number;
}

export interface NetworkData {
  name: string;
  walkSpeed: number;
  accessRadius: number;
  defaultFrom: { lon: number; lat: number; name: string };
  sources: string;
  generated: string;
  stops: RawStop[];
  edges: RawEdge[];
  lines: RawLine[];
  stations: RawStation[];
}

/** prepareNetwork() 결과 — 앱 생애 동안 1개 생성되고 불변으로 다룬다. */
export interface GraphModel {
  data: NetworkData;
  /** 상태 스트라이드 = lines.length + 1 (0 = 도보 상태, k+1 = 노선 k 승차 상태) */
  stride: number;
  /** adj[i] = [다음 정류장, 분, 노선 인덱스|-1] 나열. 양방향 간선은 양쪽 모두에 등록. */
  adj: number[][];
  /** 정류장 평면 좌표 (m). toWorld/toLL로 왕복. */
  x: Float64Array;
  y: Float64Array;
  /** 버킷 키 "cx,cy" → 정류장 인덱스 (주변 검색 인덱스, BUCKET_M 크기) */
  bucket: Map<string, number[]>;
  proj: { lon0: number; lat0: number; mLat: number; mLon: number };
}

/** Dijkstra 결과. state = stopIdx * stride + (line + 1); 0번 슬롯 = 도보 상태. */
export interface Solution {
  dist: Float64Array;
  prev: Int32Array;
  /** 정류장당 최소 도달 시간(분) — 색/등시선/요약 통계의 근거 */
  timeAt: Float64Array;
  stride: number;
}

/** 출발지/도착지 지점. label은 표시용 (예: nearest station name or "경도, 위도"). */
export interface Place {
  label: string;
  point: LngLat;
}

export interface RouteStepWalk {
  kind: "walk";
  points: LngLat[];
  minutes: number;
}

export interface RouteStepRide {
  kind: "ride";
  /** lines 인덱스 */
  line: number;
  from: number;
  to: number;
  points: LngLat[];
  minutes: number;
}

export type RouteStep = RouteStepWalk | RouteStepRide;

export interface Route {
  total: number;
  steps: RouteStep[];
}

/** 400m 격자 도달 시간 필드. Infinity = 도달 불가 (도보 반경 밖 또는 연결 없음). */
export interface IsoGrid {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** 행-major, length = rows*cols, 단위 = 분 */
  times: Float32Array;
}

/** rankings.json 스키마 (v0 build_data.py가 만든 실제 키와 동일). */
export interface RankingsData {
  generated: string;
  note: string;
  /** [노선명, 노선 id, 배차간격 분, 정차 승강장 수] */
  lineHeadwayShort: Array<[string, string, number, number]>;
  lineHeadwayLong: Array<[string, string, number, number]>;
  /** [역 이름, 계획 시간표상 정차 횟수] */
  mostStops: Array<[string, number]>;
  /** [노선명, 노선 id, 끝에서 끝 주행 분, 정차 수] */
  longestTrips: Array<[string, string, number, number]>;
  /** [역 이름, 시청 출발 분] */
  farthestFromCityHall: Array<[string, number]>;
  reachableFromCityHall: { within30: number; totalStations: number };
}
