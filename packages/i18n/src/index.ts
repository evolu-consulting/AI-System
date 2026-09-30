// ADM-NFR-06 · chuỗi giao diện dùng chung; `bun run i18n:check` bắt vi/en cùng tập key.
import en from "../locales/en.json";
import vi from "../locales/vi.json";

export const SUPPORTED_LOCALES = ["vi", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "vi";

export const resources = {
  vi: { translation: vi },
  en: { translation: en },
} as const;
