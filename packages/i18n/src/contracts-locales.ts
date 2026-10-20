// PK-FR-10 Ã‚Â· TF1: chuÃ¡Â»â€”i riÃƒÂªng cÃ¡Â»Â§a contracts-web (`contracts.*`), nÃ¡ÂºÂ¡p Ã„â€˜Ã¡Â»â„¢ng tÃ¡Â»Â«ng ngÃƒÂ´n ngÃ¡Â»Â¯ (khÃƒÂ´ng kÃƒÂ©o chuÃ¡Â»â€”i Admin/chat vÃƒÂ o bundle).
import type { Locale } from "./locales";

// HD9: chuÃ¡Â»â€”i CKS Ã¡Â»Å¸ tÃ¡Â»â€¡p riÃƒÂªng (`contracts.cks.*`); M2-chat: trÃ¡Â»Â£ lÃƒÂ½ (`contracts.assistant.*`); M1D: cÃ†Â¡ cÃ¡ÂºÂ¥u (`contracts.org.*`);
// HD7: sÃ¡Â»â€¢ Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c (`contracts.ledger.*`); HD8: Ã„â€˜Ã¡Â»â€˜i tÃƒÂ¡c, Ã„â€˜iÃ¡Â»Æ’m uy tÃƒÂ­n, giÃƒÂ¡ hÃƒÂ ng hoÃƒÂ¡ (`contracts.partners.*`, `contracts.scoring.*`,
// `contracts.goods.*`) Ã¢â‚¬â€ gÃ¡Â»â„¢p vÃƒÂ o cÃƒÂ¹ng gÃ¡Â»â€˜c `contracts`; V2-F: form + chi tiÃ¡ÂºÂ¿t hÃ¡Â»Â£p Ã„â€˜Ã¡Â»â€œng (`contracts.cform.*`, `contracts.cdetail.*`).
/** NÃ¡ÂºÂ¡p bÃ¡ÂºÂ£n dÃ¡Â»â€¹ch contracts-web cÃ¡Â»Â§a mÃ¡Â»â„¢t ngÃƒÂ´n ngÃ¡Â»Â¯ khi cÃ¡ÂºÂ§n (mÃ¡Â»â€”i ngÃƒÂ´n ngÃ¡Â»Â¯ mÃ¡Â»â„¢t chunk riÃƒÂªng). */
export async function loadContractsLocale(locale: Locale): Promise<Record<string, unknown>> {
  const [mod, cks, assistant, org, work, ledger, partners, v2f, v2g, v2h, v2i, v2j2, v2l, v2m] =
    locale === "en"
      ? await Promise.all([
          import("../locales/contracts/en.json"),
          import("../locales/contracts/cks.en.json"),
          import("../locales/contracts/assistant.en.json"),
          import("../locales/contracts/org.en.json"),
          import("../locales/contracts/work.en.json"),
          import("../locales/contracts/ledger.en.json"),
          import("../locales/contracts/partners.en.json"),
          import("../locales/contracts/v2f.en.json"),
          import("../locales/contracts/v2g.en.json"),
          import("../locales/contracts/v2h.en.json"),
          import("../locales/contracts/v2i.en.json"),
          import("../locales/contracts/v2j2.en.json"),
          import("../locales/contracts/v2l.en.json"),
          import("../locales/contracts/v2m.en.json"),
        ])
      : await Promise.all([
          import("../locales/contracts/vi.json"),
          import("../locales/contracts/cks.vi.json"),
          import("../locales/contracts/assistant.vi.json"),
          import("../locales/contracts/org.vi.json"),
          import("../locales/contracts/work.vi.json"),
          import("../locales/contracts/ledger.vi.json"),
          import("../locales/contracts/partners.vi.json"),
          import("../locales/contracts/v2f.vi.json"),
          import("../locales/contracts/v2g.vi.json"),
          import("../locales/contracts/v2h.vi.json"),
          import("../locales/contracts/v2i.vi.json"),
          import("../locales/contracts/v2j2.vi.json"),
          import("../locales/contracts/v2l.vi.json"),
          import("../locales/contracts/v2m.vi.json"),
        ]);
  const base = mod.default as { contracts: Record<string, unknown> };
  return {
    ...base,
    contracts: {
      ...base.contracts,
      ...cks.default.contracts,
      ...assistant.default.contracts,
      ...org.default.contracts,
      ...work.default.contracts,
      ...ledger.default.contracts,
      ...partners.default.contracts,
      ...v2f.default.contracts,
      // V2-H: khÃƒÂ¡ch Ã„â€˜ang dÃƒÂ¹ng (`contracts.svc.*`).
      ...v2h.default.contracts,
      ...v2i.default.contracts, // V2-I: Ã„ÂÃ¡Â»â€˜i tÃƒÂ¡c UI v2 (`contracts.pv2.*`)
      ...v2j2.default.contracts, // V2-J2: tab NCC & giÃƒÂ¡ (contracts.psup.*)
      // V2-L: hÃ¡Â»â„¢p thoÃ¡ÂºÂ¡i CÃƒÂ i Ã„â€˜Ã¡ÂºÂ·t (`contracts.settings.*`).
      ...v2l.default.contracts,
      ...v2m.default.contracts,
      // V2-G: thÃƒÂªm khoÃƒÂ¡ vÃƒÂ o cform/cdetail cÃ¡Â»Â§a V2-F (gÃ¡Â»â„¢p mÃ¡Â»â„¢t cÃ¡ÂºÂ¥p, khÃƒÂ´ng ghi Ã„â€˜ÃƒÂ¨).
      cform: { ...v2f.default.contracts.cform, ...v2g.default.contracts.cform },
      cdetail: { ...v2f.default.contracts.cdetail, ...v2g.default.contracts.cdetail },
    },
  };
}
