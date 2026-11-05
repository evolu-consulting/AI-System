// CR-120 · HĐ nháp / không quyền xem ⇒ MỘT câu chung (404 và 403 như nhau — không lộ HĐ có tồn tại).
import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { detailErrorKey, NOT_FOUND_KEY, NOT_VISIBLE_KEY } from "./load-error";

describe("detailErrorKey", () => {
  test("404 và 403 ⇒ cùng khoá chung", () => {
    expect(detailErrorKey(new ApiError(404, "HTTP_ERROR", "Not found"))).toBe(NOT_VISIBLE_KEY);
    expect(detailErrorKey(new ApiError(403, "HTTP_ERROR", "Forbidden"))).toBe(NOT_VISIBLE_KEY);
  });
  test("400/422 (mã không hợp lệ, vd /contracts/c/login) ⇒ câu không tìm thấy", () => {
    expect(detailErrorKey(new ApiError(400, "HTTP_ERROR", "Invalid request"))).toBe(NOT_FOUND_KEY);
  });
  test("lỗi khác (500, mạng, không phải ApiError) ⇒ null, giữ câu lỗi gốc", () => {
    expect(detailErrorKey(new ApiError(500, "HTTP_ERROR", "x"))).toBeNull();
    expect(detailErrorKey(new Error("boom"))).toBeNull();
    expect(detailErrorKey(null)).toBeNull();
  });
});
