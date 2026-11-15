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

describe("fix-return-reason · băng hiện lý do của bước quyết (G1: một nguồn)", () => {
  // Trả lại / Từ chối qua bước có bằng chứng: engine ghi `returned`/`rejected` (không lý do) + `stage_decided` (feedback bị lược vì đi theo bằng chứng).
  test("nội bộ: sự kiện kết cục không có lý do ⇒ lý do lấy từ return_reason của hub; người = người quyết", () => {
    const events = [
      ev(1, "stage_decided", "2026-11-15T14:07:00Z", { action: "return", run_id: "r1" }, "truong"),
      ev(2, "returned", "2026-11-15T14:07:00Z", { run_id: "r1" }, "truong"),
    ];
    expect(lastDecision(events, "Điều 3 thiếu hạn thanh toán")).toMatchObject({
      action: "return",
      by: "truong",
      note: "Điều 3 thiếu hạn thanh toán",
      viaPartner: false,
    });
  });
  test("nội bộ: Từ chối cũng hiện lý do", () => {
    const events = [
      ev(1, "stage_decided", "2026-11-15T14:07:00Z", { action: "reject" }, "truong"),
      ev(2, "rejected", "2026-11-15T14:07:00Z", {}, "truong"),
    ];
    expect(lastDecision(events, "Không phù hợp chính sách")).toMatchObject({
      action: "reject",
      note: "Không phù hợp chính sách",
    });
  });
  test("lý do người duyệt nhập (feedback trong sự kiện) thắng return_reason", () => {
    const events = [
      ev(1, "stage_decided", "2026-11-15T14:07:00Z", { action: "return", feedback: "A" }),
    ];
    expect(lastDecision(events, "B")?.note).toBe("A");
  });
  test("đối tác trả lại: người = đối tác (không lộ người bên kia), lý do = lý do đối tác nêu, không lấy return_reason cũ", () => {
    const events = [
      ev(1, "stage_decided", "2026-11-10T08:00:00Z", { action: "return" }, "truong"),
      ev(2, "returned", "2026-11-10T08:00:00Z", {}, "truong"),
      ev(3, "partner_sent", "2026-11-14T08:00:00Z", { round: 2, to: "Công ty E" }, "hoa"),
      ev(
        4,
        "partner_replied",
        "2026-11-15T14:08:00Z",
        { round: 2, outcome: "returned", reason: "Giá trị chưa khớp báo giá" },
        null as never,
      ),
      ev(5, "returned", "2026-11-15T14:08:00Z", {}, "ai-do"),
    ];
    expect(lastDecision(events, "lý do cũ của vòng trước")).toMatchObject({
      action: "return",
      viaPartner: true,
      partnerName: "Công ty E",
      note: "Giá trị chưa khớp báo giá",
    });
  });
  test("đối tác từ chối ⇒ action reject, lý do đối tác", () => {
    const events = [
      ev(
        1,
        "partner_replied",
        "2026-11-15T14:08:00Z",
        { outcome: "declined", reason: "Phạt quá cao" },
        null as never,
      ),
      ev(2, "rejected", "2026-11-15T14:08:00Z", {}, "ai-do"),
    ];
    expect(lastDecision(events)).toMatchObject({
      action: "reject",
      viaPartner: true,
      note: "Phạt quá cao",
    });
  });
  test("không ăn lý do của vòng cũ: kết cục mới không có nguồn ⇒ không mượn partner_replied cũ", () => {
    const events = [
      ev(
        1,
        "partner_replied",
        "2026-11-10T08:00:00Z",
        { outcome: "returned", reason: "cũ" },
        null as never,
      ),
      ev(2, "returned", "2026-11-10T08:00:00Z", {}, "x"),
      ev(3, "returned", "2026-11-15T08:00:00Z", {}, "truong"),
    ];
    expect(lastDecision(events)).toMatchObject({ viaPartner: false, by: "truong", note: null });
  });
});
