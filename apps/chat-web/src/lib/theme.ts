// CR-027 · giao diện Sáng/Tối/Theo hệ thống (plan-frontend-theme §3). Hàm thuần + áp lên <html>; script chống nháy trong index.html dùng cùng khoá.
import { readLocal, writeLocal } from "~/lib/storage";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "ai-chat-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseTheme(raw: string | null): ThemeMode {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolve(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

export function getTheme(): ThemeMode {
  return parseTheme(readLocal(THEME_KEY));
}

function mql(): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia(DARK_QUERY) : null;
}

export function applyResolved(theme: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function applyTheme(mode: ThemeMode) {
  applyResolved(resolve(mode, mql()?.matches ?? false));
}

/** Lưu (nếu được) và áp ngay; không lưu được thì vẫn đổi trong phiên. */
export function setTheme(mode: ThemeMode) {
  writeLocal(THEME_KEY, mode);
  applyTheme(mode);
}

/** Theo dõi đổi hệ thống (khi mode = system) và đổi ở tab khác; trả hàm huỷ. */
export function watchTheme(onChange?: (mode: ThemeMode) => void): () => void {
  const m = mql();
  const onSystem = () => {
    if (getTheme() === "system") applyTheme("system");
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    const mode = getTheme();
    applyTheme(mode);
    onChange?.(mode);
  };
  m?.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  return () => {
    m?.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
  };
}
