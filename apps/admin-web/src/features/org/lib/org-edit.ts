// CR-139d · luật thuần của màn «Cơ cấu tổ chức» (admin): danh sách phòng ban phẳng (`parent_group_id`) ⇒ cây; chọn «Thuộc phòng» không tạo vòng.
import type { OrgDepartment } from "@ai/contracts/org";

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

/** Khoá nhóm ([a-z0-9-]{2,32}) tự sinh từ tên: bỏ dấu, gạch nối, thêm hậu tố ngẫu nhiên để không trùng. */
export function deptKey(name: string, rand: () => number = Math.random): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 22);
  const tail = Math.floor(rand() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${slug || "phong"}-${tail}`;
}
