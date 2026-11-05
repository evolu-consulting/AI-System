// CR-121 Q-3 · ghi `contracts.contract_events` (SQL một câu, `tenant_id` tường minh + RLS FORCE):
// `platform_approval_op` (ý định, trước thao tác) và `platform_approval_result` (kết quả, sau thao tác).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PlatformAuditRepo } from "../application/reopen-contract.usecase";

export function platformAuditRepo(tx: Tx, tenantId: string): { audit: PlatformAuditRepo } {
  return {
    audit: {
      intent: async (c) => {
        await tx.execute(sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, k.id, 'platform_approval_op', ${c.actor}::uuid,
            jsonb_build_object('op', ${c.op}::text, 'reason', ${c.reason}::text, 'actor_role', 'platform_admin')
          from contracts.contracts k where k.id = ${c.id}::uuid and k.tenant_id = ${tenantId}::uuid`);
      },
      result: async (c) => {
        await tx.execute(sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, k.id, 'platform_approval_result', ${c.actor}::uuid,
            jsonb_build_object('op', ${c.op}::text, 'outcome', ${c.outcome}::text, 'actor_role', 'platform_admin')
          from contracts.contracts k where k.id = ${c.id}::uuid and k.tenant_id = ${tenantId}::uuid`);
      },
    },
  };
}
