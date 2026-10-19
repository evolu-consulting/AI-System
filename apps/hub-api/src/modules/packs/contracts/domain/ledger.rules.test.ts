// HD7-FR-01…09 · HD7-AC02/03/05: luật tiền/ngày thuần của sổ thanh toán — parity với mgmt-app (`ledger/obligations.py`,
// `ledger/overdue.py`, `contracts/schedule.py::_sane`, `tests/test_{ledger,overdue,schedule}.py`). Viết TRƯỚC code (làn đầy đủ: tiền).
import { describe, expect, it } from "bun:test";
import {
  counterparty,
  daysLate,
  MONEY_MAX,
  overdueOf,
  partyKey,
  saneSchedule,
  settledType,
  undoOf,
} from "./ledger.rules";

describe("HD7-FR-01 · đối tác của HĐ (obligations.counterparty)", () => {
  it("bán ⇒ bên mua, thu (receive), khách hàng; mua ⇒ bên bán, trả (pay), nhà cung cấp", () => {
    const f = {
      buyer_name: "Bếp Việt",
      buyer_tax_id: "0311111111",
      supplier_name: "Bình An",
      supplier_tax_id: "0322-222-222",
    };
    expect(counterparty("sale", f)).toEqual({
      party: "tax:0311111111",
      direction: "receive",
      role: "customer",
      name: "Bếp Việt",
    });
    expect(counterparty("purchase", f)).toEqual({
      party: "tax:0322222222",
      direction: "pay",
      role: "supplier",
      name: "Bình An",
    });
  });
  it("chưa biết bên (direction null) ⇒ như mua (mgmt: `sale = direction == 'sale'`)", () => {
    expect(counterparty(null, { supplier_name: "X" }).direction).toBe("pay");
  });
  it("không MST ⇒ khoá theo tên đã bỏ dấu; không tên lẫn MST ⇒ null", () => {
    expect(partyKey("  Công ty   Phương Nam ", null)).toBe("name:cong ty phuong nam");
    expect(partyKey(null, "  ")).toBeNull();
    expect(partyKey("", null)).toBeNull();
    expect(partyKey("Đà Lạt", "MST: 0355-555-555")).toBe("tax:0355555555");
  });
});

