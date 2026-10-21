// app-catalog · lọc/nhãn/link của switcher (thuần).
import { describe, expect, it } from "bun:test";
import type { MeApp } from "@ai/contracts";
import { appDescription, appLabel, fallbackApps, otherApps, withCurrent } from "./apps";

const urls = {
  chat: "https://chat.x/",
  contracts: "https://so.x",
  admin: "https://admin.x",
  studio: "https://studio.x/studio/",
};

describe("fallbackApps (khi /me/apps lỗi)", () => {
  it("theo vai; app không có URL env bị ẩn; bỏ `/` cuối", () => {
    expect(fallbackApps(urls, "member").map((a) => a.key)).toEqual(["chat", "contracts"]);
    expect(fallbackApps(urls, "tenant_admin").map((a) => a.key)).toEqual([
      "chat",
      "contracts",
      "admin",
    ]);
    expect(fallbackApps(urls, "platform_admin").map((a) => a.key)).toEqual([
      "chat",
      "contracts",
      "studio",
      "admin",
    ]);
    expect(fallbackApps({ chat: "", admin: "https://a.x" }, "member")).toEqual([]);
    expect(fallbackApps(urls, "member")[0]?.url).toBe("https://chat.x");
  });
});

describe("switcher", () => {
  const apps = fallbackApps(urls, "platform_admin");
  it("bỏ app hiện tại và app chưa có URL", () => {
    expect(otherApps(apps, "chat").map((a) => a.key)).toEqual(["contracts", "studio", "admin"]);
    const noUrl = { key: "k", name: { vi: "K" }, icon: "app", url: "", sso: true };
    expect(otherApps([...apps, noUrl], "admin").map((a) => a.key)).toEqual([
      "chat",
      "contracts",
      "studio",
    ]);
  });
  it("nhãn theo locale, en vắng ⇒ vi", () => {
    const a = {
      key: "k",
      name: { vi: "Việt", en: "Eng" },
      icon: "app",
      url: "https://k.x",
      sso: true,
    };
    expect(appLabel(a, "en")).toBe("Eng");
    expect(appLabel(a, "vi")).toBe("Việt");
    expect(appLabel({ ...a, name: { vi: "Việt" } }, "en")).toBe("Việt");
  });
});

describe("withCurrent (switcher liệt kê cả app hiện tại)", () => {
  const apps = fallbackApps(urls, "tenant_admin");
  it("app hiện tại đã có ⇒ giữ nguyên; thiếu ⇒ thêm đúng thứ tự mặc định, url rỗng", () => {
    expect(withCurrent(apps, "admin").map((a) => a.key)).toEqual(["chat", "contracts", "admin"]);
    const noAdmin = apps.filter((a) => a.key !== "admin");
    expect(withCurrent(noAdmin, "admin").map((a) => a.key)).toEqual(["chat", "contracts", "admin"]);
    const noChat = apps.filter((a) => a.key !== "chat");
    const r = withCurrent(noChat, "chat");
    expect(r.map((a) => a.key)).toEqual(["chat", "contracts", "admin"]);
    expect(r[0]?.url).toBe("");
    expect(appLabel(r[0] as MeApp, "vi")).toBe("Chat AI");
    expect(appLabel(r[0] as MeApp, "en")).toBe("AI Chat");
  });
  it("key lạ ⇒ không bịa; có mô tả cho app chuẩn", () => {
    expect(withCurrent(apps, "zzz")).toEqual(apps);
    expect(appDescription(apps[0] as MeApp, "en")).toContain("chat");
    expect(appDescription({ ...(apps[0] as MeApp), key: "zzz" }, "vi")).toBe("");
  });
});
