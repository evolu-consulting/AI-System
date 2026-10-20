// I1 · dựng kế hoạch ghi từ ảnh chụp nguồn: chạy mọi mapper theo thứ tự phụ thuộc (HĐ ⇒ nhắc ⇒ CKS ⇒ sổ ⇒ vùng chờ ⇒ tri
// thức), thêm `visibility_settings.mode = 'org'` cho mỗi tenant (D-M1-01: luật thấy của mgmt-app). Thuần.
import { companyIndex } from "./companies.rules";
import { type Ctx, docsOf, type Snapshot } from "./context";
import { mapCks } from "./map-cks.rules";
import { type FileJob, mapContracts, mapReminders } from "./map-contracts.rules";
import type { Membership } from "./map-identity.rules";
import { mapKnowledge } from "./map-knowledge.rules";
import { mapLedger } from "./map-ledger.rules";
import { mapLegacy } from "./map-legacy.rules";
import { newPlan, type Plan, push, tenantPlan } from "./plan";
import { str } from "./values.rules";

export function buildPlan(
  s: Snapshot,
  ctx: Ctx,
  members: Map<string, Membership>,
  orgs: readonly string[],
): { plan: Plan; files: FileJob[] } {
  const p = newPlan();
  p.issues = ctx.issues;
  for (const [k, v] of Object.entries(s.docs)) p.read[k] = v.length;
  for (const [k, v] of Object.entries(s.graph)) p.read[`graph.${k}`] = v?.length ?? 0;
  for (const org of orgs) {
    const tid = ctx.tenantOf(org);
    if (tid) push(tenantPlan(p, tid, org), "contracts.visibility_settings", { mode: "org" });
  }
  const orgOfContract = new Map<string, string>();
  for (const d of docsOf(s, "contracts")) {
    const org = str(d.src.org_id, 128);
    if (org) orgOfContract.set(d.id, org);
  }
  const companies = companyIndex(s);
  const files = mapContracts(s, ctx, p);
  mapReminders(s, ctx, p, orgOfContract);
  const movedFollowups = mapCks(s, ctx, p, companies);
  mapLedger(s, ctx, p, companies);
  mapLegacy({ s, ctx, p }, members, movedFollowups);
  mapKnowledge(s, ctx, p, orgOfContract);
  return { plan: p, files };
}
