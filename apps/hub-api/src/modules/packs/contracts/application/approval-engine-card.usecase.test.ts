// contract-flow S3b · use case thẻ + hành động engine với cổng giả: Đạt (duyệt cuối lưu pending_links TRƯỚC act), Trả lại (fail + về
// bước 0), Từ chối (reject + HĐ rejected), Đọc lại (huỷ run ⇒ extracting + job), đã có người quyết trước ⇒ APPROVAL_NOT_OPEN.
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "../domain/approval-flow.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEnginePort, PendingLinksOp } from "./approval-engine.ports";
import { engineAct, engineView } from "./approval-engine-card.usecase";

const T = "00000000-0000-4000-8000-0000000000a1";
const U = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const AID = "00000000-0000-4000-8000-0000000000d1";
const RUN = "00000000-0000-4000-8000-0000000000e1";
const G = "00000000-0000-4000-8000-0000000000f1";
const who = { tenantId: T, userId: U };
const BIG = { op: "and", conds: [{ field: "total_value", op: "ge", value: 1000 }] };
const step = (key: string): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: G,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  }) as FlowStep;
const state = (o: Partial<ApprovalState> = {}): ApprovalState => ({
  runId: AID,
  status: "needs_review",
  hasSource: true,
  version: 1,
  approval: {
    id: AID,
    status: "level1",
    startedBy: U,
    feedback: null,
    mode: "engine",
    engineRunId: RUN,
    flowSteps: [step("a"), { ...step("b"), when: BIG } as FlowStep],
  },
  value: 10,
  deal: "buy",
  threshold: 1000,
  ...o,
});
const st = (key: string, status: string, task = false) => ({
  key,
  status,
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
  task: task ? { id: `t-${key}`, can_act: true } : null,
});
const view = (open: "s0" | "s1") => ({
  run_id: RUN,
  status: "waiting_review",
  started_by: U,
  steps: [
    st("s0", open === "s0" ? "open" : "passed", open === "s0"),
    st("route", "passed"),
    st("s1", open === "s1" ? "open" : "pending", open === "s1"),
    st("finalize", "pending"),
  ],
});

