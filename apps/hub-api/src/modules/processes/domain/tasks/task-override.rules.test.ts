// CR-113 (review) · `overrideOnly`: người xem quyết task duyệt CHỈ nhờ Group "cũng quyết" (Toàn quyền) ⇒ duyệt thay, người của bước
// (Group duyệt qua cửa, người cụ thể, giao đích danh, Group chuyển cấp đã thêm) ⇒ không.
import { describe, expect, it } from "bun:test";
import { overrideOnly } from "./task-access.rules";

const OWN = "g-own";
const KT = "g-kt";
const H = "u-h"; // Toàn quyền
const HEAD = "u-head";
const APPROVER = "u-approver";
const base = { userIds: new Set<string>(), groupId: KT, gate: null, escalated: [], also: [OWN] };

describe("CR-113 · overrideOnly", () => {
  it("owner ngoài Group bước ⇒ duyệt thay, owner CŨNG thuộc Group bước ⇒ người của bước", () => {
    expect(overrideOnly(H, new Set([OWN]), base)).toBe(true);
    expect(overrideOnly(H, new Set([OWN, KT]), base)).toBe(false);
  });

  it("bước head_only: owner thuộc phòng nhưng không phải trưởng ⇒ duyệt thay, trưởng phòng ⇒ không", () => {
    const t = { ...base, gate: HEAD };
    expect(overrideOnly(H, new Set([OWN, KT]), t)).toBe(true);
    expect(overrideOnly(HEAD, new Set([KT]), t)).toBe(false);
  });

  it("bước người cụ thể - task gắn Group Toàn quyền, cửa là người đó: owner quyết ⇒ duyệt thay, người cụ thể ⇒ không", () => {
    const t = { ...base, groupId: OWN, gate: APPROVER };
    expect(overrideOnly(H, new Set([OWN]), t)).toBe(true);
    expect(overrideOnly(APPROVER, new Set<string>(), t)).toBe(false);
  });

  it("quyết định: bước ĐÃ chuyển cấp cho chính nhóm owner ⇒ owner là người của bước (member), chưa chuyển ⇒ duyệt thay", () => {
    expect(overrideOnly(H, new Set([OWN]), { ...base, escalated: [OWN] })).toBe(false);
    expect(overrideOnly(H, new Set([OWN]), { ...base, escalated: [] })).toBe(true);
  });

  it("được giao đích danh / không có Group cũng quyết ⇒ không", () => {
    expect(overrideOnly(H, new Set([OWN]), { ...base, userIds: new Set([H]) })).toBe(false);
    expect(overrideOnly(H, new Set([OWN]), { ...base, also: [] })).toBe(false);
  });
});
