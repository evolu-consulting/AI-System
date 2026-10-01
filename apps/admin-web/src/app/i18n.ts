// ADM-NFR-06, ADM-FR-01 · khởi tạo i18next; mặc định vi (hoặc `ai.locale`, rồi ngôn ngữ trình duyệt), `<html lang>` đi theo ngôn ngữ đang dùng.
import { DEFAULT_LOCALE, resources, SUPPORTED_LOCALES } from "@ai/i18n";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LOCALE_STORAGE_KEY = "ai.locale";

type DocLike = { documentElement: { lang: string } };
type StorageLike = Pick<Storage, "getItem">;

/** Đặt `lang` của trang theo ngôn ngữ `lng` (tiêu đề tab do từng trang đặt: "<H1> · Admin"). */
export function syncDocument(doc: DocLike, lng: string): void {
  doc.documentElement.lang = lng;
}

const isSupported = (v: string | null | undefined): v is (typeof SUPPORTED_LOCALES)[number] =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** Thứ tự: `ai.locale` đã lưu → ngôn ngữ trình duyệt (vi hoặc en) → `vi`. */
export function resolveInitialLocale(
  storage: StorageLike | undefined,
  browserLanguage: string | undefined,
): (typeof SUPPORTED_LOCALES)[number] {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY);
  if (isSupported(saved)) return saved;
  const prefix = browserLanguage?.slice(0, 2).toLowerCase();
  return isSupported(prefix) ? prefix : DEFAULT_LOCALE;
}

// Đăng ký trước `init` để lần init đầu cũng đặt `lang`; `bun test` không có `document`.
i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") syncDocument(document, lng);
  if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, lng);
});

i18next.use(initReactI18next).init({
  resources,
  lng: resolveInitialLocale(
    typeof localStorage === "undefined" ? undefined : localStorage,
    typeof navigator === "undefined" ? undefined : navigator.language,
  ),
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: [...SUPPORTED_LOCALES],
  interpolation: { escapeValue: false },
});

export const i18n = i18next;
