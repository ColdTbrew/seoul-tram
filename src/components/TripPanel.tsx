/** 출발/도착 검색, 등시선 밴드 강조, 요약 배지, 경로 카드 — 사이드바의 내용물 (레이아웃은 App이 담당). */
import { ArrowDownUp, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StationSearch } from "./StationSearch.tsx";
import { fmtTime } from "@/lib/format.ts";
import { BANDS } from "@/lib/constants.ts";
import type { GraphModel, Place, Route } from "@/lib/types.ts";

interface Props {
  model: GraphModel;
  origin: Place | null;
  dest: Place | null;
  onOrigin: (p: Place | null) => void;
  onDest: (p: Place) => void;
  swap: () => void;
  reset: () => void;
  focus: number;
  onFocus: (t: number) => void;
  summary: {
    withinReach: number;
    totalStations: number;
    reachMinutes: number;
    farthest: { name: string; minutes: number } | null;
  } | null;
  route: Route | null;
  /** 패널을 닫을 때 (전체 폭 지도가 다시 보이게). 없으면 닫기 버튼을 그리지 않는다. */
  onClose?: () => void;
}

export function TripPanel(p: Props) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">이동 계획</CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={p.swap} title="출발/도착 교환">
                <ArrowDownUp className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={p.reset}>
                <RotateCcw className="size-3.5" />
                초기화
              </Button>
              {p.onClose && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label="패널 닫기"
                  title="패널 닫기"
                  onClick={p.onClose}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <StationSearch
            label="출발"
            placeholder="출발역 또는 좌표"
            data={p.model.data}
            value={p.origin}
            onPick={p.onOrigin}
          />
          <StationSearch
            label="도착"
            placeholder="도착역 또는 좌표"
            data={p.model.data}
            value={p.dest}
            onPick={p.onDest}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">등시선 (소요 시간 등고선)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          <p className="w-full pb-0.5 text-[11px] text-muted-foreground">
            5개 밴드를 항상 그립니다 — 고른 밴드만 윤곽·라벨로 강조합니다.
          </p>
          {BANDS.map((t) => (
            <button
              key={t}
              onClick={() => p.onFocus(t)}
              className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors ${
                p.focus === t
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              ≤{t}분
            </button>
          ))}
        </CardContent>
      </Card>

      {p.summary && (
        <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">개요</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 font-mono text-[11px]">
          <span className="rounded-md border border-border bg-secondary px-2 py-1 text-secondary-foreground">
            {p.summary.reachMinutes}분 이내역 {p.summary.withinReach}/{p.summary.totalStations}
          </span>
          {p.summary.farthest && (
            <span className="rounded-md border border-border bg-secondary px-2 py-1 text-secondary-foreground">
              최원격 {p.summary.farthest.name} · {fmtTime(p.summary.farthest.minutes)}
            </span>
          )}
        </CardContent>
        </Card>
      )}

      {p.dest && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">경로</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            {!p.route && <p className="text-muted-foreground">지하철로 도달할 수 없습니다.</p>}
            {p.route?.steps.map((s, i) => {
              if (s.kind === "walk") {
                return (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground">도보</span>
                    <span className="font-mono">{fmtTime(s.minutes)}</span>
                  </div>
                );
              }
              const line = p.model.data.lines[s.line];
              const from = p.model.data.stops[s.from]?.n ?? "?";
              const to = p.model.data.stops[s.to]?.n ?? "?";
              return (
                <div key={i} className="flex items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-1.5">
                    <span className="size-2 translate-y-px shrink-0 rounded-full" style={{ background: line?.color }} />
                    {line?.name ?? "이동"} · {from} → {to}
                  </span>
                  <span className="font-mono">{fmtTime(s.minutes)}</span>
                </div>
              );
            })}
            {p.route && (
              <div className="flex items-baseline justify-between border-t border-border/60 pt-1.5 font-mono text-[11px]">
                <span>총 소요</span>
                <span>{fmtTime(p.route.total)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
