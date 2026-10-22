// Ngày "hôm nay" của agent chat theo múi tenant, không theo đồng hồ UTC của máy chạy CLI.
import { describe, expect, test } from "bun:test";
import { nowLine, withNowLine } from "./now-line.rules";

const VN = "Asia/Ho_Chi_Minh";

describe("nowLine", () => {
  test("01:45 sáng 23/10 giờ VN = 18:45 ngày 22/10 UTC ⇒ ngày 23/10 (Thứ Sáu), không phải 22/10", () => {
    const line = nowLine(new Date("2026-10-22T18:45:00Z"), VN);
    expect(line).toContain("2026-10-23 01:45 (Thứ Sáu)");
    expect(line).toContain(VN);
    expect(line).not.toContain("2026-10-22");
  });
  test("giữa ngày cùng ngày UTC; múi khác theo đúng lịch của múi đó", () => {
    expect(nowLine(new Date("2026-10-23T05:00:00Z"), VN)).toContain("2026-10-23 12:00 (Thứ Sáu)");
    expect(nowLine(new Date("2026-10-23T05:00:00Z"), "America/New_York")).toContain(
      "2026-10-23 01:00 (Thứ Sáu)",
    );
    expect(nowLine(new Date("2026-10-24T17:30:00Z"), VN)).toContain("2026-10-25 00:30 (Chủ nhật)");
  });
});

describe("withNowLine", () => {
  test("nối cuối lời nhắc; lời nhắc rỗng ⇒ chỉ dòng thời điểm; vượt trần ⇒ giữ nguyên", () => {
    expect(withNowLine("Bạn là trợ lý.", "X", 100)).toBe("Bạn là trợ lý.\n\nX");
    expect(withNowLine("", "X", 100)).toBe("X");
    expect(withNowLine("a".repeat(99), "X", 100)).toBe("a".repeat(99));
  });
});
