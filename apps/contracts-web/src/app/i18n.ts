// PK-FR-10 · TF1 · khởi tạo i18next cho contracts-web: chuỗi `contracts.*` nạp động; `ai.locale` đã lưu, không có thì en (CR-052).
import { loadContractsLocale } from "@ai/i18n/contracts-locales";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

export const LOCALE_STORAGE_KEY = "ai.locale";

const isSupported = (v: string | null | undefined): v is Locale =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** `ai.locale` đã lưu → `en`; storage bị chặn (ném lỗi) coi như chưa lưu. */
export function resolveInitialLocale(read: (key: string) => string | null): Locale {
  try {
    const saved = read(LOCALE_STORAGE_KEY);
    if (isSupported(saved)) return saved;
  } catch {
    // storage bị chặn
  }
  return DEFAULT_LOCALE;
}

const readLocal = (key: string): string | null =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(key);

i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
});

const lazyBackend = {
  type: "backend" as const,
  init() {},
  read(lng: string, _ns: string, cb: (err: unknown, data?: Record<string, unknown>) => void) {
    if (!isSupported(lng)) return cb(null, {});
    loadContractsLocale(lng).then(
      (r) => cb(null, r),
      (e) => cb(e),
    );
  },
};

/** Khởi tạo i18n; promise xong khi bản dịch đang dùng (và `vi` dự phòng) đã nạp. */
export const initI18n = (): Promise<unknown> =>
  i18next
    .use(lazyBackend)
    .use(initReactI18next)
    .init({
      partialBundledLanguages: true,
      lng: resolveInitialLocale(readLocal),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      interpolation: { escapeValue: false },
    });

export const i18n = i18next;
