// V2-L · CD-01: nhận diện công ty áp lên cả app — 6 màu chủ đạo (bảng của mockup NITI), giao diện, tên + logo. Kho nhỏ (useSyncExternalStore):
// `saved` = đã lưu ở server; `preview` = bản nháp của hộp thoại đang mở (đổi tên/màu/giao diện là sidebar, menu, nút đổi NGAY; đóng
// hộp thoại mà chưa lưu ⇒ trở về `saved`). Thuần ngoài phần DOM (`applyBrandDom`).
import {
  type CompanyAccent,
  type CompanyTheme,
  contrastRatio,
  isAccentHex,
  mixHex,
} from "@ai/contracts/pack-contracts";
import { useSyncExternalStore } from "react";

export type Brand = {
  name: string | null;
  app_name: string | null;
  logo: string | null;
  /** Khoá một trong 12 màu đặt sẵn hoặc `#rrggbb` tự chọn (CR-138 Q8; luật ở `company-accent.ts`). */
  accent: string;
  theme: CompanyTheme;
};
export const DEFAULT_BRAND: Brand = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
};

/** [act, act-hover, act-soft, act-line, grad-to] — sáng / tối (mockup NITI `ACCENTS`; 6 màu thêm ở CR-138 cùng khuôn, chữ trắng ≥ 4.5:1 trên nền sáng). */
type Palette = { l: string[]; d: string[] };
export const ACCENTS: Record<CompanyAccent, Palette> = {
  indigo: {
    l: ["#4f46e5", "#4338ca", "#eef2ff", "#c7d2fe", "#a855f7"],
    d: ["#818cf8", "#a5b4fc", "#24264a", "#4b4f8f", "#a855f7"],
  },
  violet: {
    l: ["#7c3aed", "#6d28d9", "#f5f3ff", "#ddd6fe", "#d946ef"],
    d: ["#a78bfa", "#c4b5fd", "#2a2152", "#5b3fb0", "#e879f9"],
  },
  magenta: {
    l: ["#a21caf", "#86198f", "#fdf4ff", "#f5d0fe", "#f43f5e"],
    d: ["#e879f9", "#f0abfc", "#3b1442", "#86198f", "#fb7185"],
  },
  rose: {
    l: ["#e11d48", "#be123c", "#fff1f2", "#fecdd3", "#f97316"],
    d: ["#fb7185", "#fda4af", "#3b1219", "#9f1239", "#fb923c"],
  },
  orange: {
    l: ["#ea580c", "#c2410c", "#fff7ed", "#fed7aa", "#f59e0b"],
    d: ["#fb923c", "#fdba74", "#3a1d0c", "#9a3412", "#fbbf24"],
  },
  amber: {
    l: ["#b45309", "#92400e", "#fffbeb", "#fde68a", "#eab308"],
    d: ["#fbbf24", "#fcd34d", "#3a2a0a", "#92400e", "#facc15"],
  },
  lime: {
    l: ["#4d7c0f", "#3f6212", "#f7fee7", "#d9f99d", "#22c55e"],
    d: ["#a3e635", "#bef264", "#1f2d0a", "#4d7c0f", "#4ade80"],
  },
  green: {
    l: ["#16a34a", "#15803d", "#f0fdf4", "#bbf7d0", "#84cc16"],
    d: ["#4ade80", "#86efac", "#12301c", "#166534", "#a3e635"],
  },
  teal: {
    l: ["#0d9488", "#0f766e", "#f0fdfa", "#99f6e4", "#22c55e"],
    d: ["#2dd4bf", "#5eead4", "#10302d", "#115e59", "#4ade80"],
  },
  sky: {
    l: ["#0369a1", "#075985", "#f0f9ff", "#bae6fd", "#6366f1"],
    d: ["#38bdf8", "#7dd3fc", "#0c2a3d", "#075985", "#818cf8"],
  },
  blue: {
    l: ["#2563eb", "#1d4ed8", "#eff6ff", "#bfdbfe", "#06b6d4"],
    d: ["#60a5fa", "#93c5fd", "#172554", "#1e3a8a", "#22d3ee"],
  },
  slate: {
    l: ["#475569", "#334155", "#f8fafc", "#cbd5e1", "#64748b"],
    d: ["#94a3b8", "#cbd5e1", "#1e2533", "#475569", "#94a3b8"],
  },
};

const DARK_CARD = "#17182a"; // --card của giao diện tối (tokens.css)
const WHITE = "#ffffff";

/** Bảng màu suy ra từ mã tự chọn: sáng = màu gốc (đã kiểm AA với chữ trắng); tối = sáng dần tới khi chữ/liên kết đạt 4.5:1 trên nền thẻ tối. */
export function customPalette(hex: string): Palette {
  const act = hex.toLowerCase();
  let dark = act;
  for (let t = 0; t <= 1 && contrastRatio(dark, DARK_CARD) < 4.5; t += 0.05)
    dark = mixHex(act, WHITE, t);
  return {
    l: [act, mixHex(act, "#000000", 0.15), mixHex(act, WHITE, 0.92), mixHex(act, WHITE, 0.78), act],
    d: [
      dark,
      mixHex(dark, WHITE, 0.3),
      mixHex(dark, DARK_CARD, 0.85),
      mixHex(dark, DARK_CARD, 0.6),
      dark,
    ],
  };
}

/** Bảng màu của khoá đặt sẵn hoặc mã tự chọn; giá trị lạ ⇒ chàm. */
export const accentPalette = (a: string): Palette =>
  isAccentHex(a) ? customPalette(a) : (ACCENTS[a as CompanyAccent] ?? ACCENTS.indigo);
/** Màu mẫu (sáng) để vẽ ô chọn. */
export const accentSwatch = (a: string): string => accentPalette(a).l[0] as string;

const vars = ([act, hover, soft, line, grad]: string[]): string =>
  `--primary:${act};--primary-strong:${hover};--accent:${soft};--accent-foreground:${hover};--ring:${act};` +
  `--sidebar-primary:${act};--sidebar-accent:${soft};--sidebar-accent-foreground:${hover};--act-line:${line};--grad-to:${grad}`;

/** CSS đè token màu (chàm = mặc định ⇒ rỗng, để theme gốc nguyên vẹn). */
export function brandCss(accent: string): string {
  if (accent === "indigo" || !(isAccentHex(accent) || accent in ACCENTS)) return "";
  const p = accentPalette(accent);
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
