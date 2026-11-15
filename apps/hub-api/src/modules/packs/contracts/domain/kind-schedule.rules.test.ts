import { describe, expect, it } from "bun:test";
import {
  coopShares,
  franchiseFee,
  kindMilestones,
  pctOf,
  periodOfKey,
  periodsOf,
} from "./kind-schedule.rules";
import {
  countsMoney,
  kindTermsMissing,
  normalizeKindTerms,
  sanitizeKindTerms,
} from "./kind-terms.rules";

const FR = {
  role: "franchisor",
  brand: "Cà Phê Mẫu",
  initial_fee: 300_000_000,
  fee_basis: "revenue_pct",
  fee_pct: 5,
  period: "month",
  ad_fee_pct: 1,
};
const base = { signed: null, noticeDays: null, today: "2026-11-20" };

describe("kết quả: chuỗi kỳ", () => {
  it("chuỗi tháng cắt theo hiệu lực", () => {
    const p = periodsOf("2026-12-15", "2027-02-10", "month");
    expect(p.map((x) => x.key)).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(p[0]).toMatchObject({ start: "2026-12-15", end: "2026-12-31", label: "tháng 12/2026" });
    expect(p[2]?.end).toBe("2027-02-10");
  });
  it("chuỗi quý và năm", () => {
    expect(periodsOf("2027-01-01", "2028-12-31", "quarter").map((x) => x.key)).toEqual([
      "2027-Q1",
      "2027-Q2",
      "2027-Q3",
      "2027-Q4",
      "2028-Q1",
      "2028-Q2",
      "2028-Q3",
      "2028-Q4",
    ]);
    expect(periodsOf("2027-03-01", "2028-02-28", "year").map((x) => x.key)).toEqual([
      "2027",
      "2028",
    ]);
  });
  it("không có ngày kết thúc: 12 kỳ đầu; trần 99 kỳ", () => {
    expect(periodsOf("2027-01-01", null, "month")).toHaveLength(12);
    expect(periodsOf("2027-01-01", "2060-12-31", "month")).toHaveLength(99);
  });
  it("khoá kỳ ngược lại ra ngày đầu/cuối", () => {
    expect(periodOfKey("2027-Q1", null, null)).toMatchObject({
      start: "2027-01-01",
      end: "2027-03-31",
    });
    expect(periodOfKey("2027-02", null, null)?.end).toBe("2027-02-28");
    expect(periodOfKey("2027-13", null, null)).toBeNull();
  });
});

describe("kết quả: phí và chia tiền", () => {
  it("làm tròn nửa lên tới đồng", () => {
    expect(pctOf(820_000_000, 5)).toBe(41_000_000);
    expect(pctOf(1, 50)).toBe(1);
    expect(pctOf(3, 33.33)).toBe(1);
  });
  it("phí theo % cộng quảng cáo; chưa có doanh thu thì chưa có số", () => {
    expect(franchiseFee(FR, null)).toBeNull();
    expect(franchiseFee(FR, 820_000_000)).toBe(41_000_000 + 8_200_000);
  });
  it("phí cố định: giữ nguyên, cộng quảng cáo khi có doanh thu", () => {
    const t = { fee_basis: "fixed", fee_fixed: 10_000_000, ad_fee_pct: 2 };
    expect(franchiseFee(t, null)).toBe(10_000_000);
    expect(franchiseFee(t, 100_000_000)).toBe(12_000_000);
    expect(franchiseFee({ fee_basis: "fixed", fee_fixed: 10_000_000 }, 999)).toBe(10_000_000);
  });
  it("chia: phần mình + phần đối tác = đúng tổng", () => {
    expect(coopShares(500_000_000, 60)).toEqual({ ours: 300_000_000, partner: 200_000_000 });
    const s = coopShares(101, 33.33);
    expect(s.ours + s.partner).toBe(101);
  });
});

