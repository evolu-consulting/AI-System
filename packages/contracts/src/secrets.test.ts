import { describe, expect, test } from "bun:test";
import {
  type Secret,
  SecretCreateRequestSchema,
  SecretListQuerySchema,
  SecretListResponseSchema,
  SecretNoteRequestSchema,
  SecretReplaceRequestSchema,
  SecretSchema,
} from "./index";
import { T0, T1, TENANT_ID } from "./test-fixtures";

const secret: Secret = {
  id: TENANT_ID,
  name: "DIFY_TRANSLATE_KEY",
  last4: "a1b2",
  note: null,
  used_by: ["translate"],
  created_at: T0,
  updated_at: T1,
  updated_by: "admin",
};

describe("ADM-FR-50 · SecretSchema (AC-A06: không có giá trị)", () => {
  test("nhận bản hợp lệ; last4 đếm code point", () => {
    expect(SecretSchema.parse(secret)).toEqual(secret);
    expect(SecretSchema.safeParse({ ...secret, last4: "😀😀ab" }).success).toBe(true);
    expect(SecretSchema.safeParse({ ...secret, last4: "abc" }).success).toBe(false);
  });

  test.each(["value", "ciphertext", "iv", "key_version"])("từ chối trường lộ bí mật: %s", (k) => {
    expect(SecretSchema.safeParse({ ...secret, [k]: "x" }).success).toBe(false);
  });
});

describe("ADM-FR-50 · M2-R01 · request", () => {
  test("tạo: tên chuẩn hoá HOA, giá trị không trim, note rỗng → null", () => {
    const r = SecretCreateRequestSchema.parse({
      name: " dify_key ",
      value: "  12345678 ",
      note: " ",
    });
    expect(r).toEqual({ name: "DIFY_KEY", value: "  12345678 ", note: null });
    expect(SecretCreateRequestSchema.parse({ name: "AB", value: "12345678" }).note).toBeUndefined();
  });

  test.each([
    ["giá trị 7 ký tự", { name: "AB", value: "1234567" }],
    ["giá trị 2049 ký tự", { name: "AB", value: "a".repeat(2049) }],
    ["tên 1 ký tự", { name: "A", value: "12345678" }],
    ["tên có -", { name: "A-B", value: "12345678" }],
    ["tên 65 ký tự", { name: "A".repeat(65), value: "12345678" }],
    ["note 201 ký tự", { name: "AB", value: "12345678", note: "a".repeat(201) }],
    ["trường lạ", { name: "AB", value: "12345678", id: TENANT_ID }],
  ])("tạo từ chối: %s", (_n, input) => {
    expect(SecretCreateRequestSchema.safeParse(input).success).toBe(false);
  });

  test("biên giá trị 8 và 2048 được nhận", () => {
    for (const value of ["a".repeat(8), "a".repeat(2048)])
      expect(SecretCreateRequestSchema.safeParse({ name: "AB", value }).success).toBe(true);
  });

  test("PUT chỉ nhận value; PATCH chỉ nhận note (null được)", () => {
    expect(SecretReplaceRequestSchema.safeParse({ value: "12345678" }).success).toBe(true);
    expect(SecretReplaceRequestSchema.safeParse({ value: "12345678", note: "x" }).success).toBe(
      false,
    );
    expect(SecretNoteRequestSchema.parse({ note: null })).toEqual({ note: null });
    expect(SecretNoteRequestSchema.parse({ note: " ghi chú " })).toEqual({ note: "ghi chú" });
    expect(SecretNoteRequestSchema.safeParse({}).success).toBe(false);
    expect(SecretNoteRequestSchema.safeParse({ note: "x", value: "12345678" }).success).toBe(false);
  });
});

describe("ADM-FR-50 · list", () => {
  test("query used=true|false, mặc định limit", () => {
    expect(SecretListQuerySchema.parse({ used: "false" })).toEqual({
      used: false,
      limit: 50,
      offset: 0,
    });
    expect(SecretListQuerySchema.safeParse({ used: "1" }).success).toBe(false);
    expect(SecretListQuerySchema.safeParse({ value: "x" }).success).toBe(false);
  });

  test("response counts {all, used, unused}", () => {
    const ok = { items: [secret], total: 1, counts: { all: 1, used: 1, unused: 0 } };
    expect(SecretListResponseSchema.parse(ok)).toEqual(ok);
    expect(
      SecretListResponseSchema.safeParse({ ...ok, counts: { all: 1, active: 1, locked: 0 } })
        .success,
    ).toBe(false);
  });
});
