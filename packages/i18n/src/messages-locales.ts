// CR-169 · chuỗi «Tin nhắn» dùng chung (`contracts.messages.*`, gói `@ai/messages-web`), nạp lười để app không phải kéo cả chuỗi Sổ Hợp Tác.
import type { Locale } from "./locales";

export async function loadMessagesLocale(locale: Locale): Promise<Record<string, unknown>> {
  const mod =
    locale === "en"
      ? await import("../locales/contracts/messages.en.json")
      : await import("../locales/contracts/messages.vi.json");
  return mod.default as Record<string, unknown>;
}
