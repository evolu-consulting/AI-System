// CR-102a · contract user ngoài: hình dạng kind/role/org, schema tạo công ty/user, mã lỗi riêng ngoài API_ERRORS.
import { describe, expect, test } from "bun:test";
import { MeSchema } from "./auth";
import { API_ERRORS } from "./common";
import {
  EXTERNAL_ORG_ERRORS,
  ExternalOrgCreateRequestSchema,
  ExternalUserCreateRequestSchema,
  isValidKindShape,
} from "./external-orgs";

const ORG = "01900000-0000-7000-8000-0000000000aa";

describe("CR-102a · external-orgs contract", () => {
  test("isValidKindShape: external cần org + member; internal không có org", () => {
    expect(isValidKindShape({ kind: "external", role: "member", externalOrgId: ORG })).toBe(true);
    expect(isValidKindShape({ kind: "external", role: "tenant_admin", externalOrgId: ORG })).toBe(
      false,
    );
    expect(isValidKindShape({ kind: "external", role: "member", externalOrgId: null })).toBe(false);
    expect(isValidKindShape({ kind: "internal", role: "tenant_admin", externalOrgId: null })).toBe(
      true,
    );
    expect(isValidKindShape({ kind: "internal", role: "member", externalOrgId: ORG })).toBe(false);
  });

  test("tên công ty trim 1..200; user ngoài không nhận role, locale mặc định vi", () => {
    expect(ExternalOrgCreateRequestSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(ExternalOrgCreateRequestSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(ExternalOrgCreateRequestSchema.parse({ name: " NCC " }).name).toBe("NCC");
    expect(
      ExternalUserCreateRequestSchema.safeParse({
        username: "a1",
        display_name: "A",
        role: "tenant_admin",
      }).success,
    ).toBe(false);
    expect(
      ExternalUserCreateRequestSchema.parse({ username: "A1", display_name: "A" }),
    ).toMatchObject({ username: "a1", locale: "vi" });
  });

  test("mã lỗi riêng, không lẫn API_ERRORS (khoá 46)", () => {
    for (const k of Object.keys(EXTERNAL_ORG_ERRORS))
      expect(Object.keys(API_ERRORS)).not.toContain(k);
    expect(EXTERNAL_ORG_ERRORS.EXTERNAL_USER_NOT_ALLOWED).toBe(422);
  });

  test("Me cũ (không kind) vẫn hợp lệ; Me mới mang kind/ext_org_id", () => {
    const me = {
      id: ORG,
      tenant: { id: ORG, key: "acme", name: "A" },
      username: "an",
      display_name: "An",
      email: null,
      role: "member",
      locale: "vi",
      must_change_password: false,
      totp_enabled: false,
      totp_enabled_at: null,
      backup_codes_left: 0,
    };
    expect(MeSchema.parse(me).kind).toBeUndefined();
    expect(MeSchema.parse({ ...me, kind: "external", ext_org_id: ORG })).toMatchObject({
      kind: "external",
    });
  });
});
