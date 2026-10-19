// PK-FR-01 · PK-FR-05 · PK-FR-08 · PK-FR-07 · N1 plan §2: luật thuần của contract `packages/contracts/src/packs.ts`
// (khoá gói, ánh xạ mã quyền → feature/group key, bảng vai → việc, mã lỗi, schema). Thiếu file ⇒ đỏ ngay "chưa có tính năng".
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadPackContract, ROOT } from "../_support/load";

const mod = () => loadPackContract();

describe("PK-FR-01 · khoá gói (PACK_KEY_RE, PackKeySchema)", () => {
  it("PK-FR-01 · PACK_KEY_RE nhận khoá hợp lệ (2–21 ký tự, a-z0-9_ , mở đầu chữ)", async () => {
    const { PACK_KEY_RE } = await mod();
    const ok = ["contracts", "pkdemo", "ab", "a1", "a_b9", `a${"b".repeat(20)}`];
    expect(ok.filter((k) => !PACK_KEY_RE.test(k))).toEqual([]);
  });
  it("PK-FR-01 · PACK_KEY_RE loại: 1 ký tự, 22 ký tự, mở đầu số/gạch, hoa, '-', '.', rỗng", async () => {
    const { PACK_KEY_RE } = await mod();
    const bad = ["a", `a${"b".repeat(21)}`, "1abc", "_abc", "Abc", "a-b", "a.b", "", "a b", "ab\n"];
    expect(bad.filter((k) => PACK_KEY_RE.test(k))).toEqual([]);
  });
  it("PK-FR-01 · PackKeySchema cấm public, admin, hub, drizzle, packs, information_schema và tiền tố pg_", async () => {
    const { PackKeySchema } = await mod();
    const bad = [
      "public",
      "admin",
      "hub",
      "drizzle",
      "packs",
      "information_schema",
      "pg_x",
      "pg_catalog",
    ];
    expect(bad.filter((k) => PackKeySchema.safeParse(k).success)).toEqual([]);
    expect(PackKeySchema.safeParse("contracts").success).toBe(true);
    expect(PackKeySchema.safeParse("pgx").success).toBe(true); // chỉ tiền tố `pg_` bị cấm
  });
  it("PK-FR-01 · khoá gói khai MỘT chỗ: @ai/contracts (index) xuất PACK_KEY_RE, PackKeySchema, PACK_ACTIONS", async () => {
    const idx = await import(join(ROOT, "packages/contracts/src/index.ts"));
    expect(
      ["PACK_KEY_RE", "PackKeySchema", "PACK_ACTIONS", "PACK_ROLE_ACTIONS", "PackErrorCode"].filter(
        (n) => !(n in idx),
      ),
    ).toEqual([]);
  });
});

describe("PK-FR-05 · mã quyền gói và vai", () => {
  it("PK-FR-05 · PACK_ACTIONS = read, write, admin; PACK_ROLES = owner, editor, viewer", async () => {
    const m = await mod();
    expect([...m.PACK_ACTIONS]).toEqual(["read", "write", "admin"]);
    expect([...m.PACK_ROLES]).toEqual(["owner", "editor", "viewer"]);
  });
  it("PK-FR-05 · PACK_ROLE_ACTIONS: viewer=read · editor=read+write · owner=cả ba", async () => {
    const { PACK_ROLE_ACTIONS } = await mod();
    expect({
      viewer: [...PACK_ROLE_ACTIONS.viewer],
      editor: [...PACK_ROLE_ACTIONS.editor],
      owner: [...PACK_ROLE_ACTIONS.owner],
    }).toEqual({
      viewer: ["read"],
      editor: ["read", "write"],
      owner: ["read", "write", "admin"],
    });
  });
  it("PK-FR-05 · packCode = <khoá>.<việc>; packFeatureKey/packGroupKey đổi '_' → '-'", async () => {
    const { packCode, packFeatureKey, packGroupKey } = await mod();
    expect(packCode("contracts", "read")).toBe("contracts.read");
    expect(packFeatureKey("contracts", "write")).toBe("contracts-write");
    expect(packFeatureKey("my_pack", "admin")).toBe("my-pack-admin");
    expect(packGroupKey("contracts", "owner")).toBe("contracts-owner");
    expect(packGroupKey("my_pack", "viewer")).toBe("my-pack-viewer");
  });
  it("PK-FR-05 · feature key khớp CHECK admin.features_key_check ^[a-z0-9-]{2,32}$ cho khoá dài nhất (21) và đơn ánh", async () => {
    const { packFeatureKey, packGroupKey, PACK_ACTIONS, PACK_ROLES } = await mod();
    const longest = `a${"b_".repeat(10)}`; // 21 ký tự
    expect(longest.length).toBe(21);
    const keys = [
      ...PACK_ACTIONS.map((a: string) => packFeatureKey(longest, a)),
      ...PACK_ROLES.map((r: string) => packGroupKey(longest, r)),
    ];
    expect(keys.filter((k: string) => !/^[a-z0-9-]{2,32}$/.test(k))).toEqual([]);
    const set = new Set(["a_b", "a_bc", "ab", "a_b_c"].map((k) => packFeatureKey(k, "read")));
    expect(set.size).toBe(4); // đơn ánh: khoá gói không có '-'
  });
});

