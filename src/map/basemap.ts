/** 베이스맵 스타일 (CARTO 벡터). 테마 → 스타일 URL. © CARTO/OFF 기여자 표기는 MapCanvas에서. */

export const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
export const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export function basemapUrl(theme: "light" | "dark" | "system", systemDark: boolean): string {
  return theme === "dark" || (theme === "system" && systemDark) ? BASEMAP_DARK : BASEMAP_LIGHT;
}
