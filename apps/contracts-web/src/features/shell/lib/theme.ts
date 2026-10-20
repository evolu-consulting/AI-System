// PK-FR-10 · TF5 · giao diện sáng / tối / theo máy (`html[data-theme]`), nhớ theo trình duyệt. Nguồn: mgmt-app theme.ts.
import { useCallback, useEffect, useState } from "react";
import { brandStore } from "~/features/settings/lib/brand";

export type Theme = "auto" | "light" | "dark";
export const THEME_KEY = "theme";

/** Lựa chọn riêng đã nhớ; chưa có ⇒ `fallback` (V2-L: giao diện mặc định của công ty, trước đó luôn sáng). */
export function storedTheme(fallback: Theme = "light"): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "auto" || v === "light" ? v : fallback;
  } catch {
    return fallback;
  }
}
/** Người dùng đã tự chọn giao diện (menu avatar) chưa. */
export function ownTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "dark" || v === "auto" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/** `auto` = theo máy: chỉ tối khi máy đang tối (không có thuộc tính ⇒ sáng; CSS gốc không có media query). */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  const dark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  if (t === "auto" && !dark) delete root.dataset.theme;
  else root.dataset.theme = t === "auto" ? "dark" : t;
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(() => storedTheme(brandStore.get().theme));
  useEffect(() => applyTheme(t), [t]);
  const set = useCallback((x: Theme) => {
    setT(x);
    try {
      localStorage.setItem(THEME_KEY, x);
    } catch {
      // không lưu được
    }
  }, []);
  return [t, set];
}