describe("HD7-FR-04 · trễ bao nhiêu ngày (settle)", () => {
  it("trả 2026-10-13 cho hạn 10-10 ⇒ 3; đúng/sớm ⇒ 0 (max(0, at − due))", () => {
    expect(daysLate("2026-10-13", "2026-10-10")).toBe(3);
    expect(daysLate("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysLate("2026-10-01", "2026-10-20")).toBe(0);
    expect(daysLate("2027-03-01", "2027-02-28")).toBe(1);
    expect(daysLate("2028-03-01", "2028-02-28")).toBe(2); // năm nhuận
  });
  it("loại sự kiện: giao hàng ⇒ delivered; thu ⇒ received; trả ⇒ paid", () => {
    expect(settledType("delivery", "pay")).toBe("delivered");
    expect(settledType("payment", "receive")).toBe("received");
    expect(settledType("payment", "pay")).toBe("paid");
  });
});

describe("HD7-FR-09 · dòng quá hạn (overdue.sweep)", () => {
  it("at = hạn + 1; khách nợ tiền hoặc NCC nợ hàng ⇒ lỗi của đối tác; mình trả trễ ⇒ không", () => {
    expect(overdueOf({ due_date: "2026-10-01", direction: "receive", kind: "payment" })).toEqual({
      at: "2026-10-02",
      role: "customer",
      party_late: true,
    });
    expect(overdueOf({ due_date: "2026-12-31", direction: "pay", kind: "payment" })).toEqual({
      at: "2027-01-01",
      role: "supplier",
      party_late: false,
    });
    expect(
      overdueOf({ due_date: "2026-10-01", direction: "pay", kind: "delivery" }).party_late,
    ).toBe(true);
    expect(
      overdueOf({ due_date: "2026-10-01", direction: "receive", kind: "delivery" }).party_late,
    ).toBe(false);
  });
});

describe("HD7-FR-07 · huỷ sự kiện hoàn tác đợt (obligations.undo)", () => {
  const ob = { status: "done", due_date: "2026-10-20", postpones: 1, reminders: 2 } as const;
  it("đã thu/đã trả/giao hàng ⇒ mở lại khi đợt đang xong", () => {
    expect(undoOf({ type: "received" }, ob)).toEqual({ reopen: true });
    expect(undoOf({ type: "paid" }, { ...ob, status: "open" })).toBeNull();
  });
  it("hẹn lại ⇒ về hạn cũ khi đợt chưa xong và hạn vẫn là ngày đã hẹn", () => {
    const open = { ...ob, status: "open" as const };
    expect(undoOf({ type: "postponed", was: "2026-10-13", to: "2026-10-20" }, open)).toEqual({
      due_date: "2026-10-13",
      postpones: 0,
      clearPostponed: true,
    });
    expect(
      undoOf({ type: "postponed", was: "2026-10-13", to: "2026-10-20" }, { ...open, postpones: 2 }),
    ).toEqual({ due_date: "2026-10-13", postpones: 1, clearPostponed: false });
    expect(undoOf({ type: "postponed", was: "2026-10-13", to: "2026-10-25" }, open)).toBeNull();
    expect(undoOf({ type: "postponed", was: "2026-10-13", to: "2026-10-20" }, ob)).toBeNull();
    expect(undoOf({ type: "postponed", to: "2026-10-20" }, open)).toBeNull();
  });
  it("đã nhắc ⇒ bớt một lượt, không âm; loại khác ⇒ không đụng đợt", () => {
    expect(undoOf({ type: "reminded" }, ob)).toEqual({ reminders: 1 });
    expect(undoOf({ type: "reminded" }, { ...ob, reminders: 0 })).toEqual({ reminders: 0 });
    expect(undoOf({ type: "complaint" }, ob)).toBeNull();
  });
});

describe("HD7-FR-02 · lịch AI có tin được không (schedule._sane)", () => {
  const i = (due_date: string, amount: number) => ({ due_date, amount });
  it("hai đợt 45.000.000 cho 90.000.000 ⇒ tin", () => {
    expect(
      saneSchedule([i("2026-10-31", 45_000_000), i("2026-12-08", 45_000_000)], 90_000_000),
    ).toBe(true);
  });
  it("10.000.000 cho 100.000.000 ⇒ không tin (test_amounts_that_do_not_add_up)", () => {
    expect(saneSchedule([i("2026-11-01", 10_000_000)], 100_000_000)).toBe(false);
  });
  it("lệch ≤ max(1000, giá trị // 1000) ⇒ tin; lệch hơn ⇒ không (chia nguyên, không làm tròn)", () => {
    expect(saneSchedule([i("2026-11-01", 999_999_000)], 1_000_000_000)).toBe(true); // lệch 1.000 ≤ 1.000.000
    expect(saneSchedule([i("2026-11-01", 998_999_999)], 1_000_000_000)).toBe(false); // lệch 1.000.001 > 1.000.000
    expect(saneSchedule([i("2026-11-01", 1_999)], 1_000)).toBe(true); // lệch 999 ≤ 1000
    expect(saneSchedule([i("2026-11-01", 2_001)], 1_000)).toBe(false);
    expect(saneSchedule([i("2026-11-01", 1_001_999)], 1_000_999)).toBe(true); // 1_000_999 // 1000 = 1000
  });
  it("rỗng, giá trị 0/null, tiền ≤ 0, ngày sai ⇒ không tin", () => {
    expect(saneSchedule([], 1000)).toBe(false);
    expect(saneSchedule([i("2026-11-01", 1000)], 0)).toBe(false);
    expect(saneSchedule([i("2026-11-01", 1000)], null)).toBe(false);
    expect(saneSchedule([i("2026-11-01", 0), i("2026-11-02", 1000)], 1000)).toBe(false);
    expect(saneSchedule([i("2026-02-30", 1000)], 1000)).toBe(false);
  });
  it("trần tiền 10¹⁵ là số nguyên an toàn của JS", () => {
    expect(MONEY_MAX).toBe(1_000_000_000_000_000);
    expect(Number.isSafeInteger(MONEY_MAX)).toBe(true);
  });
});
