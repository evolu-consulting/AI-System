// ADM-NFR-03, ADM-NFR-06 · hằng ngôn ngữ + bộ nạp động (không kéo cả hai file JSON vào bundle ban đầu).
export const SUPPORTED_LOCALES = ["vi", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Nạp bản dịch của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadLocale(locale: Locale): Promise<Record<string, unknown>> {
  const mod =
    locale === "en" ? await import("../locales/en.json") : await import("../locales/vi.json");
  return mod.default as Record<string, unknown>;
}
