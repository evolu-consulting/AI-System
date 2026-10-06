// HUB-FR-78, HUB-FR-87 · H3b-R16, R19 · ghi `hub.audit_log` (append-only, plan-db §3) trong transaction của nghiệp vụ:
// lỗi ghi ⇒ ném ⇒ rollback cả thao tác (fail-closed). Không ghi nội dung tin, prompt, `detail`, secret.
// `HubAuditWriter` là điểm tiêm (P12/PL10): `AppDeps.hubAudit` ghi đè cho test lỗi giữa transaction (AC-04, AC-11).
import type { Tx } from "@ai/db";
import type {
  HUB_AUDIT_ACTION_VALUES,
  HUB_AUDIT_ACTOR_ROLE_VALUES,
  HUB_AUDIT_ENTITY_VALUES,
} from "@ai/db/schema/hub";
import { sql } from "drizzle-orm";

/** CHECK `hub_audit_log_entity_name_check` (0009). */
export const AUDIT_ENTITY_NAME_MAX = 200;

/** Một hàng audit (cột = `hub.audit_log`, trừ `id`/`seq`/`at` do DB sinh). `type` (không `interface`) để gán được vào bản ghi tổng quát. */
export type HubAuditRow = {
  /** Null = audit cấu hình phạm vi system (Studio H4a, 0010 D3). */
  tenantId: string | null;
  actorId: string | null;
  actorUsername: string | null;
  actorRole: (typeof HUB_AUDIT_ACTOR_ROLE_VALUES)[number] | null;
  action: (typeof HUB_AUDIT_ACTION_VALUES)[number];
  entity: (typeof HUB_AUDIT_ENTITY_VALUES)[number];
  entityId: string | null;
  entityName: string;
  hubConfigVersion: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: Record<string, unknown>;
};

export interface HubAuditWriter {
  insert(tx: Tx, row: HubAuditRow): Promise<void>;
}

/** Cắt theo code point (không tách đôi cặp surrogate) để không vi phạm CHECK ≤ 200. */
export function clipEntityName(name: string): string {
  const cps = Array.from(name);
  return cps.length <= AUDIT_ENTITY_NAME_MAX ? name : cps.slice(0, AUDIT_ENTITY_NAME_MAX).join("");
}

/** `entity_name` của grant/revoke: `<agent_key> → <group_key|username>` (U+2192), đã cắt. */
export const grantEntityName = (agentKey: string, subjectKey: string): string =>
  clipEntityName(`${agentKey} → ${subjectKey}`);

/** jsonb qua `JSON.stringify` + `::jsonb` (bẫy postgres.js CONVENTIONS §2: object thô thành chuỗi JSON). */
const jsonOrNull = (v: Record<string, unknown> | null): string | null =>
  v === null ? null : JSON.stringify(v);

/** Ghi thật vào DB (mặc định khi `AppDeps.hubAudit` vắng). */
export const dbHubAudit: HubAuditWriter = {
  async insert(tx, r) {
    await tx.execute(sql`insert into hub.audit_log (tenant_id, actor_id, actor_username, actor_role, action, entity,
        entity_id, entity_name, hub_config_version, before, after, summary)
      values (${r.tenantId}::uuid, ${r.actorId}::uuid, ${r.actorUsername}::text, ${r.actorRole}::text, ${r.action}::text,
        ${r.entity}::text, ${r.entityId}::uuid, ${clipEntityName(r.entityName)}::text, ${r.hubConfigVersion}::int,
        ${jsonOrNull(r.before)}::jsonb, ${jsonOrNull(r.after)}::jsonb, ${JSON.stringify(r.summary)}::jsonb)`);
  },
};
