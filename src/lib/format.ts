/** 표시용 포맷/색 헬퍼 — DOM·React를 모른다 (단위 테스트 가능하게 유지). */
import { FAR_COLOR, PALETTE } from "./constants.ts";

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** 평면좌표(m) 두 점 사이 직선거리 (m) */
export const dist2 = (a: [number, number], b: [number, number]): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 분 → 표기: 60분 미만 "40분", 정각 "2시간", 그 외 "2시간 6분" (소수 분은 반올림, 0 패딩 없음). */
export function fmtTime(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1) return "1분 미만";
  if (m < 60) return `${Math.round(m)}분`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m - h * 60);
  return mm === 0 ? `${h}시간` : `${h}시간 ${mm}분`;
}

/** t = 0(가슴/진함)~1(멂/옅음). 1 초과는 먼 지역 회색. 반환은 [r,g,b] 0~255. */
export function paletteColor(t: number): [number, number, number] {
  if (t > 1) return FAR_COLOR;
  for (let i = 1; i < PALETTE.length; i += 1) {
    const [stop, color] = PALETTE[i]!;
    if (t <= stop) {
      const [p, prev] = PALETTE[i - 1]!;
      const f = (t - p) / (stop - p);
      return [
        Math.round(prev[0] + (color[0] - prev[0]) * f),
        Math.round(prev[1] + (color[1] - prev[1]) * f),
        Math.round(prev[2] + (color[2] - prev[2]) * f),
      ];
    }
  }
  return FAR_COLOR;
}

export const rgb = (c: [number, number, number]): string => `rgb(${c[0]},${c[1]},${c[2]})`;
