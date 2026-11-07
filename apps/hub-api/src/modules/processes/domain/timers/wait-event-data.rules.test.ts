// CR-125 · m9 · dữ liệu kèm sự kiện ⇒ trường output stage chờ (luật thuần).
import { describe, expect, test } from "bun:test";
import { cleanEventData, EVENT_DATA_MAX_KEYS, waitEventFields } from "./wait-event-data.rules";

describe("wait-event-data (CR-125 m9 · đầu ra stage chờ)", () => {
  test("đúng sự kiện thắng ⇒ gộp dữ liệu kèm, `event` không bị ghi đè", () => {
    const f = waitEventFields("esign.completed", {
      event: "esign.completed",
      data: { signed_at: "2026-11-07", signer: "An", event: "hack" },
    });
    expect(f).toEqual({ signed_at: "2026-11-07", signer: "An", event: "esign.completed" });
  });
  test("sự kiện khác thắng / hết hạn ⇒ chỉ `event`", () => {
    const s = { event: "esign.completed", data: { signer: "An" } };
    expect(waitEventFields("esign.declined", s)).toEqual({ event: "esign.declined" });
    expect(waitEventFields("timeout", s)).toEqual({ event: "timeout" });
    expect(waitEventFields("timeout", undefined)).toEqual({ event: "timeout" });
  });
  test("lọc khoá sai dạng, giá trị không vô hướng, số vô hạn, chuỗi rỗng; cắt trần", () => {
    const d = cleanEventData({
      "Bad-Key": "x",
      ok: "  a  ",
      n: 2,
      inf: Number.POSITIVE_INFINITY,
      obj: { a: 1 },
      empty: " ",
      long: "x".repeat(600),
    });
    expect(d).toEqual({ ok: "a", n: 2, long: "x".repeat(500) });
    expect(cleanEventData(null)).toEqual({});
    expect(cleanEventData(["a"])).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanEventData(many))).toHaveLength(EVENT_DATA_MAX_KEYS);
  });
});
