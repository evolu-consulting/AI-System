// CR-121 Q-3 · ghi `contracts.contract_events` type `platform_approval_op` (SQL một câu, `tenant_id` tường minh + RLS FORCE).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PlatformAuditRepo } from "../application/reopen-contract.usecase";

export function platformAuditRepo(tx: Tx, tenantId: string): { audit: PlatformAuditRepo } {
  return {
    audit: {
      record: async (c) => {
        await tx.execute(sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, k.id, 'platform_approval_op', ${c.actor}::uuid,
            jsonb_build_object('op', ${c.op}::text, 'reason', ${c.reason}::text, 'actor_role', 'platform_admin')
          from contracts.contracts k where k.id = ${c.id}::uuid and k.tenant_id = ${tenantId}::uuid`);
      },
    },
  };
}
