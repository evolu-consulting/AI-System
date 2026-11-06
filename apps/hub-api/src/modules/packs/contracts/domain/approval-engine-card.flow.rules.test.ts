// CR-122 · P11 · thẻ duyệt của lượt flow theo sự kiện (không có mẫu chụp `flow_steps`): bước = stage Duyệt của run đã tới, đúng
// `s<idx>`; nhánh chưa tới không hiện; chờ bộ điều phối (`FLOW_STARTING`, chưa run) không báo "kẹt".
import { describe, expect, it } from "bun:test";
import { attentionOf, type EngineStageView, engineCardView } from "./approval-engine-card.rules";

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
