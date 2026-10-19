// HD-FR-02 · HD-FR-07 · HD-FR-08 · D-03 · D-18 · HD1 plan §1: ListQuery, PATCH, tải lên, lỗi — unit (biên zod).
import { describe, expect, test } from "bun:test";
import {
  ContractErrorCode,
  ContractListQuerySchema,
  ContractStaleDetailsSchema,
  fieldValueSchema,
  PatchFieldsRequestSchema,
  UploadContractFormSchema,
} from "./index";

const U = "c0de0000-0000-4000-8000-000000000001";
const NFD = "Nguyễn"; // "Nguyễn" dạng NFD
const NFC = "Nguyễn";

describe("HD-FR-07 · ContractListQuerySchema", () => {
  test("mặc định page=1, page_size=20, sort=updated_at, dir=desc", () => {
    expect(ContractListQuerySchema.parse({})).toEqual({
      sort: "updated_at",
      dir: "desc",
      page: 1,
      page_size: 20,
    });
  });
  test("tham số lặp ⇒ mảng; một giá trị ⇒ mảng 1 phần tử; số từ chuỗi", () => {
    const r = ContractListQuerySchema.parse({
      status: ["active", "expiring"],
      owner: U,
      direction: "unknown",
      value_min: "0",
      page: "2",
      page_size: "100",
    });
    expect(r).toMatchObject({
      status: ["active", "expiring"],
      owner: [U],
      direction: ["unknown"],
      value_min: 0,
      page: 2,
      page_size: 100,
    });
  });
  test.each([
    ["page=0", { page: "0" }],
    ["page=1001", { page: "1001" }],
    ["page_size=0", { page_size: "0" }],
    ["page_size=101", { page_size: "101" }],
    ["sort lạ", { sort: "id" }],
    ["dir lạ", { dir: "up" }],
    ["q 1 ký tự", { q: "a" }],
    ["q 101 ký tự", { q: "x".repeat(101) }],
    ["owner không phải uuid", { owner: "x" }],
    ["status lạ", { status: "draft" }],
    ["value_min âm", { value_min: "-1" }],
    ["signer > 20", { signer: Array.from({ length: 21 }, (_, i) => `s${i}`) }],
    ["tham số lạ", { cursor: "x" }],
  ])("từ chối: %s", (_n, q) => {
    expect(ContractListQuerySchema.safeParse(q).success).toBe(false);
  });
  test("D-18 · q và signer chuẩn NFC + trim ở biên; q rỗng ⇒ bỏ", () => {
    const r = ContractListQuerySchema.parse({ q: ` ${NFD} `, signer: NFD });
    expect([r.q, r.signer]).toEqual([NFC, [NFC]]);
    expect(ContractListQuerySchema.parse({ q: "  " }).q).toBeUndefined();
  });
});

describe("HD-FR-02 · fieldValueSchema + PATCH", () => {
  test("D-18 · text NFC ở biên", () => {
    expect(fieldValueSchema("buyer_representative").parse(NFD)).toBe(NFC);
  });
  test("PATCH hợp lệ; rỗng fields, khoá lạ, sai kiểu, thiếu version ⇒ từ chối", () => {
    const ok = { version: 1, fields: { total_value: 5, end_date: null } };
    expect(PatchFieldsRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { version: 1, fields: {} },
      { version: 1, fields: { khong_co: 1 } },
      { version: 1, fields: { total_value: "abc" } },
      { fields: { total_value: 1 } },
      { version: 0, fields: { total_value: 1 } },
    ])
      expect(PatchFieldsRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("HD-FR-08 · tải lên + mã lỗi", () => {
  test("form: kind mặc định contract; title > 200 ⇒ từ chối", () => {
    expect(UploadContractFormSchema.parse({})).toEqual({ kind: "contract" });
    expect(UploadContractFormSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
  });
  test("ContractErrorCode gồm mã N1 + mã HD1; CONTRACT_STALE details {current:{version}, updated_at}", () => {
    for (const c of ["PACK_FORBIDDEN", "DOCX_BUSY", "CONTRACT_STALE", "UPLOAD_QUOTA", "FILE_TYPE"])
      expect(ContractErrorCode.safeParse(c).success).toBe(true);
    const d = { current: { version: 2 }, updated_at: "2026-10-19T00:00:00Z" };
    expect(ContractStaleDetailsSchema.safeParse(d).success).toBe(true);
  });
});
