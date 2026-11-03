// CR-113 (review #1) · "duyệt thay" ghi write-ahead TRƯỚC khi engine nhận quyết: ghi lỗi ⇒ KHÔNG gọi engine (không có quyết duyệt
// thay thiếu audit); Đạt / Từ chối / Trả lại đều ghi (kèm hành động); người của bước (không cờ override) ⇒ không ghi.
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "../domain/approval-flow.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEnginePort, OverrideEvent } from "./approval-engine.ports";
import { engineAct } from "./approval-engine-card.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const AID = "00000000-0000-4000-8000-0000000000d1";
const RUN = "00000000-0000-4000-8000-0000000000e1";
const who = { tenantId: T, userId: U };
const step = (key: string): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: "g",
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  }) as FlowStep;
const state = (): ApprovalState => ({
  runId: AID,
  status: "needs_review",
  hasSource: true,
  version: 1,
  approval: {
    id: AID,
    status: "level1",
    startedBy: "someone-else",
    feedback: null,
    mode: "engine",
    engineRunId: RUN,
    flowSteps: [step("a"), step("b")],
  },
  value: 10,
  deal: "buy",
  threshold: 1000,
});
const st = (key: string, open: boolean, override: boolean) => ({
  key,
  status: open ? "open" : "passed",
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  result: null,
  idx: 0,
  name: key,
  group_id: null,
  task: open ? { id: `t-${key}`, can_act: true, ...(override ? { override: true } : {}) } : null,
});

function setup(
  o: {
    open?: "s0" | "s1";
    override?: boolean;
    fail?: boolean;
    engine?: "ok" | "not_open" | "throw";
  } = {},
) {
  const calls: string[] = [];
  const open = o.open ?? "s0";
  const port = {
    stepsView: async () => ({
      run_id: RUN,
      status: "waiting_review",
      started_by: "someone-else",
      steps: [
        st("s0", open === "s0", o.override ?? true),
        st("route", false, false),
        st("s1", open === "s1", o.override ?? true),
      ],
    }),
    act: async (_u: unknown, _r: string, _at: unknown, b: { result: string }) => {
      calls.push(`act:${b.result}`);
      if (o.engine === "throw") throw new Error("engine down");
      return o.engine === "not_open" ? ("not_open" as const) : ("ok" as const);
    },
  } as unknown as ApprovalEnginePort;
  const repos = {
    approval: {
      markRejected: async () => {
        calls.push("markRejected");
        return true;
      },
      markExtracting: async () => true,
      state: async () => state(),
    },
    approvalEngine: {
      setPendingLinks: async () => {
        calls.push("links");
        return true;
      },
      recordOverride: async (_c: string, _a: string, e: OverrideEvent) => {
        if (o.fail) throw new Error("db down");
        calls.push(`override:${e.stageKey}:${e.action}:${e.taskId}`);
        return "ev1";
      },
      voidOverride: async (id: string) => {
        calls.push(`void:${id}`);
        return true;
      },
    },
    outbox: { enqueue: async () => undefined },
  };
  const d = {
    port: () => port,
    uow: { tenant: async <X>(_w: unknown, fn: (r: typeof repos) => Promise<X>) => fn(repos) },
    jobs: { enqueue: async () => undefined },
  };
  return { d, calls };
}

describe("CR-113 · duyệt thay write-ahead", () => {
  it("Đạt (duyệt cuối) ⇒ ghi duyệt thay TRƯỚC giữ chỗ SP + act", async () => {
    const { d, calls } = setup({ open: "s1" });
    expect(await engineAct(d)(who, C, { action: "approve" }, state())).toBe("ok");
    expect(calls).toEqual(["override:s1:approve:t-s1", "links", "act:pass"]);
  });

  it("Từ chối / Trả lại cũng ghi duyệt thay (kèm hành động)", async () => {
    const r = setup();
    await engineAct(r.d)(who, C, { action: "reject", feedback: "sai" }, state());
    expect(r.calls).toEqual(["override:s0:reject:t-s0", "act:reject", "markRejected"]);
    const b = setup({ open: "s1" });
    await engineAct(b.d)(who, C, { action: "return", feedback: "sửa" }, state());
    expect(b.calls).toEqual(["override:s1:return:t-s1", "act:fail"]);
  });

  it("recordOverride ném ⇒ lỗi lan ra, KHÔNG gọi engine (không quyết thiếu audit)", async () => {
    const { d, calls } = setup({ fail: true });
    await expect(engineAct(d)(who, C, { action: "approve" }, state())).rejects.toThrow("db down");
    expect(calls).toEqual([]);
  });

  it("engine không nhận (not_open / ném) ⇒ bù trừ: xoá đúng bản ghi vừa chèn", async () => {
    const a = setup({ engine: "not_open", open: "s1" });
    expect(await engineAct(a.d)(who, C, { action: "return", feedback: "x" }, state())).toEqual({
      error: "APPROVAL_NOT_OPEN",
    });
    expect(a.calls).toEqual(["override:s1:return:t-s1", "act:fail", "void:ev1"]);
    const b = setup({ engine: "throw" });
    await expect(engineAct(b.d)(who, C, { action: "approve" }, state())).rejects.toThrow(
      "engine down",
    );
    expect(b.calls).toEqual(["override:s0:approve:t-s0", "act:pass", "void:ev1"]);
  });

  it("người của bước (không cờ override) ⇒ không ghi", async () => {
    const { d, calls } = setup({ override: false, open: "s1" });
    await engineAct(d)(who, C, { action: "approve" }, state());
    expect(calls).toEqual(["links", "act:pass"]);
  });
});
