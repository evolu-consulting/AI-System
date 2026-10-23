// app-perm · Chat AI gắn feature `chat-app` theo công ty (entitlement tenant, không cần grant nhóm/user) — luật thuần.
import { describe, expect, it } from "bun:test";
import {
  type CatalogRow,
  CHAT_APP_FEATURE,
  chatAllowed,
  type Viewer,
  visibleApps,
} from "./app-catalog.rules";
import { effectiveDefaultApp } from "./portal.rules";

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
  row("chat", { sortOrder: 10, requiredFeature: CHAT_APP_FEATURE }),
  row("contracts", { sortOrder: 20, requiredFeature: "contracts-read" }),
  row("admin", { sortOrder: 40, audience: "admin" }),
];
const known = new Set([CHAT_APP_FEATURE, "contracts-read"]);
const v = (o: Partial<Viewer>): Viewer => ({
  role: "member",
  features: new Set(["contracts-read"]),
  tenantFeatures: new Set([CHAT_APP_FEATURE]),
  knownFeatures: known,
  ...o,
});
const keys = (x: Viewer) => visibleApps(ROWS, x).map((r) => r.key);

describe("chat-app theo công ty", () => {
  it("tenant được cấp ⇒ member thấy Chat AI dù không có grant nhóm/user", () => {
    expect(keys(v({}))).toEqual(["chat", "contracts"]);
    expect(chatAllowed(ROWS, v({}))).toBe(true);
  });
  it("tenant bị thu hồi ⇒ member chỉ còn Sổ Hợp Tác; tenant_admin còn Sổ Hợp Tác + Quản trị", () => {
    expect(keys(v({ tenantFeatures: new Set() }))).toEqual(["contracts"]);
    expect(chatAllowed(ROWS, v({ tenantFeatures: new Set() }))).toBe(false);
    expect(keys(v({ role: "tenant_admin", tenantFeatures: new Set() }))).toEqual([
      "contracts",
      "admin",
    ]);
  });
  it("grant nhóm/user một mình KHÔNG thay entitlement công ty", () => {
    const x = v({ features: new Set([CHAT_APP_FEATURE]), tenantFeatures: new Set() });
    expect(chatAllowed(ROWS, x)).toBe(false);
  });
  it("feature `chat-app` chưa tồn tại (DB trống/cài mới) ⇒ Chat AI mở như cũ", () => {
    const x = v({ tenantFeatures: new Set(), knownFeatures: new Set(["contracts-read"]) });
    expect(keys(x)).toEqual(["chat", "contracts"]);
    expect(keys({ role: "member", features: new Set() })).toEqual(["chat"]);
  });
  it("hạ cánh: không Chat AI + chưa đặt mặc định ⇒ app đầu tiên mở được; có Chat AI ⇒ trang chủ như cũ", () => {
    expect(effectiveDefaultApp(null, null, ["contracts"], false)).toBe("contracts");
    expect(effectiveDefaultApp(null, "contracts", ["contracts", "admin"], false)).toBe("contracts");
    expect(effectiveDefaultApp(null, null, [], false)).toBeNull();
    expect(effectiveDefaultApp(null, null, ["chat", "contracts"])).toBeNull();
  });
  it("platform_admin luôn mở được Chat AI", () => {
    expect(chatAllowed(ROWS, v({ role: "platform_admin", tenantFeatures: new Set() }))).toBe(true);
  });
  it("chatAllowed theo quyền, không theo URL/bật; không có hàng chat ⇒ true", () => {
    const noUrl = [row("chat", { url: "", requiredFeature: CHAT_APP_FEATURE })];
    expect(chatAllowed(noUrl, v({}))).toBe(true);
    expect(chatAllowed(noUrl, v({ tenantFeatures: new Set() }))).toBe(false);
    expect(chatAllowed([row("contracts")], v({ tenantFeatures: new Set() }))).toBe(true);
  });
});
