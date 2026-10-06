/** 안내(tab 3): 비용 모델 + 가정/한계 + 데이터 출처 — 지도가 깨져도 이 탭은 동작해야 한다. */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GraphModel } from "@/lib/types.ts";

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-[7.5rem] shrink-0 font-mono text-[11px]">{k}</span>
      <span className="text-muted-foreground">{v}</span>
    </div>
  );
}

export function AboutView({ model }: { model: GraphModel }) {
  const m = model.data.meta;
  return (
    <div className="grid max-w-3xl gap-3 p-3 text-xs leading-snug">
      <Card>
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">읽는 법</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p>
            등시선 윤곽 하나 = 출발지에서 <b className="font-medium">그 시간 안에 걸어갈 수 있는 곳 전체</b> (도보 + 승차
            대기 + 탑승 포함). 색이 옅을수록 먼 곳이며, 회색에 가까울수록 도달이 어렵거나 오래 걸립니다.
          </p>
          <p>지도 클릭 = 도착 선택 (가까운 역이든 임의 지점이든). 초록 점(출발지)은 드래그로 옮길 수 있습니다.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">비용 모델 (정확도의 핵심)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Line k="도보" v="직선 75 m/분 — 개찰구·출구 내 이동도 도보로 합산" />
          <Line k="승차/환승" v="노선 평균 배차간격 ÷ 2 = 승차 대기 (1~15분 클램프)" />
          <Line k="환승" v="같은 역 안 승강장 간 이동도 시간으로 계산 (정류장 = 승강장 단위)" />
          <Line k="등시선" v="150 m 격자 + 매끄러운 닫힌 링 — 도달 불가 지역은 채우지 않음" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">가정 · 한계</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <p>
            • 승강장 여러 개를 <b className="font-medium">한 노드</b>로 다룸 — 환승 페널티(실제 환승 시간)는 승강장 간
            이동 + 대기 근사로만 반영되며, 별도 환승 벌점은 없습니다.
          </p>
          <p>• 출근시간대 평일 시간표 기준 — 시간대·요일 구분 없이 상시 평균으로 계산합니다.</p>
          <p>• 도보 거리는 직선거리 — 실제로 돌아가야 하는 강·언덕·담장은 고려하지 않습니다.</p>
          <p>• 실시간 운행 정보가 아닌 정적 사이트입니다. (v0에서 삭제된 v1 기능: 실시간 도착 조회 연동)</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1.5">
          <CardTitle className="text-sm">데이터 · 출처</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-muted-foreground">
          <p>{m.sources}</p>
          <p>
            베이스맵 스타일 © OpenStreetMap contributors © CARTO (Positron · Dark Matter, Lite 빌드) · 렌더링 엔진:
            MapLibre GL JS + CARTO 벡터 타일. 데이터 생성 시각: {m.generated}.
          </p>
          <p>알고리즘 아이디어 오경: «À portée de tram» (tram.camilleroux.com, MIT © Camille Roux).</p>
        </CardContent>
      </Card>
    </div>
  );
}