describe("PK-FR-05/07/08 · mã lỗi và schema", () => {
  it("PK-FR-05 · PackErrorCode = PACK_DISABLED, PACK_FORBIDDEN, PACK_NOT_FOUND, DOCX_UNREADABLE, DOCX_BUSY", async () => {
    const { PackErrorCode } = await mod();
    expect([...PackErrorCode.options].sort()).toEqual(
      ["DOCX_BUSY", "DOCX_UNREADABLE", "PACK_DISABLED", "PACK_FORBIDDEN", "PACK_NOT_FOUND"].sort(),
    );
  });
  it("PK-FR-05 · PackMeResponseSchema: chưa bật/không quyền vẫn hợp lệ ({enabled:false, actions:[]}); > 3 việc hoặc việc lạ bị loại", async () => {
    const { PackMeResponseSchema } = await mod();
    expect(
      PackMeResponseSchema.safeParse({ pack: "pkdemo", enabled: false, actions: [] }).success,
    ).toBe(true);
    expect(
      PackMeResponseSchema.safeParse({
        pack: "pkdemo",
        enabled: true,
        actions: ["read", "write", "admin"],
      }).success,
    ).toBe(true);
    expect(
      PackMeResponseSchema.safeParse({
        pack: "pkdemo",
        enabled: true,
        actions: ["read", "write", "admin", "read"],
      }).success,
    ).toBe(false);
    expect(
      PackMeResponseSchema.safeParse({ pack: "pkdemo", enabled: true, actions: ["delete"] })
        .success,
    ).toBe(false);
    expect(
      PackMeResponseSchema.safeParse({ pack: "Bad-Key", enabled: true, actions: [] }).success,
    ).toBe(false);
  });
  it("PK-FR-05 · PackStateSchema ≤ 3 Group, PackListResponseSchema ≤ 50 gói", async () => {
    const { PackStateSchema, PackListResponseSchema } = await mod();
    const g = (role: string) => ({ role, group_id: "a5e10000-0000-4000-8000-000000000001" });
    expect(
      PackStateSchema.safeParse({
        key: "pkdemo",
        enabled: true,
        groups: [g("owner"), g("editor"), g("viewer")],
      }).success,
    ).toBe(true);
    expect(
      PackStateSchema.safeParse({
        key: "pkdemo",
        enabled: true,
        groups: [g("owner"), g("editor"), g("viewer"), g("viewer")],
      }).success,
    ).toBe(false);
    const st = { key: "pkdemo", enabled: false, groups: [] };
    expect(
      PackListResponseSchema.safeParse({ items: Array.from({ length: 50 }, () => st) }).success,
    ).toBe(true);
    expect(
      PackListResponseSchema.safeParse({ items: Array.from({ length: 51 }, () => st) }).success,
    ).toBe(false);
  });
  it("PK-FR-08 · IndexOutboxRowSchema: entity ^[a-z][a-z0-9_]{1,40}$, entity_id uuid, op upsert|delete", async () => {
    const { IndexOutboxRowSchema } = await mod();
    const id = "a5e10000-0000-4000-8000-000000000001";
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "contract", entity_id: id, op: "upsert" }).success,
    ).toBe(true);
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "contract", entity_id: id, op: "delete" }).success,
    ).toBe(true);
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "Contract", entity_id: id, op: "upsert" }).success,
    ).toBe(false);
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "contract", entity_id: "x", op: "upsert" }).success,
    ).toBe(false);
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "contract", entity_id: id, op: "update" }).success,
    ).toBe(false);
    expect(
      IndexOutboxRowSchema.safeParse({ entity: "a", entity_id: id, op: "upsert" }).success,
    ).toBe(false);
  });
  it("PK-FR-07 · DocxMarkdownSchema: markdown ≤ 5.000.000 ký tự, warnings ≤ 50 mục × ≤ 200 ký tự", async () => {
    const { DocxMarkdownSchema } = await mod();
    expect(
      DocxMarkdownSchema.safeParse({ markdown: "x".repeat(5_000_000), warnings: [] }).success,
    ).toBe(true);
    expect(
      DocxMarkdownSchema.safeParse({ markdown: "x".repeat(5_000_001), warnings: [] }).success,
    ).toBe(false);
    expect(
      DocxMarkdownSchema.safeParse({ markdown: "", warnings: Array(51).fill("w") }).success,
    ).toBe(false);
    expect(
      DocxMarkdownSchema.safeParse({ markdown: "", warnings: ["w".repeat(201)] }).success,
    ).toBe(false);
  });
});
