// CR-118 · UW-FR-13 · tương đương: FlowView từ adapter == dữ liệu thẻ duyệt hôm nay (khuôn thẻ CF: engine 2 bước, Dify, Ký số,
// duyệt cuối gắn SP, lượt kẹt, máy cũ). Mọi trường thẻ có mặt ở FlowView, không thêm quyết định mới.
import { describe, expect, test } from "bun:test";
import { type FlowView, FlowViewSchema } from "@ai/contracts/flow";
import { type ContractApproval, ContractApprovalSchema } from "@ai/contracts/pack-contracts";
import { flowViewOfCard, summaryItemOf } from "./approval-flow-view.rules";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const step = (idx: number, o: Record<string, unknown> = {}) => ({
  idx,
  key: `b${idx}`,
  name: `Bước ${idx}`,
  kind: "review",
  status: "pending",
  group_id: U(100 + idx),
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  skip_when: null,
  ...o,
});
const card = (o: Record<string, unknown>): ContractApproval =>
  ContractApprovalSchema.parse({
    run_id: U(1),
    run_status: "waiting_review",
    step: "level1",
    task_id: null,
    can_act: false,
    feedback: null,
    block_reason: null,
    finalizes_on_approve: false,
    mode: "engine",
    steps: [],
    needs_reopen: false,
    attention: null,
    esign: null,
    ...o,
  });

/** CF fixtures (hình dạng thẻ từ tests/acceptance/CF/approval-card.int.test.ts + approval-dify + esign + owner-override). */
const FIXTURES: Record<string, ContractApproval> = {
  "engine bước 0 mở, người xem quyết được": card({
    task_id: U(9),
    can_act: true,
    steps: [
      step(0, { status: "open", due_at: "2026-11-04T10:00:00.000Z", overdue: false }),
      step(1, {
        skip_when: [{ field: "total_value", op: "ge", value: 100 }],
        head_only: true,
      }),
    ],
  }),
  "engine bước 1 mở, người gửi bị chặn": card({
    task_id: U(9),
    can_act: false,
    block_reason: "starter",
    steps: [
      step(0, {
        status: "passed",
        decided_by: { id: U(5), name: "Hoa" },
        decided_at: "2026-11-03T10:00:00.000Z",
        decided_as: "owner_override",
      }),
      step(1, {
        status: "open",
        escalated: true,
        escalated_group_id: U(7),
        escalated_to: "Giám đốc",
        overdue: true,
      }),
    ],
  }),
  "duyệt cuối + gắn SP + Dify + Ký số": card({
    task_id: U(9),
    can_act: true,
    finalizes_on_approve: true,
    steps: [
      step(0, { status: "passed" }),
      step(1, { kind: "dify", group_id: null, status: "passed" }),
      step(2, { status: "open", skip_when: [{ field: "deal", in: ["buy"] }] }),
    ],
    esign: { key: "ky", name: "Ký số", status: "pending", reason: null, can_resend: false },
  }),
  "lượt kẹt (stalled)": card({
    needs_reopen: true,
    feedback: "ENGINE_RUN_CANCELLED",
    attention: { kind: "stalled", reason: "ENGINE_RUN_CANCELLED", since: null },
    steps: [step(0, { status: "open" })],
  }),
  "ký số cần quyết": card({
    step: "done",
    run_status: "done",
    steps: [step(0, { status: "passed" })],
    esign: {
      key: "ky",
      name: "Ký số",
      status: "needs_decision",
      reason: "DECLINED",
      can_resend: true,
      due_at: "2026-11-05T00:00:00.000Z",
      overdue: true,
      reminded_at: "2026-11-04T00:00:00.000Z",
    },
  }),
  "máy cũ cấp 2": ContractApprovalSchema.parse({
    run_id: U(1),
    run_status: "waiting_review",
    step: "level2",
    task_id: U(1),
    can_act: true,
    feedback: null,
    block_reason: null,
    finalizes_on_approve: true,
  }),
  "chưa có lượt": ContractApprovalSchema.parse({
    run_id: null,
    run_status: null,
    step: null,
    task_id: null,
    can_act: false,
    feedback: null,
  }),
};

