/** App 셸: 탭(지도/역 순위/정보) + URL 상태(?from=&to=) + 전체 폭 지도 위에 떠 있는 접이식 패널.
 * 순수 파생(Dijkstra/격자/링)은 useTripPlan, 지도 명령형 상호작용은 MapCanvas — 여기는 배선만. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
/** 패널 열린/닫힘 상태를 탭 전환·새로고침을 넘어 유지 (기본 열림). */
const PANEL_KEY = "seoul-tram:panel";
type Tab = "iso" | "rank" | "about";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "iso", label: "지도" },
  { id: "rank", label: "역 순위" },
  { id: "about", label: "정보" },
];

/** 데스크톱(lg 이상) 여부 — 열린 패널이 지도의 어느 가장자리를 덮는지 알 때 쓴다 (좁은 화면은 아래 시트). */
function useIsDesktop() {
  const [d, setD] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const m = matchMedia("(min-width: 1024px)");
    const f = () => setD(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return d;
}

export default function App() {
  const { model, error } = useNetworkData();
  const { resolved } = useTheme();
  const [tab, setTab] = useState<Tab>("iso");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [focus, setFocus] = useState<number>(DEFAULT_FOCUS);
  const [resetSignal, setResetSignal] = useState(0);
  const inited = useRef(false);
  const [panelOpen, setPanelOpenState] = useState(() => sessionStorage.getItem(PANEL_KEY) !== "closed");
  const setPanelOpen = useCallback((v: boolean) => {
    setPanelOpenState(v);
    sessionStorage.setItem(PANEL_KEY, v ? "open" : "closed");
  }, []);
  // 접기는 한 번만: 지도를 직접 움직이거나 닫기 버튼을 누르거나. 다시 여는 건 사용자의 클릭뿐.
  const onUserMove = useCallback(() => setPanelOpen(false), [setPanelOpen]);
  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen]);

  // 열려 있는 패널/시트가 가리는 폭만큼 지도 중심을 밀어낸다 (닫으면 원위치).
  const isDesktop = useIsDesktop();
  const mapPadding = useMemo(
    () =>
      !panelOpen
        ? { left: 0, bottom: 0 }
        : isDesktop
          ? { left: 344, bottom: 0 }
          // 하단 시트가 max-h-[55dvh]라서 여백도 55%로 맞춘다 (50%로 두면 시트가 아래 여백까지 덮는다)
          : { left: 0, bottom: Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.55) },
    [panelOpen, isDesktop],
  );

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
        <p className="font-medium text-foreground">데이터를 불러오지 못했습니다</p>
        <p className="font-mono text-xs">{error}</p>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">지하철 노선을 불러오는 중…</div>
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
        <h1 className="text-[13px] font-semibold tracking-tight">서울 지하철 시간 지도</h1>
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
        <main className="relative min-h-0 flex-1 overflow-hidden">
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
            onUserMove={onUserMove}
            padding={mapPadding}
          />

          {/* 데스크톱(lg 이상): 지도 위에 떠 있는 패널. 접으면 지도가 다시 전체 폭을 쓰고 클릭이 통과한다. */}
          <div
            className={`absolute left-3 top-3 bottom-3 z-20 hidden w-80 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur transition-[transform,opacity] duration-300 ease-out ${
              panelOpen ? "lg:flex translate-x-0 opacity-100" : "pointer-events-none hidden -translate-x-[calc(100%+1rem)] opacity-0"
            }`}
          >
            <div className="sticky top-0 z-10 -mx-1 -mt-1 flex items-center justify-between bg-background/95 px-1 pb-1 backdrop-blur">
              <span className="text-xs font-medium text-muted-foreground">이동·시간 설정</span>
              <Button variant="ghost" size="icon" className="size-7 rounded-full" aria-label="패널 닫기" title="패널 닫기" onClick={closePanel}>
                <X className="size-4" />
              </Button>
            </div>
            {searchPanel}
            <IsochroneLegend focus={focus} />
            <LineLegend lines={model.data.lines} />
          </div>

          {/* 모바일(lg 미만): 아래에서 올라오는 시트. 손잡이 = 스크롤 영역의 일부로 함께 올라간다. */}
          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex max-h-[55dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-lg backdrop-blur transition-transform duration-300 ease-out lg:hidden ${
              panelOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
            }`}
          >
            <div className="relative flex h-9 shrink-0 items-center justify-center">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              <Button variant="ghost" size="icon" className="absolute right-2 top-1 size-7 rounded-full" aria-label="패널 닫기" title="패널 닫기" onClick={closePanel}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-0">
              {searchPanel}
              <IsochroneLegend focus={focus} />
            </div>
          </div>

          {/* 닫힌 뒤에는 이것만 지도 위에 남는다 (열림 때는 투명+클릭 통과 → 지도가 곧바로 받는다) */}
          <Button
            variant="outline"
            size="icon"
            aria-label="패널 열기"
            title="패널 열기"
            onClick={() => setPanelOpen(true)}
            className={`absolute left-3 top-3 z-20 transition-opacity duration-300 ${
              panelOpen ? "pointer-events-none opacity-0" : ""
            }`}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </main>
      )}

      {tab === "rank" && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <RankingsView summary={plan.summary} />
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
