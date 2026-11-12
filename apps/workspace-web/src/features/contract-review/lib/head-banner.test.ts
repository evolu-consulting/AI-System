import { describe, expect, test } from "bun:test";
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { hoursLeft, lastDecision } from "./head-banner";

const ev = (id: number, type: string, at: string, data: Record<string, unknown> = {}, by = "u1") =>
  ({ id, type, at, data, actor_user_id: by }) as ContractDetail["events"][number];

describe("CR-127 U5 · băng lý do đầu trang", () => {
  test("lastDecision: lấy lần Trả lại mới nhất kèm ý kiến", () => {
    const d = lastDecision([
      ev(1, "stage_decided", "2026-11-10T08:00:00Z", { action: "return", feedback: "cũ" }),
      ev(2, "stage_decided", "2026-11-10T15:20:00Z", {
        action: "return",
        feedback: "Sửa thanh toán 30 ngày.",
      }),
      ev(3, "uploaded", "2026-11-09T08:00:00Z"),
    ]);
    expect(d).toMatchObject({ action: "return", by: "u1", note: "Sửa thanh toán 30 ngày." });
  });
  test("lastDecision: từ chối; không có quyết định ⇒ null", () => {
    expect(
      lastDecision([ev(1, "rejected", "2026-11-11T09:40:00Z", { note: "Nợ quá hạn" })]),
    ).toMatchObject({ action: "reject", note: "Nợ quá hạn" });
    expect(lastDecision([ev(1, "uploaded", "2026-11-09T08:00:00Z")])).toBeNull();
  });
  test("hoursLeft: còn giờ / quá hạn / không hạn", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(hoursLeft("2026-11-11T07:00:00Z", now)).toEqual({ hours: 31, over: false });
    expect(hoursLeft("2026-11-09T00:00:00Z", now)).toEqual({ hours: 0, over: true });
    expect(hoursLeft(null, now)).toBeNull();
  });
});
