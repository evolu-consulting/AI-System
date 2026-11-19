// CR-139d · CR-189 · luật thuần của màn «Cơ cấu tổ chức» (admin): danh sách phòng ban phẳng (`parent_group_id`) ⇒ cây; chặn vòng khi chuyển
// phòng cha; đếm «còn người/phòng con» để báo trước khi xoá; câu lỗi nghiệp vụ từ mã lỗi API.
import type { OrgAccessChange, OrgDepartment } from "@ai/contracts/org";

export type DeptNode = OrgDepartment & { children: DeptNode[] };
export type DeptRow = { dept: OrgDepartment; depth: number };

/** Từ `start` leo lên cha; true nếu gặp `target` (hoặc chính `start`). Dừng khi lặp (dữ liệu hỏng không treo UI). */
function climbsTo(
  byId: ReadonlyMap<string, OrgDepartment>,
  start: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  for (let cur: string | null | undefined = start; cur && !seen.has(cur); ) {
    if (cur === target) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parent_group_id;
  }
  return false;
}

/** Cha không có trong danh sách (hoặc tạo vòng) ⇒ coi là gốc; anh em giữ thứ tự đầu vào. */
export function buildDeptTree(depts: readonly OrgDepartment[]): DeptNode[] {
  const byId = new Map(depts.map((d) => [d.group_id, d]));
  const nodes = new Map<string, DeptNode>(depts.map((d) => [d.group_id, { ...d, children: [] }]));
  const roots: DeptNode[] = [];
  for (const n of nodes.values()) {
    const pid = n.parent_group_id;
    const p = pid ? nodes.get(pid) : undefined;
    if (p && !climbsTo(byId, pid as string, n.group_id)) p.children.push(n);
    else roots.push(n);
  }
  return roots;
}

/** Cây ⇒ dòng phẳng theo thứ tự duyệt (cha trước con) kèm độ sâu để thụt lề. */
export function flattenTree(roots: readonly DeptNode[]): DeptRow[] {
  const out: DeptRow[] = [];
  const walk = (n: DeptNode, depth: number) => {
    out.push({ dept: n, depth });
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

/** Các phòng được chọn làm «Thuộc phòng» của `id`: mọi phòng trừ chính nó và con cháu nó (chặn vòng). */
export function parentChoices(depts: readonly OrgDepartment[], id: string): DeptRow[] {
  const byId = new Map(depts.map((d) => [d.group_id, d]));
  const valid = new Set(
    depts
      .filter((d) => d.group_id !== id && !climbsTo(byId, d.group_id, id))
      .map((d) => d.group_id),
  );
  return flattenTree(buildDeptTree(depts)).filter((r) => valid.has(r.dept.group_id));
}

/**
 * Kéo/chọn phòng `id` sang phòng cha `to` (null = công ty) có hợp lệ không: phòng phải còn tồn tại, KHÔNG vào chính nó hay con cháu của nó
 * (chặn ở UI, API cũng chặn `dept_cycle`), và phải khác phòng cha hiện tại.
 */
export function canMoveDept(
  depts: readonly OrgDepartment[],
  id: string,
  to: string | null,
): boolean {
  const byId = new Map(depts.map((d) => [d.group_id, d]));
  const cur = byId.get(id);
  if (!cur || to === cur.parent_group_id) return false;
  if (to === null) return true;
  return byId.has(to) && !climbsTo(byId, to, id);
}

/** Số người (thành viên ∪ trưởng phòng, không đếm trùng) và số phòng con của một phòng — báo trước khi xoá. */
export function deptLoad(
  depts: readonly OrgDepartment[],
  id: string,
): { members: number; children: number } {
  const d = depts.find((x) => x.group_id === id);
  const people = new Set(d?.member_ids ?? []);
  if (d?.head_user_id) people.add(d.head_user_id);
  return {
    members: people.size,
    children: depts.filter((x) => x.parent_group_id === id).length,
  };
}

export type OrgErrorSpec = { key: string; params?: Record<string, string | number> };

/**
 * Mã lỗi sửa cơ cấu ⇒ câu nghiệp vụ (key i18n). `null` = không phải lỗi cơ cấu (host dùng câu lỗi chung).
 * DEPT_NOT_EMPTY `{members, children}`, MEMBER_IS_HEAD, DEPT_IN_USE `{open_reviews}`, NAME_TAKEN, dept_cycle.
 */
export function orgErrorSpec(err: { code: string; details?: unknown }): OrgErrorSpec | null {
  const d = (err.details ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  if (err.code === "DEPT_NOT_EMPTY") {
    const m = n("members");
    const c = n("children");
    const what = m > 0 && c > 0 ? "both" : m > 0 ? "members" : "children";
    return { key: `orgEdit.err.notEmpty.${what}`, params: { members: m, children: c } };
  }
  if (err.code === "MEMBER_IS_HEAD") return { key: "orgEdit.err.memberIsHead" };
  if (err.code === "DEPT_IN_USE")
    return { key: "orgEdit.err.inUse", params: { count: n("open_reviews") } };
  if (err.code === "NAME_TAKEN") return { key: "orgEdit.err.nameTaken" };
  if (JSON.stringify(d).includes("dept_cycle")) return { key: "orgEdit.cycle" };
  return null;
}

/** Có quyền theo nhóm đổi ⇒ tham số cho câu «Quyền theo phòng đổi…»; không đổi ⇒ null. */
export function accessNote(
  a: OrgAccessChange | undefined,
): { gained: number; lost: number } | null {
  return a && (a.gained > 0 || a.lost > 0) ? { gained: a.gained, lost: a.lost } : null;
}
