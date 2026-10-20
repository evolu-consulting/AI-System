// V2-M · dòng tác động hộp xác nhận xoá HĐ.
import { describe, expect, test } from "bun:test";
import type { DeleteImpact } from "@ai/contracts";
import { blockedReason, impactLines } from "./impact";

const base: DeleteImpact = {
  contract: { id: "00000000-0000-4000-8000-000000000001", number: "N-1", title: "HĐ" },
  milestones: 0,
  delivered_lines: 0,
  stock: [],
  service_customers: 0,
  products: [],
  partner_events: 0,
  appendices: 0,
  has_cks: false,
  stock_blocked: null,
};

describe("V2-M · impactLines", () => {
  test("không tác động ⇒ rỗng; chỉ liệt kê mục > 0", () => {
    expect(impactLines(base)).toEqual([]);
    const keys = impactLines({
      ...base,
      milestones: 2,
      stock: [{ product: "A", component: "A", direction: "out", qty: "4" }],
      products: ["A", "B"],
    }).map((l) => l.key);
    expect(keys).toEqual(["milestones", "stock", "products"]);
  });
  test("phụ lục + CKS được liệt kê (không chặn); chặn chỉ khi kho không đảo được", () => {
    const keys = impactLines({ ...base, appendices: 2, has_cks: true }).map((l) => l.key);
    expect(keys).toEqual(["appendices", "cks"]);
    expect(blockedReason(base)).toBeNull();
    expect(blockedReason({ ...base, stock_blocked: "đã bán" })).toBe("đã bán");
  });
});
