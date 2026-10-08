import { beforeAll, describe, expect, test } from "bun:test";
import { i18n, initI18n, resolveInitialLocale, syncDocument } from "./i18n";

describe("ADM-NFR-06 · i18n admin-web", () => {
  beforeAll(() => initI18n());

  test("mặc định en (CR-052)", () => {
    expect(i18n.language).toBe("en");
    expect(i18n.t("nav.overview")).toBe("Overview");
  });

  test("đổi sang en", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.overview")).toBe("Overview");
    await i18n.changeLanguage("vi");
  });

  test("nội suy {tham_số}", () => {
    expect(i18n.t("auth.error.tempLocked", { time: "14:45" })).toBe("Tạm khoá đến 14:45");
    expect(i18n.t("banner.quota80", { pct: 85 })).toBe("Đã dùng 85% quota tháng này");
  });

  test("syncDocument đặt lang", () => {
    const doc = { documentElement: { lang: "" } };
    syncDocument(doc, "en");
    expect(doc.documentElement.lang).toBe("en");
  });

  test("ngôn ngữ ban đầu: đã lưu → en (không dò trình duyệt)", () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(resolveInitialLocale(store("vi"))).toBe("vi");
    expect(resolveInitialLocale(store(null))).toBe("en");
    expect(resolveInitialLocale(store("xx"))).toBe("en");
    expect(resolveInitialLocale(undefined)).toBe("en");
  });
});
