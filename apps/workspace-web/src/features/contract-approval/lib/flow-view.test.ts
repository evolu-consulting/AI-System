// CR-118 · cr118-flow-web · thẻ duyệt ⇒ FlowView ⇒ dòng thời gian: kết quả PHẢI trùng `timelineRows` cũ (hành vi y hệt).
import { describe, expect, test } from "bun:test";
import type { ApprovalCardStep, ContractApproval, ContractGroup } from "@ai/contracts";
import { timelineRows } from "./engine-card";
import { APPROVAL_SLOT, flowViewOfApproval, rowOfFlowStep, withGroupLabels } from "./flow-view";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const G3 = "33333333-3333-4333-8333-333333333333";
const GROUPS: ContractGroup[] = [
  { id: G1, name: "Pháp chế" },
  { id: G2, name: "Giám đốc" },
];
const NOW = Date.parse("2026-11-04T10:00:00Z");
const step = (o: Partial<ApprovalCardStep>): ApprovalCardStep => ({
  idx: 0,
  key: "s0",
  name: "Soạn",
  kind: "review",
  status: "pending",
  group_id: G1,
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  ...o,
});
const card = (steps: ApprovalCardStep[], o: Partial<ContractApproval> = {}): ContractApproval => ({
  mode: "engine",
  run_id: G1,
  run_status: "running",
  step: "level1",
  task_id: G2,
  can_act: true,
  feedback: null,
  steps,
  ...o,
});

const STEPS: ApprovalCardStep[] = [
  step({
    status: "passed",
    decided_by: { id: G1, name: "An" },
    decided_at: "2026-11-01T01:00:00Z",
    decided_as: "owner_override",
    feedback: "ok",
  }),
  step({
    idx: 1,
    key: "s1",
    name: "Pháp chế duyệt",
    status: "open",
    head_only: true,
    due_at: "2026-11-04T08:00:00Z", // quá hạn, hub không gửi `overdue` ⇒ tự tính
    escalated: true,
    escalated_group_id: G2,
  }),
  step({ idx: 2, key: "s2", name: "Dify", kind: "dify", group_id: null, status: "running" }),
  step({
    idx: 3,
    key: "s3",
    name: "Cấp cao",
    group_id: G3, // không có trong /groups ⇒ "" (không lộ id)
    skip_when: [
      { field: "total_value", op: "ge", value: 500_000_000 },
      { field: "deal", in: ["buy"] },
    ] as never,
  }),
  step({ idx: 4, key: "s4", status: "returned", escalated: true, escalated_to: "Ban TGĐ" }),
];

describe("flowViewOfApproval → rowOfFlowStep", () => {
  test("dòng thời gian từ FlowView trùng timelineRows(steps) cũ (kể cả quá hạn tự tính, bỏ qua, chuyển cấp)", () => {
    const view = flowViewOfApproval(card(STEPS), "c1", GROUPS, NOW);
    const rows = view.steps.map((s, i) => rowOfFlowStep(s, i));
    expect(rows).toEqual(timelineRows(STEPS, GROUPS, NOW));
  });

  test("khi chưa tải /groups ⇒ vẫn trùng timelineRows với danh sách rỗng", () => {
    const view = flowViewOfApproval(card(STEPS), "c1", [], NOW);
    expect(view.steps.map((s, i) => rowOfFlowStep(s, i))).toEqual(timelineRows(STEPS, [], NOW));
  });

  test("hub báo overdue=false thì tin hub (không tự tính)", () => {
    const s = [step({ status: "open", due_at: "2026-11-04T08:00:00Z", overdue: false })];
    const [row] = flowViewOfApproval(card(s), "c1", GROUPS, NOW).steps.map(rowOfFlowStep);
    expect(row?.overdue).toBe(false);
    expect(row?.due?.flag).toBeNull();
  });

  test("slot/ref/state/phase + bước Ký số nối cuối · tasks rỗng (nút thẻ do useApprovalUi)", () => {
    const esign = {
      key: "esign",
      name: "Ký số",
      status: "sent" as const,
      reason: null,
      can_resend: false,
      due_at: "2026-11-09T00:00:00Z",
      overdue: false,
      reminded_at: null,
    };
    const v = flowViewOfApproval(card(STEPS, { esign }), "c1", GROUPS, NOW);
    expect(v).toMatchObject({
      slot: APPROVAL_SLOT,
      ref: "c1",
      state: "running",
      phase: "level1",
      tasks: [],
      run: { id: G1, mode: "engine" },
    });
    const last = v.steps.at(-1);
    expect(last).toMatchObject({
      kind: "esign",
      status: "running",
      esign: { provider_status: "sent", can_resend: false },
    });
  });

  test("lượt máy cũ ⇒ run.mode = machine, không có dòng bước", () => {
    const v = flowViewOfApproval(
      card([], { mode: "machine", step: "level2", steps: undefined }),
      "c1",
      GROUPS,
      NOW,
    );
    expect(v.run?.mode).toBe("machine");
    expect(v.steps).toEqual([]);
    expect(v.state).toBe("running");
  });

  test("chưa có lượt (step null, không run) ⇒ state none, run null", () => {
    const v = flowViewOfApproval(
      card([], { run_id: null, run_status: null, step: null, mode: "machine" }),
      "c1",
      GROUPS,
      NOW,
    );
    expect([v.run, v.state]).toEqual([null, "none"]);
  });
});

describe("CR-120 · withGroupLabels (FlowView của hub)", () => {
  // Hub chỉ gửi nhãn phòng khi chuyển cấp; bước thường label=null ⇒ điền tên phòng từ /groups như dòng thời gian cũ.
  const hubView = () => {
    const v = flowViewOfApproval(card(STEPS), "c1", GROUPS, NOW);
    return {
      ...v,
      steps: v.steps.map((s, i) =>
        s.assignee?.kind === "group"
          ? { ...s, assignee: { ...s.assignee, label: i === 4 ? "Ban TGĐ" : null } }
          : s,
      ),
    };
  };
  test("label null + id ⇒ tên phòng; nhãn chuyển cấp của hub giữ nguyên; dify không đổi", () => {
    const v = withGroupLabels(hubView(), GROUPS);
    const label = (i: number) => {
      const a = v.steps[i]?.assignee;
      return a?.kind === "group" ? a.label : a?.kind;
    };
    expect([label(0), label(2), label(3), label(4)]).toEqual(["Pháp chế", "system", "", "Ban TGĐ"]);
    expect(v.tasks).toEqual(hubView().tasks);
  });
  test("chưa tải /groups ⇒ trả nguyên view", () => {
    const v = hubView();
    expect(withGroupLabels(v, [])).toBe(v);
  });
});
