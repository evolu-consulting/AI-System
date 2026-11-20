// CR-142 · sơ đồ tổ chức dạng cây: danh sách phòng ban phẳng (parent) ⇒ nodes/edges có toạ độ (cây từ trên xuống) + tìm phòng.
// Thuần (không React/xyflow). Bố cục tự viết (anh em cạnh nhau, cha ở giữa con) — không cần worker ELK, chạy đồng bộ, O(n).

export type OrgChartPerson = {
  id: string;
  name: string;
  jobTitle?: string | null;
  /** Ảnh đại diện thật (data URL); vắng => chữ cái đầu. */
  avatar?: string | null;
};
export type OrgChartDept = {
  id: string;
  name: string;
  parentId: string | null;
  head: OrgChartPerson | null;
  /** Mọi người thuộc phòng (gồm cả trưởng phòng nếu có trong danh sách; trưởng phòng luôn được đếm). */
  members: readonly OrgChartPerson[];
};

export const ORG_ROOT_ID = "__company__";
export const ORG_NODE_W = 232;
export const ORG_NODE_H = 136;
const GAP_X = 28;
const GAP_Y = 56;

export type OrgNodeData = {
  kind: "company" | "dept";
  name: string;
  head: OrgChartPerson | null;
  /** BR-189-2 · «N người»: trực tiếp = thành viên ∪ trưởng phòng (không đếm phòng con). Công ty: tổng mọi người. */
  count: number;
  /** BR-189-2 · «tổng M»: số người khác nhau cả nhánh; chỉ khác `count` khi có phòng con. Công ty: bằng `count`. */
  total: number;
  /** Có phòng con ⇒ thẻ hiện «· tổng M». */
  hasChildren: boolean;
  /** Hàng avatar nhân viên: thành viên trực tiếp, KHÔNG gồm trưởng phòng. */
  staff: readonly OrgChartPerson[];
  members: readonly OrgChartPerson[];
};

/** Nhân viên của thẻ (không gồm trưởng phòng, mỗi người một lần). Thuần. */
export function staffOf(d: Pick<OrgChartDept, "head" | "members">): OrgChartPerson[] {
  const seen = new Set<string>(d.head ? [d.head.id] : []);
  return d.members.filter((m) => !seen.has(m.id) && seen.add(m.id));
}
export type OrgGraphNode = { id: string; x: number; y: number; data: OrgNodeData };
export type OrgGraphEdge = { id: string; source: string; target: string };
export type OrgGraph = { nodes: OrgGraphNode[]; edges: OrgGraphEdge[] };

const fold = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase().trim();

