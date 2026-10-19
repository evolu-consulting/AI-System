// W1 · "Việc của tôi": luật thuần của màn.
import { describe, expect, test } from "bun:test";
import type { MyWorkItem } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import {
  addDays,
  atLabel,
  countByKind,
  defaultPostpone,
  defaultSnooze,
  filterItems,
  groupOf,
  postponeOk,
  snoozeOk,
  titleKey,
  whenOf,
  workErrorText,
} from "./mywork";

const it = (o: Partial<MyWorkItem>): MyWorkItem => ({
  id: "x:1",
  kind: "obligation",
  tone: "late",
  days: 1,
  due: "2026-10-19",
  at: null,
  title: null,
  party: null,
  amount: null,
  direction: null,
  contract_direction: null,
  contract_id: null,
  customer_id: null,
  note: null,
  milestone: null,
  subject: null,
  ...o,
});
const t = (k: string) => k;

describe("nhóm và nhãn mức gấp", () => {
  test("trễ / hôm nay / sắp tới theo số ngày", () => {
    expect([3, 1, 0, -1, -7].map((days) => groupOf({ days }))).toEqual([
      "late",
      "late",
      "today",
      "upcoming",
      "upcoming",
    ]);
    expect([whenOf({ days: 3 }), whenOf({ days: 0 }), whenOf({ days: -2 })]).toEqual([
      { key: "late", n: 3 },
      { key: "today", n: 0 },
      { key: "left", n: 2 },
    ]);
  });
  test("khoá tiêu đề theo loại việc, hướng tiền, chủ thể hẹn nhắc", () => {
    expect(titleKey(it({ kind: "obligation", direction: "receive" }))).toBe("receive");
    expect(titleKey(it({ kind: "obligation", direction: "pay" }))).toBe("pay");
    expect(titleKey(it({ kind: "followup", subject: "renewal", customer_id: "k" }))).toBe(
      "followupRenewal",
    );
    expect(titleKey(it({ kind: "followup", subject: "customer", customer_id: "k" }))).toBe(
      "followupCustomer",
    );
    expect(titleKey(it({ kind: "followup", subject: "obligation" }))).toBe("followupGeneric");
    expect(titleKey(it({ kind: "deadline" }))).toBe("deadline");
    expect(titleKey(it({ kind: "reminder" }))).toBe("reminder");
  });
});

describe("lọc và đếm", () => {
  const items = [
    it({ id: "a", kind: "followup" }),
    it({ id: "b" }),
    it({ id: "c" }),
    it({ id: "d", kind: "deadline" }),
  ];
  test("lọc theo loại; tất cả giữ nguyên thứ tự", () => {
    expect(filterItems(items, "all").map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterItems(items, "obligation").map((i) => i.id)).toEqual(["b", "c"]);
    expect(filterItems(items, "reminder")).toEqual([]);
  });
  test("đếm theo loại", () => {
    expect(countByKind(items)).toEqual({
      all: 4,
      followup: 1,
      obligation: 2,
      deadline: 1,
      reminder: 0,
    });
  });
});

describe("gợi ý ngày", () => {
  test("cộng ngày lịch qua tháng/năm/năm nhuận", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-20", -20)).toBe("2026-09-30");
  });
  test("Khách hẹn lại: +7 ngày sau cái muộn hơn của (hạn, hôm nay)", () => {
    expect(defaultPostpone({ due: "2026-10-10" }, "2026-10-20")).toBe("2026-10-27");
    expect(defaultPostpone({ due: "2026-10-25" }, "2026-10-20")).toBe("2026-11-01");
  });
  test("Nhắc lại sau: 09:00 ngày mai", () => {
    expect(defaultSnooze("2026-10-31")).toBe("2026-11-01T09:00");
  });
  test("hợp lệ: hẹn mới phải sau hạn; giờ nhắc có thật", () => {
    expect([
      postponeOk("2026-10-20", { due: "2026-10-19" }),
      postponeOk("2026-10-19", { due: "2026-10-19" }),
      postponeOk("", { due: "2026-10-19" }),
    ]).toEqual([true, false, false]);
    expect([
      snoozeOk("2026-10-20T09:00"),
      snoozeOk("2026-10-20T24:00"),
      snoozeOk("2026-10-20T09:60"),
      snoozeOk("2026-10-20"),
      snoozeOk(""),
    ]).toEqual([true, false, false, false, false]);
  });
  test("nhãn giờ hẹn", () => {
    expect(atLabel("2026-10-20T08:30")).toBe("08:30 20/10");
  });
});

describe("câu lỗi theo mã", () => {
  test("mã đã biết ⇒ câu riêng; mất mạng ⇒ câu mạng; còn lại ⇒ câu chung (không lộ thông điệp máy chủ)", () => {
    const e = (code: string) => new ApiError(422, code as never, "máy chủ nói gì đó");
    expect(workErrorText(e("POSTPONE_DATE"), t)).toBe("contracts.work.errors.POSTPONE_DATE");
    expect(workErrorText(e("OBLIGATION_DONE"), t)).toBe("contracts.work.errors.OBLIGATION_DONE");
    expect(workErrorText(e("NETWORK_ERROR"), t)).toBe("contracts.errors.network");
    expect(workErrorText(e("WEIRD"), t)).toBe("contracts.errors.unknown");
    expect(workErrorText(new Error("x"), t)).toBe("contracts.errors.unknown");
  });
});