function setup(
  o: {
    open?: "s0" | "s1";
    act?: "ok" | "not_open";
    ready?: boolean;
    held?: boolean;
    outside?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const ops: PendingLinksOp[] = [];
  const port = {
    stepsView: async () => view(o.open ?? "s0"),
    act: async (_u: unknown, _r: string, at: unknown, b: unknown) => {
      calls.push(`act:${JSON.stringify(at)}:${JSON.stringify(b)}`);
      return o.act ?? "ok";
    },
    cancelSys: async () => {
      calls.push("cancelSys");
      return true;
    },
  } as unknown as ApprovalEnginePort;
  const repos = {
    approval: {
      markRejected: async (_c: string, _a: string, e: { feedback: string | null }) => {
        calls.push(`markRejected:${e.feedback}`);
        return true;
      },
      markExtracting: async () => {
        calls.push("markExtracting");
        return true;
      },
      // CR-109 · khoá theo luật thấy cũ: người duyệt ngoài cây ⇒ null
      state: async () => (o.outside ? null : state()),
    },
    approvalEngine: {
      setPendingLinks: async (_a: string, _r: string, p: PendingLinksOp) => {
        ops.push(p);
        if ("release" in p) {
          calls.push("links:release");
          return true;
        }
        calls.push(`links:${p.links === null ? "null" : p.links.length}`);
        return !o.held; // CR-107 · người khác đang giữ task ⇒ giữ chỗ thất bại
      },
    },
    outbox: { enqueue: async () => void calls.push("outbox") },
  };
  const d = {
    port: () => port,
    uow: { tenant: async <X>(_w: unknown, fn: (r: typeof repos) => Promise<X>) => fn(repos) },
    jobs: { enqueue: async () => void calls.push("job") },
    redo: { ready: o.ready ?? true, quota: async () => void calls.push("quota") },
  };
  return { d, calls, ops };
}
const body = (action: "approve" | "reject" | "redo" | "return", extra = {}) => ({
  action,
  feedback: "lý do",
  ...extra,
});

describe("engineView", () => {
  it("2 bước, bước 0 mở: task + can_act + duyệt cuối (giá trị dưới ngưỡng)", async () => {
    const v = await engineView(setup().d)(who, state());
    expect(v).toMatchObject({ mode: "engine", can_act: true, task_id: "t-s0" });
    expect(v.finalizes_on_approve).toBe(true);
    expect(v.steps).toHaveLength(2);
  });
  it("CR-122 P18 · run dừng vì thiếu dữ kiện ⇒ attention nêu NHÃN trường (manifest), không lộ khoá", async () => {
    const { d } = setup();
    const decision = { reason: "missing_fact", at: null, missing: ["total_value"] };
    const sv = { ...view("s0"), status: "needs_decision", decision };
    const d2 = { ...d, port: () => ({ ...d.port(), stepsView: async () => sv }) as never };
    const v = await engineView(d2)(who, state());
    expect(v.attention).toEqual({
      kind: "needs_decision",
      reason: "missing_fact",
      since: null,
      missing: ["Giá trị hợp đồng"],
    });
  });
});

describe("engineAct", () => {
  it("Đạt duyệt cuối kèm SP ⇒ lưu pending_links TRƯỚC act pass", async () => {
    const { d, calls } = setup();
    const r = await engineAct(d)(who, C, body("approve", { products: [{}, {}] }), state());
    expect(r).toBe("ok");
    expect(calls).toEqual(["links:2", 'act:{"task_id":"t-s0"}:{"result":"pass"}']);
  });
  it("Đạt duyệt cuối KHÔNG kèm SP ⇒ ghi đè null (xoá SP sót); act not_open ⇒ xoá lại", async () => {
    const a = setup();
    await engineAct(a.d)(who, C, body("approve"), state());
    expect(a.calls).toEqual(["links:null", 'act:{"task_id":"t-s0"}:{"result":"pass"}']);
    const b = setup({ act: "not_open" });
    const r = await engineAct(b.d)(who, C, body("approve", { products: [{}] }), state());
    expect(r).toEqual({ error: "APPROVAL_NOT_OPEN" });
    expect(b.calls.filter((c) => c.startsWith("links:"))).toEqual(["links:1", "links:release"]);
  });
  it("CR-107 · trả chỗ đúng lần giữ và chặn khi người khác giữ (không act)", async () => {
    const a = setup({ act: "not_open" });
    await engineAct(a.d)(who, C, body("approve", { products: [{}] }), state());
    const [claim, rel] = a.ops;
    expect({ by: claim?.by, task: claim?.task }).toEqual({ by: U, task: "t-s0" });
    expect(rel).toEqual({ claim: claim?.claim, by: U, task: "t-s0", release: true } as never);
    const b = setup({ held: true });
    const r = await engineAct(b.d)(who, C, body("approve", { products: [{}] }), state());
    expect(r).toEqual({ error: "APPROVAL_NOT_OPEN" });
    expect(b.calls).toEqual(["links:1"]);
  });
  it("Đạt không phải bước cuối ⇒ bỏ products (không lưu)", async () => {
    const { d, calls } = setup();
    await engineAct(d)(who, C, body("approve", { products: [{}] }), state({ value: 5000 }));
    expect(calls).toEqual(['act:{"task_id":"t-s0"}:{"result":"pass"}']);
  });
  it("Trả lại ở bước 1 ⇒ fail + back_to_step 0", async () => {
    const { d, calls } = setup({ open: "s1" });
    expect(await engineAct(d)(who, C, body("return"), state())).toBe("ok");
    expect(calls).toEqual([
      'act:{"task_id":"t-s1"}:{"result":"fail","feedback":"lý do","back_to_step":0}',
    ]);
  });
  it("Từ chối ⇒ reject + HĐ rejected; thiếu lý do ⇒ FEEDBACK_REQUIRED, chưa gọi engine", async () => {
    const a = setup();
    expect(await engineAct(a.d)(who, C, body("reject"), state())).toBe("ok");
    expect(a.calls).toEqual([
      'act:{"task_id":"t-s0"}:{"result":"reject","feedback":"lý do"}',
      "markRejected:lý do",
    ]);
    const b = setup();
    const r = await engineAct(b.d)(who, C, { action: "reject" }, state());
    expect(r).toEqual({ error: "FEEDBACK_REQUIRED" });
    expect(b.calls).toEqual([]);
  });
  it("Đọc lại ⇒ quota, huỷ run, extracting + outbox, job; AI chưa sẵn sàng ⇒ unavailable (không huỷ)", async () => {
    const a = setup();
    expect(await engineAct(a.d)(who, C, body("redo"), state())).toBe("ok");
    expect(a.calls).toEqual(["quota", "cancelSys", "markExtracting", "outbox", "job"]);
    const b = setup({ ready: false });
    expect(await engineAct(b.d)(who, C, body("redo"), state())).toBe("unavailable");
    expect(b.calls).toEqual([]);
    // CR-109 · người duyệt ngoài cây (khoá theo luật thấy cũ ⇒ null) ⇒ chặn TRƯỚC khi huỷ run / tốn quota
    const x = setup({ outside: true });
    expect(await engineAct(x.d)(who, C, body("redo"), state())).toEqual({
      error: "APPROVAL_NOT_OPEN",
    });
    expect(x.calls).toEqual([]);
  });
  it("engine báo đã có người quyết trước ⇒ APPROVAL_NOT_OPEN; Từ chối không ghi HĐ", async () => {
    const { d, calls } = setup({ act: "not_open" });
    expect(await engineAct(d)(who, C, body("reject"), state())).toEqual({
      error: "APPROVAL_NOT_OPEN",
    });
    expect(calls.some((c) => c.startsWith("markRejected"))).toBe(false);
  });
});
