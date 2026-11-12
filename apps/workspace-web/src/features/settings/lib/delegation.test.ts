// CR-127 · U4 · M14 · luật thuần biểu mẫu uỷ quyền.
import { describe, expect, test } from "bun:test";
import {
  activeDelegations,
  claimHoursIssue,
  delegationBody,
  delegationIssue,
  EMPTY_DELEGATION,
  toggleKind,
} from "./delegation";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ok = { ...EMPTY_DELEGATION, toUserId: B, from: "2026-11-12", to: "2026-11-15" };

describe("delegationIssue", () => {
  test("thiếu người / chính mình / khoảng ngày sai / không loại việc", () => {
    expect(delegationIssue(EMPTY_DELEGATION, A)).toBe("person");
    expect(delegationIssue({ ...ok, toUserId: A }, A)).toBe("self");
    expect(delegationIssue({ ...ok, to: "2026-11-01" }, A)).toBe("range");
    expect(delegationIssue({ ...ok, kinds: [] }, A)).toBe("kinds");
    expect(delegationIssue(ok, A)).toBeNull();
  });
  test("đặt thay người khác: «chính mình» tính theo người được đặt thay", () => {
    expect(delegationIssue({ ...ok, forUserId: B }, A)).toBe("self");
  });
});

describe("delegationBody", () => {
  test("«Tới hết» ngày cuối = đầu ngày kế; for_user_id chỉ khi đặt thay", () => {
    const b = delegationBody(ok);
    expect(Date.parse(b.to_at) - Date.parse(b.from_at)).toBe(4 * 86_400_000);
    expect("for_user_id" in b).toBe(false);
    expect(delegationBody({ ...ok, forUserId: A }).for_user_id).toBe(A);
  });
});

describe("activeDelegations / toggleKind / giờ tự trả", () => {
  const d = (to: string, revoked: string | null) =>
    ({ id: A, to_at: to, revoked_at: revoked }) as never;
  test("bỏ bản đã thu hồi hoặc hết hạn", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    const r = activeDelegations(
      [
        d("2026-11-09T00:00:00Z", null),
        d("2026-11-20T00:00:00Z", "x"),
        d("2026-11-30T00:00:00Z", null),
      ],
      now,
    );
    expect(r).toHaveLength(1);
  });
  test("bật/tắt loại việc", () => {
    expect(toggleKind(["approve"], "form")).toEqual(["approve", "form"]);
    expect(toggleKind(["approve", "form"], "form")).toEqual(["approve"]);
  });
  test("giờ tự trả 1..168", () => {
    expect([0, 1, 168, 169, 1.5].map(claimHoursIssue)).toEqual([true, false, false, true, true]);
  });
});
