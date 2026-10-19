// PK-FR-10 · TF1: chuỗi riêng của contracts-web (`contracts.*`), nạp động từng ngôn ngữ (không kéo chuỗi Admin/chat vào bundle).
import type { Locale } from "./locales";

/** Nạp bản dịch contracts-web của một ngôn ngữ khi cần (mỗi ngôn ngữ một chunk riêng). */
export async function loadContractsLocale(locale: Locale): Promise<Record<string, unknown>> {
  const [mod, cks, assistant, org, work] =
    locale === "en"
      ? await Promise.all([
          import("../locales/contracts/en.json"),
          import("../locales/contracts/cks.en.json"),
          import("../locales/contracts/assistant.en.json"),
          import("../locales/contracts/org.en.json"),
          import("../locales/contracts/work.en.json"),
        ])
      : await Promise.all([
          import("../locales/contracts/vi.json"),
          import("../locales/contracts/cks.vi.json"),
          import("../locales/contracts/assistant.vi.json"),
          import("../locales/contracts/org.vi.json"),
          import("../locales/contracts/work.vi.json"),
        ]);
  // HD9: chuỗi CKS ở tệp riêng (`contracts.cks.*`); M2-chat: trợ lý (`contracts.assistant.*`); M1D: cơ cấu (`contracts.org.*`)
  // — gộp vào cùng gốc `contracts`.
  const base = mod.default as { contracts: Record<string, unknown> };
  return {
    ...base,
    contracts: {
      ...base.contracts,
      ...cks.default.contracts,
      ...assistant.default.contracts,
      ...org.default.contracts,
      ...work.default.contracts,
    },
  };
}
