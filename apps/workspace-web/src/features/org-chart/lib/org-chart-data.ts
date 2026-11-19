// CR-142 · API Sổ Hợp Tác (`ContractsOrgDept`) ⇒ đầu vào sơ đồ cây dùng chung (`@ai/flow-canvas/pure`).

import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";
import type { OrgChartDept, OrgChartPerson } from "@ai/flow-canvas/pure";

const toPerson = (p: ContractsOrgDept["members"][number]): OrgChartPerson => ({
  id: p.id,
  name: p.name,
  jobTitle: p.job_title ?? null,
});

export const toChartDepts = (depts: readonly ContractsOrgDept[]): OrgChartDept[] =>
  depts.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    head: d.head ? toPerson(d.head) : null,
    members: d.members.map(toPerson),
  }));
