// HUB-FR-72 · i18next cho studio-web: namespace `studio` nạp động từng ngôn ngữ; mặc định vi (D10), nhớ `studio.locale`.
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import { loadStudioLocale } from "@ai/i18n/studio-locales";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { setRequestLanguage } from "#/lib/http";
import { readLocal, writeLocal } from "#/lib/storage";

export const LOCALE_STORAGE_KEY = "studio.locale";
export const NAMESPACE = "studio";

const isSupported = (v: string | null | undefined): v is Locale =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** Thứ tự: `studio.locale` đã lưu → ngôn ngữ trình duyệt (vi hoặc en) → `vi`. */
export function resolveInitialLocale(
  saved: string | null,
  browserLanguage: string | undefined,
): Locale {
  if (isSupported(saved)) return saved;
  const prefix = browserLanguage?.slice(0, 2).toLowerCase();
  return isSupported(prefix) ? prefix : DEFAULT_LOCALE;
}

// `<html lang>` đi theo ngôn ngữ đang dùng (a11y §7).
i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  writeLocal(LOCALE_STORAGE_KEY, lng);
  setRequestLanguage(lng);
});

const lazyBackend = {
  type: "backend" as const,
  init() {},
  read(lng: string, _ns: string, cb: (err: unknown, data?: Record<string, unknown>) => void) {
    if (!isSupported(lng)) return cb(null, {});
    loadStudioLocale(lng).then(
      (r) => cb(null, r),
      (e) => cb(e),
    );
  },
};

/** Promise xong khi bản dịch đang dùng (và `vi` dự phòng) đã nạp → vẽ lần đầu không nháy key. */
export const initI18n = (): Promise<unknown> =>
  i18next
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      partialBundledLanguages: true,
      ns: [NAMESPACE],
      defaultNS: NAMESPACE,
      lng: resolveInitialLocale(
        readLocal(LOCALE_STORAGE_KEY),
        typeof navigator === "undefined" ? undefined : navigator.language,
      ),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      // Chuỗi dùng {tham_số}, không phải {{...}} mặc định của i18next.
      interpolation: { prefix: "{", suffix: "}", escapeValue: false },
    });

export const i18n = i18next;
