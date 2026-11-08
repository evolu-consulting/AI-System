// CR-122 · P11 · thẻ duyệt của lượt flow theo sự kiện (không có mẫu chụp `flow_steps`): bước = stage Duyệt của run đã tới, đúng
// `s<idx>`; nhánh chưa tới không hiện; chờ bộ điều phối (`FLOW_STARTING`, chưa run) không báo "kẹt".
import { describe, expect, it } from "bun:test";
import {
  attentionOf,
  type EngineStageView,
  engineCardView,
  planEngineAct,
} from "./approval-engine-card.rules";

const st = (key: string, status: EngineStageView["status"], o: Partial<EngineStageView> = {}) =>
  ({
    key,
    status,
    escalated_group_id: null,
    due_at: null,
    escalated: false,
    decided_by: null,
    decided_at: null,
    feedback: null,
    task: null,
    task_ref: null,
    ...o,
  }) as EngineStageView;

const NO_FACTS = { deal: null, total_value: null } as never;
const approval = { id: "a1", status: "level1", startedBy: "u1", feedback: null, engineRunId: "r1" };

describe("CR-122 P11f · khoá stage FlowDef do người dựng đặt (không phải s<i>)", () => {
  it("stepsView thật (key 'nhanh'/'duyet-lon', idx 0/1) ⇒ bước 'Duyệt giá trị lớn' idx 1 mở, task + can_act", () => {
    // Tái hiện e2e G1.2 (trace 20261107-003237): run gắn, `run_status: waiting_review` nhưng thẻ `steps: []`, `task_id: null`.
    const sv = {
      status: "waiting_review",
      started_by: "u1",
      steps: [
        st("nhanh", "passed", { idx: 0, name: "Giá trị lớn hơn 100 triệu" }),
        st("duyet-lon", "open", {
          idx: 1,
          name: "Duyệt giá trị lớn",
          task: { id: "t9", can_act: true },
          task_ref: "t9",
        }),
        st("duyet-nho", "pending", { idx: 2, name: "Duyệt giá trị nhỏ" }),
      ],
    };
    const v = engineCardView({ approval, flow: [], facts: NO_FACTS, sv, viewerId: "u2" });
    expect(v.steps.map((s) => [s.idx, s.name, s.status])).toEqual([
      [1, "Duyệt giá trị lớn", "open"],
    ]);
    expect(v).toMatchObject({ task_id: "t9", can_act: true });
  });
});

describe("CR-122 P11 · thẻ duyệt từ run flow", () => {
  it("flow_steps rỗng ⇒ bước = stage Duyệt đã tới (s1 mở, s2 nhánh chưa tới bị ẩn), task + can_act theo stage mở", () => {
    const sv = {
      status: "waiting_review",
      started_by: "u1",
      steps: [
        st("s0", "passed", { name: "Nếu" }),
        st("s1", "open", {
          name: "Duyệt giá trị lớn",
          task: { id: "t1", can_act: true },
          task_ref: "t1",
          group_id: "g1",
        }),
        st("s2", "pending", { name: "Duyệt giá trị nhỏ" }),
      ],
    };
    const v = engineCardView({ approval, flow: [], facts: NO_FACTS, sv, viewerId: "u2" });
    expect(v.steps.map((s) => [s.idx, s.name, s.status])).toEqual([
      [1, "Duyệt giá trị lớn", "open"],
    ]);
    expect(v).toMatchObject({ task_id: "t1", can_act: true, attention: null });
  });

  it("chưa có run + FLOW_STARTING ⇒ không 'kẹt', lý do khác ⇒ stalled như cũ", () => {
    const base = { flow: [], facts: NO_FACTS, sv: null, viewerId: "u1" };
    const wait = { ...approval, engineRunId: null, feedback: "FLOW_STARTING" };
    expect(attentionOf({ ...base, approval: wait })).toBeNull();
    const bad = { ...approval, engineRunId: null, feedback: "ENGINE_RUN_FAILED" };
    expect(attentionOf({ ...base, approval: bad })?.kind).toBe("stalled");
  });

  it("P11b · FLOW_STARTING quá 2 phút ⇒ stalled (lý do FLOW_STARTING), còn mới ⇒ null", () => {
    const now = new Date("2026-11-07T10:00:00Z");
    const base = { flow: [], facts: NO_FACTS, sv: null, viewerId: "u1", extras: { now } };
    const at = (ms: number) => ({
      ...approval,
      engineRunId: null,
      feedback: "FLOW_STARTING",
      updatedAt: new Date(now.getTime() - ms).toISOString(),
    });
    expect(attentionOf({ ...base, approval: at(60_000) })).toBeNull();
    expect(attentionOf({ ...base, approval: at(121_000) })).toMatchObject({
      kind: "stalled",
      reason: "FLOW_STARTING",
    });
  });

  it("P11b · vừa gắn run, chưa có bước mở ⇒ thẻ hiện bước kế tiếp đang chờ (không trống)", () => {
    const sv = {
      status: "running",
      started_by: "u1",
      steps: [st("s0", "running", { name: "Nếu" }), st("s1", "pending", { name: "Duyệt" })],
    };
    const v = engineCardView({ approval, flow: [], facts: NO_FACTS, sv, viewerId: "u1" });
    expect(v.steps.map((s) => [s.idx, s.name, s.status])).toEqual([[0, "Nếu", "running"]]);
  });
});

const giveBack = (
  o: Omit<Parameters<typeof planEngineAct>[0], "action" | "feedback" | "hasSource">,
  feedback: string,
) => planEngineAct({ ...o, action: "return", feedback, hasSource: false });

describe("CR-124 q6 · lượt flow theo sự kiện có stage Duyệt ở idx 0 (Giám đốc duyệt là bước ĐẦU)", () => {
  const sv = {
    status: "waiting_review",
    started_by: "u1",
    steps: [
      st("giam-doc", "open", {
        idx: 0,
        name: "Giám đốc duyệt",
        task: { id: "t1", can_act: true },
        task_ref: "t1",
      }),
    ],
  };
  const base = { approval, flow: [], facts: NO_FACTS, sv, viewerId: "u2" };
  it("thẻ đánh dấu `from_run` (bước 0 là stage thật) + người duyệt có task để quyết", () => {
    const v = engineCardView(base);
    expect(v).toMatchObject({ from_run: true, task_id: "t1", can_act: true });
    expect(v.steps.map((s) => [s.idx, s.status])).toEqual([[0, "open"]]);
  });
  it("Trả lại được ở bước 0 của lượt flow (không bị coi là bước soạn)", () => {
    const p = giveBack(base, "sai đơn giá");
    // Trả lại của flow theo sự kiện = nhánh của stage (không đích lùi `back_to_step` ⇒ không BACK_TARGET_INVALID).
    expect(p).toEqual({ kind: "fail_flow", taskId: "t1" });
  });
  it("stage có đích lùi (`back_to_steps`) ⇒ Trả lại lùi về đích đó (fail_back), không fail_flow", () => {
    const withBack = {
      ...base,
      sv: {
        ...sv,
        steps: [
          st("duyet-2", "open", {
            idx: 0,
            name: "Duyệt 2",
            task: { id: "t2", can_act: true },
            back_to_steps: [0],
          }),
        ],
      },
    };
    const p = giveBack(withBack, "sửa lại");
    expect(p).toEqual({ kind: "fail_back", taskId: "t2", backTo: 0 });
  });
});
