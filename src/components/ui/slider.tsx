/** 시간 범위 슬라이더 (5단계): 트랙 = 현재 테마의 밴드 팔레트(5색 그라데이션), 썸 = 강조 중 밴드색.
 * 값은 "분"이 아니라 BANDS 인덱스 — 분↔인덱스 변환과 칩과의 양방향 동기화는 호출측(TripPanel)이 한다.
 * Thumb의 position/translate 은 Base UI가 인라인 스타일로 넣는다 (tracks는 overflow-visible 여야 썸이 안 짤린다). */
import type { CSSProperties } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "cn";

interface SliderProps {
  className?: string;
  /** 트랙 배경 (그라데이션 등). 생략하면 muted 단색. */
  trackStyle?: CSSProperties;
  /** 썸 배경/테두리 등 (강조 중인 밴드색을 여기에 흘려보낸다). */
  thumbStyle?: CSSProperties;
  "aria-label"?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: readonly number[];
  onValueChange?: (value: readonly number[]) => void;
}

export function Slider({ className, trackStyle, thumbStyle, onValueChange, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("flex w-full touch-none items-center select-none", className)}
      onValueChange={onValueChange ? (value) => onValueChange(value) : undefined}
      {...props}
    >
      <SliderPrimitive.Control className="relative h-5 flex-1">
        <SliderPrimitive.Track
          className="relative h-1.5 w-full select-none rounded-full bg-muted"
          style={trackStyle}
        >
          <SliderPrimitive.Indicator className="hidden" />
          <SliderPrimitive.Thumb
            className="block size-5 rounded-full border-2 shadow-sm outline-none"
            style={thumbStyle}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
