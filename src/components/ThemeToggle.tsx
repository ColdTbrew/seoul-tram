/** 테마 토글: 라이트 ↔ 다크 토글 (처음엔 시스템 설정을 따르고, 누르면 resolved의 반대로 고정). */
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme.tsx";

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const toDark = resolved === "light";
  const label = toDark ? "다크 모드로 전환" : "라이트 모드로 전환";
  // 아이콘 = 지금 모드 (라이트일 때 해, 다크일 때 달)
  const Icon = toDark ? Sun : Moon;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      title={label}
      aria-label={label}
      onClick={() => setTheme(toDark ? "dark" : "light")}
    >
      <Icon className="size-4" />
    </Button>
  );
}
