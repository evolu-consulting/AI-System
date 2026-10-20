// UAT CR-095 B5: tập trạng thái "đã xác nhận" của sổ thanh toán khớp tập có giá (HĐ đã duyệt) của phụ lục/nguồn hàng.
import { describe, expect, it } from "bun:test";
import { PRICED_STATUSES } from "./appendix.repo";
import { CONFIRMED_STATUSES, confirmedOf } from "./ledger-sql";

describe("UAT B5 · CONFIRMED_STATUSES", () => {
  it("bằng PRICED_STATUSES, không gồm trạng thái chờ / trích xuất / từ chối", () => {
    expect([...CONFIRMED_STATUSES]).toEqual([...PRICED_STATUSES]);
    for (const s of ["needs_review", "extracting", "extract_failed", "rejected"])
      expect((CONFIRMED_STATUSES as readonly string[]).includes(s)).toBe(false);
  });
  it("mảnh SQL nối theo HĐ của đúng bí danh", () => {
    const q = JSON.stringify(confirmedOf("x", "t").queryChunks);
    expect(q).toContain(".contract_id <> all");
    expect(q).toContain("'active', 'expiring', 'expired', 'renewed', 'terminated'");
    expect(q).not.toContain("needs_review");
  });
});
