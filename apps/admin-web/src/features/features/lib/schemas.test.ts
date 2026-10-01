// ADM-FR-30 · ADM-BR-10 · M2-R19 · featureSchema, body POST/PATCH, command mồ côi.
import { describe, expect, test } from "bun:test";
import {
  emptyFeatureForm,
  type FeatureFormValues,
  featureSchema,
  removedOrphans,
  toCreateBody,
  toUpdateBody,
} from "./schemas";

const valid = (over: Partial<FeatureFormValues> = {}): FeatureFormValues => ({
  ...emptyFeatureForm(),
  key: "nhan-su",
  name: { vi: "Nhân sự", en: "" },
  ...over,
});
const first = (v: FeatureFormValues) => {
  const r = featureSchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? null);
};

describe("ADM-FR-30 · featureSchema", () => {
  test("key: chữ thường/số/-, 2–32; chuẩn hoá chữ hoa", () => {
    expect(first(valid({ key: "Ke Toan" }))).toBe("features.error.keyFormat");
    expect(first(valid({ key: "a" }))).toBe("features.error.keyFormat");
    expect(first(valid({ key: "Ke-Toan" }))).toBeNull();
  });

  test("tên VI bắt buộc ≤ 64; EN tuỳ chọn ≤ 64", () => {
    const e = "features.error.nameRequired";
    expect(first(valid({ name: { vi: " ", en: "" } }))).toBe(e);
    expect(first(valid({ name: { vi: "x".repeat(65), en: "" } }))).toBe(e);
    expect(first(valid({ name: { vi: "x".repeat(64), en: "y".repeat(65) } }))).toBe(e);
    expect(first(valid({ name: { vi: "x".repeat(64), en: "" } }))).toBeNull();
  });

  test("mô tả ≤ 400", () => {
    expect(first(valid({ description: { vi: "d".repeat(401), en: "" } }))).toBe(
      "features.error.descMax",
    );
    expect(first(valid({ description: { vi: "d".repeat(400), en: "" } }))).toBeNull();
  });
});

describe("ADM-FR-30 · body", () => {
  test("tạo: bỏ EN/mô tả rỗng, key chuẩn hoá", () => {
    const b = toCreateBody(valid({ key: " Nhan-Su ", description: { vi: "", en: "" } }));
    expect(b.key).toBe("nhan-su");
    expect(b.name).toEqual({ vi: "Nhân sự" });
    expect(b.description).toEqual({});
  });

  test("sửa: có version; core không gửi status", () => {
    expect(toUpdateBody(valid(), 3, false)).toMatchObject({ version: 3, status: "on" });
    expect("status" in toUpdateBody(valid(), 3, true)).toBe(false);
    expect("key" in toUpdateBody(valid(), 3, false)).toBe(false);
  });
});

describe("ADM-BR-10 · removedOrphans", () => {
  const initial = [
    { id: "a", name: "kiemtra-hoadon", feature_count: 1 },
    { id: "b", name: "dich", feature_count: 2 },
  ];
  test("chỉ command bị bỏ và chỉ thuộc feature này", () => {
    expect(removedOrphans(initial, ["b"]).map((c) => c.name)).toEqual(["kiemtra-hoadon"]);
    expect(removedOrphans(initial, ["a"])).toEqual([]);
    expect(removedOrphans(initial, [])).toHaveLength(1);
  });
});
