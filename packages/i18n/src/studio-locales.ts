// HUB-FR-72 · chuỗi riêng của studio-web (namespace `studio`), nạp động từng ngôn ngữ (không kéo chuỗi Admin/Chat vào bundle).
import type { Locale } from "./locales";

/** Nạp bản dịch Studio của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadStudioLocale(locale: Locale): Promise<Record<string, unknown>> {
  const mod =
    locale === "en"
      ? await import("../locales/studio/en.json")
      : await import("../locales/studio/vi.json");
  return mod.default as Record<string, unknown>;
}
