// CR-142 · API admin (`OrgResponse`) ⇒ đầu vào sơ đồ cây dùng chung (`@ai/flow-canvas/pure`). Thiếu người trong `members` ⇒ bỏ qua.
import type { OrgResponse } from "@ai/contracts/org";
import type { OrgChartDept, OrgChartPerson } from "@ai/flow-canvas/pure";

export function toChartDepts(org: OrgResponse | undefined): OrgChartDept[] {
  if (!org) return [];
  const who = new Map<string, OrgChartPerson>(
    org.members.map((m) => [m.user_id, { id: m.user_id, name: m.display_name }]),
  );
  const person = (id: string): OrgChartPerson | null => who.get(id) ?? null;
  return org.departments.map((d) => ({
    id: d.group_id,
    name: d.name,
    parentId: d.parent_group_id,
    head: d.head_user_id ? person(d.head_user_id) : null,
    members: d.member_ids.flatMap((id) => person(id) ?? []),
  }));
}
