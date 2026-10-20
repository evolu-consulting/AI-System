// V2-H · luật thuần "Khách đang dùng" (SP-03, §5.8): phân loại theo số ngày nhắc của HĐ / mặc định Cài đặt, đếm, lọc, thứ tự.
import { describe, expect, it } from "bun:test";
import {
  buildServiceCustomers,
  type RawServiceCustomer,
  renewalTaskTitle,
  statusOf,
} from "./service-customers.rules";

const row = (
  id: string,
  expires: string | null,
  notice: number | null = null,
): RawServiceCustomer => ({
  id,
  customer_name: `Khách ${id}`,
  party_key: `name:${id}`,
  contract_id: "c",
  contract_number: null,
  contract_title: null,
  started_on: null,
  expires_on: expires,
  notice_days: notice,
  renewals: 0,
  reminded: false,
});

describe("V2-H · statusOf", () => {
  it("hết hạn < 0; sắp hết hạn ≤ số ngày nhắc (kể cả 0 = hôm nay); còn hạn; không có hạn = còn hạn", () => {
    expect([statusOf(-1, 60), statusOf(0, 60), statusOf(60, 60), statusOf(61, 60)]).toEqual([
      "expired",
      "soon",
      "soon",
      "active",
    ]);
    expect(statusOf(null, 60)).toBe("active");
  });
});

describe("V2-H · buildServiceCustomers", () => {
  const today = "2026-10-20";
  const rows = [
    row("a", "2026-12-31"), // 72 ngày, mặc định 60 ⇒ còn hạn
    row("b", "2026-12-31", 90), // HĐ ghi 90 ⇒ sắp hết hạn
    row("c", "2026-10-01"), // đã hết 19 ngày
    row("d", null),
    row("e", "2026-11-01"), // 12 ngày
  ];
  it("số ngày nhắc của HĐ thắng mặc định; đếm từng nhóm; gần hạn lên đầu, không hạn xuống cuối", () => {
    const v = buildServiceCustomers(rows, today, 60, "all");
    expect(v.counts).toEqual({ all: 5, expired: 1, soon: 2, active: 2 });
    expect(v.items.map((r) => [r.id, r.days_left, r.status, r.notice_days])).toEqual([
      ["c", -19, "expired", 60],
      ["e", 12, "soon", 60],
      ["a", 72, "active", 60],
      ["b", 72, "soon", 90],
      ["d", null, "active", 60],
    ]);
  });
  it("lọc giữ nguyên số đếm của cả tập; mặc định Cài đặt khác 60 áp cho HĐ không ghi", () => {
    const v = buildServiceCustomers(rows, today, 80, "soon");
    expect(v.counts).toEqual({ all: 5, expired: 1, soon: 3, active: 1 });
    expect(v.items.map((r) => r.id)).toEqual(["e", "a", "b"]);
  });
});

describe("V2-H · renewalTaskTitle", () => {
  it("tên khách + SP; khách trống ⇒ 'khách'; trần 200 ký tự", () => {
    expect(renewalTaskTitle("Công ty A", "Chữ ký số 1 năm")).toBe(
      "Liên hệ Công ty A mời gia hạn Chữ ký số 1 năm",
    );
    expect(renewalTaskTitle("  ", "CKS")).toBe("Liên hệ khách mời gia hạn CKS");
    expect(renewalTaskTitle("x".repeat(300), "CKS")).toHaveLength(200);
  });
});
