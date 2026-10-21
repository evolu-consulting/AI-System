// PK-FR-10 · TF5 · giao diện sáng / tối / theo máy (`html[data-theme]`). prefs-sync: lựa chọn riêng của người dùng nằm ở kho dùng chung
// (`@ai/web-kit/prefs`, khoá `ai.theme`, đồng bộ qua /auth/me); file này chỉ còn phần áp lên DOM cho nhận diện công ty (brand).
import { isTheme, readStored } from "@ai/web-kit/prefs/prefs";

export type Theme = "auto" | "light" | "dark";

/** Lựa chọn riêng đã nhớ (`system` của kho chung = `auto` ở đây); chưa có ⇒ null. */
export function ownTheme(): Theme | null {
  const v = readStored().theme;
  if (!isTheme(v)) return null;
  return v === "system" ? "auto" : v;
}

/** `auto` = theo máy: chỉ tối khi máy đang tối (không có thuộc tính ⇒ sáng; CSS gốc không có media query). */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  const dark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  if (t === "auto" && !dark) delete root.dataset.theme;
  else root.dataset.theme = t === "auto" ? "dark" : t;
}
