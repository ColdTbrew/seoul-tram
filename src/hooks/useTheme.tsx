/** 테마 상태: light/dark/system. html 요소에 .dark 클래스 토글, localStorage 저장, 시스템 설정 추적. */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

export interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "seoul-tram-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPref(): Resolved {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    } catch {
      return "system";
    }
  });
  const [system, setSystem] = useState<Resolved>(systemPref);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* 저장 불가(시크릿 모드 등)는 그냥 무시 */
    }
  }, [theme]);

  const resolved: Resolved = theme === "system" ? system : theme;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    // eslint가 아닌 경우를 위해: system이 바뀌면 resolved도 바뀌므로 의존성에 충분하다
    [theme, system],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme는 <ThemeProvider> 안에서만 쓸 수 있습니다.");
  return ctx;
}
