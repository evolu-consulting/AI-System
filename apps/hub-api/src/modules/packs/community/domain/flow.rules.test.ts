// CR-120 · cr120-community-flows · unit cho máy trạng thái 3 khe Community (luật thuần).
import { describe, expect, it } from "bun:test";
import {
  afterScreen,
  awaitingReview,
  decideJoin,
  decideModeration,
  decideReport,
  type ModRow,
  parseScreen,
  parseTriage,
  REMIND_H,
  reviewClock,
  SCREEN_STALE_MS,
  screenPrompt,
  triagePrompt,
} from "./flow.rules";

const T0 = Date.parse("2026-11-05T00:00:00Z");
const pend = (mod_screen: ModRow["mod_screen"], at = new Date(T0).toISOString()): ModRow => ({
  moderation: "pending",
  mod_screen,
  mod_at: at,
});

describe("parseScreen / parseTriage: kết quả agent là DỮ LIỆU", () => {
  it("nhận JSON đúng hình (kể cả bọc ```json), sai hình ⇒ null", () => {
    expect(parseScreen('{"flagged":true,"reason":" spam "}')).toEqual({
      flagged: true,
      reason: "spam",
    });
    expect(parseScreen('```json\n{"flagged":false}\n```')).toEqual({
      flagged: false,
      reason: null,
    });
    expect(parseScreen('{"flagged":"yes"}')).toBeNull();
    expect(parseScreen("không phải json")).toBeNull();
    expect(parseScreen("[1,2]")).toBeNull();
    expect(
      parseScreen('{"flagged":true,"reason":"' + "x".repeat(2000) + '"}')?.reason,
    ).toHaveLength(1000);
  });
  it("triage: kind/level ngoài tập ⇒ null", () => {
    expect(parseTriage('{"kind":"spam","level":"high"}')).toEqual({ kind: "spam", level: "high" });
    expect(parseTriage('{"kind":"hack","level":"high"}')).toBeNull();
    expect(parseTriage('{"kind":"spam","level":"extreme"}')).toBeNull();
    expect(parseTriage('{"kind":"spam"}')).toBeNull();
  });
});

describe("afterScreen: lỗi/hết hạn không tự đăng", () => {
  it("sạch ⇒ approved, gắn cờ ⇒ pending, lỗi (null) ⇒ pending + error", () => {
    expect(afterScreen({ flagged: false, reason: null })).toEqual({
      moderation: "approved",
      screen: "clean",
    });
    expect(afterScreen({ flagged: true, reason: "x" })).toEqual({
      moderation: "pending",
      screen: "flagged",
    });
    expect(afterScreen(null)).toEqual({ moderation: "pending", screen: "error" });
  });
});

describe("awaitingReview", () => {
  it("flagged/error ⇒ chờ duyệt, running chỉ khi quá SCREEN_STALE_MS, khác ⇒ không", () => {
    expect(awaitingReview(pend("flagged"), T0)).toBe(true);
    expect(awaitingReview(pend("error"), T0)).toBe(true);
    expect(awaitingReview(pend("running"), T0 + SCREEN_STALE_MS)).toBe(false);
    expect(awaitingReview(pend("running"), T0 + SCREEN_STALE_MS + 1)).toBe(true);
    expect(awaitingReview({ moderation: "approved", mod_screen: "clean", mod_at: null }, T0)).toBe(
      false,
    );
    expect(awaitingReview({ moderation: "none", mod_screen: null, mod_at: null }, T0)).toBe(false);
  });
  it("CR-122 P13 · pending + không screen (flow đã mở lượt) ⇒ chờ người duyệt ngay, không đợi quá hạn", () => {
    expect(awaitingReview({ moderation: "pending", mod_screen: null, mod_at: null }, T0)).toBe(
      true,
    );
  });
});

describe("decideModeration", () => {
  const o = { reviewer: true, now: T0 };
  it("approve/reject khi đang chờ duyệt", () => {
    expect(decideModeration(pend("flagged"), "approve", o)).toBe("approved");
    expect(decideModeration(pend("error"), "reject", o)).toBe("rejected");
  });
  it("không phải người duyệt ⇒ NOT_REVIEWER, chưa mở (screen đang chạy) ⇒ NOT_OPEN, hành động lạ ⇒ ACTION_UNKNOWN", () => {
    expect(decideModeration(pend("flagged"), "approve", { ...o, reviewer: false })).toBe(
      "NOT_REVIEWER",
    );
    expect(decideModeration(pend("running"), "approve", o)).toBe("NOT_OPEN");
    expect(decideModeration(pend("flagged"), "hide", o)).toBe("ACTION_UNKNOWN");
  });
  it("đã quyết rồi ⇒ NOT_OPEN (không quyết lại)", () => {
    const done: ModRow = { moderation: "approved", mod_screen: "flagged", mod_at: null };
    expect(decideModeration(done, "reject", o)).toBe("NOT_OPEN");
  });
});

describe("decideJoin / decideReport", () => {
  it("join: pending ⇒ approved/rejected, đã quyết ⇒ NOT_OPEN, đối tác ⇒ NOT_REVIEWER", () => {
    expect(decideJoin("pending", "approve", { reviewer: true })).toBe("approved");
    expect(decideJoin("pending", "reject", { reviewer: true })).toBe("rejected");
    expect(decideJoin("approved", "reject", { reviewer: true })).toBe("NOT_OPEN");
    expect(decideJoin("pending", "approve", { reviewer: false })).toBe("NOT_REVIEWER");
    expect(decideJoin("pending", "hide", { reviewer: true })).toBe("ACTION_UNKNOWN");
  });
  it("report: hide/warn/dismiss khi pending, còn lại như trên", () => {
    for (const a of ["hide", "warn", "dismiss"] as const)
      expect(decideReport("pending", a, { reviewer: true })).toBe(a);
    expect(decideReport("resolved", "hide", { reviewer: true })).toBe("NOT_OPEN");
    expect(decideReport("pending", "hide", { reviewer: false })).toBe("NOT_REVIEWER");
    expect(decideReport("pending", "approve", { reviewer: true })).toBe("ACTION_UNKNOWN");
  });
});

describe("reviewClock", () => {
  it("nhắc 24 h, chuyển cấp 48 h, không mốc ⇒ không hạn", () => {
    const at = new Date(T0).toISOString();
    const h = 3_600_000;
    expect(reviewClock(null, T0)).toEqual({ due_at: null, overdue: false, escalated: false });
    const early = reviewClock(at, T0 + 1 * h);
    expect(early.overdue).toBe(false);
    expect(early.due_at).toBe(new Date(T0 + REMIND_H * h).toISOString());
    expect(reviewClock(at, T0 + 25 * h)).toMatchObject({ overdue: true, escalated: false });
    expect(reviewClock(at, T0 + 49 * h)).toMatchObject({ overdue: true, escalated: true });
  });
});

describe("prompt gửi agent: dữ liệu JSON, cắt độ dài", () => {
  it("không nối chuỗi chỉ dẫn, cắt title 400 / body 4000", () => {
    const p = JSON.parse(screenPrompt({ title: "t".repeat(900), body: "b".repeat(9000) }));
    expect(p.title).toHaveLength(400);
    expect(p.body).toHaveLength(4000);
    const q = JSON.parse(triagePrompt({ reason: "r".repeat(2000), title: "t", body: "b" }));
    expect(q.report).toHaveLength(1000);
    expect(q.post).toEqual({ title: "t", body: "b" });
  });
});
