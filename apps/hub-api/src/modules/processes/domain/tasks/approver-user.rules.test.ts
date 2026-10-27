// esign-flow · cửa người duyệt cụ thể (`after.approver_user_id`) trong `canAct`: chỉ đúng người đó quyết phía Group chính (thắng
// head_only), thành viên Group khác không; Group "cũng quyết" giữ quyền; người ngoài tenant không.
import { describe, expect, test } from "bun:test";
import { canAct, headGate } from "./task-access.rules";

const T = "00000000-0000-4000-8000-0000000000a0";
const G = "00000000-0000-4000-8000-000000000001";
const OWN = "00000000-0000-4000-8000-000000000002";
const U = "00000000-0000-4000-8000-0000000000a1";
const M = "00000000-0000-4000-8000-0000000000a2";
const after = { kind: "review", group_id: G, head_only: true, approver_user_id: U };

const run = { tenantId: T, startedBy: M, status: "waiting_review" as const };
const task = (gate: string | null) => ({
  kind: "review" as const,
  status: "open" as const,
  reason: null,
  userIds: new Set<string>(),
  groupId: G,
  reviewGroupId: G,
  extraGroupIds: [OWN],
  headGate: gate,
});
const viewer = (userId: string, groups: string[], tenantId = T) => ({
  userId,
  tenantId,
  role: "member" as const,
  groupIds: new Set(groups),
});

describe("esign-flow · approver_user_id", () => {
  test("headGate: người cụ thể (SQL xác nhận hợp lệ) thắng trưởng phòng; không hợp lệ ⇒ rơi về cửa trưởng phòng / cả Group", () => {
    expect(headGate(after, U)).toBe(U);
    // esign-flow-fix · SQL không xác nhận (khoá/khác tenant) ⇒ `headUserId` = trưởng phòng ⇒ luật head_only như thường.
    expect(headGate(after, "head-id")).toBe("head-id");
    expect(headGate({ ...after, head_only: false }, null)).toBeNull();
    expect(headGate({ ...after, approver_user_id: undefined }, "head-id")).toBe("head-id");
  });
  test("canAct: người cụ thể quyết (kể cả ngoài Group); thành viên Group khác không; Group cũng quyết vẫn được", () => {
    const g = headGate(after, U);
    expect(canAct(viewer(U, []), task(g), run as never)).toBe(true);
    expect(canAct(viewer(M, [G]), task(g), run as never)).toBe(false);
    expect(canAct(viewer(M, [OWN]), task(g), run as never)).toBe(true);
    expect(
      canAct(viewer(U, [], "00000000-0000-4000-8000-0000000000b0"), task(g), run as never),
    ).toBe(false);
  });
});
