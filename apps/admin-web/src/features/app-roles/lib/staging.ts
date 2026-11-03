// CR-112 · ADM-FR-80, ADM-FR-82 · thay đổi CHƯA LƯU của màn Phân quyền (hàm thuần, bất biến): tạo/đổi tên/đổi mức/xoá vai, gán và
// gỡ người. Một nút Lưu chạy `buildOps` tuần tự qua `runOps` (tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá). Chỉ lưu CHÊNH LỆCH so với bản đã tải.
import type { AppRole, AppRoleLevel } from "@ai/contracts";

export type NewRole = { tempId: string; pack: string; name: string; level: AppRoleLevel };
export type RoleEdit = { name?: string; level?: AppRoleLevel };
export type Staged = {
  created: NewRole[];
  edits: Record<string, RoleEdit>;
  deleted: string[];
  /** roleRef (id thật hoặc tempId) → user id được thêm. */
  adds: Record<string, string[]>;
  /** id vai thật → user id bị gỡ. */
  removes: Record<string, string[]>;
};

export const emptyStaged = (): Staged => ({
  created: [],
  edits: {},
  deleted: [],
  adds: {},
  removes: {},
});

const without = <T>(xs: readonly T[] | undefined, x: T): T[] => (xs ?? []).filter((y) => y !== x);
const withItem = <T>(xs: readonly T[] | undefined, x: T): T[] => [...without(xs, x), x];
const dropKey = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  const { [key]: _gone, ...rest } = rec;
  return rest;
};
const setList = (rec: Record<string, string[]>, key: string, xs: string[]) =>
  xs.length ? { ...rec, [key]: xs } : dropKey(rec, key);

/** Sửa tên/mức của vai đã lưu; trường trùng bản gốc bị bỏ (không tính là thay đổi). */
export function stageEdit(s: Staged, base: AppRole, patch: RoleEdit): Staged {
  const next: RoleEdit = { ...s.edits[base.id], ...patch };
  if (next.name === undefined || next.name === base.name.vi) next.name = undefined;
  if (next.level === undefined || next.level === base.level) next.level = undefined;
  const clean: RoleEdit = {};
  if (next.name !== undefined) clean.name = next.name;
  if (next.level !== undefined) clean.level = next.level;
  const empty = clean.name === undefined && clean.level === undefined;
  return { ...s, edits: empty ? dropKey(s.edits, base.id) : { ...s.edits, [base.id]: clean } };
}

export const stageCreate = (s: Staged, role: NewRole): Staged => ({
  ...s,
  created: [...s.created, role],
});

export const stageEditNew = (s: Staged, tempId: string, patch: RoleEdit): Staged => ({
  ...s,
  created: s.created.map((r) =>
    r.tempId === tempId
      ? {
          ...r,
          ...(patch.name === undefined ? {} : { name: patch.name }),
          level: patch.level ?? r.level,
        }
      : r,
  ),
});

/** Xoá vai: vai tạm biến mất cùng người đã gán; vai đã lưu vào danh sách xoá (bỏ mọi sửa/gán dở). */
export function stageDelete(s: Staged, roleRef: string): Staged {
  if (s.created.some((r) => r.tempId === roleRef)) {
    return {
      ...s,
      created: s.created.filter((r) => r.tempId !== roleRef),
      adds: dropKey(s.adds, roleRef),
    };
  }
  return {
    ...s,
    deleted: withItem(s.deleted, roleRef),
    edits: dropKey(s.edits, roleRef),
    adds: dropKey(s.adds, roleRef),
  };
}

export const undoDelete = (s: Staged, roleId: string): Staged => ({
  ...s,
  deleted: without(s.deleted, roleId),
});

/** Người đang ở trong vai SAU các thay đổi chưa lưu (`saved` = có trong bản đã tải). */
export function isMember(s: Staged, roleRef: string, userId: string, saved: boolean): boolean {
  if (s.adds[roleRef]?.includes(userId)) return true;
  return saved && !s.removes[roleRef]?.includes(userId);
}

