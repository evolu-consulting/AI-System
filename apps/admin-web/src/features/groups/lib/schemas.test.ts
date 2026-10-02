// ADM-FR-62 · M3-R01 · schema form group: biên key 1/2/32/33, tên 64/65, mô tả 400/401; chuẩn hoá key khi gõ; body gửi đi.
import { describe, expect, test } from "bun:test";
import {
  groupCreateSchema,
  groupRenameSchema,
  toCreateBody,
  toRenameBody,
  typeGroupKey,
} from "./schemas";

const base = { key: "ke-toan", name: { vi: "Kế toán", en: "" }, description: "" };
const msgs = (r: ReturnType<typeof groupCreateSchema.safeParse>) =>
  r.success ? [] : r.error.issues.map((i) => i.message);

describe("ADM-FR-62 · groupCreateSchema", () => {
  test("key: 1 ký tự sai, 2 và 32 đúng, 33 sai, hoa/dấu sai", () => {
    const key = (k: string) => msgs(groupCreateSchema.safeParse({ ...base, key: k }));
    expect(key("a")).toEqual(["groups.error.keyFormat"]);
    expect(key("ab")).toEqual([]);
    expect(key("a".repeat(32))).toEqual([]);
    expect(key("a".repeat(33))).toEqual(["groups.error.keyFormat"]);
    expect(key("ke_toan")).toEqual(["groups.error.keyFormat"]);
  });

  test("tên VI bắt buộc ≤ 64; EN ≤ 64; mô tả ≤ 400", () => {
    const name = (vi: string, en = "") =>
      msgs(groupCreateSchema.safeParse({ ...base, name: { vi, en } }));
    expect(name("")).toEqual(["groups.error.nameRequired"]);
    expect(name("a".repeat(64))).toEqual([]);
    expect(name("a".repeat(65))).toEqual(["groups.error.nameRequired"]);
    expect(name("x", "b".repeat(65))).toEqual(["groups.error.nameRequired"]);
    const desc = (d: string) => msgs(groupCreateSchema.safeParse({ ...base, description: d }));
    expect(desc("d".repeat(400))).toEqual([]);
    expect(desc("d".repeat(401))).toEqual(["groups.error.descMax"]);
  });

  test("groupRenameSchema không có key", () => {
    expect(groupRenameSchema.safeParse({ name: base.name, description: "" }).success).toBe(true);
  });
});

describe("ADM-FR-62 · typeGroupKey + body", () => {
  test("'Ke Toan 2' → 'ke-toan-2'; bỏ dấu; không trim", () => {
    expect(typeGroupKey("Ke Toan 2")).toBe("ke-toan-2");
    expect(typeGroupKey("Kế Toán")).toBe("ke-toan");
    expect(typeGroupKey("ab ")).toBe("ab-");
  });

  test("toCreateBody/toRenameBody: EN trống bỏ khoá, mô tả trống → null", () => {
    expect(toCreateBody({ ...base, key: " Ke-Toan " })).toEqual({
      key: "ke-toan",
      name: { vi: "Kế toán" },
      description: null,
    });
    expect(toRenameBody({ ...base, name: { vi: "A", en: "B" }, description: " mô tả " })).toEqual({
      name: { vi: "A", en: "B" },
      description: "mô tả",
    });
  });
});
