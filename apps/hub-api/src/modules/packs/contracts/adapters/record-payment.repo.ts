// CR-140 · ghi MỘT dòng «đã trả» vào sổ thanh toán của HĐ (`contracts.obligations` kind=payment, hướng `pay`, đã xong) + sổ đối tác + nhật ký
// HĐ — đúng bảng/cột sổ hiện có (không bảng mới). Hai câu trong tx gói: (1) khoá hàng HĐ + đọc cờ «đã ghi cho lượt này» / «còn đợt thanh toán
// mở» + giá trị HĐ; (2) ghi một câu (CTE). Idempotent theo lượt: nhật ký HĐ `flow_payment_recorded` mang `run_id` ⇒ lần sau chỉ báo `exists`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditCte, eventCte } from "./ledger-sql";

export const FLOW_PAYMENT_EVENT = "flow_payment_recorded";
export const FLOW_PAYMENT_TITLE = "Thanh toán";

export type FlowPaymentWrite = {
  contractId: string;
  runId: string;
  by: string;
  /** Đồng; null ⇒ giá trị HĐ (null nếu HĐ chưa có giá trị). */
  amount: number | null;
  /** `YYYY-MM-DD` (đã chốt ở tool). */
  paidAt: string;
};
export type FlowPaymentResult =
  | { status: "not_found" | "exists" | "has_schedule" }
  | { status: "recorded"; obligationId: string; amount: number | null };

type Head = { total: string | null; party: string | null; done: boolean; has_open: boolean };

const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : (((r as { rows?: T[] }).rows ?? []) as T[]);

export async function recordFlowPayment(
  tx: Tx,
  tenantId: string,
  w: FlowPaymentWrite,
): Promise<FlowPaymentResult> {
  const t = tenantId;
  const [h] = rowsOf<Head>(
    await tx.execute(sql`select c.fields -> 'total_value' ->> 'value' as total,
        contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value') as party,
        exists (select 1 from contracts.contract_events e where e.tenant_id = ${t}::uuid and e.contract_id = c.id
          and e.type = ${FLOW_PAYMENT_EVENT} and e.data ->> 'run_id' = ${w.runId}::text) as done,
        exists (select 1 from contracts.obligations o where o.tenant_id = ${t}::uuid and o.contract_id = c.id
          and o.kind = 'payment' and o.direction = 'pay' and o.status = 'open') as has_open
      from contracts.contracts c where c.tenant_id = ${t}::uuid and c.id = ${w.contractId}::uuid
      for no key update of c`),
  );
  if (!h) return { status: "not_found" };
  if (h.done) return { status: "exists" };
  if (h.has_open) return { status: "has_schedule" }; // có đợt thanh toán ⇒ đường «Xác nhận mốc» lo, không ghi đôi
  const total = h.total !== null && /^\d{1,15}$/.test(h.total) ? Number(h.total) : null;
  const amount = w.amount ?? total;
  const [r] = rowsOf<{ id: string }>(
    await tx.execute(sql`with u as (
        insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, status,
          done_at, done_by, title, source)
        values (${t}::uuid, ${w.contractId}::uuid, ${h.party}::text, 'pay', 'payment',
          (select coalesce(max(z.seq), 0) + 1 from contracts.obligations z
            where z.tenant_id = ${t}::uuid and z.contract_id = ${w.contractId}::uuid),
          ${w.paidAt}::date, ${amount}::bigint, 'done', ${w.paidAt}::date, ${w.by}::uuid, ${FLOW_PAYMENT_TITLE}, 'fulfill')
        returning *),
      ${eventCte(t, { role: "supplier", type: "paid", at: w.paidAt, by: w.by, late: 0, amount: sql`u.amount` })},
      ${auditCte(
        t,
        FLOW_PAYMENT_EVENT,
        w.by,
        sql`jsonb_build_object('run_id', ${w.runId}::text, 'obligation_id', u.id, 'at', ${w.paidAt}::text, 'amount', u.amount)`,
      )}
      select u.id::text as id from u`),
  );
  return { status: "recorded", obligationId: r?.id as string, amount };
}

/** Cổng repo cho `createPackUow` (một tx gói của công ty). */
export const recordPaymentRepo = (tx: Tx, tenantId: string) => ({
  recordPayment: (w: FlowPaymentWrite) => recordFlowPayment(tx, tenantId, w),
});
export type RecordPaymentRepo = ReturnType<typeof recordPaymentRepo>;
