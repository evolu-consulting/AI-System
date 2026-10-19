// I1 · duyệt bản ghi có `org_id` của một index: đếm đọc, bỏ (đếm) bản ghi không có tenant, gọi mapper với kế hoạch tenant.
import { type Ctx, docsOf, type Snapshot, type SourceDoc } from "./context";
import { bump, type Plan, type TenantPlan, tenantPlan } from "./plan";
import { str } from "./values.rules";

export function eachOrgDoc(
  s: Snapshot,
  ctx: Ctx,
  p: Plan,
  index: string,
  fn: (d: SourceDoc, t: TenantPlan) => void,
): void {
  for (const d of docsOf(s, index)) {
    const org = str(d.src.org_id, 128);
    const tid = ctx.tenantOf(org);
    if (!tid || !org) {
      bump(p.noTenant, index);
      continue;
    }
    fn(d, tenantPlan(p, tid, org));
  }
}
