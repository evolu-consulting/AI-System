// portal-home · luật app mặc định hiệu lực.
import { describe, expect, it } from "bun:test";
import { canSetTenantDefault, effectiveDefaultApp } from "./portal.rules";

const OPEN = ["chat", "contracts"];

describe("effectiveDefaultApp", () => {
  it("cá nhân thắng công ty; chưa đặt gì ⇒ null (trang chủ)", () => {
    expect(effectiveDefaultApp("chat", "contracts", OPEN)).toBe("chat");
    expect(effectiveDefaultApp(null, "contracts", OPEN)).toBe("contracts");
    expect(effectiveDefaultApp(null, null, OPEN)).toBeNull();
  });
  it("app không còn mở được bị bỏ qua, rơi xuống mặc định công ty rồi trang chủ", () => {
    expect(effectiveDefaultApp("admin", "contracts", OPEN)).toBe("contracts");
    expect(effectiveDefaultApp("admin", "studio", OPEN)).toBeNull();
  });
  it("chỉ quản trị đặt mặc định công ty", () => {
    expect(canSetTenantDefault("tenant_admin")).toBe(true);
    expect(canSetTenantDefault("platform_admin")).toBe(true);
    expect(canSetTenantDefault("member")).toBe(false);
  });
});
