// contract-flow S3b · luật thuần thẻ duyệt engine: ghép stage ↔ bước người dùng, bước mở/task/can_act, finalizes_on_approve, lý do bị
// chặn, kế hoạch hành động (Đạt / Trả lại / Từ chối / Đọc lại) + version def + đồng bộ run kết thúc (reconcile).
import { describe, expect, it } from "bun:test";
import { engineDefVersion, factsOf, reconcileOf } from "./approval-engine.rules";
import {
  type EngineCardInput,
  type EngineStageView,
  engineCardView,
  planEngineAct,
} from "./approval-engine-card.rules";
import type { FlowStep } from "./approval-flow.rules";
import type { FlowWhen } from "./approval-flow.types";

const G = "00000000-0000-4000-8000-0000000000a1";
const ME = "00000000-0000-4000-8000-0000000000b1";
const STARTER = "00000000-0000-4000-8000-0000000000b2";
const review = (key: string, o: Partial<FlowStep> = {}): FlowStep =>
  ({
    kind: "review",
    key,
    name: `Bước ${key}`,
    department_group_id: G,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
    ...o,
  }) as FlowStep;
const BIG: FlowWhen = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1000 }] };
const FLOW = [review("a"), review("b", { when: BIG, exclude_starter: true })];

const stage = (key: string, status: EngineStageView["status"], task = false, can = true) =>
  ({
    key,
    status,
    escalated_group_id: null,
    due_at: null,
    escalated: false,
    decided_by: null,
    decided_at: null,
    feedback: null,
    task: task ? { id: `t-${key}`, can_act: can } : null,
  }) satisfies EngineStageView;

const input = (
  o: Partial<EngineCardInput> & { open?: string; can?: boolean } = {},
): EngineCardInput => ({
  approval: { id: "ap", status: "level1", startedBy: STARTER, feedback: null },
  flow: FLOW,
  facts: factsOf("buy", 10),
  sv: {
    status: "waiting_review",
    started_by: STARTER,
    steps: [
      stage("s0", o.open === "s0" ? "open" : "passed", o.open === "s0", o.can ?? true),
      stage("route", "passed"),
      stage("s1", o.open === "s1" ? "open" : "pending", o.open === "s1", o.can ?? true),
      stage("finalize", "pending"),
    ],
  },
  viewerId: ME,
  ...("open" in o ? {} : {}),
});

