import { describe, expect, test } from "bun:test";
import { i18n } from "./i18n";

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
});
