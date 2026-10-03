// ADM-FR-51, ADM-BR-09 · M4-R12 · truy vấn admin.audit_log (plan §4.3). Gọi trong một `withScope` của actor: RLS
// (`audit_log_select`) + điều kiện `tenant_id` tường minh. Phân trang keyset `seq < cursor order by seq desc limit n+1`
// — index `audit_log_tenant_seq_idx` (lọc tenant), `audit_log_entity_seq_idx` (entity/entity_id),
// `audit_log_actor_seq_idx` (actor), `audit_log_seq_uq` (all/system).
import type { AuditAction, AuditEntity } from "@ai/contracts";
import { auditLog, type Tx, tenants } from "@ai/db";
import { and, desc, eq, gte, ilike, isNull, lt, type SQL, sql } from "drizzle-orm";
import { likeArg, outer } from "../../lib/sql";
import type { AuditFilter } from "./audit.rules";

export type AuditRow = {
  id: string;
  seq: string;
  at: Date;
  tenantId: string | null;
  tenantKey: string | null;
  actorId: string | null;
  actorUsername: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  entityName: string;
  configVersion: number | null;
  entityVersion: number | null;
  summary: Record<string, unknown>;
  snapshot: boolean;
  /** Không có dòng nào mới hơn cùng `(entity, entity_id)` — luật khôi phục dòng `delete` (`canRestore`). */
  latest: boolean;
};
export type AuditDetailRow = AuditRow & {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const tenantKey = sql<string | null>`(select ${tenants.key} from ${tenants}
  where ${tenants.id} = ${outer(auditLog.tenantId)})`;

// Probe `audit_log_entity_seq_idx` mỗi hàng của trang (≤ 201). RLS cùng scope: tenant_admin không thấy dòng ngoài
// tenant nhưng với họ `restorable` luôn false (Q8), nên không ảnh hưởng.
const latest = sql<boolean>`not exists (select 1 from "admin"."audit_log" as newer
  where newer.entity = ${outer(auditLog.entity)} and newer.entity_id = ${outer(auditLog.entityId)}
    and newer.seq > ${outer(auditLog.seq)})`;

const rowCols = {
  id: auditLog.id,
  seq: sql<string>`${auditLog.seq}::text`,
  at: auditLog.at,
  tenantId: auditLog.tenantId,
  tenantKey,
  actorId: auditLog.actorId,
  actorUsername: auditLog.actorUsername,
  action: auditLog.action,
  entity: auditLog.entity,
  entityId: auditLog.entityId,
  entityName: auditLog.entityName,
  configVersion: auditLog.configVersion,
  entityVersion: auditLog.entityVersion,
  summary: auditLog.summary,
  snapshot: auditLog.snapshot,
  latest,
};

export type AuditListFilter = {
  scope: AuditFilter;
  entity?: AuditEntity;
  action?: AuditAction;
  actorId?: string;
  entityId?: string;
  q?: string;
  since: Date;
  until: Date | null;
  cursor: string | null;
  limit: number;
};

function scopeWhere(f: AuditFilter): SQL | undefined {
  if (f.kind === "tenant") return eq(auditLog.tenantId, f.tenantId);
  if (f.kind === "system") return isNull(auditLog.tenantId);
  return undefined;
}

/** Trả tối đa `limit + 1` hàng (hàng thừa = còn trang sau). */
export async function listAudit(tx: Tx, f: AuditListFilter): Promise<AuditRow[]> {
  const rows = await tx
    .select(rowCols)
    .from(auditLog)
    .where(
      and(
        scopeWhere(f.scope),
        f.entity ? eq(auditLog.entity, f.entity) : undefined,
        f.action ? eq(auditLog.action, f.action) : undefined,
        f.actorId ? eq(auditLog.actorId, f.actorId) : undefined,
        f.entityId ? eq(auditLog.entityId, f.entityId) : undefined,
        f.q ? ilike(auditLog.entityName, likeArg(f.q)) : undefined,
        gte(auditLog.at, f.since),
        f.until ? lt(auditLog.at, f.until) : undefined,
        f.cursor ? sql`${auditLog.seq} < ${f.cursor}::bigint` : undefined,
      ),
    )
    .orderBy(desc(auditLog.seq))
    .limit(f.limit + 1);
  return rows as AuditRow[];
}

/** Một hàng theo id trong phạm vi `scope` (tenant_admin: chỉ tenant mình; hàng NULL/tenant khác → null). */
export async function getAudit(
  tx: Tx,
  scope: AuditFilter,
  id: string,
): Promise<AuditDetailRow | null> {
  const [row] = await tx
    .select({ ...rowCols, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.id, id), scopeWhere(scope)))
    .limit(1);
  return (row as AuditDetailRow | undefined) ?? null;
}
