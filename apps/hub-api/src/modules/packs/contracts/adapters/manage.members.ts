// gap-a1 #7 · người có thể được giao HĐ: thành viên tenant còn dùng được VÀ thuộc nhóm được cấp quyền xem gói hợp đồng. MỘT câu SQL
// (lọc tenant tường minh, nhóm qua một tham số JSON) đọc `admin.users` + `admin.group_members` bằng `hub_ro` như danh bạ thành viên.
import { MEMBERS_MAX } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import type { PackWho } from "../../kit/public";
import { internalMembersOfGroups, type PackAccessView, packAccessInput } from "../../kit/public";

type Member = { id: string; name: string };

export function packAssignees(db: Db, view: PackAccessView, packKey: string) {
  async function list(who: PackWho, only?: string): Promise<Member[]> {
    const i = await packAccessInput(view, packKey, who);
    const groups = i.entitled && !i.featureOff ? i.grantedByAction.read : [];
    if (groups.length === 0) return [];
    return internalMembersOfGroups(db, who, groups, { only, limit: MEMBERS_MAX });
  }
  return {
    list: (who: PackWho) => list(who),
    assignable: async (who: PackWho, userId: string) => (await list(who, userId)).length > 0,
  };
}
