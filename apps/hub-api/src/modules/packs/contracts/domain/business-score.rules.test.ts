// V2-J1 · công thức điểm kinh doanh (BA §5.2a-e) + quy tắc đề xuất + kiểm cấu hình — hàm thuần.
import { describe, expect, it } from "bun:test";
import {
  type BizInput,
  bizProblem,
  DEFAULT_BIZ,
  mergeBiz,
  scoreBusiness,
} from "./business-score.rules";

const base: BizInput = {
  group: "goods",
  kind: "stock",
  heldQty: 0,
  unit: "cái",
  expiresInDays: null,
  sold12: 0,
  l3: 0,
  p3: 0,
  revenue: 0,
  cost: 0,
  commissionTotal: 0,
  commissionReceived: 0,
};
const f = (r: ReturnType<typeof scoreBusiness>, k: string) => r.factors.find((x) => x.key === k);

describe("điểm kinh doanh · yếu tố", () => {
  it("kho: tốc độ = 100 − (ngày tồn − 30) ÷ 1,5; biên lãi ×400; xu hướng 50 + Δ÷3th trước×50", () => {
    // vel = 91/91 = 1/ngày, tồn 75 ⇒ 75 ngày ⇒ 100 − 45/1,5 = 70. Lãi 20% ⇒ 80. Xu hướng: (91−70)/70×50 + 50 = 65.
    const r = scoreBusiness({
      ...base,
      heldQty: 75,
      sold12: 200,
      l3: 91,
      p3: 70,
      revenue: 1000,
      cost: 800,
    });
    expect(f(r, "rot")?.value).toBe(70);
    expect(f(r, "margin")?.value).toBe(80);
    expect(f(r, "trend")?.value).toBe(65);
    expect(r.score).toBe(Math.round(70 * 0.4 + 80 * 0.35 + 65 * 0.25));
  });

  it("gói suất: suất dự kiến bán trước hạn ÷ suất đang giữ (tối đa 100)", () => {
    // vel 0,5/ngày × 60 ngày = 30 suất; giữ 40 ⇒ 75%.
    const r = scoreBusiness({
      ...base,
      kind: "quota",
      heldQty: 40,
      expiresInDays: 60,
      sold12: 90,
      l3: 45,
      p3: 45,
    });
    expect(f(r, "rot")?.value).toBe(75);
    expect(f(r, "rot")?.detail).toContain("dự kiến bán 30/40 suất");
  });
});

describe("điểm kinh doanh · yếu tố (đặt theo khách, thiếu dữ liệu)", () => {
  it("đặt theo khách: bán 3 tháng ÷ mục tiêu; Giới thiệu: số HĐ ÷ mục tiêu và hoa hồng đã nhận ÷ phát sinh", () => {
    const o = scoreBusiness({ ...base, kind: "order", group: "goods", sold12: 4, l3: 3, p3: 1 });
    expect(f(o, "rot")?.value).toBe(50);
    const g = scoreBusiness({
      ...base,
      kind: "referral",
      group: "referral",
      sold12: 9,
      l3: 6,
      p3: 3,
      commissionTotal: 10_000_000,
      commissionReceived: 4_000_000,
    });
    expect(f(g, "rot")?.value).toBe(100);
    expect(f(g, "margin")?.value).toBe(40);
  });

  it("yếu tố không có dữ liệu bị bỏ khỏi mẫu số; chưa bán và không giữ ⇒ không điểm", () => {
    const r = scoreBusiness({ ...base, kind: "order", sold12: 6, l3: 6, p3: 6 });
    expect(f(r, "margin")?.value).toBeNull();
    // chỉ rot (100) và trend (50): (100×40 + 50×25) ÷ 65
    expect(r.score).toBe(Math.round((100 * 40 + 50 * 25) / 65));
    const none = scoreBusiness(base);
    expect([none.score, none.suggestion]).toEqual([null, null]);
  });
});

describe("đề xuất theo ngưỡng mặc định", () => {
  const held = (o: Partial<BizInput>) =>
    scoreBusiness({ ...base, sold12: 300, p3: 91, revenue: 100, cost: 70, ...o });

  it("giữ kho: tồn đủ bán < 45 ngày và điểm ≥ 65 ⇒ Mua thêm; > 150 ngày ⇒ Xả hàng; giữa ⇒ Giữ", () => {
    expect(held({ heldQty: 20, l3: 91 }).suggestion).toBe("buy");
    expect(held({ heldQty: 200, l3: 91 }).suggestion).toBe("dump");
    expect(held({ heldQty: 80, l3: 91 }).suggestion).toBe("hold");
  });

  it("đang giữ mà 3 tháng chưa bán ⇒ Xả hàng", () => {
    const r = scoreBusiness({ ...base, heldQty: 10, sold12: 5, l3: 0, p3: 5 });
    expect(r.suggestion).toBe("dump");
    expect(r.reason).toContain("3 tháng chưa bán");
  });

  it("gói suất: ≥ 120% và điểm ≥ 65 ⇒ Mua thêm; < 70% ⇒ Xả hàng; giữa ⇒ Giữ", () => {
    const q = (heldQty: number) => held({ kind: "quota", heldQty, expiresInDays: 60, l3: 91 });
    expect(q(40).suggestion).toBe("buy"); // dự kiến 60 suất / 40 = 150%
    expect(q(100).suggestion).toBe("dump"); // 60%
    expect(q(60).suggestion).toBe("hold"); // 100%
  });

  it("không giữ hàng: ≥ 70 Đẩy mạnh · < 45 Cân nhắc dừng · giữa Duy trì; ngưỡng đổi được", () => {
    const o = (l3: number, cost: number, cfg = DEFAULT_BIZ) =>
      scoreBusiness({ ...base, kind: "order", sold12: 12, l3, p3: l3, revenue: 100, cost }, cfg);
    expect(o(6, 70).suggestion).toBe("push"); // 40 + 35 + 12,5 = 88
    expect(o(1, 95).suggestion).toBe("stop"); // 6,7 + 7 + 12,5 = 26
    expect(o(3, 70).suggestion).toBe("keep"); // 20 + 35 + 12,5 = 68
    expect(o(3, 70, { ...DEFAULT_BIZ, lo: 69 }).suggestion).toBe("stop");
  });
});

describe("cấu hình", () => {
  it("ngưỡng sai quan hệ ⇒ thông báo; mặc định hợp lệ; bản cũ thiếu khoá được bù mặc định", () => {
    expect(bizProblem(DEFAULT_BIZ)).toBeNull();
    expect(bizProblem({ ...DEFAULT_BIZ, w: { rot: 0, margin: 0, trend: 0 } })).not.toBeNull();
    expect(bizProblem({ ...DEFAULT_BIZ, buyDays: 200 })).not.toBeNull();
    expect(bizProblem({ ...DEFAULT_BIZ, quotaDump: 130 })).not.toBeNull();
    expect(bizProblem({ ...DEFAULT_BIZ, lo: 80, hi: 70 })).not.toBeNull();
    expect(mergeBiz({ hi: 80, w: { rot: 50 } })).toEqual({
      ...DEFAULT_BIZ,
      hi: 80,
      w: { ...DEFAULT_BIZ.w, rot: 50 },
    });
    expect(mergeBiz(null)).toEqual(DEFAULT_BIZ);
  });
});
