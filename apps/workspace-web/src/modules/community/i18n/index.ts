// COM-FR-46 · i18n Community: namespace khoá `community.*` (packages/i18n/locales/community/{vi,en}.json), gộp vào i18next CHUNG
// của app (CR-118: một instance, khoá `community.*` và `contracts.*` không trùng — test i18n-merge). Module KHÔNG tự init i18next:
// shell khởi tạo, module chỉ thêm gói dịch khi tải (VI gốc + dự phòng; EN nạp động theo ngôn ngữ đang dùng).
import { communityVi, loadCommunityLocale } from "@ai/i18n/community-locales";
import { type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import i18next from "i18next";

export const isLocale = (v: unknown): v is Locale => SUPPORTED_LOCALES.some((l) => l === v);

export const i18n = i18next;
export const t = i18next.t.bind(i18next);
export const currentLang = (): Locale => (isLocale(i18next.language) ? i18next.language : "vi");
/** Mã locale cho định dạng ngày/số theo ngôn ngữ UI. */
export const numLocale = (): string => (currentLang() === "en" ? "en-US" : "vi-VN");

/** VI gốc + dự phòng (gói tĩnh, dùng đồng bộ trong logic thuần/test). Gọi nhiều lần vô hại. */
export function registerCommunityVi(): void {
  i18next.addResourceBundle("vi", "translation", communityVi, true, false);
}
registerCommunityVi();

let enLoaded: Promise<void> | null = null;
async function ensureLoaded(l: Locale): Promise<void> {
  if (l === "vi") return;
  enLoaded ??= loadCommunityLocale(l).then((b) => {
    i18next.addResourceBundle(l, "translation", b, true, true);
  });
  await enLoaded;
}

/** Đổi ngôn ngữ UI chung (shell lưu `ai.locale` qua sự kiện languageChanged): nạp gói Community trước rồi đổi. */
export async function setLang(l: Locale, _persist = true): Promise<void> {
  await ensureLoaded(l);
  await i18next.changeLanguage(l);
}

/** Khi module tải: nạp gói Community của ngôn ngữ đang dùng để không nháy key. */
export async function initLang(): Promise<void> {
  await ensureLoaded(currentLang());
}
