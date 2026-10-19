// L1b · đọc details 423/429 của admin-api cho câu báo đăng nhập.
import { describe, expect, test } from "bun:test";
import { lockUntilClock, retryMinutes } from "./auth-limit";

describe("L1b · lockUntilClock", () => {
  test("ISO ⇒ HH:MM giờ trình duyệt; thiếu/hỏng ⇒ null", () => {
    const d = new Date(2026, 9, 20, 7, 5);
    expect(lockUntilClock({ until: d.toISOString() })).toBe("07:05");
    expect(lockUntilClock({ until: "x" })).toBeNull();
    expect(lockUntilClock({})).toBeNull();
    expect(lockUntilClock(undefined)).toBeNull();
  });
});

describe("L1b · retryMinutes", () => {
  test("details.retry_after_s làm tròn lên phút, ≥ 1", () => {
    expect(retryMinutes({ retry_after_s: 61 })).toBe(2);
    expect(retryMinutes({ retry_after_s: 5 })).toBe(1);
    expect(retryMinutes({ retry_after_s: 600 })).toBe(10);
  });
  test("không có details ⇒ header Retry-After ⇒ mặc định", () => {
    expect(retryMinutes(undefined, 125)).toBe(3);
    expect(retryMinutes({ retry_after_s: "x" }, 0)).toBe(1);
    expect(retryMinutes(null, undefined, 300)).toBe(5);
  });
});
