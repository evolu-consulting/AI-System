import { describe, expect, test } from "bun:test";
import { createScrollRestoration, shouldHandleScroll } from "./scroll-policy";

describe("shouldHandleScroll", () => {
  test("lần đầu ⇒ xử lý", () => expect(shouldHandleScroll(undefined, "/a")).toBe(true));
  test("đổi trang ⇒ xử lý (về đầu)", () => expect(shouldHandleScroll("/a", "/b")).toBe(true));
  test("cùng trang (đổi query/tab) ⇒ không cuộn", () =>
    expect(shouldHandleScroll("/a", "/a")).toBe(false));
});

describe("createScrollRestoration", () => {
  test("chuỗi điều hướng", () => {
    const f = createScrollRestoration();
    const at = (pathname: string) => f({ location: { pathname } });
    expect([at("/a"), at("/a"), at("/b"), at("/a")]).toEqual([true, false, true, true]);
  });
});
