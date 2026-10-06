/** NAVER Maps JS API v3 스크립트 로드 + 인증 상태.
 * Client ID는 .env.local의 VITE_NAVER_MAPS_CLIENT_ID (gitignore됨 — 값/키를 소스에 남기지 않는다).
 * 로드 실패/인증 실패/키 없음은 모두 error로 되돌린다. 지도가 깨져도 앱 나머지
 * (검색·순위·경로 텍스트)는 계속 동작해야 한다 — 이 모듈은 지도 영역만 담당한다. */

/** 스크립트/도메인 인증 오류가 한 번이라도 나면 true (MapCanvas가 라우팅 처리 없이 이걸 UI로 보여준다). */
let authFailureSeen = false;

function isAuthFailed(): boolean {
  return authFailureSeen;
}

function markAuthFailed(): void {
  authFailureSeen = true;
}

function finishError(reject: (e: Error) => void, message: string): void {
  reject(new Error(message));
}

export function loadNaverMaps(): Promise<void> {
  const w = window as unknown as { naver?: { maps?: { Map?: unknown } }; navermap_authFailure?: () => void };
  if (w.naver?.maps?.Map) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    if (authFailureSeen) {
      finishError(reject, "네이버 지도 인증이 실패한 상태입니다 — 페이지 URL이 네이버 클라우드 콘솔의 서비스 URL 등록과 일치하는지 확인하세요.");
      return;
    }
    // 로드 전에 전역 훅을 정의한다 (네이버가 인증 실패 시 이 함수를 부른다)
    w.navermap_authFailure = () => {
      markAuthFailed();
    };

    const key = (import.meta.env as Record<string, string | undefined>).VITE_NAVER_MAPS_CLIENT_ID?.trim();
    if (!key) {
      finishError(reject, "네이버 지도 Client ID가 없습니다 (VITE_NAVER_MAPS_CLIENT_ID). 지도 없이도 검색·순위·경로 텍스트는 동작합니다.");
      return;
    }

    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(key)}`;
    script.async = true;
    script.onerror = () => finishError(reject, "네이버 지도 스크립트를 내리지 못했습니다 (네트워크/프록시/광고 차단 확인).");
    script.onload = () => {
      // 스크립트가 로드된 뒤에도 Map 클래스 생성까지 시간이 걸릴 수 있어 최대 5초 대기
      const started = performance.now();
      const tick = () => {
        if (isAuthFailed()) {
          finishError(reject, "네이버 지도 인증 실패 — 이 페이지의 URL(도메인/포트/경로)이 네이버 클라우드 콘솔의 서비스 URL 등록과 일치하는지 확인하세요.");
          return;
        }
        if (w.naver?.maps?.Map) {
          resolve();
        } else if (performance.now() - started < 5000) {
          window.setTimeout(tick, 120);
        } else {
          finishError(reject, "네이버 지도가 초기화되지 않았습니다. 키가 잘못됐거나 이 페이지의 URL이 서비스 URL로 등록되지 않았을 수 있습니다.");
        }
      };
      tick();
    };
    document.head.appendChild(script);
  });
}

/** Map 인스턴스 생성 (중앙 = [경도, 위도]). */
export function createMap(nm: Record<string, any>, el: HTMLElement, center: [number, number], zoom: number): any {
  return new nm.Map(el, {
    center: new nm.LatLng(center[1], center[0]),
    zoom,
    zoomRange: { min: 7, max: 17 },
    backgroundColor: "#e5e7eb",
  });
}

/** 이벤트 등록 헬퍼 (v3 문서/타입에 Event와 event가 혼재 — 둘 다 시도) */
export function onMapEvent(nm: Record<string, any>, map: unknown, event: string, handler: (e: any) => void): void {
  const evt = nm.Event ?? nm.event;
  evt?.addListener?.(map, event, handler);
}

/** 지도 클릭 이벤트 → [경도, 위도] ( 이벤트 필드/배열 순서가 문서마다 다른 데 방어적으로 대응) */
export function clickCoord(e: { coord?: any; coordinates?: any }): [number, number] | null {
  const c = e.coord ?? e.coordinates;
  if (!c) return null;
  if (typeof c.getLng === "function" && typeof c.getLat === "function") return [c.getLng(), c.getLat()];
  if (Array.isArray(c) && c.length === 2) return [c[1], c[0]]; // naver 배열 리터럴은 [lat, lng] 순서
  return null;
}

/** 줌/위도 → 1px당 m (클릭 히트 반경 계산용, v0과 같은 근사식) */
export function metersPerPixel(zoom: number, lat: number): number {
  return (156543.033928041 / Math.pow(2, zoom)) * Math.cos((lat * Math.PI) / 180);
}
