// contract-flow S1b · luật thuần: cửa trưởng phòng (`head_only`) trong `canAct` + tiêu đề/khoá chuông gói.
import { describe, expect, test } from "bun:test";
import { packBellsOf, packBellTitle } from "../notify/pack-bell.rules";
import { canAct, headGate, inReviewGroup } from "./task-access.rules";

const G = "g-review";
const ESC = "g-esc";
const after = (head_only?: boolean) => ({ kind: "review", group_id: G, head_only });

describe("S1b · headGate", () => {
  test("head_only + phòng có trưởng ⇒ id trưởng phòng", () => {
    expect(headGate(after(true), "head")).toBe("head");
  });
  test("không head_only / phòng không có trưởng / không Group / stage auto ⇒ null (cả nhóm)", () => {
    expect(headGate(after(false), "head")).toBeNull();
    expect(headGate(after(undefined), "head")).toBeNull();
    expect(headGate(after(true), null)).toBeNull();
    expect(headGate({ kind: "review", group_id: null, head_only: true }, "head")).toBeNull();
    expect(headGate({ kind: "auto" }, "head")).toBeNull();
    expect(headGate(undefined, "head")).toBeNull();
  });
});

describe("S1b · inReviewGroup", () => {
  const groups = new Set([G]);
  test("có cửa ⇒ chỉ trưởng phòng (kể cả ngoài group_members)", () => {
    expect(inReviewGroup("member", groups, G, "head")).toBe(false);
    expect(inReviewGroup("head", new Set(), G, "head")).toBe(true);
  });
  test("không cửa ⇒ thành viên Group", () => {
    expect(inReviewGroup("member", groups, G, null)).toBe(true);
    expect(inReviewGroup("other", new Set(), G, null)).toBe(false);
    expect(inReviewGroup("head", groups, null, "head")).toBe(false);
  });
});

describe("S1b · canAct với head_only", () => {
  const run = {
    tenantId: "t",
    startedBy: "starter",
    originRoom: "none" as const,
    taskAssignee: true,
    status: "waiting_review" as const,
  };
  const viewer = (userId: string, gs: string[]) => ({
    userId,
    tenantId: "t",
    role: "member" as const,
    groupIds: new Set(gs),
  });
  const task = {
    kind: "review" as const,
    status: "open" as const,
    reason: null,
    userIds: new Set<string>(),
    groupId: G,
    reviewGroupId: G,
    headGate: "head",
  };
  test("thành viên không quyết, trưởng phòng quyết", () => {
    expect(canAct(viewer("member", [G]), task, run)).toBe(false);
    expect(canAct(viewer("head", [G]), task, run)).toBe(true);
  });
  test("phòng không có trưởng ⇒ cả nhóm", () => {
    expect(canAct(viewer("member", [G]), { ...task, headGate: null }, run)).toBe(true);
  });
  test("Group chuyển cấp và user được chuyển tiếp không bị head_only", () => {
    expect(canAct(viewer("esc", [ESC]), { ...task, extraGroupIds: [ESC] }, run)).toBe(true);
    expect(canAct(viewer("fw", []), { ...task, userIds: new Set(["fw"]) }, run)).toBe(true);
  });
  test("decision redo_limit: thành viên Group duyệt bị chặn, trưởng phòng được", () => {
    const dec = {
      ...task,
      kind: "decision" as const,
      reason: "redo_limit" as const,
      groupId: null,
    };
    const r = { ...run, status: "needs_decision" as const };
    expect(canAct(viewer("member", [G]), dec, r)).toBe(false);
    expect(canAct(viewer("head", []), dec, r)).toBe(true);
  });
  test("ask không bị cửa trưởng phòng", () => {
    expect(canAct(viewer("member", [G]), { ...task, kind: "ask" as const }, run)).toBe(true);
  });
});

describe("S1b · chuông gói", () => {
  test("tiêu đề theo loại notice, cắt ≤ 200", () => {
    expect(packBellTitle("review_requested", { stage_name: "Pháp chế" })).toBe(
      "Cần duyệt: Pháp chế",
    );
    expect(packBellTitle("task_closed", { stage_name: "Kế toán", result: "fail" })).toBe(
      "Trả lại: Kế toán",
    );
    expect(packBellTitle("run_finished", { process_name: "Duyệt HĐ", stage_name: null })).toBe(
      "Kết thúc duyệt: Duyệt HĐ",
    );
    expect(packBellTitle("escalated", {})).toBe("Chuyển cấp duyệt: Quy trình duyệt");
    expect(packBellTitle("reminder", { stage_name: "x".repeat(300) }).length).toBe(200);
  });
  test("mỗi notice một mục: kind approval.<kind>, dedup = id notice", () => {
    const rows = [
      { id: "n1", userId: "u1", processRunId: "r1", payload: { stage_name: "B1" } },
      { id: "n2", userId: "u2", processRunId: "r1", payload: { stage_name: "B1" } },
    ];
    expect(packBellsOf("reminder", rows)).toEqual([
      {
        run_id: "r1",
        user_id: "u1",
        kind: "approval.reminder",
        title: "Nhắc duyệt: B1",
        dedup_key: "n1",
      },
      {
        run_id: "r1",
        user_id: "u2",
        kind: "approval.reminder",
        title: "Nhắc duyệt: B1",
        dedup_key: "n2",
      },
    ]);
  });
});
