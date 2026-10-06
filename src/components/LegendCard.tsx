/** 범례 카드는 두 덩어리 — 등시선 색(어디까지 걸음+대기+탑승 기준)과 노선 색. */
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_MAX, PALETTE } from "@/lib/constants.ts";
import { fmtTime } from "@/lib/format.ts";

const RAMP_SAMPLES: Array<{ label: string; t: number }> = [
  { label: "가장 가까움", t: 0 },
  { label: "약 25분", t: 0.55 },
  { label: `약 ${DEFAULT_MAX}분 이상`, t: 1.05 },
  { label: "도보·대기·탑승 없이 도달 불가", t: 2 },
];

function rampColor(t: number): string {
  if (t > 1) return "rgb(154,160,166)";
  for (let i = 1; i < PALETTE.length; i += 1) {
    const [stop, color] = PALETTE[i]!;
    if (t <= stop) {
      const [p, prev] = PALETTE[i - 1]!;
      const f = (t - p) / (stop - p);
      return `rgb(${prev.map((c, k) => Math.round(c + (color[k] - c) * f)).join(",")})`;
    }
  }
  return "rgb(154,160,166)";
}

export function IsochroneLegend({ isos }: { isos: number[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">등시선 · 색</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-center gap-1">
          {isos.length === 0 && <span className="text-muted-foreground">등시선 없음 — 체크하면 지도에 윤곽이 나타납니다.</span>}
          {isos.map((t) => (
            <span
              key={t}
              className="rounded-sm border border-border/60 bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
            >
              ≤{t}분
            </span>
          ))}
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-sm">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <div key={t} className="h-full flex-1" style={{ background: rampColor(t) }} />
          ))}
        </div>
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>가까움 · {fmtTime(DEFAULT_MAX * 0.5)} 이내</span>
          <span>멂 · {DEFAULT_MAX}분</span>
        </div>
        <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
          {RAMP_SAMPLES.slice(2).map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <span
                className="size-2.5 rounded-full"
                style={{ background: rampColor(s.t), opacity: s.t > 1.5 ? 0.35 : 0.85 }}
              />
              {s.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function LineLegend({ lines }: { lines: Array<{ id: string; name: string; color: string }> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">노선</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-44">
          <div className="flex flex-wrap gap-1.5 pr-2 text-[11px] leading-none">
            {lines.map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2 py-1 text-secondary-foreground"
              >
                <span className="size-2 rounded-full" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
