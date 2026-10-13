// HUB-FR-68 · HUB-FR-69 · contract secrets Hub (spec H4b-1 §3): phần tenant (B), lỗi, chi tiết 409 — phần chung có ở
// test khoá `tests/acceptance/H4b1/rules/contracts-h4b1.test.ts`.
import { describe, expect, test } from "bun:test";
import {
  HUB_SECRET_ERRORS,
  HubSecretConflictDetailsSchema,
  HubSecretDeleteQuerySchema,
  HubSecretListQuerySchema,
  HubSecretListResponseSchema,
  HubSecretNameSchema,
  SecretInUseDetailsSchema,
  SourceCredentialCreateRequestSchema,
  SourceCredentialDeleteQuerySchema,
  SourceCredentialListQuerySchema,
  SourceCredentialTenantQuerySchema,
} from "./index";

const ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-10-13T00:00:00.000Z";
const meta = {
  id: ID,
  kind: "provider_api_key",
  tenant: null,
  name: "anthropic-main",
  version: 1,
  used_by: [],
  created_at: AT,
  updated_at: AT,
  updated_by: null,
};
const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("HUB-FR-68 · secrets contract", () => {
  test("tên: emoji/ký tự ngoài ASCII ⇒ fail; giữ hoa-thường", () => {
    expect(ok(HubSecretNameSchema, "key🔑")).toBe(false);
    expect(HubSecretNameSchema.parse("Anthropic-Main")).toBe("Anthropic-Main");
  });
  test("list Studio: limit mặc định 100, cursor ≤ 512, tenant_id uuid", () => {
    expect(HubSecretListQuerySchema.parse({}).limit).toBe(100);
    expect(ok(HubSecretListQuerySchema, { cursor: "x".repeat(513) })).toBe(false);
    expect(ok(HubSecretListQuerySchema, { tenant_id: "acme" })).toBe(false);
    expect(ok(HubSecretListQuerySchema, { x: 1 })).toBe(false);
  });
  test("list tenant: limit mặc định 50, không có kind", () => {
    expect(SourceCredentialListQuerySchema.parse({}).limit).toBe(50);
    expect(ok(SourceCredentialListQuerySchema, { kind: "source_credential" })).toBe(false);
  });
  test("tạo tenant: không nhận kind; tenant_id tuỳ chọn", () => {
    const b = { name: "git-acme", value: "qc-value-1" };
    expect(ok(SourceCredentialCreateRequestSchema, b)).toBe(true);
    expect(ok(SourceCredentialCreateRequestSchema, { ...b, tenant_id: ID })).toBe(true);
    expect(ok(SourceCredentialCreateRequestSchema, { ...b, kind: "source_credential" })).toBe(
      false,
    );
  });
  test("DELETE: version coerce ≥ 1 bắt buộc; tenant query", () => {
    expect(HubSecretDeleteQuerySchema.parse({ version: "3" }).version).toBe(3);
    expect(ok(HubSecretDeleteQuerySchema, {})).toBe(false);
    expect(ok(HubSecretDeleteQuerySchema, { version: "0" })).toBe(false);
    expect(ok(SourceCredentialDeleteQuerySchema, { version: "1", tenant_id: ID })).toBe(true);
    expect(ok(SourceCredentialTenantQuerySchema, { tenant_id: ID, version: 1 })).toBe(false);
  });
  test("response list ≤ 100; 409 details", () => {
    expect(ok(HubSecretListResponseSchema, { items: [meta], next_cursor: null })).toBe(true);
    expect(
      ok(HubSecretListResponseSchema, {
        items: Array.from({ length: 101 }, () => meta),
        next_cursor: "c",
      }),
    ).toBe(false);
    expect(ok(HubSecretConflictDetailsSchema, { current: meta, updated_at: AT })).toBe(true);
    expect(ok(SecretInUseDetailsSchema, { used_by: [] })).toBe(false);
    expect(
      ok(SecretInUseDetailsSchema, { used_by: [{ type: "provider", id: ID, key: "anthropic" }] }),
    ).toBe(true);
    expect(Object.keys(HUB_SECRET_ERRORS)).toEqual(["SECRET_NAME_TAKEN", "SECRET_IN_USE"]);
  });
});
