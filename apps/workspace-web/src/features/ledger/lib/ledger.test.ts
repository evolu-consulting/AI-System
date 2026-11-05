// HD7-FR-12 · câu đọc dòng sổ như mgmt `PartnerLog.tsx::said` (dùng chuỗi vi thật), dòng quá hạn đã xử lý, 15 dòng gần nhất.
import { describe, expect, test } from "bun:test";
import type { PartnerEvent } from "@ai/contracts";
import vi from "../../../../../../packages/i18n/locales/contracts/ledger.vi.json";
import { answeredSet, lateBy, otherKinds, recentOf, said, voidable } from "./ledger";

const dict = vi.contracts.ledger as Record<string, unknown>;
const t = (k: string, o: Record<string, unknown> = {}) => {
  const v = k
    .replace(/^contracts\.ledger\./, "")
    .split(".")
    .reduce<unknown>((x, p) => (x as Record<string, unknown>)?.[p], dict);
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n]));
};
const ev = (o: Partial<PartnerEvent>): PartnerEvent =>
  ({
    id: "1",
    party: "tax:1",
    role: "customer",
    type: "received",
    at: "2026-10-10",
    by: null,
    by_name: null,
    source: "action",
    contract_id: null,
    obligation_id: null,
    days_late: null,
    amount: null,
    note: null,
    voided: false,
    voided_by: null,
    voided_at: null,
    ...o,
  }) as PartnerEvent;

describe("said (PartnerLog.tsx:31-41)", () => {
  test("đã thu trễ + tiền; đúng hạn; hẹn lại sang ngày", () => {
    expect(said(ev({ days_late: 3, amount: 85_000_000 }), t)).toBe(
      "Khách đã trả · trễ 3 ngày · 85.000.000 đ",
    );
    expect(said(ev({ type: "paid", days_late: 0 }), t)).toBe("Mình đã trả · đúng hạn");
    expect(said(ev({ type: "postponed", to: "2026-10-20" }), t)).toBe("Hẹn lại · sang 20/10/2026");
    expect(said(ev({ type: "rating", value: 80 }), t)).toBe("Chấm điểm · 80/100");
    expect(said(ev({ type: "lạ" }), t)).toBe("lạ");
  });
  test("quá hạn: ai chưa trả, đợt, tiền, hạn, đã xử lý", () => {
    const o = ev({
      type: "overdue",
      party_late: true,
      kind: "payment",
      seq: 1,
      amount: 350_000,
      due_date: "2026-10-01",
    });
    expect(said(o, t)).toBe("Quá hạn · Khách chưa trả đợt 1 · 350.000 đ · hạn 01/10/2026");
    expect(said({ ...o, party_late: false }, t, true)).toBe(
      "Quá hạn · Mình chưa trả đợt 1 · 350.000 đ · hạn 01/10/2026 · sau đó đã xử lý",
    );
    expect(said({ ...o, kind: "delivery", seq: undefined, amount: null }, t)).toBe(
      "Quá hạn · Chưa giao · hạn 01/10/2026",
    );
  });
});

describe("đã xử lý / gần đây / huỷ được", () => {
  test("dòng quá hạn được trả lời khi đợt đã thu hoặc hẹn lại (chưa huỷ)", () => {
    const s = answeredSet([
      ev({ obligation_id: "a" }),
      ev({ type: "postponed", obligation_id: "b", voided: true }),
      ev({ type: "reminded", obligation_id: "c" }),
    ]);
    expect([s.has("a"), s.has("b"), s.has("c")]).toEqual([true, false, false]);
  });
  test("15 mới nhất; trang HĐ chỉ dòng của HĐ hoặc không gắn HĐ", () => {
    const all = Array.from({ length: 20 }, (_, i) =>
      ev({ id: String(i), contract_id: i % 2 ? "k1" : null }),
    );
    expect(recentOf(all).map((e) => e.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => String(19 - i)),
    );
    expect(
      recentOf([ev({ contract_id: "k2" }), ev({ id: "2", contract_id: "k1" })], "k1").map(
        (e) => e.id,
      ),
    ).toEqual(["2"]);
  });
  test("không huỷ dòng hệ thống / chấm điểm / CKS / đã huỷ / khi chỉ xem", () => {
    expect(voidable(ev({}), true)).toBe(true);
    expect(voidable(ev({}), false)).toBe(false);
    for (const x of [
      { source: "system" as const },
      { type: "rating" },
      { type: "cks_renewed" },
      { voided: true },
    ])
      expect(voidable(ev(x), true)).toBe(false);
  });
  test("việc khác theo vai; trễ theo ngày", () => {
    expect(otherKinds("customer").map((k) => k.type)).toEqual([
      "complaint",
      "appointment_kept",
      "appointment_missed",
    ]);
    expect(otherKinds("supplier")[0]).toEqual({
      type: "delivered",
      roles: ["supplier"],
      late: true,
    });
    expect(lateBy("2026-10-18", "2026-10-10")).toBe(8);
  });
});
