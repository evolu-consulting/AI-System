// CR-142 · API Sổ Hợp Tác (`ContractsOrgDept`) ⇒ đầu vào sơ đồ cây dùng chung (`@ai/flow-canvas/pure`).

import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";
import type { OrgChartDept } from "@ai/flow-canvas/pure";

export const toChartDepts = (depts: readonly ContractsOrgDept[]): OrgChartDept[] =>
  depts.map((d) => ({
    id: d.id,
    name: d.name,
    parentId: d.parent_id,
    head: d.head,
    members: d.members,
  }));
