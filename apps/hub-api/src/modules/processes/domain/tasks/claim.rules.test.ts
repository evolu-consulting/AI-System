// CR-127 · E2 · spec §5.1 · luật thuần Nhận việc.
import { describe, expect, it } from "bun:test";
import {
  canReassign,
  claimable,
  claimBlocks,
  claimDeadline,
  claimHoursOk,
  claimMissOutcome,
  claimState,
  mayReassign,
  reassignBlock,
  releaseRecipients,
} from "./claim.rules";
import { canAct } from "./task-access.rules";

const miss = (o: Partial<Parameters<typeof claimMissOutcome>[0] & object> = {}) => ({
  status: "open" as const,
  kind: "review",
  need: "one",
  groupId: "g",
  claimedBy: null,
  member: true,
  ...o,
});

describe("CR-127 E2 · claim.rules", () => {
  it("claimState theo người xem", () => {
    expect(claimState(null, "a")).toBe("unclaimed");
    expect(claimState("a", "a")).toBe("mine");
    expect(claimState("b", "a")).toBe("other");
  });
  it("claimBlocks: chỉ need='one' (vắng = one) + người khác giữ", () => {
    expect(claimBlocks({ claimedBy: "b" }, "a")).toBe(true);
    expect(claimBlocks({ need: "one", claimedBy: "a" }, "a")).toBe(false);
    expect(claimBlocks({ need: "all", claimedBy: "b" }, "a")).toBe(false);
    expect(claimBlocks({ need: "one", claimedBy: null }, "a")).toBe(false);
  });
  it("claimable: việc nhóm duyệt/mốc need='one'", () => {
    expect(claimable({ kind: "review", need: "one", groupId: "g" })).toBe(true);
    expect(claimable({ kind: "milestone", need: "one", groupId: "g" })).toBe(true);
    expect(claimable({ kind: "ask", need: "one", groupId: "g" })).toBe(false);
    expect(claimable({ kind: "review", need: "head", groupId: "g" })).toBe(false);
    expect(claimable({ kind: "review", need: "one", groupId: null })).toBe(false);
  });
  it("claimMissOutcome: 404 / xong / không cần nhận / mình / người khác", () => {
    expect(claimMissOutcome(null, "a")).toBe("not_found");
    expect(claimMissOutcome(miss({ member: false }), "a")).toBe("not_found");
    expect(claimMissOutcome(miss({ status: "closed" }), "a")).toBe("TASK_CLOSED");
    expect(claimMissOutcome(miss({ need: "all" }), "a")).toBe("TASK_NOT_CLAIMABLE");
    expect(claimMissOutcome(miss({ claimedBy: "a" }), "a")).toBe("mine");
    expect(claimMissOutcome(miss({ claimedBy: "b" }), "a")).toBe("TASK_CLAIMED");
  });
  it("claimDeadline + claimHoursOk 1..168", () => {
    expect(claimDeadline(new Date("2026-11-10T00:00:00Z"), 24).toISOString()).toBe(
      "2026-11-11T00:00:00.000Z",
    );
    expect([0, 1, 168, 169, 1.5].map(claimHoursOk)).toEqual([false, true, true, false, false]);
  });
  it("R#27 · releaseRecipients: trưởng phòng, không có ⇒ quản trị công ty", () => {
    expect(releaseRecipients("h", ["x"])).toEqual(["h"]);
    expect(releaseRecipients(null, ["x", "y", "x"])).toEqual(["x", "y"]);
  });
  it("mayReassign: trưởng phòng / quản trị", () => {
    expect(mayReassign({ userId: "h", role: "member" }, "h")).toBe(true);
    expect(mayReassign({ userId: "m", role: "member" }, "h")).toBe(false);
    expect(mayReassign({ userId: "m", role: "tenant_admin" }, null)).toBe(true);
  });
  it("RA1 · reassignBlock/canReassign: thứ tự lỗi = thứ tự của endpoint; cờ = không có lỗi", () => {
    const t = { status: "open", kind: "review", need: "one", groupId: "g", head: "h" };
    const head = { userId: "h", role: "member" as const };
    const member = { userId: "m", role: "member" as const };
    const admin = { userId: "a", role: "tenant_admin" as const };
    expect(reassignBlock(head, t)).toBeNull();
    expect([canReassign(head, t), canReassign(member, t), canReassign(admin, t)]).toEqual([
      true,
      false,
      true,
    ]);
    expect(canReassign(admin, { ...t, head: null })).toBe(true);
    expect(canReassign(member, { ...t, head: null })).toBe(false);
    // người không có quyền ⇒ NOT_GROUP_HEAD kể cả khi việc đã xong (lộ ít thông tin nhất)
    expect(reassignBlock(member, { ...t, status: "closed" })).toBe("NOT_GROUP_HEAD");
    expect(reassignBlock(head, { ...t, status: "closed" })).toBe("TASK_CLOSED");
    expect(reassignBlock(head, { ...t, need: "all" })).toBe("TASK_NOT_CLAIMABLE");
    expect(reassignBlock(head, { ...t, kind: "ask" })).toBe("TASK_NOT_CLAIMABLE");
    expect(reassignBlock(head, { ...t, groupId: null })).toBe("TASK_NOT_CLAIMABLE");
  });
});

// CR-127 · FIX-OV · CR-113 · người Toàn quyền (Group "cũng quyết") Nhận việc được như người của bước; người khác đang giữ ⇒ không quyết.
describe("FIX-OV · Toàn quyền nhận việc + can_act khi người khác giữ", () => {
  const OWN = "g-own";
  const v = (userId: string, groups: string[]) => ({
    userId,
    tenantId: "t",
    role: "member" as const,
    groupIds: new Set(groups),
  });
  const task = (claimedBy: string | null) => ({
    kind: "review" as const,
    status: "open" as const,
    reason: null,
    userIds: new Set<string>(),
    groupId: "g",
    reviewGroupId: "g",
    extraGroupIds: [OWN], // = also_group_ids của stage
    need: "one" as const,
    claimedBy,
  });
  const run = (assignee: boolean) => ({
    tenantId: "t",
    startedBy: "s",
    originRoom: "none" as const,
    taskAssignee: assignee,
    status: "waiting_review" as const,
  });

  it("đọc lại khi nhận hụt: Toàn quyền (member nhờ Group cũng quyết) ⇒ mine/TASK_CLAIMED; ngoài nhóm không Toàn quyền ⇒ 404", () => {
    expect(claimMissOutcome(miss({ member: true, claimedBy: "o" }), "o")).toBe("mine");
    expect(claimMissOutcome(miss({ member: true, claimedBy: "a" }), "o")).toBe("TASK_CLAIMED");
    expect(claimMissOutcome(miss({ member: false, claimedBy: null }), "x")).toBe("not_found");
  });

  it("Toàn quyền đang giữ ⇒ quyết được; thành viên nhóm khi Toàn quyền giữ ⇒ không; ngoài nhóm không Toàn quyền ⇒ không", () => {
    expect(canAct(v("o", [OWN]), task("o"), run(true))).toBe(true);
    expect(canAct(v("a", ["g"]), task("o"), run(true))).toBe(false);
    expect(canAct(v("a", ["g"]), task(null), run(true))).toBe(true);
    expect(canAct(v("x", ["g-khac"]), task(null), run(false))).toBe(false);
  });
});
