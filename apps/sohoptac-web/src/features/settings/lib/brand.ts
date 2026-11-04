// V2-L · CD-01: nhận diện công ty áp lên cả app — 6 màu chủ đạo (bảng của mockup NITI), giao diện, tên + logo. Kho nhỏ (useSyncExternalStore):
// `saved` = đã lưu ở server; `preview` = bản nháp của hộp thoại đang mở (đổi tên/màu/giao diện là sidebar, menu, nút đổi NGAY; đóng
// hộp thoại mà chưa lưu ⇒ trở về `saved`). Thuần ngoài phần DOM (`applyBrandDom`).
import type { CompanyAccent, CompanyTheme } from "@ai/contracts";
import { useSyncExternalStore } from "react";

export type Brand = {
  name: string | null;
  app_name: string | null;
  logo: string | null;
  accent: CompanyAccent;
  theme: CompanyTheme;
};
export const DEFAULT_BRAND: Brand = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
};

/** [act, act-hover, act-soft, act-line, grad-to] — sáng / tối (mockup NITI `ACCENTS`). */
type Palette = { l: string[]; d: string[] };
export const ACCENTS: Record<CompanyAccent, Palette> = {
  indigo: {
    l: ["#4f46e5", "#4338ca", "#eef2ff", "#c7d2fe", "#a855f7"],
    d: ["#818cf8", "#a5b4fc", "#24264a", "#4b4f8f", "#a855f7"],
  },
  blue: {
    l: ["#2563eb", "#1d4ed8", "#eff6ff", "#bfdbfe", "#06b6d4"],
    d: ["#60a5fa", "#93c5fd", "#172554", "#1e3a8a", "#22d3ee"],
  },
  teal: {
    l: ["#0d9488", "#0f766e", "#f0fdfa", "#99f6e4", "#22c55e"],
    d: ["#2dd4bf", "#5eead4", "#10302d", "#115e59", "#4ade80"],
  },
  green: {
    l: ["#16a34a", "#15803d", "#f0fdf4", "#bbf7d0", "#84cc16"],
    d: ["#4ade80", "#86efac", "#12301c", "#166534", "#a3e635"],
  },
  orange: {
    l: ["#ea580c", "#c2410c", "#fff7ed", "#fed7aa", "#f59e0b"],
    d: ["#fb923c", "#fdba74", "#3a1d0c", "#9a3412", "#fbbf24"],
  },
  rose: {
    l: ["#e11d48", "#be123c", "#fff1f2", "#fecdd3", "#f97316"],
    d: ["#fb7185", "#fda4af", "#3b1219", "#9f1239", "#fb923c"],
  },
};

const vars = ([act, hover, soft, line, grad]: string[]): string =>
  `--primary:${act};--primary-strong:${hover};--accent:${soft};--accent-foreground:${hover};--ring:${act};` +
  `--sidebar-primary:${act};--sidebar-accent:${soft};--sidebar-accent-foreground:${hover};--act-line:${line};--grad-to:${grad}`;

/** CSS đè token màu (chàm = mặc định ⇒ rỗng, để theme gốc nguyên vẹn). */
export function brandCss(accent: CompanyAccent): string {
  if (accent === "indigo") return "";
  const p = ACCENTS[accent];
  return `html:root{${vars(p.l)}}html:root[data-theme="dark"],html:root.dark{${vars(p.d)}}`;
}

/** Giao diện hiệu lực: bản xem thử > lựa chọn riêng của người dùng (menu avatar) > mặc định công ty. */
export const effectiveTheme = (
  b: Brand,
  previewing: boolean,
  own: CompanyTheme | null,
): CompanyTheme => (previewing ? b.theme : (own ?? b.theme));

let saved: Brand | null = null;
let preview: Brand | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
export const brandStore = {
  get: (): Brand => preview ?? saved ?? DEFAULT_BRAND,
  isPreview: (): boolean => preview !== null,
  setSaved(b: Brand | null) {
    saved = b;
    emit();
  },
  setPreview(b: Brand | null) {
    preview = b;
    emit();
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
export const useBrand = (): Brand => useSyncExternalStore(brandStore.subscribe, brandStore.get);

/** Tên hiển thị: công ty rỗng ⇒ tên tenant; app rỗng ⇒ tên mặc định (i18n). */
export const nameOf = (b: Brand, tenantName: string | undefined): string =>
  b.name ?? tenantName ?? "";
export const appNameOf = (b: Brand, fallback: string): string => b.app_name ?? fallback;

/** Chỉ gọi ở trình duyệt: ghi `<style id="brand-css">` + tiêu đề tab. */
export function applyBrandDom(b: Brand, appName: string, doc: Document = document): void {
  let st = doc.getElementById("brand-css");
  if (!st) {
    st = doc.createElement("style");
    st.id = "brand-css";
    doc.head.appendChild(st);
  }
  st.textContent = brandCss(b.accent);
  doc.title = b.name ? `${appName} · ${b.name}` : appName;
}