describe("engineCardView", () => {
  it("chỉ bước người dùng (s0, s1), bỏ route/finalize; bước mở + task + can_act", () => {
    const v = engineCardView(input({ open: "s0" }));
    expect(v.mode).toBe("engine");
    expect(v.steps.map((s) => [s.idx, s.key, s.status])).toEqual([
      [0, "a", "open"],
      [1, "b", "pending"],
    ]);
    expect([v.task_id, v.can_act, v.block_reason]).toEqual(["t-s0", true, null]);
    expect(v.step).toBe("level1");
  });
  it("finalizes_on_approve: dưới ngưỡng ở s0 ⇒ true; trên ngưỡng ⇒ false; không quyền ⇒ false", () => {
    expect(engineCardView(input({ open: "s0" })).finalizes_on_approve).toBe(true);
    const big = { ...input({ open: "s0" }), facts: factsOf("buy", 5000) };
    expect(engineCardView(big).finalizes_on_approve).toBe(false);
    expect(engineCardView(input({ open: "s0", can: false })).finalizes_on_approve).toBe(false);
  });
  it("người xem không quyết được: block_reason not_reviewer; người bắt đầu ở bước exclude_starter ⇒ starter", () => {
    expect(engineCardView(input({ open: "s0", can: false })).block_reason).toBe("not_reviewer");
    const me = { ...input({ open: "s1", can: false }), viewerId: STARTER };
    expect(engineCardView(me).block_reason).toBe("starter");
  });
  it("lượt đã đóng hoặc không có run ⇒ không task, không can_act; thiếu stage ⇒ pending", () => {
    const done = { ...input({ open: "s0" }), approval: { ...input().approval, status: "done" } };
    expect(engineCardView(done)).toMatchObject({ task_id: null, can_act: false, step: "done" });
    const none = engineCardView({ ...input(), sv: null });
    expect(none.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
    expect(none.run_status).toBeNull();
  });
});

describe("planEngineAct", () => {
  const plan = (
    action: "approve" | "reject" | "redo" | "return",
    extra: object = {},
    open = "s0",
  ) =>
    planEngineAct({
      ...input({ open }),
      action,
      feedback: "lý do",
      hasSource: true,
      ...extra,
    });
  it("Đạt ⇒ pass (kèm cờ duyệt cuối)", () => {
    expect(plan("approve")).toEqual({ kind: "pass", taskId: "t-s0", finalizes: true });
  });
  it("Trả lại: chỉ từ bước ≥ 1; ở bước soạn ⇒ APPROVAL_NOT_OPEN; cần lý do", () => {
    expect(plan("return", {}, "s1")).toEqual({ kind: "fail_back", taskId: "t-s1" });
    expect(plan("return")).toEqual({ kind: "error", code: "APPROVAL_NOT_OPEN" });
    expect(plan("return", { feedback: " " }, "s1")).toEqual({
      kind: "error",
      code: "FEEDBACK_REQUIRED",
    });
  });
  it("Từ chối / Đọc lại cần lý do; Đọc lại không nguồn ⇒ không trích lại", () => {
    expect(plan("reject", { feedback: undefined })).toEqual({
      kind: "error",
      code: "FEEDBACK_REQUIRED",
    });
    expect(plan("reject")).toEqual({ kind: "reject", taskId: "t-s0" });
    expect(plan("redo", { hasSource: false })).toEqual({
      kind: "redo",
      taskId: "t-s0",
      reextract: false,
    });
  });
  it("chặn: không bước mở / không quyền (starter hay không)", () => {
    expect(
      planEngineAct({ ...input(), action: "approve", feedback: null, hasSource: true }),
    ).toEqual({
      kind: "error",
      code: "APPROVAL_NOT_OPEN",
    });
    const no = { ...input({ open: "s0", can: false }), viewerId: ME };
    expect(planEngineAct({ ...no, action: "approve", feedback: null, hasSource: true })).toEqual({
      kind: "error",
      code: "NOT_REVIEWER",
    });
    const st = { ...input({ open: "s1", can: false }), viewerId: STARTER };
    expect(planEngineAct({ ...st, action: "approve", feedback: null, hasSource: true })).toEqual({
      kind: "error",
      code: "STARTER_CANNOT_REVIEW",
    });
  });
});

describe("engineDefVersion · reconcileOf", () => {
  it("mẫu lưu luôn lớn hơn mọi mẫu mặc định; mặc định tăng theo rev", () => {
    const d = (rev: number) => engineDefVersion({ version: 1, isDefault: true }, rev);
    expect([d(0), d(5)]).toEqual([1, 6]);
    expect(engineDefVersion({ version: 2, isDefault: false }, 99)).toBeGreaterThan(d(5_000_000));
  });
  it("run kết thúc ⇒ đồng bộ; còn chạy ⇒ không làm gì", () => {
    const o = (status: string, rejected = false, feedback: string | null = null) => ({
      status,
      rejected,
      feedback,
    });
    expect(reconcileOf(o("waiting_review"))).toEqual({ kind: "none" });
    expect(reconcileOf(o("cancelled", true, "sai giá"))).toEqual({
      kind: "reject",
      feedback: "sai giá",
    });
    expect(reconcileOf(o("failed"))).toEqual({ kind: "release", reason: "ENGINE_RUN_FAILED" });
    expect(reconcileOf(o("cancelled"))).toEqual({
      kind: "release",
      reason: "ENGINE_RUN_CANCELLED",
    });
    expect(reconcileOf(undefined)).toEqual({ kind: "release", reason: "ENGINE_RUN_MISSING" });
  });
});