/** Cha → danh sách con (giữ thứ tự đầu vào). Cha không tồn tại / vòng cha–con ⇒ treo dưới gốc công ty. */
function childrenMap(depts: readonly OrgChartDept[]): Map<string, string[]> {
  const byId = new Map(depts.map((d) => [d.id, d]));
  /** Đi lên từ `id` quay lại chính nó ⇒ `id` nằm trong vòng cha–con. */
  const inCycle = (id: string): boolean => {
    const seen = new Set<string>();
    for (let cur = byId.get(id)?.parentId; cur && byId.has(cur) && !seen.has(cur); ) {
      if (cur === id) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    return false;
  };
  const kids = new Map<string, string[]>([[ORG_ROOT_ID, []]]);
  for (const d of depts) kids.set(d.id, []);
  for (const d of depts) {
    const p = d.parentId && d.parentId !== d.id && byId.has(d.parentId) ? d.parentId : null;
    // phòng nằm trong vòng ⇒ không có đường lên gốc: treo dưới gốc (cắt vòng tại đây)
    const parent = p && !inCycle(d.id) ? p : ORG_ROOT_ID;
    kids.get(parent)?.push(d.id);
  }
  return kids;
}

/** Người của riêng một phòng (thành viên + trưởng phòng); không phòng (gốc công ty) ⇒ rỗng. */
function ownPeople(d: OrgChartDept | undefined): Map<string, OrgChartPerson> {
  const people = new Map<string, OrgChartPerson>();
  if (!d) return people;
  for (const m of d.members) people.set(m.id, m);
  if (d.head) people.set(d.head.id, d.head);
  return people;
}

/** Dữ liệu một node: phòng (có `d`) hoặc gốc công ty. */
function nodeData(
  d: OrgChartDept | undefined,
  rootName: string,
  n: { direct: number; total: number; hasChildren: boolean },
): OrgGraphNode["data"] {
  return d
    ? {
        kind: "dept",
        name: d.name,
        head: d.head,
        count: n.direct,
        total: n.total,
        hasChildren: n.hasChildren,
        staff: staffOf(d),
        members: d.members,
      }
    : {
        kind: "company",
        name: rootName,
        head: null,
        count: n.total,
        total: n.total,
        hasChildren: false,
        staff: [],
        members: [],
      };
}

export function buildOrgGraph(depts: readonly OrgChartDept[], rootName: string): OrgGraph {
  const byId = new Map(depts.map((d) => [d.id, d]));
  const kids = childrenMap(depts);
  const edges: OrgGraphEdge[] = [];
  const nodes: OrgGraphNode[] = [];
  let slot = 0; // cột lá kế tiếp

  /** Trả [x giữa, người của nhánh]; đặt node theo hậu thứ tự. */
  const place = (id: string, depth: number): { x: number; people: Map<string, OrgChartPerson> } => {
    const d = byId.get(id);
    const people = ownPeople(d);
    const direct = people.size;
    const childIds = kids.get(id) ?? [];
    const xs: number[] = [];
    for (const c of childIds) {
      edges.push({ id: `${id}>${c}`, source: id, target: c });
      const r = place(c, depth + 1);
      xs.push(r.x);
      for (const [k, v] of r.people) people.set(k, v);
    }
    const x =
      xs.length > 0 ? ((xs[0] ?? 0) + (xs[xs.length - 1] ?? 0)) / 2 : slot++ * (ORG_NODE_W + GAP_X);
    nodes.push({
      id,
      x: Math.round(x),
      y: depth * (ORG_NODE_H + GAP_Y),
      data: nodeData(d, rootName, { direct, total: people.size, hasChildren: childIds.length > 0 }),
    });
    return { x, people };
  };
  place(ORG_ROOT_ID, 0);
  return { nodes, edges };
}

/** Phòng khớp (tên phòng / trưởng phòng / thành viên), không phân biệt dấu; rỗng ⇒ []. Tên phòng khớp xếp trước. */
export function searchDepts(depts: readonly OrgChartDept[], query: string): string[] {
  const q = fold(query);
  if (q === "") return [];
  const byName: string[] = [];
  const byPerson: string[] = [];
  for (const d of depts) {
    if (fold(d.name).includes(q)) byName.push(d.id);
    else if (
      (d.head && fold(d.head.name).includes(q)) ||
      d.members.some((m) => fold(m.name).includes(q))
    )
      byPerson.push(d.id);
  }
  return [...byName, ...byPerson];
}

/** CR-193 · điện thoại (< 640px): vừa khung làm chữ ~4px ⇒ zoom tối thiểu 0.85 (chữ ≥ 11px), bắt đầu ở nút gốc; người dùng vẫn kéo/zoom tự do. */
export const ORG_PHONE_MAX_W = 640;
export const ORG_PHONE_MIN_ZOOM = 0.85;
export function orgFitOptions(viewportW: number): {
  padding: number;
  maxZoom: number;
  minZoom?: number;
  nodes?: { id: string }[];
} {
  return viewportW < ORG_PHONE_MAX_W
    ? {
        padding: 0.1,
        minZoom: ORG_PHONE_MIN_ZOOM,
        maxZoom: 1,
        nodes: [{ id: ORG_ROOT_ID }],
      }
    : { padding: 0.15, maxZoom: 1 };
}
