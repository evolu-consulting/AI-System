import { describe, expect, it } from "bun:test";
import { isSwitchApp, visibleApps } from "./apps";

const urls = { chat: "https://chat.x", admin: "https://admin.x" };

describe("V2-GAPS · app switcher", () => {
  it("AI System luôn hiện khi có URL; Quản trị chỉ cho quản trị viên; thiếu URL ⇒ ẩn", () => {
    expect(visibleApps({ urls, role: "member" })).toEqual(["chat"]);
    expect(visibleApps({ urls, role: "tenant_admin" })).toEqual(["chat", "admin"]);
    expect(
      visibleApps({ urls: { chat: "", admin: "https://admin.x" }, role: "platform_admin" }),
    ).toEqual(["admin"]);
    expect(visibleApps({ urls: { chat: "", admin: "" }, role: "tenant_admin" })).toEqual([]);
    expect(isSwitchApp("chat") && !isSwitchApp("contracts")).toBe(true);
  });
});
