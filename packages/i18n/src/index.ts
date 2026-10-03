// ADM-NFR-06 · chuỗi giao diện dùng chung; `bun run i18n:check` bắt vi/en cùng tập key.
// Ứng dụng web nạp theo nhu cầu qua `@ai/i18n/locales`; `resources` (nạp tĩnh cả hai) dành cho test và kiểu.
import en from "../locales/en.json";
import vi from "../locales/vi.json";

export { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./locales";

export const resources = {
  vi: { translation: vi },
  en: { translation: en },
} as const;
