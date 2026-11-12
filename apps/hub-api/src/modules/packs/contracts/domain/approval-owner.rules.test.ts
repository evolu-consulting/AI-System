// CR-113 · luật Toàn quyền: chuyển cấp mặc định khi biên dịch (`compileDef` + `defaultEscalateOf`), thứ tự Group Toàn quyền,
// `decided_as` của thẻ (duyệt thay / người của bước), `overdue` + `escalated_to` của bước.

import { describe, expect, it } from "bun:test";
import { compileDef } from "../testing/approval-slot/approval-compile";
import { PACK_OWNER_GROUP_KEY } from "./approval-def.rules";
import { cardSteps, type EngineStageView } from "./approval-engine-card.rules";
import type { FlowStep } from "./approval-flow.types";
import { decidedAsOf, defaultEscalateOf, escalateOrder, overrideKey } from "./approval-owner.rules";

const G = {
  kt: "00000000-0000-4000-8000-0000000000a1",
  gd: "00000000-0000-4000-8000-0000000000a2",
  own: "00000000-0000-4000-8000-0000000000a3",
  l2: "00000000-0000-4000-8000-0000000000a4",
};
const ALL = new Set(Object.values(G));
const review = (key: string, group: string | null, o: Record<string, unknown> = {}): FlowStep =>
  ({
    kind: "review",
    key,
    name: key,
    department_group_id: group,
    head_only: false,
    due_h: 48,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
    ...o,
  }) as FlowStep;
type Stage = { key: string; after: { kind: string; escalate?: unknown } };
const escalates = (steps: FlowStep[], escalateTo: string[] = [G.own, G.l2]) =>
  (compileDef({ steps }, ALL, new Map(), [G.l2, G.own], escalateTo).stages as unknown as Stage[])
    .filter((s) => s.after.kind === "review")
    .map((s) => [s.key, s.after.escalate]);

describe("CR-113 · chuyển cấp mặc định về Toàn quyền khi biên dịch", () => {
  it("bước có hạn, không đặt nhóm chuyển cấp ⇒ escalate về Group owner sau due_h", () => {
    expect(escalates([review("kt", G.kt)])).toEqual([["s0", { after_h: 48, group_id: G.own }]]);
  });

  it("đặt tường minh vẫn thắng", () => {
    const s = review("kt", G.kt, { escalate_group_id: G.gd, due_h: 24 });
    expect(escalates([s])).toEqual([["s0", { after_h: 24, group_id: G.gd }]]);
  });

  it("bước không hạn (due_h vắng/0) ⇒ không chuyển cấp", () => {
    expect(escalates([review("kt", G.kt, { due_h: 0 })])).toEqual([["s0", null]]);
    expect(defaultEscalateOf({ due_h: null }, G.kt, [G.own], ALL)).toBeNull();
  });

  it("Group của bước chính là Toàn quyền đầu ⇒ lấy Toàn quyền kế; không còn ⇒ không chuyển cấp", () => {
    expect(escalates([review("own", G.own)])).toEqual([["s0", { after_h: 48, group_id: G.l2 }]]);
    expect(escalates([review("own", G.own)], [G.own])).toEqual([["s0", null]]);
  });

  it("không truyền escalateTo (thư viện / gọi cũ) ⇒ hành vi cũ (không chuyển cấp)", () => {
    const def = compileDef({ steps: [review("kt", G.kt)] }, ALL);
    expect((def.stages as unknown as Stage[])[0]?.after.escalate).toBeNull();
  });

  it("thứ tự Toàn quyền: Group vai owner trước, rồi Group cấp 2; mã thiếu bị bỏ, không trùng", () => {
    const ids = new Map([
      ["lvl2", G.l2],
      [PACK_OWNER_GROUP_KEY, G.own],
    ]);
    expect(escalateOrder(ids, "lvl2")).toEqual([G.own, G.l2]);
    expect(escalateOrder(new Map([["lvl2", G.l2]]), "lvl2")).toEqual([G.l2]);
    expect(escalateOrder(new Map([[PACK_OWNER_GROUP_KEY, G.own]]), PACK_OWNER_GROUP_KEY)).toEqual([
      G.own,
    ]);
  });
});

const stage = (key: string, o: Partial<EngineStageView> = {}): EngineStageView => ({
  key,
  status: "passed",
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: { id: "u1", name: "U" },
  decided_at: "2026-11-03T00:00:00.000Z",
  feedback: null,
  task: null,
  ...o,
});
const facts = { deal: null, total_value: 1 };

describe("CR-113 · thẻ: decided_as / overdue / escalated_to", () => {
  it("task đã ghi duyệt thay ⇒ owner_override, còn lại member, chưa quyết ⇒ vắng", () => {
    const ov = new Set([overrideKey("t1", "u1")]);
    expect(decidedAsOf("u1", "t1", ov)).toBe("owner_override");
    expect(decidedAsOf("u1", "t2", ov)).toBe("member");
    expect(decidedAsOf(null, "t1", ov)).toBeNull();
    // review · bản ghi write-ahead của người bấm thua đua (u2 ghi, u1 quyết) không tính
    expect(decidedAsOf("u1", "t1", new Set([overrideKey("t1", "u2")]))).toBe("member");
    const flow = [review("a", G.kt), review("b", G.gd), review("c", G.kt)];
    const sv = {
      status: "waiting_review",
      started_by: "u0",
      steps: [
        stage("s0", { task_ref: "t1" }),
        stage("s1", { task_ref: "t2" }),
        stage("s2", {
          status: "open",
          decided_by: null,
          decided_at: null,
          task_ref: "t3",
          due_at: "2026-11-01T00:00:00.000Z",
          escalated: true,
          escalated_group_id: G.own,
          task: { id: "t3", can_act: true },
        }),
      ],
    };
    const out = cardSteps(flow, sv, facts, {
      overrides: new Set([overrideKey("t1", "u1")]),
      now: new Date("2026-11-03T00:00:00.000Z"),
      groupNames: new Map([[G.own, `Toàn quyền ${"x".repeat(300)}`]]),
    });
    expect(out.map((s) => [s.decided_as, s.overdue, s.escalated_to?.length])).toEqual([
      ["owner_override", undefined, undefined],
      ["member", undefined, undefined],
      [undefined, true, 200], // review #6 · tên Group cắt an toàn ≤ 200
    ]);
  });

  it("bước mở chưa tới hạn ⇒ overdue=false; không truyền extras ⇒ không có trường mới", () => {
    const flow = [review("a", G.kt)];
    const sv = {
      status: "waiting_review",
      started_by: "u0",
      steps: [
        stage("s0", {
          status: "open",
          decided_by: null,
          due_at: "2026-11-05T00:00:00.000Z",
          task: { id: "t9", can_act: false },
        }),
      ],
    };
    const now = new Date("2026-11-03T00:00:00.000Z");
    expect(cardSteps(flow, sv, facts, { now })[0]?.overdue).toBe(false);
    const bare = cardSteps(flow, sv, facts)[0] as Record<string, unknown>;
    expect(["decided_as", "overdue", "escalated_to"].filter((k) => k in bare)).toEqual([]);
  });
});
