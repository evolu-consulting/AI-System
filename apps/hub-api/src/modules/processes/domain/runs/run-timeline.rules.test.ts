// CR-121 · R-2 · unit: dựng dòng thời gian (thứ tự, từng loại sự kiện, trần) + điều kiện rẽ nhánh khớp.
import { describe, expect, it } from "bun:test";
import {
  buildTimeline,
  conditionsOf,
  type TlEvent,
  type TlRun,
  type TlStage,
} from "./run-timeline.rules";

const T = (s: number) => new Date(Date.UTC(2026, 10, 5, 8, 0, s)).toISOString();
const who = { id: "u1", display_name: "Lan" };
const run: TlRun = {
  startedAt: T(0),
  finishedAt: null,
  status: "running",
  startedBy: who,
  processName: "Hoá đơn",
};
const stage = (idx: number, o: Partial<TlStage> = {}): TlStage => ({
  idx,
  name: `B${idx + 1}`,
  status: "pending",
  startedAt: null,
  finishedAt: null,
  updatedAt: T(0),
  lastErrorCode: null,
  ...o,
});
const ev = (o: Partial<TlEvent> & Pick<TlEvent, "src" | "at">): TlEvent => ({
  stageIdx: 0,
  sub: null,
  sub2: null,
  actor: null,
  a: null,
  b: null,
  ...o,
});

describe("buildTimeline", () => {
  it("bắt đầu → bước chạy/xong → kết thúc, tăng dần theo mốc", () => {
    const tl = buildTimeline(
      { ...run, finishedAt: T(30), status: "done" },
      [stage(0, { status: "done", startedAt: T(1), finishedAt: T(10) })],
      [],
    );
    expect(tl.map((t) => t.kind)).toEqual(["started", "step_started", "step_done", "finished"]);
    expect(tl[0]?.text.vi).toContain("Lan");
    expect(tl[0]?.actor).toEqual(who);
  });

  it("gom đủ loại sự kiện: nhắc, chuyển cấp, thử lại, quyết định, rẽ nhánh, quay lại, dừng/chạy lại", () => {
    const events: TlEvent[] = [
      ev({ src: "task_open", at: T(2), sub: "review" }),
      ev({ src: "task_remind", at: T(3), sub: "review", a: 2 }),
      ev({ src: "task_escalate", at: T(4), sub: "review" }),
      ev({ src: "timer_retry", at: T(5) }),
      ev({ src: "task_open", at: T(6), sub: "decision" }),
      ev({ src: "task_close", at: T(7), sub: "decision", sub2: "add_attempt", actor: who }),
      ev({ src: "task_close", at: T(8), sub: "review", sub2: "reject", actor: who }),
      ev({ src: "audit", at: T(9), sub: "branch", a: 2, b: 3 }),
      ev({ src: "back", at: T(10), a: 0, b: 2, actor: who }),
      ev({ src: "audit", at: T(11), sub: "cancel", actor: who }),
      ev({ src: "audit", at: T(12), sub: "resume" }),
      ev({ src: "audit", at: T(13), sub: "rerun" }),
      ev({ src: "audit", at: T(14), sub: "view" }), // không thuộc dòng thời gian
    ];
    const tl = buildTimeline(run, [stage(0)], events);
    expect(tl.map((t) => t.kind)).toEqual([
      "started",
      "review",
      "reminder",
      "escalate",
      "retry",
      "decision_requested",
      "decision",
      "review",
      "branch",
      "back",
      "stopped",
      "resumed",
      "rerun",
    ]);
    expect(tl.find((t) => t.kind === "reminder")?.text.vi).toContain("lần 2");
    expect(tl.find((t) => t.kind === "branch")?.text.vi).toContain("luật 2");
    expect(tl.find((t) => t.kind === "branch")?.text.vi).toContain("bước 4");
    expect(tl.find((t) => t.kind === "decision")?.text.en).toContain("another attempt");
    expect(tl.find((t) => t.kind === "decision")?.actor).toEqual(who);
  });

  it("bước lỗi có câu dễ hiểu, bước bỏ qua có mục riêng; cùng mốc giữ thứ tự bắt đầu → kết thúc", () => {
    const tl = buildTimeline(
      run,
      [
        stage(0, { status: "failed", startedAt: T(1), finishedAt: T(1), lastErrorCode: "TIMEOUT" }),
        stage(1, { status: "skipped", finishedAt: T(2) }),
      ],
      [],
    );
    expect(tl.map((t) => t.kind)).toEqual(["started", "step_started", "error", "step_skipped"]);
    expect(tl[2]?.text.vi).not.toContain("TIMEOUT");
  });

  it("trần 200 mục", () => {
    const many = Array.from({ length: 300 }, (_, i) => ev({ src: "timer_retry", at: T(i % 59) }));
    expect(buildTimeline(run, [stage(0)], many)).toHaveLength(200);
  });
});

describe("conditionsOf", () => {
  const branch = [
    { field: "amount", op: "gt", value: 100, goto_step: 2 },
    { field: "kind", op: "eq", value: "a", goto_step: 3 },
    { field: 5, op: "eq", value: 1, goto_step: 3 }, // sai kiểu ⇒ bỏ
  ];
  it("đánh dấu luật đã khớp (1-based)", () => {
    const c = conditionsOf(branch, new Set([2]));
    expect(c.map((x) => [x.rule, x.matched])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(c[0]).toMatchObject({ field: "amount", op: "gt", value: 100, goto_step: 2 });
  });
  it("không phải mảng ⇒ rỗng", () => {
    expect(conditionsOf(undefined, new Set())).toEqual([]);
  });
});
