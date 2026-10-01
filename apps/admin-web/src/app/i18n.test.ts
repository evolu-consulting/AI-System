import { describe, expect, test } from "bun:test";
import { i18n, resolveInitialLocale, syncDocument } from "./i18n";

describe("ADM-NFR-06 · i18n admin-web", () => {
  test("mặc định vi", () => {
    expect(i18n.language).toBe("vi");
    expect(i18n.t("nav.overview")).toBe("Tổng quan");
  });

  test("đổi sang en", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.overview")).toBe("Overview");
    await i18n.changeLanguage("vi");
  });

  test("syncDocument đặt lang", () => {
    const doc = { documentElement: { lang: "" } };
    syncDocument(doc, "en");
    expect(doc.documentElement.lang).toBe("en");
  });

  test("ngôn ngữ ban đầu: đã lưu → trình duyệt → vi", () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(resolveInitialLocale(store("en"), "vi-VN")).toBe("en");
    expect(resolveInitialLocale(store(null), "en-US")).toBe("en");
    expect(resolveInitialLocale(store("xx"), "fr-FR")).toBe("vi");
    expect(resolveInitialLocale(undefined, undefined)).toBe("vi");
  });
});
