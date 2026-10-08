// CHAT-AC-36 · khởi tạo i18next cho chat-web: chuỗi `chat/*` nạp động; CR-052: `ai.locale` đã lưu, không có thì en (không dò trình duyệt).
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@ai/i18n/locales";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { setRequestLanguage } from "~/lib/http";
import { readLocal, writeLocal } from "~/lib/storage";

export const LOCALE_STORAGE_KEY = "ai.locale";

const isSupported = (v: string | null | undefined): v is Locale =>
  SUPPORTED_LOCALES.some((l) => l === v);

/** Thứ tự: `ai.locale` đã lưu → `en` (CR-052: không dò ngôn ngữ trình duyệt). */
export function resolveInitialLocale(storage: Pick<Storage, "getItem"> | undefined): Locale {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY);
  if (isSupported(saved)) return saved;
  return DEFAULT_LOCALE;
}

i18next.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") document.documentElement.lang = lng;
  writeLocal(LOCALE_STORAGE_KEY, lng);
  // `Accept-Language` của mọi request theo ngôn ngữ UI.
  setRequestLanguage(isSupported(lng) ? lng : null);
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
      // Đọc qua `readLocal`: storage bị chặn (ném lỗi) thì coi như chưa lưu, không làm vỡ app.
      lng: resolveInitialLocale({ getItem: readLocal }),
      fallbackLng: DEFAULT_LOCALE,
      supportedLngs: [...SUPPORTED_LOCALES],
      interpolation: { escapeValue: false },
    });

export const i18n = i18next;
