// CR-118 · i18n gộp: Community và Sổ Hợp Tác dùng CHUNG một instance i18next ⇒ hai bộ khoá phải có gốc riêng và không trùng khoá.
import { describe, expect, it } from "bun:test";
import { loadCommunityLocale } from "@ai/i18n/community-locales";
import { loadContractsLocale } from "@ai/i18n/contracts-locales";

const flat = (o: unknown, pre = ""): string[] =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => flat(v, pre ? `${pre}.${k}` : k))
    : [pre];

describe("i18n gộp community + contracts", () => {
  it("hai bộ khoá có gốc riêng và không khoá nào trùng ở vi và en", async () => {
    for (const lng of ["vi", "en"] as const) {
      const cm = await loadCommunityLocale(lng);
      const ct = await loadContractsLocale(lng);
      expect(Object.keys(cm)).toEqual(["community"]);
      expect(Object.keys(ct)).toEqual(["contracts"]);
      const a = new Set(flat(cm));
      expect(flat(ct).filter((k) => a.has(k))).toEqual([]);
    }
  });
});
