import { describe, expect, test } from "bun:test";
import { canonicalJson, sameIdSet, sameJson } from "./json";

describe("ADM-FR-30 · json", () => {
  test("ADM-FR-30 · sameJson bỏ qua thứ tự khoá, giữ thứ tự mảng", () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameJson({ vi: "x" }, { vi: "x", en: "y" })).toBe(false);
    expect(canonicalJson({ b: 1, a: undefined })).toBe('{"b":1}');
  });

  test("ADM-FR-30 · sameIdSet", () => {
    expect(sameIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameIdSet(["a"], ["a", "b"])).toBe(false);
  });
});
