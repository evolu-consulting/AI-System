// CR-122 · E1 · A · gắn lượt vào sự kiện (`flow_event_id`/`company_flow_id`) và — MỘT câu — nối bản ghi + dữ kiện của sự kiện vào
// `process_runs.inputs` (chỉ khoá chưa có: input khai rõ thắng). Chạy trong tx tạo run.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export async function attachFlowEvent(
  tx: Tx,
  tenantId: string,
  runId: string,
  fe: {
    eventRowId: string;
    companyFlowId: string;
    recordInputs?: readonly { key: string; type: string; text?: string; value?: string }[];
  },
): Promise<void> {
  await tx.execute(sql`update hub.process_runs set flow_event_id = ${fe.eventRowId}::uuid,
      company_flow_id = ${fe.companyFlowId}::uuid,
      inputs = coalesce(inputs, '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements(
        ${JSON.stringify(fe.recordInputs ?? [])}::jsonb) x
        where not exists (select 1 from jsonb_array_elements(coalesce(inputs, '[]'::jsonb)) y
          where y->>'key' = x->>'key')), '[]'::jsonb)
    where id = ${runId} and tenant_id = ${tenantId}`);
}
