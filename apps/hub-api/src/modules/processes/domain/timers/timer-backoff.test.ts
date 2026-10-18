// HUB-FR-144 · review T12 #4: lùi giờ hẹn bắn lỗi (nhân đôi, kẹp 1 phút … 1 giờ).
import { describe, expect, it } from "bun:test";
import { failedTimerDueAt } from "./timer.rules";

const NOW = new Date("2026-11-17T02:00:00Z");
const minus = (ms: number) => new Date(NOW.getTime() - ms);

describe("failedTimerDueAt", () => {
  it("lỗi đầu (trễ ~0) ⇒ +1 phút", () => {
    expect(failedTimerDueAt(NOW, NOW).getTime() - NOW.getTime()).toBe(60_000);
  });
  it("mỗi lần lỗi lại nhân đôi", () => {
    const d1 = failedTimerDueAt(minus(60_000), NOW).getTime() - NOW.getTime();
    const d2 = failedTimerDueAt(minus(120_000), NOW).getTime() - NOW.getTime();
    expect([d1, d2]).toEqual([120_000, 240_000]);
  });
  it("kẹp 1 giờ; due_at tương lai (lệch đồng hồ) ⇒ vẫn +1 phút", () => {
    expect(failedTimerDueAt(minus(10 * 3_600_000), NOW).getTime() - NOW.getTime()).toBe(3_600_000);
    expect(failedTimerDueAt(new Date(NOW.getTime() + 5000), NOW).getTime() - NOW.getTime()).toBe(
      60_000,
    );
  });
});
