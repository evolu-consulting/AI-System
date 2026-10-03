// CHAT-AC-36 · khởi tạo i18next cho chat-web: chuỗi `chat/*` nạp động; mặc định vi (hoặc `ai.locale`, rồi ngôn ngữ trình duyệt).
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LOCALE_STORAGE_KEY = "ai.locale";

const isSupported = (v: string | null | undefined): v is Locale =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** Thứ tự: `ai.locale` đã lưu → ngôn ngữ trình duyệt (vi hoặc en) → `vi`. */
export function resolveInitialLocale(
  storage: Pick<Storage, "getItem"> | undefined,
  browserLanguage: string | undefined,
): Locale {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY);
  if (isSupported(saved)) return saved;
  const prefix = browserLanguage?.slice(0, 2).toLowerCase();
  return isSupported(prefix) ? prefix : DEFAULT_LOCALE;
}

i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, lng);
});

const lazyBackend = {
  type: "backend" as const,
  init() {},
  read(lng: string, _ns: string, cb: (err: unknown, data?: Record<string, unknown>) => void) {
    if (!isSupported(lng)) return cb(null, {});
    loadChatLocale(lng).then(
      (r) => cb(null, r),
      (e) => cb(e),
    );
  },
};

/** Khởi tạo i18n; promise xong khi bản dịch đang dùng (và `vi` dự phòng) đã nạp. Chuỗi dùng `{{x}}` mặc định. */
export const initI18n = (): Promise<unknown> =>
  i18next
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      partialBundledLanguages: true,
      lng: resolveInitialLocale(
        typeof localStorage === "undefined" ? undefined : localStorage,
        typeof navigator === "undefined" ? undefined : navigator.language,
      ),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      interpolation: { escapeValue: false },
    });

export const i18n = i18next;
