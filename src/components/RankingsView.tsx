/** 순위(tab 2): rankings.json의 미리 계산한 통계를 표 없이 가볍게 — 한 칸 목록. */
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
      title: "배차가 잦은 노선 (출근길 기준)",
      caption: "평일 아침 배차간격이 짧은 노선 — 숫자는 평균 배차간격과 정차 승강장 수",
      rows: d.lineHeadwayShort.map(([n, , h, stops]) => [n, `${fmtHeadway(h)} · ${stops}개 승강장`] as [string, string]),
    },
    {
      title: "배차가 뜸한 노선",
      caption: "배차간격이 가장 긴 노선 — 교외선·지선급",
      rows: d.lineHeadwayLong.map(([n, , h, stops]) => [n, `${fmtHeadway(h)} · ${stops}개 승강장`] as [string, string]),
    },
    {
      title: "정차가 가장 많은 역",
      caption: "상·하행 정차 승강장을 모두 썬 횟수 — 한 역이 여러 승강장일 수 있어 역을 세는 것과 다릅니다",
      rows: d.mostStops.map(([n, c]) => [n, `${c}회`] as [string, string]),
    },
    {
      title: "종점까지 가장 긴 노선",
      caption: "노선 끝에서 끝까지 계획 시간표상 주행 시간 — 미리 계산한 값",
      rows: d.longestTrips.map(([n, , m, stops]) => [n, `${fmtTime(m)} · 정차 ${stops}회`] as [string, string]),
    },
    {
      title: "시청에서 가장 먼 역",
      caption: "시청 출발 가장 빠른 경로의 총 시간 — 미리 계산한 값 (승강장 사이만 · 도보 제외)",
      rows: d.farthestFromCityHall.map(([n, m]) => [n, fmtTime(m)] as [string, string]),
    },
  ];
}

interface Props {
  /** 지도와 같은 계산(useTripPlan)의 결과 — 없으면 rankings.json의 미리 계산한 값으로 되돈다 */
  summary: { withinReach: number; totalStations: number; reachMinutes: number } | null;
}

export function RankingsView({ summary }: Props) {
  const state = useRankings();
  if (state.kind === "loading") return <p className="p-6 text-sm text-muted-foreground">순위를 불러오는 중…</p>;
  if (state.kind === "error") return <p className="p-6 text-sm text-muted-foreground">순위를 불러오지 못했습니다: {state.message}</p>;

  const d = state.data;
  // 지도 개요와 같은 수치가 보이게 한다 — 순위 탭의 기준값을 사전 계산(승강장·대기 제외)으로 두면
  // 같은 "시청 30분 이내"가 화면마다 145/138/120으로 갈린다.
  const head = summary
    ? {
        minutes: summary.reachMinutes,
        count: summary.withinReach,
        total: summary.totalStations,
        note: "이동 계획과 같은 실시간 계산",
      }
    : {
        minutes: 30,
        count: d.reachableFromCityHall.within30,
        total: d.reachableFromCityHall.totalStations,
        note: "미리 계산한 값 (승강장 사이만 · 도보 제외)",
      };

  const sections = listToRows(d);
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      <Card className="md:col-span-2 xl:col-span-3">
        <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="text-muted-foreground">{head.minutes}분 안에 갈 수 있는 역 {head.count}곳</span>
          <span className="text-muted-foreground">전체 {head.total}곳</span>
          <span className="text-muted-foreground">{head.note} · 생성일 {d.generated}</span>
        </CardContent>
      </Card>
      {sections.map((s) => (
        <Section key={s.title} title={s.title} caption={s.caption} rows={s.rows} />
      ))}
    </div>
  );
}
