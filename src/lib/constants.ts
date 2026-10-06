/** 계산 모델 상수 — build_data.py와 shared로 유지하려면 build_data.py 쪽을 함께 고친다. */

/** 도보 속도 (m/분, 직선거리 기준) */
export const WALK_SPEED = 75;
/** 출발지/도착지에서 도보로 역을 잡는 최대 반경 (m). 등시선 격자도 이 반경 밖은 Infinity. */
export const ACCESS_RADIUS = 1200;
/** 등시선 격자 크기 (m) — 150 m 이하로 있어야 계단형 잘림이 눈에 띄지 않는다. */
export const GRID_CELL_M = 150;
/** 등시선 밴드 (항상 전부 그린다): ≤15 / ≤30 / ≤45 / ≤60 / ≤90분 */
export const BANDS: number[] = [15, 30, 45, 60, 90];
/** 격자·블러의 시간 상한 (분). 등치선 값 뒤집기(ISO_CAP − t)와 미도달 표현에 쓴다. */
export const ISO_CAP = 120;
/** 블러 가우시안 시그마 (격자 셀 단위). 커널 반경 = ceil(3σ) = 4셀. */
export const ISO_BLUR_SIGMA = 1.2;
/** 이보다 작은 섬(m²)은 버린다 — 격자 노이즈·고립 섬 */
export const ISO_MIN_ISLAND_M2 = 250_000;
/** 이보다 작은 구멍(m²)은 버린다 (바깥링이 살아 있는 한 그 안은 채운다) */
export const ISO_MIN_HOLE_M2 = 150_000;
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

/** 밴드 색 (가까움 → 멂). 라이트 = Vercel 블루 계열, 다크 = Vercel 시안/틸 계열.
 * 등시선 fill/line·역 점·범례가 모두 이 다섯 값을 쓴다 (테마별로 분리). */
export const BAND_COLORS_LIGHT = ["#0047d6", "#1f6fff", "#4f8dff", "#86b0ff", "#bdd3ff"];
export const BAND_COLORS_DARK = ["#5ff5d9", "#3ddbc4", "#2bb5a8", "#21898a", "#1b6470"];
/** 도달 불가 색 (범례·역 점 공통) */
export const FAR_HEX = "#9aa0a6";
