// CR-118 · cr118-app-config · luật thuần trang cấu hình app: tab, nhóm app, khe, bảng công ty, trạng thái chuyển công ty/bản nháp.
import { describe, expect, test } from "bun:test";
import {
  APP_TABS,
  buildCompanyRows,
  canSwitchCompany,
  configWarnings,
  countByLevel,
  effectiveVersion,
  enabledCount,
  featureAppOf,
  filterCompanies,
  isLegacyAssignTab,
  parseAppTab,
  slotsOfApp,
} from "./app-config";

const T = [
  { id: "t1", key: "acme", name: "Acme", locked: false },
  { id: "t2", key: "beta", name: "Beta Công ty", locked: false },
  { id: "t3", key: "gamma", name: "Gamma", locked: false },
  { id: "t4", key: "delta", name: "Delta", locked: true },
];
const ents = {
  "contracts-read": [
    { tenant_id: "t1", active_user_count: 3 },
    { tenant_id: "t2", active_user_count: 5 },
    { tenant_id: "t3", active_user_count: 1 },
  ],
  "contracts-write": [
    { tenant_id: "t1", active_user_count: 3 },
    { tenant_id: "t2", active_user_count: 5 },
  ],
  "contracts-admin": [{ tenant_id: "t1", active_user_count: 3 }],
  "han-muc-duyet": [{ tenant_id: "t1", active_user_count: 3 }],
};

describe("tab của trang app", () => {
  test("5 tab theo thứ tự wireframe, giá trị lạ ⇒ undefined", () => {
    expect([...APP_TABS]).toEqual(["overview", "features", "preview"]);
    expect(parseAppTab("features")).toBe("features");
    // CR-121 c13: tab gán cũ không còn là tab hợp lệ, được nhận ra để chuyển hướng kèm thông báo
    expect(parseAppTab("processes")).toBeUndefined();
    expect(parseAppTab("companies")).toBeUndefined();
    expect(isLegacyAssignTab("processes")).toBe(true);
    expect(isLegacyAssignTab("companies")).toBe(true);
    expect(isLegacyAssignTab("overview")).toBe(false);
    expect(parseAppTab("packs")).toBeUndefined();
    expect(parseAppTab(undefined)).toBeUndefined();
  });
});

describe("featureAppOf / slotsOfApp", () => {
  test("key catalog ↔ nhóm feature; studio/admin không có nhóm", () => {
    expect(featureAppOf("contracts")).toBe("contracts");
    expect(featureAppOf("community")).toBe("community");
    expect(featureAppOf("studio")).toBeNull();
    expect(featureAppOf("core")).toBeNull();
  });
  test("lọc khe theo tiền tố app", () => {
    const rows = [{ slot: "contracts.approval" }, { slot: "community.post" }, { slot: null }];
    expect(slotsOfApp(rows, "contracts")).toEqual([{ slot: "contracts.approval" }]);
    expect(slotsOfApp(rows, "studio")).toEqual([]);
  });
});

describe("bảng công ty", () => {
  const rows = buildCompanyRows(T, ents, "contracts");
  test("mức = mức cao nhất, tính năng thêm chỉ tính khi app bật, người = max entitlement", () => {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.acme).toMatchObject({ level: "admin", addons: 1, users: 3 });
    expect(by.beta).toMatchObject({ level: "write", addons: 0, users: 5 });
    expect(by.gamma?.level).toBe("read");
    expect(by.delta).toMatchObject({ level: "off", locked: true, users: 0 });
  });
  test("đếm theo mức + số công ty đang bật", () => {
    expect(countByLevel(rows)).toEqual({ off: 1, read: 1, write: 1, admin: 1 });
    expect(enabledCount(rows)).toBe(3);
  });
  test("lọc theo mức và theo tên/ký hiệu (không phân biệt hoa thường)", () => {
    expect(filterCompanies(rows, { level: "off" }).map((r) => r.key)).toEqual(["delta"]);
    expect(filterCompanies(rows, { q: "BETA" }).map((r) => r.key)).toEqual(["beta"]);
    expect(filterCompanies(rows, { q: "công" }).map((r) => r.key)).toEqual(["beta"]);
    expect(filterCompanies(rows, {})).toHaveLength(4);
  });
});

describe("trạng thái chuyển công ty / bản nháp", () => {
  test("đang sửa dở ⇒ không chuyển sang công ty khác, sạch ⇒ chuyển tự do", () => {
    expect(canSwitchCompany(true, "t1", "t2")).toBe(false);
    expect(canSwitchCompany(true, "t1", "t1")).toBe(true);
    expect(canSwitchCompany(false, "t1", "t2")).toBe(true);
    expect(canSwitchCompany(false, undefined, "t2")).toBe(true);
  });
  test("bản nháp chỉ khi có nháp thật", () => {
    expect(effectiveVersion("draft", true)).toBe("draft");
    expect(effectiveVersion("draft", false)).toBe("saved");
    expect(effectiveVersion("saved", true)).toBe("saved");
  });
});

describe("cảnh báo cấu hình", () => {
  const rows = buildCompanyRows(T, ents, "contracts");
  const slots = [{ key: "contracts.approval", addon: "han-muc-duyet" }];
  test("app thiếu URL / đang ẩn khỏi danh mục nhưng đã có công ty bật", () => {
    const w = configWarnings({ app: { url: "", enabled: false }, rows, assigned: {}, slots: [] });
    expect(w).toEqual([
      { code: "no_url", count: 3 },
      { code: "app_disabled", count: 3 },
    ]);
    expect(
      configWarnings({ app: { url: "https://x", enabled: true }, rows, assigned: {}, slots: [] }),
    ).toEqual([]);
  });
  test("công ty được gán quy trình riêng nhưng chưa bật tính năng thêm của khe", () => {
    const assigned = { t1: [{ slot: "contracts.approval" }], t2: [{ slot: "contracts.approval" }] };
    const w = configWarnings({ app: { url: "https://x", enabled: true }, rows, assigned, slots });
    expect(w).toEqual([
      { code: "flow_needs_addon", companies: ["Beta Công ty"], addon: "han-muc-duyet" },
    ]); // acme có han-muc-duyet; beta thiếu
  });
});
