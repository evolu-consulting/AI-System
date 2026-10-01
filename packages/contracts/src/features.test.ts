import { describe, expect, test } from "bun:test";
import {
  EntitlementListResponseSchema,
  FeatureCreateRequestSchema,
  type FeatureDetail,
  FeatureDetailSchema,
  FeatureListQuerySchema,
  FeatureListResponseSchema,
  FeatureUpdateRequestSchema,
} from "./index";
import { USER_ID as CMD_ID, TENANT_ID as ID, T0, T1 } from "./test-fixtures";

const detail: FeatureDetail = {
  id: ID,
  key: "core",
  name: { vi: "Mặc định", en: "Default" },
  description: {},
  icon: "package",
  status: "on",
  is_core: true,
  command_count: 1,
  tenant_count: 0,
  version: 1,
  updated_at: T1,
  updated_by: null,
  created_at: T0,
  commands: [
    { id: CMD_ID, name: "dich", description: { vi: "Dịch" }, enabled: true, feature_count: 1 },
  ],
  affected_user_count: 12,
};

describe("ADM-FR-30 · M2-R20 · request", () => {
  test("create mặc định description {}, icon package, status on, command_ids []", () => {
    expect(
      FeatureCreateRequestSchema.parse({ key: " Docs ", name: { vi: "Tài liệu", en: "" } }),
    ).toEqual({
      key: "docs",
      name: { vi: "Tài liệu" },
      description: {},
      icon: "package",
      status: "on",
      command_ids: [],
    });
  });

  test.each([
    ["key có _", { key: "a_b", name: { vi: "x" } }],
    ["name.vi rỗng", { key: "ab", name: { vi: " " } }],
    ["name.vi 65", { key: "ab", name: { vi: "a".repeat(65) } }],
    ["description 401", { key: "ab", name: { vi: "x" }, description: { en: "a".repeat(401) } }],
    ["icon hoa", { key: "ab", name: { vi: "x" }, icon: "Package" }],
    ["status lạ", { key: "ab", name: { vi: "x" }, status: "hidden" }],
    ["command_ids trùng", { key: "ab", name: { vi: "x" }, command_ids: [ID, ID] }],
    ["command_ids không uuid", { key: "ab", name: { vi: "x" }, command_ids: ["x"] }],
  ])("create từ chối: %s", (_n, v) => {
    expect(FeatureCreateRequestSchema.safeParse(v).success).toBe(false);
  });

  test("command_ids tối đa 500", () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `0199a3b2-7c1e-7a2b-8c3d-${String(i).padStart(12, "0")}`,
    );
    const base = { key: "ab", name: { vi: "x" } };
    expect(FeatureCreateRequestSchema.safeParse({ ...base, command_ids: ids }).success).toBe(false);
    expect(
      FeatureCreateRequestSchema.safeParse({ ...base, command_ids: ids.slice(1) }).success,
    ).toBe(true);
  });

  test("update: không có key; command_ids [] được (thay cả tập)", () => {
    expect(FeatureUpdateRequestSchema.safeParse({ version: 1, key: "x" }).success).toBe(false);
    expect(FeatureUpdateRequestSchema.parse({ version: 1, command_ids: [] })).toEqual({
      version: 1,
      command_ids: [],
    });
  });
});

describe("ADM-FR-30 · ADM-FR-31 · response", () => {
  test("FeatureDetail strict; is_core khớp key", () => {
    expect(FeatureDetailSchema.parse(detail)).toEqual(detail);
    expect(FeatureDetailSchema.safeParse({ ...detail, is_core: false }).success).toBe(false);
    expect(FeatureDetailSchema.safeParse({ ...detail, icon: null }).success).toBe(false);
  });

  test("list query status on|off|beta; counts {all,on,beta,off}", () => {
    expect(FeatureListQuerySchema.parse({ status: "beta" }).status).toBe("beta");
    expect(FeatureListQuerySchema.safeParse({ status: "x" }).success).toBe(false);
    const { created_at, commands, affected_user_count, ...item } = detail;
    const ok = { items: [item], total: 1, counts: { all: 1, on: 1, beta: 0, off: 0 } };
    expect(FeatureListResponseSchema.parse(ok)).toEqual(ok);
  });

  test("entitlement {items,total}, không counts", () => {
    const e = {
      tenant_id: ID,
      tenant_key: "acme",
      tenant_name: "Acme",
      tenant_active: false,
      active_user_count: 3,
      granted_at: T0,
      granted_by: "admin",
    };
    expect(EntitlementListResponseSchema.parse({ items: [e], total: 1 })).toEqual({
      items: [e],
      total: 1,
    });
    expect(
      EntitlementListResponseSchema.safeParse({ items: [{ ...e, revoked_at: null }], total: 1 })
        .success,
    ).toBe(false);
  });
});
