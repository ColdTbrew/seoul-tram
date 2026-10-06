/** 순위(tab 2): rankings.json의 사전 계산 통계를 표 없이 가볍게 — Vercel 식 단행 목록. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtTime } from "@/lib/format.ts";
import { useRankings } from "@/hooks/useNetworkData.ts";
import type { RankingsData } from "@/lib/types.ts";

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="truncate text-foreground">{left}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{right}</span>
    </div>
  );
}

function Section({
  title,
  caption,
  rows,
}: {
  title: string;
  caption: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Card>
      <CardHeader className="pb-1.5">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="pt-1 text-[11px] leading-snug text-muted-foreground">{caption}</p>
      </CardHeader>
      <CardContent className="text-xs">{rows.map(([l, r]) => <Row key={l + r} left={l} right={r} />)}</CardContent>
    </Card>
  );
}

function fmtHeadway(min: number): string {
  return `${min}분`;
}

function listToRows(d: RankingsData): Array<{ title: string; caption: string; rows: Array<[string, string]> }> {
  return [
    {
      title: "주파수 최상위 (출근길 기준)",
      caption: "평일 아침 배차간격이 짧은 노선 — 숫자 = 평균 배차간격 · 정차 승강장 수",
      rows: d.lineHeadwayShort.map(([n, , h, stops]) => [n, `${fmtHeadway(h)} · ${stops}개 승강장`] as [string, string]),
    },
    {
      title: "주파수 최하위",
      caption: "배차간격이 가장 긴 노선 — 교외선·지선급",
      rows: d.lineHeadwayLong.map(([n, , h, stops]) => [n, `${fmtHeadway(h)} · ${stops}개 승강장`] as [string, string]),
    },
    {
      title: "계획상 정차 횟수 최다 역",
      caption: "상·하행 모든 정차역을 센 횟수 — 환승 복잡도(정차역 4개는 한 승강장이 4개일 수 있음)와 다름",
      rows: d.mostStops.map(([n, c]) => [n, `${c}회`] as [string, string]),
    },
    {
      title: "가장 긴 완주",
      caption: "노선 끝에서 끝까지 계획 시간표상 주행 시간",
      rows: d.longestTrips.map(([n, , m, stops]) => [n, `${fmtTime(m)} · 정차 ${stops}회`] as [string, string]),
    },
    {
      title: "시청에서 가장 먼 역",
      caption: "시청 출발 최적 경로의 문 앞까지 총 시간",
      rows: d.farthestFromCityHall.map(([n, m]) => [n, fmtTime(m)] as [string, string]),
    },
  ];
}

export function RankingsView() {
  const state = useRankings();
  if (state.kind === "loading") return <p className="p-6 text-sm text-muted-foreground">순위 데이터 로딩 중…</p>;
  if (state.kind === "error") return <p className="p-6 text-sm text-muted-foreground">rankings.json 로드 실패: {state.message}</p>;

  const sections = listToRows(state.data);
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      <Card className="md:col-span-2 xl:col-span-3">
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="text-muted-foreground">시청 출발 30분 이내 도달 역 {state.data.reachableFromCityHall.within30}개</span>
          <span className="text-muted-foreground">전체 {state.data.reachableFromCityHall.totalStations}개 역 기준</span>
          <span className="text-muted-foreground">생성일 {state.data.generated}</span>
        </CardContent>
      </Card>
      {sections.map((s) => (
        <Section key={s.title} title={s.title} caption={s.caption} rows={s.rows} />
      ))}
    </div>
  );
}
