// CR-127 · X4 · BR-56: luật thuần `penalty.rules` — chiều phạt, cơ sở tính, trần, làm tròn, điều khoản áp.
import { describe, expect, it } from "bun:test";
import {
  type LateMilestone,
  lateDays,
  type PenaltyTerm,
  penaltyApplies,
  penaltyEstimate,
  termFor,
} from "./penalty.rules";

const term = (o: Partial<PenaltyTerm> = {}): PenaltyTerm => ({
  id: "t1",
  party: "partner",
  trigger: "late_payment",
  rate_pct: 0.1,
  basis: "per_day_of_milestone",
  cap_pct: null,
  cap_amount: null,
  ...o,
});
const ms = (o: Partial<LateMilestone> = {}): LateMilestone => ({
  kind: "payment",
  owner: "partner",
  status: "open",
  due_date: "2026-11-01",
  done_at: null,
  amount: 1_000_000,
  ...o,
});
const TODAY = "2026-11-11"; // trễ 10 ngày

describe("lateDays", () => {
  it("mở ⇒ tới hôm nay; xong ⇒ tới ngày xong; chưa trễ / huỷ / mốc phạt ⇒ 0", () => {
    expect(lateDays(ms(), TODAY)).toBe(10);
    expect(lateDays(ms({ status: "done", done_at: "2026-11-04" }), TODAY)).toBe(3);
    expect(lateDays(ms({ status: "done", done_at: "2026-10-30" }), TODAY)).toBe(0);
    expect(lateDays(ms({ due_date: "2026-11-11" }), TODAY)).toBe(0);
    expect(lateDays(ms({ status: "cancelled" }), TODAY)).toBe(0);
    expect(lateDays(ms({ kind: "penalty" }), TODAY)).toBe(0);
    expect(penaltyApplies(ms({ status: "replaced" }))).toBe(false);
  });
});

describe("termFor", () => {
  it("đúng bên bị phạt; ưu tiên đúng loại, rồi `other`", () => {
    const other = term({ id: "o", trigger: "other" });
    const exact = term({ id: "e" });
    expect(termFor([other, exact], ms())?.id).toBe("e");
    expect(termFor([other], ms())?.id).toBe("o");
    expect(termFor([term({ party: "ours" })], ms())).toBeNull(); // đối tác trễ mà điều khoản chỉ phạt mình
    expect(termFor([exact], ms({ kind: "delivery" }))).toBeNull(); // sai loại, không có `other`
  });
});

describe("penaltyEstimate", () => {
  it("per_day_of_milestone: số tiền mốc × % × ngày; đối tác trễ ⇒ mình thu", () => {
    const e = penaltyEstimate([term()], ms(), 50_000_000, TODAY);
    expect(e).toMatchObject({ amount: 10_000, days: 10, direction: "receive", capped: false });
  });
  it("mình trễ ⇒ chiều trả (pay)", () => {
    const e = penaltyEstimate(
      [term({ party: "ours", trigger: "late_delivery" })],
      ms({ kind: "delivery", owner: "ours" }),
      null,
      TODAY,
    );
    expect(e?.direction).toBe("pay");
  });
  it("per_day_of_value: giá trị HĐ × % × ngày; HĐ không giá trị ⇒ null", () => {
    const t = term({ basis: "per_day_of_value", rate_pct: 0.05 });
    expect(penaltyEstimate([t], ms(), 50_000_000, TODAY)?.amount).toBe(250_000);
    expect(penaltyEstimate([t], ms(), null, TODAY)).toBeNull();
  });
  it("làm tròn xuống đồng nguyên (tỷ lệ 4 số lẻ)", () => {
    const t = term({ rate_pct: 0.0333 });
    // 1_000_000 × 0.0333% × 10 = 3330
    expect(penaltyEstimate([t], ms(), null, TODAY)?.amount).toBe(3330);
    expect(penaltyEstimate([t], ms({ amount: 100 }), null, TODAY)).toBeNull(); // 0,333 ⇒ 0 đồng
  });
  it("trần: cap_pct theo cùng cơ sở, cap_amount tuyệt đối, có cả hai ⇒ số nhỏ hơn", () => {
    const base = term({ rate_pct: 1 }); // 1M × 1% × 10 = 100_000
    expect(penaltyEstimate([{ ...base, cap_pct: 5 }], ms(), null, TODAY)).toMatchObject({
      amount: 50_000,
      uncapped: 100_000,
      capped: true,
    });
    expect(penaltyEstimate([{ ...base, cap_amount: 30_000 }], ms(), null, TODAY)?.amount).toBe(
      30_000,
    );
    expect(
      penaltyEstimate([{ ...base, cap_pct: 5, cap_amount: 80_000 }], ms(), null, TODAY)?.amount,
    ).toBe(50_000);
    expect(penaltyEstimate([{ ...base, cap_amount: 500_000 }], ms(), null, TODAY)?.capped).toBe(
      false,
    );
  });
  it("fixed = cap_amount, không phụ thuộc số ngày; thiếu số ⇒ null", () => {
    expect(
      penaltyEstimate(
        [term({ basis: "fixed", rate_pct: null, cap_amount: 2_000_000 })],
        ms(),
        null,
        TODAY,
      )?.amount,
    ).toBe(2_000_000);
    expect(
      penaltyEstimate([term({ basis: "fixed", rate_pct: null })], ms(), null, TODAY),
    ).toBeNull();
  });
  it("không trễ / không điều khoản / thiếu tỷ lệ / mốc không số tiền ⇒ null", () => {
    expect(penaltyEstimate([term()], ms({ due_date: TODAY }), null, TODAY)).toBeNull();
    expect(penaltyEstimate([], ms(), null, TODAY)).toBeNull();
    expect(penaltyEstimate([term({ rate_pct: null })], ms(), null, TODAY)).toBeNull();
    expect(penaltyEstimate([term()], ms({ amount: null }), null, TODAY)).toBeNull();
  });
});
