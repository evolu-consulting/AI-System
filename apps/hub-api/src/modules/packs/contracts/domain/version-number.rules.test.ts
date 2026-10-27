// CR-101a · R14 · Câu 10: số phiên bản "số gốc-SĐn" chỉ điền sẵn khi AI không đọc được số.
import { describe, expect, test } from "bun:test";
import { fillFields } from "./fields.rules";
import { prefillVersionNumber, versionNumberOf } from "./version-number.rules";

describe("versionNumberOf", () => {
  test("v2 ⇒ -SĐ1, v4 ⇒ -SĐ3; cắt khoảng trắng", () => {
    expect(versionNumberOf(" 01/2026/HĐMB ", 2)).toBe("01/2026/HĐMB-SĐ1");
    expect(versionNumberOf("01/2026/HĐMB", 4)).toBe("01/2026/HĐMB-SĐ3");
  });
  test("số gốc đã có hậu tố -SĐk ⇒ thay, không chồng", () => {
    expect(versionNumberOf("HĐ-7-SĐ1", 3)).toBe("HĐ-7-SĐ2");
  });
  test("v1 / số gốc trống ⇒ null", () => {
    expect(versionNumberOf("HĐ-7", 1)).toBeNull();
    expect(versionNumberOf(null, 2)).toBeNull();
    expect(versionNumberOf("  ", 2)).toBeNull();
  });
});

describe("prefillVersionNumber", () => {
  const chain = { versionNo: 2, rootNumber: "HĐ-7" };
  test("AI không đọc được số ⇒ điền sẵn, chưa xác minh", () => {
    const f = prefillVersionNumber(fillFields({}), chain);
    expect(f.number).toEqual({ value: "HĐ-7-SĐ1", quote: "", verified: false, edited: false });
  });
  test("AI đọc được số ⇒ giữ nguyên", () => {
    const f0 = fillFields({ number: { value: "HĐ-7/PL", quote: "q", verified: true } });
    expect(prefillVersionNumber(f0, chain)).toBe(f0);
  });
  test("người đã sửa / không phải phiên bản ⇒ giữ nguyên", () => {
    const edited = fillFields({ number: { value: null, edited: true } });
    expect(prefillVersionNumber(edited, chain)).toBe(edited);
    const f0 = fillFields({});
    expect(prefillVersionNumber(f0, null)).toBe(f0);
    expect(prefillVersionNumber(f0, { versionNo: 1, rootNumber: "HĐ-7" })).toBe(f0);
  });
});
