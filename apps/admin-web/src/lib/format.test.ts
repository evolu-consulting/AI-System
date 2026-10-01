import { describe, expect, test } from "bun:test";
import { formatClock, formatLastLogin, formatUpdated } from "./format";

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key;

// Giờ địa phương để kết quả không phụ thuộc múi giờ máy chạy test.
const now = new Date(2026, 9, 1, 14, 30, 0);
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("ADM-FR-04 · formatClock / formatLastLogin", () => {
  test("formatClock HH:MM 24h", () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 5))).toBe("09:05");
    expect(formatClock(new Date(2026, 0, 2, 23, 59))).toBe("23:59");
  });

  test("null → rỗng", () => {
    expect(formatLastLogin(null, now, t)).toBe("");
  });

  test("dưới 1 phút → Vừa xong", () => {
    expect(formatLastLogin(ago(30_000), now, t)).toBe("format.lastLogin.now");
  });

  test("dưới 60 phút → n phút trước", () => {
    expect(formatLastLogin(ago(5 * 60_000), now, t)).toBe("format.lastLogin.minutes:5");
    expect(formatLastLogin(ago(59 * 60_000), now, t)).toBe("format.lastLogin.minutes:59");
  });

  test("cùng ngày → Hôm nay HH:MM", () => {
    expect(formatLastLogin(new Date(2026, 9, 1, 8, 0).toISOString(), now, t)).toBe(
      "format.lastLogin.today:08:00",
    );
  });

  test("hôm qua → Hôm qua HH:MM", () => {
    expect(formatLastLogin(new Date(2026, 8, 30, 22, 15).toISOString(), now, t)).toBe(
      "format.lastLogin.yesterday:22:15",
    );
  });

  test("cũ hơn → dd/MM/yyyy", () => {
    expect(formatLastLogin(new Date(2026, 8, 3, 10, 0).toISOString(), now, t)).toBe("03/09/2026");
  });
});

describe("ADM-FR-50 · formatUpdated", () => {
  test("ngày dd/MM/yyyy kèm người sửa nếu có", () => {
    const iso = new Date(2026, 8, 5, 10, 0).toISOString();
    expect(formatUpdated(iso, "minh.pham")).toBe("05/09/2026 · minh.pham");
    expect(formatUpdated(iso, null)).toBe("05/09/2026");
    expect(formatUpdated(iso, undefined)).toBe("05/09/2026");
  });
});
