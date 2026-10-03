// CHAT-AC-36 · chuỗi riêng của chat-web, nạp động từng ngôn ngữ (không kéo chuỗi Admin vào bundle chat).
import type { Locale } from "./locales";

/** Nạp bản dịch chat của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadChatLocale(locale: Locale): Promise<Record<string, unknown>> {
  const mod =
    locale === "en"
      ? await import("../locales/chat/en.json")
      : await import("../locales/chat/vi.json");
  return mod.default as Record<string, unknown>;
}
