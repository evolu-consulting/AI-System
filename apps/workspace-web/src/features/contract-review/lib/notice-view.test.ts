import { describe, expect, test } from "bun:test";
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { citeOf, noticeGroups, risksOf, termKey } from "./notice-view";

const note = (group: string, text: string) => ({ group, text, clause_ref: "Điều 5.2", page: 2 });

describe("CR-127 U5 · Điều cần lưu ý / Cần chú ý", () => {
  test("nhóm theo thứ tự cố định, bỏ nhóm trống, phạt số vào nhóm phạt", () => {
    const c = {
      ai: { notes: [note("payment", "TT 30%"), note("penalty", "Phạt")], risks: [] },
      penalty_terms: [
        {
          id: "1",
          party: "partner",
          trigger: "late_payment",
          basis: "per_day_of_value",
          rate_pct: 0.05,
          cap_pct: 8,
        },
      ],
    } as unknown as ContractDetail;
    const g = noticeGroups(c);
    expect(g.map((x) => x.group)).toEqual(["penalty", "payment"]);
    expect(g[0]?.terms).toHaveLength(1);
  });
  test("không AI / không ghi chú ⇒ rỗng (thẻ ẩn)", () => {
    expect(noticeGroups({ ai: null } as unknown as ContractDetail)).toEqual([]);
    expect(risksOf({ ai: null } as unknown as ContractDetail)).toEqual([]);
  });
  test("citeOf: điều khoản + trang", () => {
    expect(citeOf({ clause_ref: "Điều 8.1", page: 3 })).toBe("Điều 8.1 · tr.3");
    expect(citeOf({ clause_ref: "Điều 8.1" })).toBe("Điều 8.1");
    expect(citeOf({})).toBeNull();
  });
  test("termKey: số thập phân kiểu Việt + trần", () => {
    const k = termKey({
      party: "ours",
      trigger: "late_delivery",
      basis: "per_day_of_value",
      rate_pct: 0.1,
      cap_pct: 8,
    } as never);
    expect(k).toEqual({ key: "ours.late_delivery.per_day_of_value", rate: "0,1", cap: "8%" });
  });
});
