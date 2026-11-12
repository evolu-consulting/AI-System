// CR-139 · Q13 · luật thuần của «Sơ đồ tổ chức»: danh sách phòng ban phẳng (`parent_id`) ⇒ cây; tìm người/phòng (không phân biệt dấu).
import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";

export type OrgNode = ContractsOrgDept & { children: OrgNode[] };

const fold = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().trim();

/** `a` có là tổ tiên (hoặc chính) của `of` — chặn vòng cha–con. */
function isAncestor(nodes: ReadonlyMap<string, OrgNode>, a: string, of: string): boolean {
  const seen = new Set<string>();
  for (let cur: string | null | undefined = of; cur && !seen.has(cur); ) {
    if (cur === a) return true;
    seen.add(cur);
    cur = nodes.get(cur)?.parent_id;
  }
  return false;
}

/** Phòng không có cha (hoặc cha không còn trong danh sách) là gốc; thứ tự anh em giữ như server (theo tên). Vòng cha–con bị cắt. */
export function buildOrgTree(depts: readonly ContractsOrgDept[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>(depts.map((d) => [d.id, { ...d, children: [] }]));
  const roots: OrgNode[] = [];
  for (const n of nodes.values()) {
    const p = n.parent_id ? nodes.get(n.parent_id) : undefined;
    if (p && !isAncestor(nodes, n.id, p.id)) p.children.push(n);
    else roots.push(n);
  }
  return roots;
}

const selfMatches = (n: OrgNode, q: string): boolean =>
  fold(n.name).includes(q) ||
  (n.head ? fold(n.head.name).includes(q) : false) ||
  n.members.some((m) => fold(m.name).includes(q));

/** Giữ phòng khớp (tên phòng / trưởng phòng / thành viên) và mọi tổ tiên của nó; phòng khớp giữ nguyên con cháu. Rỗng ⇒ cả cây. */
export function filterOrg(roots: readonly OrgNode[], query: string): OrgNode[] {
  const q = fold(query);
  if (q === "") return [...roots];
  const walk = (n: OrgNode): OrgNode | null => {
    if (selfMatches(n, q)) return n;
    const kids = n.children.flatMap((c) => walk(c) ?? []);
    return kids.length > 0 ? { ...n, children: kids } : null;
  };
  return roots.flatMap((r) => walk(r) ?? []);
}

/** Số người khác nhau trong cả nhánh (đếm một lần dù thuộc nhiều phòng). */
export function headcount(n: OrgNode): number {
  const ids = new Set<string>();
  const add = (x: OrgNode) => {
    for (const m of x.members) ids.add(m.id);
    if (x.head) ids.add(x.head.id);
    for (const c of x.children) add(c);
  };
  add(n);
  return ids.size;
}
