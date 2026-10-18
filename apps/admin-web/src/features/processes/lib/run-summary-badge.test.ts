// HUB-FR-146 · P-d2 · UAT B-D2-3: huy hiệu run ở DANH SÁCH (ProcessRunSummary) cùng luật với chi tiết (`runBadgeStatus`).
import { describe, expect, it } from "bun:test";
import { runSummaryBadgeStatus } from "./stage-label";

const T = "2026-11-17T02:00:00.000Z";

describe("runSummaryBadgeStatus (B-D2-3)", () => {
  it("waiting_timer chỉ có retry_at ⇒ running", () => {
    expect(runSummaryBadgeStatus({ status: "waiting_timer", retry_at: T })).toBe("running");
  });
  it("waiting_timer có wait_until ⇒ giữ waiting_timer (kể cả có retry_at)", () => {
    expect(runSummaryBadgeStatus({ status: "waiting_timer", wait_until: T })).toBe("waiting_timer");
    expect(runSummaryBadgeStatus({ status: "waiting_timer", wait_until: T, retry_at: T })).toBe(
      "waiting_timer",
    );
  });
  it("waiting_timer không hẹn nào / trạng thái khác ⇒ giữ nguyên", () => {
    expect(runSummaryBadgeStatus({ status: "waiting_timer" })).toBe("waiting_timer");
    expect(runSummaryBadgeStatus({ status: "waiting_review", retry_at: T })).toBe("waiting_review");
  });
});
