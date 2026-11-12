// CR-127 · X4 · spec §2.1 (`obligations.penalty_decision/penalty_obligation_id`, `kind='penalty'`), §6 "Phạt", BR-56: câu SQL của phạt chậm. Mỗi hàm MỘT
// câu văn bản cố định, `tenant_id` tường minh (Luật 4c). Khoá: hàng HĐ (`FOR NO KEY UPDATE`) rồi hàng mốc (`FOR UPDATE`) — hai câu riêng (D7-15).
// `book`/`waive` chỉ ghi khi `penalty_decision IS NULL` (CAS) ⇒ quyết hai lần không bao giờ ghi lần hai; bằng chứng qua `hub.record_evidence` CÙNG câu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { LateMilestone, PenaltyTerm } from "../domain/penalty.rules";
import { auditCte, json, obJson, one } from "./ledger-sql";
import { uuidArrLit } from "./pg-array";

export type PenaltyContract = {
  id: string;
  owner: string | null;
  created_by: string;
  /** Giá trị HĐ (cơ sở `per_day_of_value`). */
  value: number | null;
};
export type PenaltyOb = LateMilestone & {
  id: string;
  contract_id: string;
  title: string | null;
  penalty_decision: "booked" | "waived" | null;
  penalty_obligation_id: string | null;
  /** Có yêu cầu thay đổi (X3) đang chờ duyệt trên mốc (chỉ `lockOb`). */
  pending?: boolean;
};
export type PenaltyEvidence = {
  note: string;
  signature_attachment_id?: string | null | undefined;
  attachment_ids?: string[] | null | undefined;
};
const OB_COLS = sql`o.id::text, o.contract_id::text, o.kind, o.owner, o.status, o.due_date::text, o.done_at::text,
  o.amount::float8 as amount, o.title, o.penalty_decision, o.penalty_obligation_id::text`;

export type PenaltyRepo = ReturnType<typeof penaltyRepo>;

