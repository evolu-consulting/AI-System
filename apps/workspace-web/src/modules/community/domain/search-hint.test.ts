// Ngữ cảnh trợ lý ở Bảng tin: từ khoá đang tìm (gọn khoảng trắng, giới hạn độ dài).
import { describe, expect, test } from "bun:test";
import { focusCommentId, focusPostId, trimSearch } from "./search-hint";

describe("search-hint · từ khoá đang tìm", () => {
  test("gọn khoảng trắng; rỗng ⇒ null; cắt ở 200 ký tự", () => {
    expect(trimSearch("  USB   Token ")).toBe("USB Token");
    expect(trimSearch("   ")).toBeNull();
    expect(trimSearch(undefined)).toBeNull();
    expect(trimSearch("a".repeat(300))?.length).toBe(200);
  });
});

describe("focusPostId", () => {
  test("nhận uuid ở ?post=; sai dạng/thiếu ⇒ null", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(focusPostId(`?post=${id}&comment=x`)).toBe(id);
    expect(focusPostId("?post=abc")).toBeNull();
    expect(focusPostId("")).toBeNull();
  });
});

describe("focusCommentId", () => {
  test("nhận uuid ở ?comment=; sai dạng/thiếu ⇒ null", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(focusCommentId(`?post=x&comment=${id}`)).toBe(id);
    expect(focusCommentId("?comment=abc")).toBeNull();
    expect(focusCommentId("?post=1")).toBeNull();
  });
});
