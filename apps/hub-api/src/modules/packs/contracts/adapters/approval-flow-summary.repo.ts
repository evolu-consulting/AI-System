// CR-118 · UW-FR-14 · huy hiệu flow của lô HĐ: MỘT câu SQL văn bản cố định cho cả lô (≤ 100 ref, `= any(uuid[])` qua PK),
// trong tx tenant của gói (RLS `contracts` + điều kiện tenant tường minh) ⇒ HĐ tenant khác / không thấy ⇒ vắng (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ApprovalSummaryRow } from "../domain/approval-flow-view.rules";

export type ApprovalFlowSummaryRepo = {
  rows(ids: readonly string[]): Promise<ApprovalSummaryRow[]>;
};

export function approvalFlowSummaryRepo(tx: Tx, tenantId: string): ApprovalFlowSummaryRepo {
  return {
    rows: async (ids) => {
      if (ids.length === 0) return [];
      const arr = `{${ids.join(",")}}`; // ids đã kiểm uuid ở adapter
      return tx.execute<ApprovalSummaryRow>(sql`
        select c.id::text as ref, a.status, a.mode, a.flow_version,
          coalesce(a.status = 'level1' and a.mode = 'engine'
            and (a.engine_run_id is null or a.esign_status = 'needs_decision'), false) as attention
        from contracts.contracts c
        left join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
        where c.tenant_id = ${tenantId}::uuid and c.id = any(${arr}::uuid[])`);
    },
  };
}