/** Bước người dùng: cùng thứ tự, khoá, tên, loại, trạng thái, hạn, người quyết, lý do. */
function sameSteps(c: ContractApproval, v: FlowView) {
  const own = v.steps.filter((s) => s.kind !== "esign");
  expect(own.length).toBe(c.steps?.length ?? 0);
  (c.steps ?? []).forEach((s, i) => {
    const f = own[i];
    expect(f).toMatchObject({
      key: s.key,
      name: s.name,
      kind: s.kind,
      status: s.status,
      due_at: s.due_at,
      escalated: s.escalated,
      decided_by: s.decided_by,
      decided_at: s.decided_at,
      feedback: s.feedback,
      overdue: s.overdue ?? false,
      decided_as: s.decided_as ?? null,
      escalated_to: s.escalated_to ?? null,
    });
    expect((f?.skip_when ?? []).length).toBe(s.skip_when?.length ?? 0);
    if (f?.assignee?.kind === "group") expect(f.assignee.head_only).toBe(s.head_only);
  });
}

function sameEsign(c: ContractApproval, v: FlowView) {
  const es = v.steps.find((s) => s.kind === "esign");
  expect(es === undefined).toBe(!c.esign);
  if (es?.kind !== "esign" || !c.esign) return;
  expect(es.esign).toEqual({
    provider_status: c.esign.status,
    reason: c.esign.reason,
    can_resend: c.esign.can_resend,
    reminded_at: c.esign.reminded_at ?? null,
  });
}

function sameTasks(c: ContractApproval, v: FlowView) {
  const can = c.can_act && c.task_id !== null;
  expect(v.tasks.length).toBe(can ? 1 : 0);
  if (!can) return;
  const t = v.tasks[0];
  expect(t?.task_id).toBe(c.task_id as string);
  const approve = t?.actions.find((a) => a.key === "approve");
  expect(approve?.input.kind).toBe(c.finalizes_on_approve ? "extension" : "none");
  const open = c.steps?.find((s) => s.status === "open");
  const canReturn = c.mode === "engine" && open !== undefined && open.idx > 0;
  expect(t?.actions.some((a) => a.key === "return")).toBe(canReturn);
  const others = (t?.actions ?? []).filter((a) => a.key !== "approve");
  for (const a of others) expect(a.input).toMatchObject({ kind: "feedback", required: true });
}

describe("CR-118 · FlowView từ thẻ duyệt (tương đương)", () => {
  for (const [name, c] of Object.entries(FIXTURES))
    test(`tương đương: ${name}`, () => {
      const v = FlowViewSchema.parse(flowViewOfCard(c, U(2), 4));
      sameSteps(c, v);
      sameEsign(c, v);
      expect(v.run?.id ?? null).toBe(c.run_id);
      expect(v.phase).toBe(c.step);
      expect(v.note).toBe(c.feedback);
      expect(v.attention).toEqual(c.attention ?? null);
      expect(v.block_reason).toBe(c.block_reason ?? null);
      sameTasks(c, v);
    });

  test("trạng thái chung + snapshot", () => {
    expect(flowViewOfCard(FIXTURES["chưa có lượt"] as ContractApproval, U(2), null)).toMatchObject({
      run: null,
      state: "none",
    });
    expect(flowViewOfCard(FIXTURES["ký số cần quyết"] as ContractApproval, U(2), 7)).toMatchObject({
      state: "done",
      run: { mode: "engine", snapshot_version: 7 },
    });
    expect(flowViewOfCard(FIXTURES["máy cũ cấp 2"] as ContractApproval, U(2), null).run?.mode).toBe(
      "machine",
    );
  });

  test("huy hiệu: lượt engine gộp level2 ⇒ level1; máy cũ giữ; không lượt ⇒ none", () => {
    const r = { ref: U(1), flow_version: 3, attention: false };
    expect(summaryItemOf({ ...r, status: "level2", mode: "engine" })).toEqual({
      ref: U(1),
      state: "running",
      phase: "level1",
      snapshot_version: 3,
      attention: false,
    });
    expect(summaryItemOf({ ...r, status: "level2", mode: "machine" }).phase).toBe("level2");
    expect(summaryItemOf({ ...r, status: "failed", mode: "engine" }).state).toBe("cancelled");
    expect(summaryItemOf({ ...r, status: null, mode: null, flow_version: null })).toMatchObject({
      state: "none",
      phase: null,
      snapshot_version: null,
    });
  });
});
