// V2-A · BA v2 §2 · §3.1 HD-01/HD-11 · §5.4 (5.4a/5.4c): luật thuần mốc HĐ — viết TRƯỚC code (tiền + giai đoạn).
import { describe, expect, test } from "bun:test";
import {
  checkMilestone,
  commissionTotal,
  dealOfDirection,
  defaultMilestones,
  defaultOwner,
  directionOfDeal,
  effectiveAmounts,
  fromDb,
  nextStep,
  stageOf,
  toDb,
} from "./milestones.rules";

describe("V2-A · loại HĐ ↔ hướng cũ", () => {
  test("deal từ direction (backfill) và ngược lại; Giới thiệu = tiền vào (sale)", () => {
    expect([dealOfDirection("sale"), dealOfDirection("purchase"), dealOfDirection(null)]).toEqual([
      "sell",
      "buy",
      null,
    ]);
    expect([directionOfDeal("buy"), directionOfDeal("sell"), directionOfDeal("referral")]).toEqual([
      "purchase",
      "sale",
      "sale",
    ]);
  });
});

describe("V2-A · 7 loại mốc ↔ cột DB (kind, direction)", () => {
  test("Thu tiền / Thanh toán = payment theo hướng tiền; loại khác giữ hướng theo HĐ", () => {
    expect(toDb("collect", "buy")).toEqual({ kind: "payment", direction: "receive" });
    expect(toDb("pay", "sell")).toEqual({ kind: "payment", direction: "pay" });
    expect(toDb("delivery", "buy")).toEqual({ kind: "delivery", direction: "pay" });
    expect(toDb("delivery", "sell")).toEqual({ kind: "delivery", direction: "receive" });
    expect(toDb("commission", "referral")).toEqual({ kind: "commission", direction: "receive" });
    for (const k of [
      "delivery",
      "collect",
      "pay",
      "commission",
      "serial",
      "renewal",
      "other",
    ] as const)
      for (const deal of ["buy", "sell", "referral"] as const) {
        const db = toDb(k, deal);
        expect(fromDb(db.kind, db.direction)).toBe(k);
      }
  });
  test("việc của ai mặc định: tiền vào/hoa hồng/giao của NCC ⇒ đối tác; trả tiền/giao bán/nhắc ⇒ mình", () => {
    expect(defaultOwner("collect", "sell")).toBe("partner");
    expect(defaultOwner("pay", "buy")).toBe("ours");
    expect(defaultOwner("commission", "referral")).toBe("partner");
    expect(defaultOwner("delivery", "buy")).toBe("partner");
    expect(defaultOwner("delivery", "sell")).toBe("ours");
    expect(defaultOwner("serial", "buy")).toBe("partner");
    expect(defaultOwner("renewal", "sell")).toBe("ours");
    expect(defaultOwner("other", "buy")).toBe("ours");
  });
  test("SL chỉ cho Giao hàng; số tiền chỉ cho Thu/Thanh toán/Hoa hồng", () => {
    expect(checkMilestone({ kind: "delivery", qty: 5, amount: null })).toBe("ok");
    expect(checkMilestone({ kind: "collect", qty: 5, amount: null })).toBe("qty_kind");
    expect(checkMilestone({ kind: "delivery", qty: null, amount: 10 })).toBe("amount_kind");
    expect(checkMilestone({ kind: "commission", qty: null, amount: 10 })).toBe("ok");
    expect(checkMilestone({ kind: "other", qty: null, amount: null })).toBe("ok");
  });
});

describe("V2-A · 5.4c hoa hồng dự kiến (tiền: số nguyên đồng)", () => {
  test("cố định thắng %; % làm tròn nửa lên tới đồng; thiếu giá trị ⇒ null", () => {
    expect(commissionTotal({ value: 1_000_000, pct: 10, fixed: 250_000 })).toBe(250_000);
    expect(commissionTotal({ value: 1_234_567, pct: 12.5, fixed: null })).toBe(154_321); // 154.320,875
    expect(commissionTotal({ value: 1_234_563, pct: "12.50", fixed: null })).toBe(154_320); // 154.320,375
    expect(commissionTotal({ value: 1_000_000_000_000_000, pct: 100, fixed: null })).toBe(
      1_000_000_000_000_000,
    );
    expect(commissionTotal({ value: null, pct: 10, fixed: null })).toBeNull();
    expect(commissionTotal({ value: 5, pct: null, fixed: null })).toBeNull();
  });
});

