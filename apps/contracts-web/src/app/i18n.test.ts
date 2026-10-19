// PK-FR-10 · TF1 · CR-052: ngôn ngữ lấy từ `ai.locale`, không có/hỏng/storage chặn thì en.
import { describe, expect, test } from "bun:test";
import { resolveInitialLocale } from "./i18n";

describe("resolveInitialLocale", () => {
  test("dùng ai.locale đã lưu", () => {
    expect(resolveInitialLocale(() => "vi")).toBe("vi");
  });
  test("không có hoặc không hỗ trợ ⇒ en", () => {
    expect(resolveInitialLocale(() => null)).toBe("en");
    expect(resolveInitialLocale(() => "fr")).toBe("en");
  });
  test("storage ném lỗi ⇒ en", () => {
    expect(
      resolveInitialLocale(() => {
        throw new Error("blocked");
      }),
    ).toBe("en");
  });
});
