/** 시간 범위 슬라이더 (5단계): 트랙 = 현재 테마의 밴드 팔레트(5색 그라데이션), 썸 = 강조 중 밴드색.
 * 값은 "분"이 아니라 BANDS 인덱스 — 분↔인덱스 변환과 칩과의 양방향 동기화는 호출측(TripPanel)이 한다.
 * Base UI 1.8.0: value를 길이 1 배열로 넘겨도 포인터 경로(트랙 클릭·드래그)는 onValueChange에 숫자를
 * 되돌려준다(단일값일 때 resolveThumbCollision 경로) — 아래 정규화에서 숫자/배열을 모두 배열로 되돌린다.
 * Thumb의 position/translate은 Base UI가 인라인 스타일로 넣는다 (트랙은 overflow-visible여야 썸이 안 짤린다). */
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
      {...props}
      data-slot="slider"
      className={cn("flex w-full touch-none items-center select-none", className)}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onValueChange={
        onValueChange
          ? (value: number | readonly number[]) =>
              onValueChange(Array.isArray(value) ? value : [value as number])
          : undefined
      }
    >
      <SliderPrimitive.Control className="relative flex h-6 flex-1 items-center">
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