/** Muốn người ở trong/ngoài vai: ghi chênh lệch so với bản đã lưu. */
export function setMembership(
  s: Staged,
  roleRef: string,
  userId: string,
  saved: boolean,
  want: boolean,
): Staged {
  if (saved) {
    const removes = want
      ? without(s.removes[roleRef], userId)
      : withItem(s.removes[roleRef], userId);
    return { ...s, removes: setList(s.removes, roleRef, removes) };
  }
  const adds = want ? withItem(s.adds[roleRef], userId) : without(s.adds[roleRef], userId);
  return { ...s, adds: setList(s.adds, roleRef, adds) };
}

/** Số người của vai sau thay đổi chưa lưu (vai tạm: chỉ số người đã gán). */
export function memberCountAfter(s: Staged, role: { id: string; member_count: number }): number {
  return role.member_count + (s.adds[role.id]?.length ?? 0) - (s.removes[role.id]?.length ?? 0);
}

const sumLens = (rec: Record<string, string[]>): number =>
  Object.values(rec).reduce((n, xs) => n + xs.length, 0);

/** Số thay đổi cho badge "N thay đổi chưa lưu". */
export const pendingCount = (s: Staged): number =>
  s.created.length +
  Object.keys(s.edits).length +
  s.deleted.length +
  sumLens(s.adds) +
  sumLens(s.removes);

export type Op =
  | { kind: "create"; tempId: string; pack: string; name: string; level: AppRoleLevel }
  | { kind: "update"; id: string; version: number; name?: string; level?: AppRoleLevel }
  | { kind: "addMembers"; role: string; userIds: string[] }
  | { kind: "removeMember"; role: string; userId: string }
  | { kind: "delete"; id: string };

/** Thứ tự: tạo vai ⇒ sửa vai ⇒ gán/gỡ người ⇒ xoá vai (vai xoá phải hết người trước khi xoá). Mỗi vai một lô gán. */
export function buildOps(s: Staged, roles: readonly AppRole[]): Op[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const ops: Op[] = s.created.map((r) => ({ kind: "create", ...r }));
  for (const [id, e] of Object.entries(s.edits)) {
    const base = byId.get(id);
    if (base) ops.push({ kind: "update", id, version: base.version, ...e });
  }
  for (const [role, userIds] of Object.entries(s.adds)) {
    if (!s.deleted.includes(role)) ops.push({ kind: "addMembers", role, userIds });
  }
  for (const [role, userIds] of Object.entries(s.removes)) {
    for (const userId of userIds) ops.push({ kind: "removeMember", role, userId });
  }
  for (const id of s.deleted) ops.push({ kind: "delete", id });
  return ops;
}

export type OpsApi = {
  create(body: {
    pack: string;
    name: { vi: string };
    level: AppRoleLevel;
  }): Promise<{ id: string }>;
  update(
    id: string,
    body: { version: number; name?: { vi: string }; level?: AppRoleLevel },
  ): Promise<unknown>;
  addMembers(id: string, userIds: string[]): Promise<unknown>;
  removeMember(id: string, userId: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
};

export type RunResult = { applied: number; total: number; error: unknown };

async function runOne(op: Op, api: OpsApi, real: Map<string, string>): Promise<void> {
  const id = (ref: string) => real.get(ref) ?? ref;
  switch (op.kind) {
    case "create": {
      const made = await api.create({ pack: op.pack, name: { vi: op.name }, level: op.level });
      real.set(op.tempId, made.id);
      return;
    }
    case "update":
      await api.update(op.id, {
        version: op.version,
        ...(op.name === undefined ? {} : { name: { vi: op.name } }),
        ...(op.level === undefined ? {} : { level: op.level }),
      });
      return;
    case "addMembers":
      await api.addMembers(id(op.role), op.userIds);
      return;
    case "removeMember":
      await api.removeMember(id(op.role), op.userId);
      return;
    case "delete":
      await api.remove(op.id);
  }
}

/** Chạy tuần tự, dừng ở lỗi đầu tiên. `error: null` = xong cả lô; `applied` = số thao tác đã ghi thành công. */
export async function runOps(ops: readonly Op[], api: OpsApi): Promise<RunResult> {
  const real = new Map<string, string>(); // tempId → id thật
  let applied = 0;
  for (const op of ops) {
    try {
      await runOne(op, api, real);
      applied++;
    } catch (error) {
      return { applied, total: ops.length, error };
    }
  }
  return { applied, total: ops.length, error: null };
}
