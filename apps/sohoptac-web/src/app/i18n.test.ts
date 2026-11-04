// PK-FR-10 · TF1 · CR-052: ngôn ngữ lấy từ `ai.locale`, không có/hỏng/storage chặn thì en.
import { describe, expect, test } from "bun:test";
import { resolveInitialLocale } from "./i18n";

describe("resolveInitialLocale", () => {
  test("dùng ai.locale đã lưu", () => {
    expect(resolveInitialLocale(() => "en")).toBe("en");
  });
  test("không có hoặc không hỗ trợ ⇒ vi (GAP-E #33)", () => {
    expect(resolveInitialLocale(() => null)).toBe("vi");
    expect(resolveInitialLocale(() => "fr")).toBe("vi");
  });
  test("storage ném lỗi ⇒ vi", () => {
    expect(
      resolveInitialLocale(() => {
        throw new Error("blocked");
      }),
    ).toBe("vi");
  });
});
