// CR-122 · E1 · A · gắn lượt vào sự kiện (`flow_event_id`/`company_flow_id`) và — MỘT câu — nối bản ghi + dữ kiện của sự kiện vào
// `process_runs.inputs` (chỉ khoá chưa có: input khai rõ thắng). Chạy trong tx tạo run. P11 · rồi app gắn run vào bản ghi (cùng tx).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type FlowEventAttach = {
  eventRowId: string;
  companyFlowId: string;
  /** CR-122 · A · bản ghi + dữ kiện của sự kiện ⇒ nối vào `inputs` của run (khoá đã có thắng). */
  recordInputs?: readonly { key: string; type: string; text?: string; value?: string }[];
  /** CR-122 · P11 · app gắn run vào bản ghi CÙNG tx tạo run (`OutcomeHandler.launched`, CAS). */
  onCreated?: (tx: Tx, runId: string) => Promise<unknown>;
  /**
   * CR-122 · P11g · sự kiện mở lượt (vd `contract.submitted`) ⇒ `snapshot.trigger.event`. Engine tìm `FactsReader` theo (gói, sự kiện)
   * từ đây (`step.repo.ts packOf`); vắng ⇒ node Nếu KHÔNG đọc được dữ kiện ⇒ mọi vế `fact` rỗng ⇒ luôn rẽ nhánh Sai.
   */
  event?: string;
};

export async function attachFlowEvent(
  tx: Tx,
  tenantId: string,
  runId: string,
  fe: FlowEventAttach,
): Promise<void> {
  const trigger = fe.event ? JSON.stringify({ trigger: { event: fe.event } }) : "{}";
  await tx.execute(sql`update hub.process_runs set flow_event_id = ${fe.eventRowId}::uuid,
      company_flow_id = ${fe.companyFlowId}::uuid,
      snapshot = coalesce(snapshot, '{}'::jsonb) || ${trigger}::jsonb,
      inputs = coalesce(inputs, '[]'::jsonb) || coalesce((select jsonb_agg(x) from jsonb_array_elements(
        ${JSON.stringify(fe.recordInputs ?? [])}::jsonb) x
        where not exists (select 1 from jsonb_array_elements(coalesce(inputs, '[]'::jsonb)) y
          where y->>'key' = x->>'key')), '[]'::jsonb)
    where id = ${runId} and tenant_id = ${tenantId}`);
  // P11c · app trả false = bản ghi không còn chờ lượt này (đã có run khác / đã quyết) ⇒ NÉM để tx tạo run rollback (không run mồ côi).
  if ((await fe.onCreated?.(tx, runId)) === false) throw new FlowRunSuperseded();
}

/** Bản ghi không nhận lượt vừa mở (CAS của app thua) ⇒ huỷ tạo run; bộ điều phối chốt sự kiện `superseded`, không thử lại. */
export class FlowRunSuperseded extends Error {
  constructor() {
    super("flow_run_superseded");
  }
}
