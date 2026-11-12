// CR-127 · X2 · spec §6 "Giao dịch gắn HĐ": yêu cầu chờ duyệt `exec_requests(kind='transaction')` + sự kiện flow `transaction.saved`
// (ref = id yêu cầu). Mỗi hàm MỘT câu văn bản cố định, `tenant_id` tường minh. Ghi sự kiện qua `hub.emit_flow_event` (SECURITY DEFINER, CÙNG
// tx bản ghi); bằng chứng qua `hub.record_evidence` (chủ thể `exec_request`). Phần `claim/finish` chạy trong tx ENGINE (đã đổi role gói).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { EvidenceWrite } from "../application/ledger.ports";
import { uuidArrLit } from "./pg-array";

export const EV_TRANSACTION_SAVED = "transaction.saved";
export const txEventId = (requestId: string) => `${EV_TRANSACTION_SAVED}:${requestId}`;

export type TxRequestIn = {
  id: string;
  contractId: string;
  obligationId: string;
  payload: unknown;
  by: string;
  evidence: EvidenceWrite | null;
  totalValue: number | null;
};

/** Một câu: bằng chứng → yêu cầu `pending` → sự kiện. Mốc đã có yêu cầu chờ ⇒ unique `exec_requests_ob_pending_uq` (23505 ⇒ CHANGE_PENDING). */
export async function insertTxRequest(tx: Tx, t: string, w: TxRequestIn): Promise<void> {
  const ev = w.evidence;
  const facts = JSON.stringify({
    linked: true,
    ...(w.totalValue === null ? {} : { deal_value: w.totalValue }),
  });
  await tx.execute(sql`with ev as (
      select hub.record_evidence('exec_request', ${w.id}::uuid, ${ev?.note ?? null}::text,
        ${ev?.signature_attachment_id ?? null}::uuid, ${uuidArrLit(ev?.attachment_ids)}::uuid[], null::uuid) as id
      where ${ev !== null}::boolean),
    ins as (
      insert into contracts.exec_requests (id, tenant_id, contract_id, obligation_id, kind, payload, evidence_id, requested_by)
      select ${w.id}::uuid, ${t}::uuid, ${w.contractId}::uuid, ${w.obligationId}::uuid, 'transaction',
        ${JSON.stringify(w.payload)}::jsonb, (select ev.id from ev), ${w.by}::uuid
      returning id)
    select hub.emit_flow_event(${t}::uuid, ${txEventId(w.id)}, ${EV_TRANSACTION_SAVED}, ins.id::text, ${facts}::jsonb, ${w.by}::uuid)
    from ins`);
}

/** Lý do "Không theo hợp đồng" ghi vào nhật ký chứng từ giao dịch (một nguồn: nhật ký HĐ, BR-54). */
export async function insertUnlinkedNote(
  tx: Tx,
  t: string,
  contractId: string,
  by: string,
  reason: string,
): Promise<void> {
  await tx.execute(sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
    values (${t}::uuid, ${contractId}::uuid, 'deal_unlinked', ${by}::uuid, jsonb_build_object('reason', ${reason}::text))`);
}

export type ClaimedTx = { obligation_id: string; payload: unknown; requested_by: string };

/** CAS `pending → approved` (idempotent: gọi lại ⇒ null). Mở khoá chặn "yêu cầu đang chờ" TRƯỚC khi ghi vào mốc. */
export async function claimTxRequest(tx: Tx, t: string, id: string): Promise<ClaimedTx | null> {
  const rows =
    await tx.execute<ClaimedTx>(sql`update contracts.exec_requests x set status = 'approved', decided_at = now()
    where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind = 'transaction' and x.status = 'pending'
    returning x.obligation_id::text, x.payload, x.requested_by::text`);
  return rows[0] ?? null;
}

/** Kết yêu cầu: `applied` (đã ghi vào mốc) hoặc `rejected` (+ lý do). Trả người tạo để báo. `from` = trạng thái đang giữ. */
export async function finishTxRequest(
  tx: Tx,
  t: string,
  id: string,
  to: "applied" | "rejected",
  from: "pending" | "approved",
  note: string | null,
): Promise<{ requested_by: string } | null> {
  const rows = await tx.execute<{
    requested_by: string;
  }>(sql`update contracts.exec_requests x set status = ${to}, decided_at = now(), decided_note = ${note}::text
    where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind = 'transaction' and x.status = ${from}
    returning x.requested_by::text`);
  return rows[0] ?? null;
}

/** null ⇒ không có yêu cầu trong tenant; còn lại ⇒ trạng thái (để trả `already_applied`). */
export async function txRequestStatus(tx: Tx, t: string, id: string): Promise<string | null> {
  const rows = await tx.execute<{
    status: string;
  }>(sql`select x.status from contracts.exec_requests x
    where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind = 'transaction'`);
  return rows[0]?.status ?? null;
}

/** `FactsReader` (dữ kiện HIỆN TẠI): giá trị giao dịch lưu ở payload lúc lập yêu cầu. Không thấy ⇒ null. */
export async function readTxFacts(
  tx: Tx,
  t: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await tx.execute<{
    f: Record<string, unknown> | string;
  }>(sql`select jsonb_strip_nulls(jsonb_build_object(
      'linked', true, 'deal_value', case when jsonb_typeof(x.payload -> 'total_value') = 'number' then x.payload -> 'total_value' end)) as f
    from contracts.exec_requests x where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind = 'transaction'`);
  const f = rows[0]?.f;
  if (f === undefined) return null;
  return typeof f === "string" ? JSON.parse(f) : f;
}

/** Báo người tạo giao dịch (chuông) — MỘT câu `notify.enqueue` (role gói chỉ có EXECUTE hàm này). */
export async function notifyTxRequester(
  tx: Tx,
  userId: string,
  requestId: string,
  title: string,
  body: string,
): Promise<void> {
  const row = JSON.stringify([
    {
      user_id: userId,
      kind: "contract.transaction",
      title: title.slice(0, 200),
      body: body.slice(0, 2000),
      link: "/contracts",
      dedup_key: `tx-request:${requestId}`,
    },
  ]);
  await tx.execute(sql`select notify.enqueue('contracts', ${row}::jsonb)`);
}
