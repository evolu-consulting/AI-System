import { describe, expect, test } from "bun:test";
import { localeAfterLogin, markLocaleChosen } from "./login-locale";

describe("B7 · ngôn ngữ sau đăng nhập", () => {
  test("không tự chọn ở màn đăng nhập ⇒ theo user.locale", () => {
    expect(localeAfterLogin("en")).toBe("en");
  });
  test("đã chọn VI/EN ở màn đăng nhập ⇒ giữ nguyên (một lần)", () => {
    markLocaleChosen();
    expect(localeAfterLogin("en")).toBeNull();
    expect(localeAfterLogin("en")).toBe("en");
  });
});
