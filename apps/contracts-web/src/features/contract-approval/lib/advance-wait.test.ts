// CR-107 · eng-card-ui: backoff lưới an toàn + lọc sự kiện push theo run.
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts";
import { ADVANCE_MAX_TRIES, advanceDelay, eventConcernsRun, shouldListen } from "./advance-wait";

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("advanceDelay", () => {
  test("2 · 4 · 8 · 16 · 30 s (trần), dừng sau 10 lần", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(advanceDelay)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(advanceDelay(ADVANCE_MAX_TRIES)).toBe(false);
    expect(advanceDelay(99)).toBe(false);
  });
});

describe("eventConcernsRun", () => {
  const upd = (id: string) =>
    ({
      event: "process.updated",
      data: { process_run_id: id, status: "running", stage_idx: 0 },
    }) as never;
  const task = (id: string) =>
    ({
      event: "review_task.created",
      data: { task_id: OTHER, kind: "review", process_run_id: id },
    }) as never;
  test("đúng run ⇒ true; run khác / không có run ⇒ false", () => {
    expect(eventConcernsRun(upd(RUN), RUN)).toBe(true);
    expect(eventConcernsRun(task(RUN), RUN)).toBe(true);
    expect(eventConcernsRun(upd(OTHER), RUN)).toBe(false);
    expect(eventConcernsRun(task(OTHER), RUN)).toBe(false);
    expect(eventConcernsRun(upd(RUN), null)).toBe(false);
  });
  test("review_task.closed không mang run ⇒ false", () => {
    const closed = {
      event: "review_task.closed",
      data: { task_id: OTHER, result: "approved" },
    } as never;
    expect(eventConcernsRun(closed, RUN)).toBe(false);
  });
});

describe("shouldListen", () => {
  test("chỉ lượt engine cấp 1 có run", () => {
    const a = { mode: "engine", step: "level1", run_id: RUN } as ContractApproval;
    expect(shouldListen(a)).toBe(true);
    expect(shouldListen({ ...a, run_id: null })).toBe(false);
    expect(shouldListen({ ...a, mode: "machine" })).toBe(false);
    expect(shouldListen(undefined)).toBe(false);
  });
});
