// COM-FR-46 · i18n community-web: một namespace `community.*` (packages/i18n/locales/community/{vi,en}.json).
// VI = gốc + dự phòng (gói tĩnh, dùng đồng bộ cả trong logic thuần/test); EN nạp động. Mặc định vi; lưu `community.lang`.
import { communityVi, loadCommunityLocale } from "@ai/i18n/community-locales";
import { type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LANG_KEY = "community.lang";
/** Khoá cũ của màn Đăng nhập (login-i18n) — còn đọc để không mất lựa chọn đã lưu. */
const LEGACY_LANG_KEY = "community:lang";

export const isLocale = (v: unknown): v is Locale => SUPPORTED_LOCALES.some((l) => l === v);

/** Chọn ngôn ngữ: đã lưu (`community.lang`) → tuỳ chọn người dùng từ `/me` → vi. Giá trị lạ bị bỏ qua. */
export function pickLocale(src: { stored?: string | null; me?: string | null }): Locale {
  if (isLocale(src.stored)) return src.stored;
  if (isLocale(src.me)) return src.me;
  return "vi";
}

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export const readStoredLang = (): Locale | null => {
  const v = read(LANG_KEY) ?? read(LEGACY_LANG_KEY);
  return isLocale(v) ? v : null;
};

i18next.use(initReactI18next).init({
  resources: { vi: { translation: communityVi } },
  lng: pickLocale({ stored: readStoredLang() }),
  fallbackLng: "vi",
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
  initAsync: false,
});

export const i18n = i18next;
export const t = i18next.t.bind(i18next);
export const currentLang = (): Locale => (isLocale(i18next.language) ? i18next.language : "vi");
/** Mã locale cho định dạng ngày/số theo ngôn ngữ UI. */
export const numLocale = (): string => (currentLang() === "en" ? "en-US" : "vi-VN");

let enLoaded: Promise<void> | null = null;
async function ensureLoaded(l: Locale): Promise<void> {
  if (l === "vi" || i18next.hasResourceBundle(l, "translation")) return;
  enLoaded ??= loadCommunityLocale(l).then((b) => {
    i18next.addResourceBundle(l, "translation", b, true, true);
  });
  await enLoaded;
}

/** Đổi ngôn ngữ UI: nạp bản dịch, lưu `community.lang`, đặt `<html lang>`. */
export async function setLang(l: Locale, persist = true): Promise<void> {
  await ensureLoaded(l);
  await i18next.changeLanguage(l);
  if (typeof document !== "undefined") document.documentElement.lang = l;
  if (!persist) return;
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* storage bị chặn: vẫn đổi trong phiên */
  }
}

/** Khởi động: nạp bản dịch của ngôn ngữ đã chọn (EN) trước khi vẽ để không nháy key. */
export async function initLang(): Promise<void> {
  const l = currentLang();
  await setLang(l, false);
}
