// CR-125 · c1b · `signed_at` (Ký số) là mốc ISO đầy đủ nhưng khai kiểu `date`: mọi phép so/hẹn giờ theo NGÀY quy mốc về ngày lịch VN
// qua MỘT hàm (`asCalendarDate`) — If trên `signed_at` và hẹn giờ lấy `signed_at` làm gốc.
import { describe, expect, test } from "bun:test";
import { evaluateWhen } from "../if/if.rules";
import { waitDueAt } from "../timers/due-at.rules";
import { asCalendarDate } from "./start-inputs.rules";

// 01:30 ngày 07/11 giờ VN = 18:30 ngày 06/11 UTC
const SIGNED = "2026-11-06T18:30:00.000Z";

describe("asCalendarDate", () => {
  test("mốc ISO ⇒ ngày lịch Việt Nam; ranh giới 00:00 VN = 17:00 UTC", () => {
    expect(asCalendarDate(SIGNED)).toBe("2026-11-07");
    expect(asCalendarDate("2026-11-07T16:59:59Z")).toBe("2026-11-07");
    expect(asCalendarDate("2026-11-07T17:00:00Z")).toBe("2026-11-08");
  });
  test("đã là ngày / không phải mốc ⇒ giữ nguyên", () => {
    expect(asCalendarDate("2026-11-07")).toBe("2026-11-07");
    expect(asCalendarDate("không phải ngày")).toBe("không phải ngày");
  });
});

const cond = (op: string, value: string) => ({
  op: "and" as const,
  conds: [{ from: { kind: "field" as const, stageKey: "ky", field: "signed_at" }, op, value }],
});
const fields = { ky: { signed_at: SIGNED } };

describe("If trên signed_at (mốc đầy đủ) so với một NGÀY", () => {
  test("ký 01:30 ngày 07/11 giờ VN: = 2026-11-07 đúng, = 2026-11-06 sai (cắt UTC sẽ ra ngược lại)", () => {
    expect(evaluateWhen(cond("eq", "2026-11-07") as never, fields, {}).matched).toBe(true);
    expect(evaluateWhen(cond("eq", "2026-11-06") as never, fields, {}).matched).toBe(false);
  });
  test("so thứ tự theo ngày VN: ≥ 07/11 đúng, > 07/11 sai, < 08/11 đúng", () => {
    expect(evaluateWhen(cond("ge", "2026-11-07") as never, fields, {}).matched).toBe(true);
    expect(evaluateWhen(cond("gt", "2026-11-07") as never, fields, {}).matched).toBe(false);
    expect(evaluateWhen(cond("lt", "2026-11-08") as never, fields, {}).matched).toBe(true);
  });
});

describe("Hẹn giờ lấy signed_at làm gốc", () => {
  const at = (base: string | null) =>
    waitDueAt({
      base,
      offsetDays: 1,
      time: "09:00",
      tz: "Asia/Ho_Chi_Minh",
      now: new Date("2026-11-07T00:00:00Z"),
      expiresAt: null,
    });
  test("gốc là mốc đầy đủ ⇒ tính từ ngày VN (07/11 + 1 ngày, 09:00 VN = 02:00 UTC ngày 08/11)", () => {
    const r = at(SIGNED);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dueAt.toISOString()).toBe("2026-11-08T02:00:00.000Z");
  });
  test("gốc là ngày thường vẫn như cũ; thiếu ⇒ missing; rác ⇒ invalid", () => {
    expect(at("2026-11-07")).toEqual(at(SIGNED));
    expect(at(null)).toEqual({ ok: false, why: "missing" });
    expect(at("rác")).toEqual({ ok: false, why: "invalid" });
  });
});
