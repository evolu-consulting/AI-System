// CR-127 K3 · BR-02/04 · spec §3 #7b · lượt duyệt kết thúc KHÔNG thành công (huỷ / lỗi / hết hạn / không mở được) ⇒ HĐ processing → draft
// (người gửi kiểm rồi Gửi lại) + đóng lượt duyệt của HĐ (`approvals`: còn lượt sống thì lần Gửi lại không mở được lượt mới).
// CAS theo lượt: HĐ còn `processing`, `contracts.run_id` = lượt duyệt, lượt duyệt gắn ĐÚNG run engine (`engine_run_id`) — Rút về đã đổi
// trạng thái trước ⇒ hook của lượt bị rút tự bỏ qua (0 hàng, không ném). Đổi trạng thái qua hàm dùng chung `contracts.transition_set`
// (cổng theo tập, MIGC 0092). Mỗi đường MỘT câu dữ liệu văn bản hằng (Luật 4c).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type FlowRunEnd, withPackJobRoleInTx, withPackRoleInTx } from "../../kit/public";
import { CONTRACTS_PACK } from "../domain/contract-flow-events.rules";
import { approvalWrite } from "./approval.repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FlowEndEv = "flow_cancelled" | "flow_failed" | "flow_not_launched";
/** Trạng thái đóng lượt duyệt theo sự kiện. */
const APPROVAL_END: Record<FlowEndEv, "cancelled" | "failed"> = {
  flow_cancelled: "cancelled",
  flow_failed: "failed",
  flow_not_launched: "failed",
};

/**
 * Câu chung: lô `v` (JSON `[{tenant_id, ref, run, reason}]`; `run` null = lượt CHƯA có run engine — không mở được) ⇒ đóng lượt duyệt
 * khớp ⇒ `transition_set` (processing → draft + `contract_events`). Join theo cặp `(tenant_id, ref)` (#78) — không tin `ref` một mình.
 */
const END_SQL = (json: string, ev: FlowEndEv) => sql`with
  v as (select * from jsonb_to_recordset(${json}::jsonb) as v(tenant_id uuid, ref uuid, run uuid, reason text)),
  a as (update contracts.approvals x set status = ${APPROVAL_END[ev]}, feedback = left(v.reason, 4000),
      decided_at = now(), updated_at = now()
    from v join contracts.contracts c on c.tenant_id = v.tenant_id and c.id = v.ref and c.status = 'processing'
    where x.tenant_id = v.tenant_id and x.contract_id = v.ref and x.id = c.run_id and x.mode = 'engine'
      and x.status in ('level1', 'level2') and x.engine_run_id is not distinct from v.run
    returning x.tenant_id, x.contract_id, x.id, v.reason),
  t as (select * from contracts.transition_set((select coalesce(jsonb_agg(jsonb_build_object(
      'tenant_id', a.tenant_id, 'id', a.contract_id, 'run_id', a.id, 'from', 'processing', 'to', 'draft',
      'ev', ${ev}::text, 'reason', a.reason)), '[]'::jsonb) from a)))
  select count(*)::int as n from t`;

const toJson = (
  items: readonly { tenantId: string; ref: string; runId: string | null; reason: string }[],
) =>
  JSON.stringify(
    items
      .filter(
        (i) =>
          UUID.test(i.tenantId) && UUID.test(i.ref) && (i.runId === null || UUID.test(i.runId)),
      )
      .map((i) => ({
        tenant_id: i.tenantId,
        ref: i.ref,
        run: i.runId,
        reason: i.reason.slice(0, 200),
      })),
  );

/** Một lượt (huỷ / lỗi / không mở được) — TRONG tx engine, dưới role gói + tenant của lượt. Trả true khi HĐ đã về draft. */
export async function endFlowRun(
  tx: Tx,
  i: { tenantId: string; ref: string; runId: string | null; reason: string },
  ev: FlowEndEv,
): Promise<boolean> {
  const json = toJson([i]);
  if (json === "[]") return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, async () => {
    await approvalWrite(tx); // CR-109: cờ tx-local cho policy ghi HĐ
    const [r] = await tx.execute<{ n: number }>(END_SQL(json, ev));
    return Number(r?.n ?? 0) > 0;
  });
}

/**
 * #76/#79 · lượt HẾT HẠN theo lô (tx `system` nhiều tenant của `expireBatch`): MỘT câu dữ liệu theo tập dưới role `contracts_job`
 * (quyền cột + policy riêng, MIGC 0092) — không đổi tenant từng hàng. Trả số HĐ đã về draft.
 */
export async function failRunsBatch(tx: Tx, items: readonly FlowRunEnd[]): Promise<number> {
  const json = toJson(items);
  if (json === "[]") return 0;
  return withPackJobRoleInTx(tx, CONTRACTS_PACK, async () => {
    const [r] = await tx.execute<{ n: number }>(END_SQL(json, "flow_failed"));
    return Number(r?.n ?? 0);
  });
}