describe("V2-A · 5.4a số tiền mốc: trống ⇒ chia đều phần còn lại của giá trị cho mốc tiền chính", () => {
  const m = (id: string, kind: string, amount: number | null, status = "open") => ({
    id,
    kind: kind as "collect",
    amount,
    status: status as "open",
  });
  test("một mốc trống ⇒ cả giá trị; ba mốc ⇒ chia đều, đồng lẻ dồn vào mốc đầu, tổng đúng từng đồng", () => {
    expect(effectiveAmounts([m("a", "collect", null)], 100_000_000, "collect").get("a")).toBe(
      100_000_000,
    );
    const got = effectiveAmounts(
      [m("a", "collect", null), m("b", "collect", null), m("c", "collect", null)],
      100_000_001,
      "collect",
    );
    expect([got.get("a"), got.get("b"), got.get("c")]).toEqual([
      33_333_334, 33_333_334, 33_333_333,
    ]);
  });
  test("mốc có số tiền giữ nguyên; trống chia phần còn lại (âm ⇒ 0); huỷ không tính; loại phụ trống ⇒ null", () => {
    const got = effectiveAmounts(
      [
        m("a", "collect", 30_000_000),
        m("b", "collect", null),
        m("c", "collect", null),
        m("x", "collect", 999, "cancelled"),
        m("d", "delivery", null),
        m("p", "pay", null),
      ],
      100_000_000,
      "collect",
    );
    expect([got.get("a"), got.get("b"), got.get("c"), got.get("d"), got.get("p")]).toEqual([
      30_000_000,
      35_000_000,
      35_000_000,
      null,
      null,
    ]);
    expect(got.get("x")).toBe(999);
    const over = effectiveAmounts(
      [m("a", "collect", 120), m("b", "collect", null)],
      100,
      "collect",
    );
    expect(over.get("b")).toBe(0);
  });
  test("không biết giá trị ⇒ mốc trống null; trần 10¹⁵ chia chính xác (BigInt)", () => {
    expect(effectiveAmounts([m("a", "collect", null)], null, "collect").get("a")).toBeNull();
    const ids = Array.from({ length: 7 }, (_, i) => `k${i}`);
    const got = effectiveAmounts(
      ids.map((i) => m(i, "collect", null)),
      999_999_999_999_999,
      "collect",
    );
    const sum = ids.reduce((s, i) => s + BigInt(got.get(i) ?? 0), 0n);
    expect(sum).toBe(999_999_999_999_999n);
  });
});

describe("V2-A · HD-01 mốc mặc định theo loại khi lưu", () => {
  test("Mua: Giao (NCC) + Thanh toán (mình); Bán: Giao (mình) + Thu tiền (khách); Giới thiệu: Nhận hoa hồng", () => {
    const dates = {
      start: "2026-11-01",
      end: "2027-10-31",
      signed: "2026-10-25",
      today: "2026-10-20",
    };
    expect(defaultMilestones({ deal: "buy", ...dates })).toEqual([
      { kind: "delivery", title: "Giao hàng", due_date: "2026-11-01", owner: "partner" },
      { kind: "pay", title: "Thanh toán", due_date: "2027-10-31", owner: "ours" },
    ]);
    expect(defaultMilestones({ deal: "sell", ...dates }).map((x) => [x.kind, x.owner])).toEqual([
      ["delivery", "ours"],
      ["collect", "partner"],
    ]);
    expect(defaultMilestones({ deal: "referral", ...dates })).toEqual([
      { kind: "commission", title: "Nhận hoa hồng", due_date: "2027-10-31", owner: "partner" },
    ]);
  });
  test("thiếu ngày: giao = bắt đầu ?? ký ?? hôm nay; tiền = kết thúc ?? bắt đầu ?? ký ?? hôm nay", () => {
    const got = defaultMilestones({
      deal: "sell",
      start: null,
      end: null,
      signed: null,
      today: "2026-10-20",
    });
    expect(got.map((x) => x.due_date)).toEqual(["2026-10-20", "2026-10-20"]);
    const s = defaultMilestones({
      deal: "buy",
      start: null,
      end: null,
      signed: "2026-09-01",
      today: "2026-10-20",
    });
    expect(s.map((x) => x.due_date)).toEqual(["2026-09-01", "2026-09-01"]);
  });
});

describe("V2-A · KN-04 giai đoạn suy từ mốc", () => {
  const ms = (...xs: [string, string, string?][]) =>
    xs.map(([kind, status, due], i) => ({
      id: `m${i}`,
      kind: kind as "collect",
      status: status as "open",
      due_date: due ?? "2026-12-01",
      seq: i + 1,
    }));
  test("chưa mốc nào xong + chưa tới ngày bắt đầu ⇒ Chưa bắt đầu; tới ngày ⇒ Đang thực hiện", () => {
    const x = ms(["delivery", "open"], ["collect", "open"]);
    expect(stageOf({ today: "2026-10-20", start: "2026-11-01", milestones: x })).toBe(
      "not_started",
    );
    expect(stageOf({ today: "2026-11-01", start: "2026-11-01", milestones: x })).toBe(
      "in_progress",
    );
    expect(stageOf({ today: "2026-11-01", start: null, milestones: x })).toBe("not_started");
  });
  test("có mốc xong ⇒ Đang thực hiện; mọi mốc bắt buộc xong (Nhắc gia hạn không bắt buộc, huỷ bỏ qua) ⇒ Đã xong", () => {
    expect(
      stageOf({
        today: "2026-10-20",
        start: "2026-11-01",
        milestones: ms(["delivery", "done"], ["collect", "open"]),
      }),
    ).toBe("in_progress");
    expect(
      stageOf({
        today: "2026-10-20",
        start: null,
        milestones: ms(
          ["delivery", "done"],
          ["collect", "done"],
          ["renewal", "open"],
          ["other", "cancelled"],
        ),
      }),
    ).toBe("done");
    expect(stageOf({ today: "2027-01-01", start: "2026-01-01", milestones: [] })).toBe(
      "in_progress",
    );
  });
  test("bước hiện tại = mốc chưa xong sớm nhất; quá hạn khi hạn < hôm nay", () => {
    const x = ms(
      ["collect", "open", "2026-12-01"],
      ["delivery", "open", "2026-10-01"],
      ["pay", "done", "2026-09-01"],
    );
    expect(nextStep(x, "2026-10-20")).toEqual({ id: "m1", overdue: true });
    expect(nextStep(x, "2026-10-01")).toEqual({ id: "m1", overdue: false });
    expect(nextStep(ms(["pay", "done"]), "2026-10-20")).toBeNull();
  });
});
