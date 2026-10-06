/** App 셸: 탭(등시선/순위/안내) + URL 상태(?from=&to=) + 데스크톱 사이드바/모바일 풀블리드 맵.
 * 순수 파생(Dijkstra/격자/링)은 useTripPlan, 지도 명령형 상호작용은 MapCanvas — 여기는 배선만. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapCanvas, type MapPick } from "./map/MapCanvas.tsx";
import { TripPanel } from "./components/TripPanel.tsx";
import { RankingsView } from "./components/RankingsView.tsx";
import { AboutView } from "./components/AboutView.tsx";
import { IsochroneLegend, LineLegend } from "./components/LegendCard.tsx";
import { ThemeToggle } from "./components/ThemeToggle.tsx";
import { useNetworkData } from "./hooks/useNetworkData.ts";
import { useTheme } from "./hooks/useTheme.tsx";
import { useTripPlan } from "./hooks/useTripPlan.ts";
import { defaultOrigin, resolveQuery } from "./lib/search.ts";
import { routeTo } from "./lib/graph.ts";
import type { Place } from "./lib/types.ts";

const DEFAULT_FOCUS = 30;
type Tab = "iso" | "rank" | "about";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "iso", label: "시간 등시선" },
  { id: "rank", label: "역 순위" },
  { id: "about", label: "안내" },
];

export default function App() {
  const { model, error } = useNetworkData();
  const { resolved } = useTheme();
  const [tab, setTab] = useState<Tab>("iso");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [focus, setFocus] = useState<number>(DEFAULT_FOCUS);
  const [resetSignal, setResetSignal] = useState(0);
  const inited = useRef(false);

  // ?from=&to= 복원(북마크/공유 링크) — 데이터 준비 뒤 1회
  useEffect(() => {
    if (!model || inited.current) return;
    inited.current = true;
    const q = new URLSearchParams(window.location.search);
    const from = resolveQuery(model.data, q.get("from") ?? "");
    const to = resolveQuery(model.data, q.get("to") ?? "");
    // ?from= 이 없으면 기본 출발지로 되된다 — 둘 다 역 클러스터 좌표를 쓰는 같은 좌표 규칙 (수치 통일)
    setOrigin(from ?? defaultOrigin(model.data));
    setDest(to);
  }, [model]);

  // 상태 → URL 동기화 (새로고침 시 같은 뷰 재현)
  useEffect(() => {
    if (!inited.current) return;
    const q = new URLSearchParams();
    if (origin) q.set("from", origin.label);
    if (dest) q.set("to", dest.label);
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [origin, dest]);

  const plan = useTripPlan(model, origin, focus);

  const route = useMemo(
    () => (model && origin && dest && plan.solution ? routeTo(model, plan.solution, origin.point, dest.point) : null),
    [model, origin, dest, plan.solution],
  );

  // 지도 클릭 = 도착 선택 (가까운 역이든 임의 지점이든). 출발은 검색/드래그로만 바꾼다.
  const onPick = useCallback((pick: MapPick) => {
    setDest(
      pick.kind === "stop"
        ? { label: pick.name, point: pick.ll }
        : { label: `${pick.ll[0].toFixed(4)}, ${pick.ll[1].toFixed(4)}`, point: pick.ll },
    );
  }, []);

  const swap = useCallback(() => {
    setOrigin(dest);
    setDest(origin);
  }, [origin, dest]);

  const reset = useCallback(() => {
    if (!model) return;
    setOrigin(defaultOrigin(model.data));
    setDest(null);
    setFocus(DEFAULT_FOCUS);
    setResetSignal((n) => n + 1);
  }, [model]);

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">데이터 로드 실패</p>
        <p className="font-mono text-xs">{error}</p>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">노선망 로딩 중…</div>
    );
  }

  const searchPanel = (
    <TripPanel
      model={model}
      origin={origin}
      dest={dest}
      onOrigin={setOrigin}
      onDest={setDest}
      swap={swap}
      reset={reset}
      focus={focus}
      onFocus={setFocus}
      summary={plan.summary}
      route={route}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <h1 className="text-[13px] font-semibold tracking-tight">서울 지하철 · 시간 등시선</h1>
        <nav className="ml-2 flex items-center gap-0.5 text-xs">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-2 py-1 transition-colors ${
                tab === t.id ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
        </div>
      </header>

      {tab === "iso" && (
        <main className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-border lg:block">
            <div className="flex h-full flex-col gap-3 p-3">
              {searchPanel}
              <IsochroneLegend focus={focus} />
              <LineLegend lines={model.data.lines} />
            </div>
          </aside>
          <div className="relative min-h-0 w-full min-w-0 flex-1 lg:w-auto">
            <MapCanvas
              model={model}
              resolved={resolved}
              solution={plan.solution}
              grid={plan.grid}
              focus={focus}
              contours={plan.contours}
              stopsFC={plan.stopsFC}
              route={route}
              origin={origin?.point ?? null}
              dest={dest?.point ?? null}
              onPick={onPick}
              resetSignal={resetSignal}
            />
            {/* 모바일: 풀블리드 맵 위 부상 검색 카드 (지도 아래쪽은 터치 유지) */}
            <div className="absolute inset-x-3 top-3 z-20 max-h-[52dvh] overflow-y-auto rounded-xl border border-border bg-background/95 shadow-sm backdrop-blur lg:hidden">
              {searchPanel}
            </div>
          </div>
        </main>
      )}

      {tab === "rank" && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <RankingsView origin={origin?.label ?? null} summary={plan.summary} />
        </main>
      )}
      {tab === "about" && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <AboutView model={model} />
        </main>
      )}
    </div>
  );
}