describe("kết quả: bộ mốc Nhượng quyền", () => {
  it("bên nhượng quyền, theo %, hằng tháng: phí ban đầu + (báo cáo, phí) mỗi tháng + gia hạn", () => {
    const m = kindMilestones({
      deal: "franchise",
      terms: FR,
      start: "2026-12-01",
      end: "2027-02-28",
      ...base,
    });
    expect(m.map((x) => x.role)).toEqual([
      "initial",
      "report",
      "fee",
      "report",
      "fee",
      "report",
      "fee",
      "renewal",
    ]);
    expect(m[0]).toMatchObject({
      kind: "collect",
      due_date: "2026-12-06",
      amount: 300_000_000,
      owner: "partner",
      direction: "receive",
    });
    expect(m[1]).toMatchObject({
      kind: "other",
      title: "Báo cáo doanh thu tháng 12/2026",
      due_date: "2027-01-05",
      period_key: "2026-12",
    });
    expect(m[2]).toMatchObject({
      kind: "collect",
      due_date: "2027-01-10",
      amount: null,
      period_key: "2026-12",
    });
    expect(m[7]).toMatchObject({ kind: "renewal", due_date: "2026-12-30" });
  });
  it("bên nhận quyền: mình trả, mình báo cáo", () => {
    const m = kindMilestones({
      deal: "franchise",
      terms: { ...FR, role: "franchisee" },
      start: "2026-12-01",
      end: "2026-12-31",
      ...base,
    });
    expect(m[0]).toMatchObject({ kind: "pay", owner: "ours", direction: "pay" });
    expect(m[1]).toMatchObject({ role: "report", owner: "ours" });
  });
  it("theo quý, phí cố định không quảng cáo: không có mốc báo cáo, số tiền có sẵn", () => {
    const t = {
      role: "franchisor",
      brand: "X",
      fee_basis: "fixed",
      fee_fixed: 20_000_000,
      period: "quarter",
    };
    const m = kindMilestones({
      deal: "franchise",
      terms: t,
      start: "2027-01-01",
      end: "2027-06-30",
      ...base,
    });
    expect(m.map((x) => x.role)).toEqual(["fee", "fee", "renewal"]);
    expect(m[0]).toMatchObject({
      amount: 20_000_000,
      title: "Thu phí nhượng quyền quý 1/2027",
      due_date: "2027-04-10",
    });
  });
  it("không phí ban đầu thì không mốc ban đầu", () => {
    const m = kindMilestones({
      deal: "franchise",
      terms: { ...FR, initial_fee: 0 },
      start: "2027-01-01",
      end: "2027-01-31",
      ...base,
    });
    expect(m.some((x) => x.role === "initial")).toBe(false);
  });
});

describe("kết quả: bộ mốc Thỏa thuận hợp tác", () => {
  const t = {
    scope: "Tuyến miền Tây",
    split_basis: "profit",
    our_share_pct: 60,
    settle_period: "quarter",
  };
  it("có chia: đối soát mỗi kỳ + nhắc gia hạn", () => {
    const m = kindMilestones({
      deal: "cooperation",
      terms: t,
      start: "2027-01-01",
      end: "2028-12-31",
      noticeDays: 60,
      signed: null,
      today: "2026-11-20",
    });
    expect(m).toHaveLength(9);
    expect(m[0]).toMatchObject({
      kind: "other",
      title: "Đối soát lợi nhuận quý 1/2027",
      due_date: "2027-04-10",
      period_key: "2027-Q1",
    });
    expect(m[8]).toMatchObject({ role: "renewal", due_date: "2028-11-01" });
  });
  it("không chia: chỉ nhắc gia hạn, và không tính doanh thu", () => {
    const n = { scope: "Ghi nhớ", split_basis: "none" };
    const m = kindMilestones({
      deal: "cooperation",
      terms: n,
      start: "2027-01-01",
      end: "2028-12-31",
      ...base,
    });
    expect(m.map((x) => x.role)).toEqual(["renewal"]);
    expect(countsMoney("cooperation", n)).toBe(false);
    expect(countsMoney("cooperation", t)).toBe(true);
    expect(countsMoney("franchise", FR)).toBe(true);
    expect(countsMoney(null, null)).toBe(true);
  });
});

describe("kết quả: trường riêng", () => {
  it("thiếu gì thì báo thiếu đó", () => {
    expect(kindTermsMissing("franchise", { role: "franchisor" })).toEqual([
      "brand",
      "fee_basis",
      "period",
    ]);
    expect(kindTermsMissing("franchise", { ...FR, fee_pct: null })).toEqual(["fee_pct"]);
    expect(kindTermsMissing("franchise", { ...FR, foreign_franchisor: true })).toEqual([
      "moit_registered",
    ]);
    expect(kindTermsMissing("franchise", FR)).toEqual([]);
    expect(kindTermsMissing("cooperation", { scope: "a", split_basis: "revenue" })).toEqual([
      "our_share_pct",
      "settle_period",
    ]);
    expect(kindTermsMissing("cooperation", { scope: "a", split_basis: "none" })).toEqual([]);
  });
  it("chuẩn hoá bỏ trường mâu thuẫn; AI trích giữ khoá hợp lệ", () => {
    expect(
      normalizeKindTerms("franchise", { ...FR, fee_fixed: 5, moit_registered: true }),
    ).not.toHaveProperty("fee_fixed");
    expect(normalizeKindTerms("franchise", { ...FR, moit_registered: true })).not.toHaveProperty(
      "moit_registered",
    );
    expect(
      sanitizeKindTerms("franchise", { brand: "A", fee_pct: 500, lạ: 1, fee_basis: "revenue_pct" }),
    ).toEqual({ brand: "A", fee_basis: "revenue_pct" });
    expect(sanitizeKindTerms("sell", { brand: "A" })).toBeNull();
  });
});
