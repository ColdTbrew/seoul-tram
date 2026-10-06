/** 범례 카드는 두 덩어리 — 등시선 밴드 색(어디까지 걸음+대기+탑승 기준)과 노선 색.
 * 밴드 색은 지도(fill/점)와 같은 상수(BAND_COLORS_*)를 쓰므로 범례와 지도가 항상 같은 색을 가리킨다. */
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BANDS, BAND_COLORS_DARK, BAND_COLORS_LIGHT, FAR_HEX } from "@/lib/constants.ts";
import { useTheme } from "@/hooks/useTheme.tsx";

/** 등시선 5밴드 + 도달 불가. 지금 강조(focus) 중인 밴드는 테두리로 표시한다. */
export function IsochroneLegend({ focus }: { focus: number }) {
  const { resolved } = useTheme();
  const C = resolved === "dark" ? BAND_COLORS_DARK : BAND_COLORS_LIGHT;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">등시선 · 색</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex items-end gap-1">
          {BANDS.map((t, i) => (
            <span key={t} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{t}분</span>
              <span
                className={`h-2.5 w-full rounded-sm ${
                  focus === t ? "ring-1 ring-foreground ring-offset-1 ring-offset-background" : ""
                }`}
                style={{ background: C[i] }}
              />
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: FAR_HEX, opacity: 0.45 }} />
          90분 넘음 · 못 감 (회색) — 지도의 역 점도 같은 색입니다
        </div>
        <p className="text-[11px] text-muted-foreground">
          진할수록 가깝습니다. 지금은 {focus}분 밴드가 강조 중입니다 — 그 경계에만 굵은 윤곽과 "분" 라벨이 붙습니다.
        </p>
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
