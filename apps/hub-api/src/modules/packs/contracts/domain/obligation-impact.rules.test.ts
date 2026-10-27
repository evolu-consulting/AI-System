// MS-impact · luật xem trước tác động xác nhận mốc (thuần): phần góp V2-E, dòng sổ HD8 + quá hạn treo, kho, công nợ.
import { describe, expect, it } from "bun:test";
import {
  debtAfter,
  hd8After,
  hd8Event,
  settleFacts,
  stockAfter,
  v2eContribution,
  v2eWith,
} from "./obligation-impact.rules";
import { DEFAULT_DECAY } from "./rep-config.rules";
import { emptyAgg } from "./scoring-agg.rules";

const cell = { window_months: 12, decay: DEFAULT_DECAY, late_per_day: 2 };
const TODAY = "2026-10-27";

describe("MS-impact · settleFacts (≡ settle)", () => {
  it("trễ ⇒ lỗi chọn hoặc unknown; đúng/sớm hạn ⇒ không lỗi", () => {
    expect(settleFacts({ due_date: "2026-10-20" }, TODAY, "partner")).toEqual({
      late: 7,
      fault: "partner",
    });
    expect(settleFacts({ due_date: "2026-10-20" }, TODAY)).toEqual({ late: 7, fault: "unknown" });
    expect(settleFacts({ due_date: "2026-10-30" }, TODAY, "partner")).toEqual({
      late: 0,
      fault: null,
    });
  });
});

describe("MS-impact · V2-E phần góp của một mốc", () => {
  const o = { owner: "partner", kind: "delivery", due_date: "2026-10-20" };
  it("lỗi đối tác trừ late_per_day × ngày; lỗi mình / chưa rõ = 100", () => {
    expect(v2eContribution(o, TODAY, "partner", TODAY, cell)).toEqual({
      src: "m:delivery",
      h: 1,
      hs: 86,
    });
    expect(v2eContribution(o, TODAY, "ours", TODAY, cell)?.hs).toBe(100);
    expect(v2eContribution(o, TODAY, "unknown", TODAY, cell)?.hs).toBe(100);
  });
  it("mốc của mình / loại không tính ⇒ nguồn tx; ngày tương lai / ngoài khoảng ⇒ null", () => {
    expect(v2eContribution({ ...o, owner: "ours" }, TODAY, null, TODAY, cell)?.src).toBe("tx");
    expect(v2eContribution({ ...o, kind: "other" }, TODAY, null, TODAY, cell)?.src).toBe("tx");
    expect(v2eContribution(o, "2026-10-28", null, TODAY, cell)).toBeNull();
    expect(v2eContribution(o, "2025-10-27", null, TODAY, cell)).toBeNull();
  });
  it("độ cũ bậc thang: 7 tháng trước ⇒ h = 0,5", () => {
    expect(v2eContribution(o, "2026-03-20", null, TODAY, cell)?.h).toBe(0.5);
  });
  it("cộng vào ô (bản sao, không đổi ô cũ); ô chưa có ⇒ dựng mới", () => {
    const inp = {
      party: "tax:1",
      role: "supplier" as const,
      grp: "goods" as const,
      sources: { "m:delivery": { n: 2, wh: 2, whs: 200 } },
      value: 10,
      stars: {},
    };
    const out = v2eWith(inp, inp, { src: "m:delivery", h: 1, hs: 86 });
    expect(out.sources["m:delivery"]).toEqual({ n: 3, wh: 3, whs: 286 });
    expect(inp.sources["m:delivery"]).toEqual({ n: 2, wh: 2, whs: 200 });
    expect(v2eWith(undefined, inp, { src: "tx", h: 1, hs: 100 })).toMatchObject({
      value: 0,
      sources: { tx: { n: 1, wh: 1, whs: 100 } },
    });
  });
});

describe("MS-impact · HD8 dòng sổ xong đợt", () => {
  const w = { start: "2025-10-27", recent: "2026-07-27", today: TODAY };
  it("loại/vai/trễ ≡ settle", () => {
    expect(hd8Event({ kind: "delivery", direction: "pay", due_date: "2026-10-25" }, TODAY)).toEqual(
      {
        type: "delivered",
        role: "supplier",
        late: 2,
      },
    );
    expect(
      hd8Event({ kind: "payment", direction: "receive", due_date: "2026-10-30" }, TODAY),
    ).toEqual({
      type: "received",
      role: "customer",
      late: 0,
    });
  });
  it("cộng một dòng gần đây + quá hạn treo của đợt thành đã trả lời; gốc không đổi", () => {
    const a = emptyAgg();
    a.pend[1] = { n: 1, on: 0, late: 7 };
    const out = hd8After(a, { type: "delivered", late: 7, at: TODAY }, "supplier", w, [
      { at: "2026-10-21", due_date: "2026-10-20" },
    ]);
    expect(out.set[1]).toEqual({ n: 1, on: 0, late: 7 });
    expect(out.pend[1]).toEqual({ n: 0, on: 0, late: 0 });
    expect(out.counted).toBe(1);
    expect(a.pend[1]).toEqual({ n: 1, on: 0, late: 7 });
  });
  it("ngày ngoài khoảng tính ⇒ không đổi", () => {
    const out = hd8After(
      emptyAgg(),
      { type: "delivered", late: 0, at: "2027-01-01" },
      "supplier",
      w,
      [],
    );
    expect(out.counted).toBe(0);
  });
});

describe("MS-impact · kho + công nợ", () => {
  it("tồn trước → sau theo thành phần giữ tồn; nhập cộng, xuất trừ, âm được", () => {
    const stock = [
      { id: "c1", name: "Hộp", mode: "stock", on_hand: "10.5" },
      { id: "c2", name: "Theo khách", mode: "order", on_hand: "0" },
    ];
    expect(
      stockAfter(
        [
          { componentId: "c1", direction: "out", qty: "12" },
          { componentId: "c2", direction: "out", qty: "1" },
        ],
        stock,
      ),
    ).toEqual([{ component_id: "c1", name: "Hộp", before: "10.5", after: "-1.5" }]);
    expect(stockAfter([{ componentId: "c1", direction: "in", qty: "0.25" }], stock)[0]?.after).toBe(
      "10.75",
    );
  });
  it("công nợ: mốc tiền ⇒ còn phải thu/trả trừ số tiền; mốc khác ⇒ null", () => {
    expect(
      debtAfter({ kind: "payment", direction: "receive", amount: 30, debt_open: 100 }),
    ).toEqual({
      direction: "receive",
      before: 100,
      after: 70,
    });
    expect(
      debtAfter({ kind: "delivery", direction: "pay", amount: null, debt_open: 0 }),
    ).toBeNull();
  });
});
