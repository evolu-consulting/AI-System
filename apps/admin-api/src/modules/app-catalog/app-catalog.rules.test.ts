// app-catalog · lọc app theo vai/feature + kiểm đích SSO (thuần).
import { describe, expect, it } from "bun:test";
import { type CatalogRow, redeemTargetOk, visibleApps } from "./app-catalog.rules";

const row = (key: string, o: Partial<CatalogRow> = {}): CatalogRow => ({
  key,
  name: { vi: key },
  icon: "app",
  url: `https://${key}.x`,
  audience: "all",
  requiredFeature: null,
  sso: true,
  sortOrder: 100,
  enabled: true,
  ...o,
});
const ROWS = [
  row("chat", { sortOrder: 10 }),
  row("contracts", { sortOrder: 20, requiredFeature: "contracts-read" }),
  row("studio", { sortOrder: 30, audience: "platform", sso: false }),
  row("admin", { sortOrder: 40, audience: "admin" }),
];
const keys = (v: Parameters<typeof visibleApps>[1], rows = ROWS) =>
  visibleApps(rows, v).map((r) => r.key);

describe("visibleApps", () => {
  it("member không có gói: chỉ Chat AI; có feature: thêm Sổ Hợp Tác", () => {
    expect(keys({ role: "member", features: new Set() })).toEqual(["chat"]);
    expect(keys({ role: "member", features: new Set(["contracts-read"]) })).toEqual([
      "chat",
      "contracts",
    ]);
  });
  it("tenant_admin thấy Quản trị nhưng không thấy Studio; platform_admin thấy hết", () => {
    expect(keys({ role: "tenant_admin", features: new Set() })).toEqual(["chat", "admin"]);
    expect(keys({ role: "platform_admin", features: new Set() })).toEqual([
      "chat",
      "contracts",
      "studio",
      "admin",
    ]);
  });
  it("app tắt hoặc chưa có URL bị ẩn; sắp theo sort_order rồi key", () => {
    const rows = [
      row("b", { sortOrder: 5 }),
      row("a", { sortOrder: 5 }),
      row("off", { enabled: false }),
      row("nourl", { url: "" }),
    ];
    expect(keys({ role: "member", features: new Set() }, rows)).toEqual(["a", "b"]);
  });
});

describe("redeemTargetOk", () => {
  const ok = { enabled: true, url: "https://sohoptac.example.com/app", sso: true };
  it("khớp catalog; Origin phải đúng origin URL catalog", () => {
    expect(redeemTargetOk(ok, undefined)).toBe(true);
    expect(redeemTargetOk(ok, "https://sohoptac.example.com")).toBe(true);
    expect(redeemTargetOk(ok, "https://evil.example.com")).toBe(false);
  });
  it("không có hàng / tắt / không URL / không SSO ⇒ từ chối", () => {
    expect(redeemTargetOk(undefined, undefined)).toBe(false);
    expect(redeemTargetOk({ ...ok, enabled: false }, undefined)).toBe(false);
    expect(redeemTargetOk({ ...ok, url: "" }, undefined)).toBe(false);
    expect(redeemTargetOk({ ...ok, sso: false }, undefined)).toBe(false);
  });
});
