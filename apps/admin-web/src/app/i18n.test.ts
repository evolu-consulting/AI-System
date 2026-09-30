import { describe, expect, test } from "bun:test";
import { i18n, syncDocument } from "./i18n";

describe("ADM-NFR-06 · i18n admin-web", () => {
  test("mặc định vi", () => {
    expect(i18n.language).toBe("vi");
    expect(i18n.t("home.page.title")).toBe("Admin Console");
    expect(i18n.t("home.page.subtitle")).toBe("Bảng quản trị nền tảng AI");
  });

  test("đổi sang en", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("home.page.subtitle")).toBe("AI platform administration");
    await i18n.changeLanguage("vi");
  });

  test("syncDocument đặt lang và title theo app.meta.title", () => {
    const doc = { title: "", documentElement: { lang: "" } };
    syncDocument(doc, "en");
    expect(doc).toEqual({ title: "Admin Console", documentElement: { lang: "en" } });
    syncDocument(doc, "vi");
    expect(doc.documentElement.lang).toBe("vi");
    expect(doc.title).toBe(i18n.t("app.meta.title", { lng: "vi" }));
  });
});
