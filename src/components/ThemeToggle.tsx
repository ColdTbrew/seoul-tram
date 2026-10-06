/** 테마 토글: 라이트 → 다크 → 시스템 순환 (html.dark 클래스와 테마 컨텍스트를 useTheme이 관리). */
import { MonitorUp, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme.tsx";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : MonitorUp;
  const label = theme === "light" ? "라이트 모드 (클릭: 다크)" : theme === "dark" ? "다크 모드 (클릭: 시스템)" : "시스템 설정 (클릭: 라이트)";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      title={label}
      aria-label={label}
      onClick={() => setTheme(next)}
    >
      <Icon className="size-4" />
    </Button>
  );
}
