// PK-FR-10 · TF5 · giao diện sáng / tối / theo máy (`html[data-theme]`), nhớ theo trình duyệt. Nguồn: mgmt-app theme.ts.
import { useCallback, useEffect, useState } from "react";

export type Theme = "auto" | "light" | "dark";
export const THEME_KEY = "theme";

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "auto" ? v : "light";
  } catch {
    return "light";
  }
}

/** `auto` bỏ thuộc tính để CSS theo `prefers-color-scheme`. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  if (t === "auto") delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(storedTheme);
  useEffect(() => applyTheme(t), [t]);
  const set = useCallback((x: Theme) => {
    setT(x);
    try {
      if (x === "light") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, x);
    } catch {
      // không lưu được
    }
  }, []);
  return [t, set];
}
