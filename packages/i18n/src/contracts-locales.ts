// PK-FR-10 · TF1: chuỗi riêng của contracts-web (`contracts.*`), nạp động từng ngôn ngữ (không kéo chuỗi Admin/chat vào bundle).
import type { Locale } from "./locales";

/** Nạp bản dịch contracts-web của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadContractsLocale(locale: Locale): Promise<Record<string, unknown>> {
  const mod =
    locale === "en"
      ? await import("../locales/contracts/en.json")
      : await import("../locales/contracts/vi.json");
  return mod.default as Record<string, unknown>;
}
