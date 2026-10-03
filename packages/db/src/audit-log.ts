// ADM-FR-51 · ghi `admin.audit_log` (plan M4 §4.1, M4-R10): một câu INSERT nhiều hàng, cùng transaction với thay đổi.
// Chỉ làm việc DB; allowlist/snapshot (`auditSnapshot`) là việc của admin-api `lib/audit` trước khi gọi.
import { type SQL, sql } from "drizzle-orm";
import type { AUDIT_ACTION_VALUES, AUDIT_ENTITY_VALUES } from "./schema/ops";
import type { Tx } from "./scope";

export type AuditActionValue = (typeof AUDIT_ACTION_VALUES)[number];
export type AuditEntityValue = (typeof AUDIT_ENTITY_VALUES)[number];
type Json = Readonly<Record<string, unknown>>;

/** Một hàng audit chưa gắn actor/`config_version` (`ConfigSink.audit`, plan §4.1). */
export type AuditInput = {
  /** Đặt trước khi cần trả id hàng audit cho client (restore: `audit_id`); vắng → `gen_random_uuid()`. */
  id?: string;
  action: AuditActionValue;
  entity: AuditEntityValue;
  entityId: string | null;
  entityName: string;
  /** NULL = toàn hệ thống (chỉ platform ghi/đọc được, RLS). */
  tenantId: string | null;
  before: Json | null;
  after: Json | null;
  entityVersion?: number | null;
  summary?: Json;
  snapshot?: boolean;
};

export type AuditMeta = {
  /** NULL = hệ thống. */
  actorId: string | null;
  /** `config_version` sau bump; NULL khi transaction không bump (users reset-password, 2FA). */
  v: number | null;
};

const json = (x: Json | null | undefined): string | null => (x == null ? null : JSON.stringify(x));

function valuesRow(r: AuditInput): SQL {
  return sql`(${r.id ?? null}::uuid, ${r.tenantId}::uuid, ${r.action}, ${r.entity}, ${r.entityId}::uuid, ${r.entityName},
    ${r.entityVersion ?? null}::int, ${json(r.before)}::jsonb, ${json(r.after)}::jsonb,
    ${json(r.summary ?? {})}::jsonb, ${r.snapshot ?? false}::boolean)`;
}

/**
 * Chèn mọi hàng bằng MỘT câu (không gì sau nó chờ khoá: bảng không FK). `actor_username` = snapshot `users.username`
 * lấy bằng subselect một lần (actor luôn thấy chính mình trong scope của mình). `rows` rỗng → không làm gì.
 */
export async function insertAuditRows(
  tx: Tx,
  rows: readonly AuditInput[],
  meta: AuditMeta,
): Promise<void> {
  if (rows.length === 0) return;
  await tx.execute(sql`
    insert into admin.audit_log (id, tenant_id, actor_id, actor_username, action, entity, entity_id, entity_name,
      config_version, entity_version, before, after, summary, snapshot)
    select coalesce(v.id, gen_random_uuid()), v.tenant_id, ${meta.actorId}::uuid,
      (select u.username from admin.users u where u.id = ${meta.actorId}::uuid),
      v.action, v.entity, v.entity_id, v.entity_name, ${meta.v}::int, v.entity_version, v.before, v.after,
      v.summary, v.snapshot
    from (values ${sql.join(rows.map(valuesRow), sql`, `)})
      as v(id, tenant_id, action, entity, entity_id, entity_name, entity_version, before, after, summary, snapshot)`);
}
