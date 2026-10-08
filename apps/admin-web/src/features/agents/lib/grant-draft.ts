// HUB-FR-78 · CR-054 · ngăn "Cấp quyền": trạng thái chọn (cả công ty | nhóm + người) ↔ grant Hub, chênh lệch để POST/DELETE.
import type { AgentGrantRow, GrantSubjectType } from "@ai/contracts/hub-admin";

export type GrantScope = "all" | "some";
export type GrantSelection = {
  scope: GrantScope;
  groups: ReadonlySet<string>;
  users: ReadonlySet<string>;
};

/** Một grant cần thêm/xoá: `subject_id` = tenant id khi `tenant`. */
export type GrantChange = { subject_type: GrantSubjectType; subject_id: string };
export type GrantDiff = { add: GrantChange[]; remove: GrantChange[] };

/** Grant hiện có → lựa chọn ban đầu. Có grant `tenant` ⇒ "Cả công ty" (vẫn nhớ nhóm/người cũ để đổi qua lại). */
export function selectionFromRows(rows: readonly AgentGrantRow[]): GrantSelection {
  const groups = new Set<string>();
  const users = new Set<string>();
  let all = false;
  for (const r of rows) {
    if (r.subject.type === "tenant") all = true;
    else if (r.subject.type === "group") groups.add(r.subject.group.id);
    else users.add(r.subject.user.id);
  }
  return { scope: all ? "all" : "some", groups, users };
}

const key = (c: GrantChange) => `${c.subject_type}:${c.subject_id}`;

function changesOf(sel: GrantSelection, tenantId: string): GrantChange[] {
  if (sel.scope === "all") return [{ subject_type: "tenant", subject_id: tenantId }];
  return [
    ...[...sel.groups].map((id): GrantChange => ({ subject_type: "group", subject_id: id })),
    ...[...sel.users].map((id): GrantChange => ({ subject_type: "user", subject_id: id })),
  ];
}

function rowChange(r: AgentGrantRow, tenantId: string): GrantChange {
  const s = r.subject;
  if (s.type === "tenant") return { subject_type: "tenant", subject_id: tenantId };
  if (s.type === "group") return { subject_type: "group", subject_id: s.group.id };
  return { subject_type: "user", subject_id: s.user.id };
}

/** Chênh lệch giữa grant hiện có và lựa chọn. "Cả công ty" ⇒ thu hồi grant nhóm/người (một grant `tenant` thay tất cả). */
export function grantDiff(
  rows: readonly AgentGrantRow[],
  sel: GrantSelection,
  tenantId: string,
): GrantDiff {
  const before = rows.map((r) => rowChange(r, tenantId));
  const after = changesOf(sel, tenantId);
  const had = new Set(before.map(key));
  const want = new Set(after.map(key));
  return {
    add: after.filter((c) => !had.has(key(c))),
    remove: before.filter((c) => !want.has(key(c))),
  };
}

export const isEmptyDiff = (d: GrantDiff): boolean => d.add.length === 0 && d.remove.length === 0;

export function toggleIn(set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}
