/** 계산 모델 상수 — build_data.py와 shared로 유지하려면 build_data.py 쪽을 함께 고친다. */

/** 도보 속도 (m/분, 직선거리 기준) */
export const WALK_SPEED = 75;
/** 출발지/도착지에서 도보로 역을 잡는 최대 반경 (m). 등시선 격자도 이 반경 밖은 Infinity. */
export const ACCESS_RADIUS = 1200;
/** 요약 통계 기준 시간 (분): "N분 이내 역 몇 개" */
export const REACH = 30;
/** 등시선/색 상한 기본값 (분) */
export const DEFAULT_MAX = 45;
/** 등시선 격자 크기 (m) — 250 m 이하로 있어야 계단형 잘림이 눈에 띄지 않는다 (감독 지시) */
export const GRID_CELL_M = 250;
/** 정류장 공간 인덱스 버킷 크기 (m) */
export const BUCKET_M = 800;

/** 시간 색 램프 (진함→옅음): t=0이 가장 가까움. v0의 green→amber→red를 채도만 낮춰 유지. */
export const PALETTE: Array<[number, [number, number, number]]> = [
  [0, [47, 150, 18]],
  [0.25, [126, 200, 80]],
  [0.5, [226, 228, 120]],
  [0.75, [244, 182, 112]],
  [1, [230, 120, 120]],
];
export const FAR_COLOR: [number, number, number] = [154, 160, 166];
