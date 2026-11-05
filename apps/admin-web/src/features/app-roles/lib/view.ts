// CR-112 · ADM-FR-80, ADM-FR-82 · "vai như đang hiển thị" = bản đã tải + thay đổi chưa lưu (hàm thuần).
import type { AppRole, AppRoleLevel } from "@ai/contracts/app-roles";
import { roleIsEffective } from "./effective";
import { isMember, memberCountAfter, type Staged } from "./staging";

export type RoleView = {
  /** id thật, hoặc tempId của vai chưa lưu. */
  ref: string;
  pack: string;
  key: string;
  name: { vi: string; en?: string };
  isDefault: boolean;
  isNew: boolean;
  deleted: boolean;
  edited: boolean;
  level: AppRoleLevel;
  ceiling: AppRoleLevel | null;
  effective: boolean;
  members: number;
  groupId: string | null;
};

/** Vai (chưa xoá) mà người dùng đang giữ sau thay đổi chưa lưu; `groupIds` = Group của người trong bản đã tải. */
export function rolesOfUser(
  userId: string,
  groupIds: ReadonlySet<string>,
  views: readonly RoleView[],
  s: Staged,
): RoleView[] {
  return views.filter(
    (v) => !v.deleted && isMember(s, v.ref, userId, v.groupId !== null && groupIds.has(v.groupId)),
  );
}

export function buildRoleViews(items: readonly AppRole[], s: Staged): RoleView[] {
  const ceilings = new Map(items.map((r) => [r.pack, r.ceiling]));
  const saved = items.map((r): RoleView => {
    const e = s.edits[r.id];
    const level = e?.level ?? r.level;
    return {
      ref: r.id,
      pack: r.pack,
      key: r.key,
      name: e?.name === undefined ? r.name : { vi: e.name },
      isDefault: r.is_default,
      isNew: false,
      deleted: s.deleted.includes(r.id),
      edited: e !== undefined,
      level,
      ceiling: r.ceiling,
      effective: roleIsEffective(level, r.ceiling),
      members: memberCountAfter(s, r),
      groupId: r.group_id,
    };
  });
  const created = s.created.map((r): RoleView => {
    const ceiling = ceilings.get(r.pack) ?? null;
    return {
      ref: r.tempId,
      pack: r.pack,
      key: r.tempId,
      name: { vi: r.name },
      isDefault: false,
      isNew: true,
      deleted: false,
      edited: false,
      level: r.level,
      ceiling,
      effective: roleIsEffective(r.level, ceiling),
      members: s.adds[r.tempId]?.length ?? 0,
      groupId: null,
    };
  });
  return [...saved, ...created];
}
