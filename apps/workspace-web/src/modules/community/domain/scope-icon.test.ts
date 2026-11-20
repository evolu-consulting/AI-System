// CR-195 BR-195-4 · ổ khoá chỉ cho bài nội bộ; phạm vi khác dùng biểu tượng người/nhóm.
import { describe, expect, it } from "bun:test";
import { scopeIsInternal } from "./scope-label";

const aud = (mode: "all" | "internal" | "suppliers") => ({
  mode,
  cats: [],
  companies: [],
  tenants: [],
});

describe("scopeIsInternal", () => {
  it("«Chỉ nội bộ» và bài đối tác ⇒ ổ khoá", () => {
    expect(scopeIsInternal({ authorSide: "host", audience: aud("internal") })).toBe(true);
    expect(scopeIsInternal({ authorSide: "partner" })).toBe(true);
  });
  it("«Tất cả đối tác»/«Nhà cung cấp» ⇒ biểu tượng người/nhóm", () => {
    expect(scopeIsInternal({ authorSide: "host", audience: aud("all") })).toBe(false);
    expect(scopeIsInternal({ authorSide: "host", audience: aud("suppliers") })).toBe(false);
  });
});
