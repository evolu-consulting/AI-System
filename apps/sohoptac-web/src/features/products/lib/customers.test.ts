// V2-H · luật thuần tab "Khách đang dùng".
import { describe, expect, it } from "bun:test";
import type { ServiceCustomer } from "@ai/contracts";
import { canRemind, daysLabel, filterCustomers } from "./customers";

const c = (id: string, status: ServiceCustomer["status"]): ServiceCustomer => ({
  id,
  customer_name: id,
  party_key: `name:${id}`,
  contract_id: "k",
  contract_number: null,
  contract_title: null,
  started_on: null,
  expires_on: null,
  notice_days: 60,
  days_left: null,
  status,
  renewals: 0,
  reminded: false,
});

describe("V2-H · tab Khách đang dùng", () => {
  it("lọc theo trạng thái, 'all' giữ cả tập", () => {
    const xs = [c("a", "expired"), c("b", "soon"), c("d", "active")];
    expect(filterCustomers(xs, "all").map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(filterCustomers(xs, "soon").map((x) => x.id)).toEqual(["b"]);
  });
  it("nhãn ngày: đã hết / hôm nay / còn / không có hạn", () => {
    expect([daysLabel(-3), daysLabel(0), daysLabel(12), daysLabel(null)]).toEqual([
      { key: "over", n: 3 },
      { key: "today", n: 0 },
      { key: "left", n: 12 },
      { key: "noEnd", n: 0 },
    ]);
  });
  it("Nhắc gia hạn chỉ cho hết hạn / sắp hết hạn", () => {
    expect([
      canRemind(c("a", "expired")),
      canRemind(c("b", "soon")),
      canRemind(c("d", "active")),
    ]).toEqual([true, true, false]);
  });
});
