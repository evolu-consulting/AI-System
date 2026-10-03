// ADM-FR-31, ADM-BR-12 · entitlement feature ↔ tenant (spec M2 §3, M2-R22). Thu hồi = `revoked_at` (giữ hàng);
// `core` tự hiệu lực mọi tenant nên không có hàng (PUT/DELETE → CORE_FEATURE_PROTECTED, GET → rỗng).
// Khoá feature FOR SHARE (chặn xoá feature song song); tenant chỉ bị FK KEY SHARE. Không tăng version feature.
import type { Entitlement, EntitlementListResponse } from "@ai/contracts";
import { type AuditInput, type Tx, withScope } from "@ai/db";
import { auditOf } from "../../lib/audit/audit.write";
import { configWrite } from "../../lib/config/config-write";
import { appError } from "../../lib/errors";
import { afterLock } from "../../lib/test-hooks";
import * as repo from "./features.repo";
import { checkEntitlementTarget, isCore } from "./features.rules";
import { type Call, fail } from "./features.service";

function toEntitlement(r: repo.EntitlementRow): Entitlement {
  return {
    tenant_id: r.tenantId,
    tenant_key: r.tenantKey,
    tenant_name: r.tenantName,
    tenant_active: r.tenantActive,
    active_user_count: r.activeUserCount,
    granted_at: r.grantedAt.toISOString(),
    granted_by: r.grantedBy,
  };
}

export function listEntitlements(
  c: Call,
  featureId: string,
  q: { q?: string; limit: number; offset: number },
): Promise<EntitlementListResponse> {
  return withScope(c.ctx.db, c.scope, async (tx) => {
    const f = await repo.findFeature(tx, featureId);
    if (!f) throw appError("NOT_FOUND");
    if (isCore(f)) return { items: [], total: 0 };
    const rows = await repo.listEntitlements(tx, featureId, q);
    return {
      items: rows.map(({ total: _t, ...r }) => toEntitlement(r)),
      total: rows[0]?.total ?? 0,
    };
  });
}

/** Hàng audit `entitlement` (plan M4 §4.2): tenant_id = tenant được cấp, entity_id = feature, tên = feature key. */
function entitlementAudit(
  action: "grant" | "revoke",
  f: { id: string; key: string },
  tenantId: string,
): AuditInput {
  const dto = { feature_id: f.id, tenant_id: tenantId };
  return auditOf(action, "entitlement", {
    entityId: f.id,
    entityName: f.key,
    tenantId,
    before: action === "revoke" ? dto : null,
    after: action === "grant" ? dto : null,
  });
}

/** Feature lạ (ưu tiên) → 404; core → 409; tenant lạ → 404 (cùng body). Trả feature đã khoá. */
async function target(
  c: Call,
  tx: Tx,
  ids: { featureId: string; tenantId: string },
): Promise<{ id: string; key: string }> {
  const { featureId, tenantId } = ids;
  const f = await repo.lockFeature(tx, featureId, "share");
  if (!f) throw appError("NOT_FOUND");
  await afterLock(c.ctx.hooks, "entitlement.save", "locked");
  fail(checkEntitlementTarget(f));
  if (!(await repo.tenantExists(tx, tenantId))) throw appError("NOT_FOUND");
  return f;
}

export function grantEntitlement(
  c: Call,
  featureId: string,
  tenantId: string,
): Promise<Entitlement> {
  return configWrite(c, "entitlement.save", async (tx, ch) => {
    const f = await target(c, tx, { featureId, tenantId });
    const n = await repo.grantEntitlement(tx, { featureId, tenantId, actorId: c.actor.userId });
    if (n > 0) {
      ch.changed({ entity: "entitlement", tenantId });
      ch.audit(entitlementAudit("grant", f, tenantId));
    }
    await afterLock(c.ctx.hooks, "entitlement.save", "rows");
    const row = await repo.findEntitlement(tx, featureId, tenantId);
    if (!row) throw new Error("features: không đọc lại được entitlement vừa cấp");
    return toEntitlement(row);
  });
}

export function revokeEntitlement(c: Call, featureId: string, tenantId: string): Promise<void> {
  return configWrite(c, "entitlement.save", async (tx, ch) => {
    const f = await target(c, tx, { featureId, tenantId });
    const n = await repo.revokeEntitlement(tx, { featureId, tenantId });
    if (n > 0) {
      ch.changed({ entity: "entitlement", tenantId });
      ch.audit(entitlementAudit("revoke", f, tenantId));
    }
    await afterLock(c.ctx.hooks, "entitlement.save", "rows");
  });
}
