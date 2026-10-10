// CHAT-AC-55 · PF3: ánh xạ thuần của DM "Quy trình".
import { describe, expect, test } from "bun:test";
import { ALL_NOTICE_KINDS, dayKey, noticeHasTask, noticeTitleKey, todoKindKey } from "./notice";

describe("notice", () => {
  test("mọi NoticeKind có khoá tiêu đề process.inbox.notice.*", () => {
    for (const k of ALL_NOTICE_KINDS) {
      expect(noticeTitleKey(k)).toBe(`process.inbox.notice.${k}`);
    }
  });

  test("todoKindKey theo TaskKind", () => {
    expect(todoKindKey("review")).toBe("process.inbox.kind.review");
    expect(todoKindKey("ask")).toBe("process.inbox.kind.ask");
    expect(todoKindKey("decision")).toBe("process.inbox.kind.decision");
  });

  test("noticeHasTask: kind gắn việc + có task_id", () => {
    expect(noticeHasTask({ kind: "review_requested", task_id: "t1" })).toBe(true);
    expect(noticeHasTask({ kind: "ask_requested", task_id: "t1" })).toBe(true);
    expect(noticeHasTask({ kind: "decision_requested", task_id: "t1" })).toBe(true);
    expect(noticeHasTask({ kind: "reminder", task_id: "t1" })).toBe(true);
    // Không gắn việc hoặc thiếu task_id ⇒ false.
    expect(noticeHasTask({ kind: "run_finished", task_id: null })).toBe(false);
    expect(noticeHasTask({ kind: "task_closed", task_id: "t1" })).toBe(false);
    expect(noticeHasTask({ kind: "review_requested", task_id: null })).toBe(false);
  });

  test("dayKey: nhóm theo ngày địa phương", () => {
    const a = dayKey("2026-10-10T23:30:00.000Z");
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Cùng ngày ⇒ cùng khoá; khác ngày ⇒ khác.
    const base = new Date("2026-10-10T08:00:00.000Z").toISOString();
    const same = new Date("2026-10-10T09:00:00.000Z").toISOString();
    const next = new Date("2026-10-12T08:00:00.000Z").toISOString();
    expect(dayKey(base)).toBe(dayKey(same));
    expect(dayKey(base)).not.toBe(dayKey(next));
  });
});