export function penaltyRepo(tx: Tx, t: string) {
  const evCte = (subject: string, id: string, e: PenaltyEvidence | null) => sql`ev as (
      select hub.record_evidence(${subject}, ${id}::uuid, ${e?.note ?? null}::text, ${e?.signature_attachment_id ?? null}::uuid,
        ${uuidArrLit(e?.attachment_ids)}::uuid[], null::uuid) as id where ${e !== null}::boolean)`;
  return {
    /** Khoá HĐ của mốc (trước) — không có / tenant khác / HĐ không thấy ⇒ null. */
    lockContractOf: async (obId: string): Promise<PenaltyContract | null> => {
      const [r] =
        await tx.execute<PenaltyContract>(sql`select c.id::text, c.owner_user_id::text as owner, c.created_by::text,
          floor(c.value::numeric)::float8 as value
        from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = (select o.contract_id from contracts.obligations o
          where o.id = ${obId}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced') for no key update`);
      return r ?? null;
    },
    /** Khoá mốc (sau khoá HĐ). */
    lockOb: async (id: string): Promise<PenaltyOb | null> => {
      const [r] = await tx.execute<PenaltyOb>(sql`select ${OB_COLS},
          exists (select 1 from contracts.exec_requests x where x.tenant_id = o.tenant_id and x.obligation_id = o.id
            and x.status = 'pending') as pending
        from contracts.obligations o
        where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status <> 'replaced' for update of o`);
      return r ?? null;
    },
    /** Giá trị HĐ; null ⇒ không có / không thấy HĐ. */
    valueOf: async (contractId: string): Promise<{ v: number | null } | null> => {
      const [r] = await tx.execute<{
        v: number | null;
      }>(sql`select floor(c.value::numeric)::float8 as v from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid`);
      return r ?? null;
    },
    terms: async (contractId: string): Promise<PenaltyTerm[]> =>
      await tx.execute<PenaltyTerm>(sql`select p.id::text, p.party, p.trigger, p.rate_pct::float8 as rate_pct, p.basis,
          p.cap_pct::float8 as cap_pct, p.cap_amount::float8 as cap_amount
        from contracts.penalty_terms p where p.tenant_id = ${t}::uuid and p.contract_id = ${contractId}::uuid
        order by p.created_at, p.id`),
    /** Mốc có thể bị phạt của HĐ: đang mở quá hạn hoặc đã xong trễ (không phải mốc phạt) — MỘT câu, không phụ thuộc số mốc. */
    lateOf: async (contractId: string, today: string): Promise<PenaltyOb[]> =>
      await tx.execute<PenaltyOb>(sql`select ${OB_COLS} from contracts.obligations o
        where o.tenant_id = ${t}::uuid and o.contract_id = ${contractId}::uuid and o.kind <> 'penalty'
          and ((o.status = 'open' and o.due_date < ${today}::date) or (o.status = 'done' and o.done_at > o.due_date))
        order by o.due_date, o.seq`),
    /**
     * Ghi vào công nợ: mốc `kind='penalty'` (cùng HĐ, `seq` kế, nguồn `fulfill`, con của mốc trễ) — chiều theo bên trễ (đối tác trễ ⇒ `receive`,
     * mình trễ ⇒ `pay`; `owner` = bên trả phạt) — + đánh dấu mốc trễ `booked`. null ⇒ đã quyết / không áp dụng (CAS).
     */
    book: (w: {
      id: string;
      amount: number;
      today: string;
      by: string;
      evidence: PenaltyEvidence | null;
      /** Phạt ước tính lúc quyết (đối chiếu với số ghi) — vào nhật ký. */
      estimate: Record<string, unknown> | null;
    }) =>
      one<{ obligation: Record<string, unknown> } | null>(
        tx,
        sql`with ${evCte("penalty", w.id, w.evidence)},
        m as (select o.* from contracts.obligations o
          where o.tenant_id = ${t}::uuid and o.id = ${w.id}::uuid and o.penalty_decision is null and o.kind <> 'penalty'
            and o.status in ('open', 'done')),
        ins as (
          insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, title, owner, source,
            parent_obligation_id)
          select ${t}::uuid, m.contract_id, m.party_key, case when m.owner = 'partner' then 'receive' else 'pay' end, 'penalty',
            (select coalesce(max(z.seq), 0) + 1 from contracts.obligations z where z.tenant_id = ${t}::uuid and z.contract_id = m.contract_id),
            ${w.today}::date, ${w.amount}::bigint, left('Phạt chậm: ' || coalesce(m.title, m.kind), 200), m.owner, 'fulfill', m.id from m
          returning *),
        u as (
          update contracts.obligations o set penalty_decision = 'booked', penalty_obligation_id = ins.id, updated_at = now()
          from ins where o.tenant_id = ${t}::uuid and o.id = ins.parent_obligation_id returning o.id, o.contract_id),
        ${auditCte(
          t,
          "obligation_penalty_booked",
          w.by,
          sql`jsonb_build_object('obligation_id', u.id, 'penalty_id', (select ins.id from ins),
          'amount', ${w.amount}::bigint, 'estimate', ${json(w.estimate)}, 'evidence_id', (select ev.id from ev))`,
        )}
        select jsonb_build_object('obligation', ${obJson("ins")}) as j from ins`,
      ),
    /** Miễn phạt: đánh dấu mốc trễ `waived` (không sinh công nợ). Bằng chứng bắt buộc (use case). null ⇒ đã quyết / không áp dụng (CAS). */
    waive: (w: { id: string; by: string; evidence: PenaltyEvidence }) =>
      one<{ id: string } | null>(
        tx,
        sql`with ${evCte("penalty", w.id, w.evidence)},
        u as (
          update contracts.obligations o set penalty_decision = 'waived', updated_at = now()
          where o.tenant_id = ${t}::uuid and o.id = ${w.id}::uuid and o.penalty_decision is null and o.kind <> 'penalty'
            and o.status in ('open', 'done') returning o.id, o.contract_id),
        ${auditCte(t, "obligation_penalty_waived", w.by, sql`jsonb_build_object('obligation_id', u.id, 'evidence_id', (select ev.id from ev))`)}
        select jsonb_build_object('id', u.id) as j from u`,
      ),
  };
}
