// CR-191 · nút phụ ghim trên điện thoại không vào menu «⋯».
import { describe, expect, test } from "bun:test";
import { splitActions } from "./page-header-actions";

describe("splitActions", () => {
  test("nút ghim tách khỏi menu, giữ thứ tự", () => {
    const a = [{ label: "a" }, { label: "b", pinMobile: true }, { label: "c", pinMobile: false }];
    const r = splitActions(a);
    expect(r.pinned.map((x) => x.label)).toEqual(["b"]);
    expect(r.menu.map((x) => x.label)).toEqual(["a", "c"]);
  });
  test("không có nút ghim ⇒ mọi nút vào menu (hành vi cũ)", () => {
    const b = [{ label: "a", pinMobile: undefined }];
    const r = splitActions(b);
    expect(r.pinned).toEqual([]);
    expect(r.menu).toHaveLength(1);
  });
});
