// CR-127 · X3 · spec §2.2 (`exec_requests`, `exec_hold_*`), §4, §6 "Tạm khoá / yêu cầu thay đổi": câu SQL của hold/release/tách mốc/miễn phạt.
// Mỗi hàm MỘT câu văn bản cố định, `tenant_id` tường minh (Luật 4c). Bằng chứng qua `hub.record_evidence` (chủ thể `exec_request`, id = id yêu cầu)
// CÙNG câu; sự kiện `fulfilment.change_requested` qua `hub.emit_flow_event` CÙNG tx. `applied` ngay (không có quy trình) và `approved → applied`
// (sau duyệt) dùng chung các hàm `apply*`. Dời hạn dùng lại `LedgerWriteRepo.postpone` (một nguồn).
import type { ExecKind } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ChangeFacts } from "../domain/exec-request.rules";
import { auditCte, obJson, one } from "./ledger-sql";
import { uuidArrLit } from "./pg-array";

export const EV_CHANGE_REQUESTED = "fulfilment.change_requested";
export const changeEventId = (id: string) => `${EV_CHANGE_REQUESTED}:${id}`;

export type ExecContract = {
  id: string;
  status: string;
  superseded: boolean;
  effect: string | null;
  owner: string | null;
  created_by: string;
  hold: { by: string; reason: string | null; at: string } | null;
};
export type ExecEvidence = {
  note: string;
  signature_attachment_id?: string | null | undefined;
  attachment_ids?: string[] | null | undefined;
};
export type ExecRequestIn = {
  id: string;
  contractId: string;
  obligationId: string | null;
  kind: ExecKind;
  payload: unknown;
  by: string;
  evidence: ExecEvidence;
  /** `pending` ⇒ phát sự kiện quy trình; `applied` ⇒ ghi lịch sử, không sự kiện. */
  status: "pending" | "applied";
  facts: ChangeFacts;
};
export type ClaimedExec = {
  contract_id: string;
  obligation_id: string | null;
  kind: ExecKind;
  payload: Record<string, unknown>;
  requested_by: string;
  evidence_id: string | null;
};
type Ob = Record<string, unknown>;

const CONTRACT_COLS = sql`c.id::text, c.status, (c.superseded_at is not null) as superseded, c.effect, c.owner_user_id::text as owner,
  c.created_by::text, case when c.exec_hold_at is null then null else jsonb_build_object('by', c.exec_hold_by,
    'reason', c.exec_hold_reason, 'at', c.exec_hold_at) end as hold`;

export type ExecRepo = ReturnType<typeof execRequestsRepo>;

export function execRequestsRepo(tx: Tx, t: string) {
  return {
    /** Khoá hàng HĐ (`FOR NO KEY UPDATE`, trước hàng mốc — D7-15); không có / tenant khác ⇒ null. */
    lockContract: async (id: string): Promise<ExecContract | null> => {
      const [r] =
        await tx.execute<ExecContract>(sql`select ${CONTRACT_COLS} from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = ${id}::uuid for no key update`);
      return r ?? null;
    },
    /** Khoá HĐ của mốc (mốc chưa bị thay). */
    lockContractOf: async (obId: string): Promise<ExecContract | null> => {
      const [r] =
        await tx.execute<ExecContract>(sql`select ${CONTRACT_COLS} from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = (select o.contract_id from contracts.obligations o
          where o.id = ${obId}::uuid and o.tenant_id = ${t}::uuid and o.status <> 'replaced') for no key update`);
      return r ?? null;
    },
    /** MỘT câu: bằng chứng → yêu cầu → (pending) sự kiện. Mốc / HĐ đã có yêu cầu mở ⇒ 23505 (chỉ mục riêng; bắt ở use case). */
    insert: async (w: ExecRequestIn): Promise<string | null> => {
      const e = w.evidence;
      const [r] = await tx.execute<{ id: string | null }>(sql`with ev as (
          select hub.record_evidence('exec_request', ${w.id}::uuid, ${e.note}::text, ${e.signature_attachment_id ?? null}::uuid,
            ${uuidArrLit(e.attachment_ids)}::uuid[], null::uuid) as id),
        ins as (
          insert into contracts.exec_requests (id, tenant_id, contract_id, obligation_id, kind, payload, evidence_id, requested_by,
            status, decided_at)
          select ${w.id}::uuid, ${t}::uuid, ${w.contractId}::uuid, ${w.obligationId}::uuid, ${w.kind}, ${JSON.stringify(w.payload)}::jsonb,
            ev.id, ${w.by}::uuid, ${w.status}, case when ${w.status} = 'applied' then now() end from ev
          returning id)
        select (select ev.id::text from ev) as id, case when ${w.status === "pending"}::boolean then hub.emit_flow_event(${t}::uuid,
          ${changeEventId(w.id)}, ${EV_CHANGE_REQUESTED}, ins.id::text, ${JSON.stringify(w.facts)}::jsonb, ${w.by}::uuid) end as e
        from ins`);
      return r?.id ?? null;
    },
    /** CAS `pending → approved` (lặp lại ⇒ null). Không đụng yêu cầu `transaction` (X2). */
    claim: async (id: string): Promise<ClaimedExec | null> => {
      const [r] =
        await tx.execute<ClaimedExec>(sql`update contracts.exec_requests x set status = 'approved', decided_at = now()
        where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind <> 'transaction' and x.status = 'pending'
        returning x.contract_id::text, x.obligation_id::text, x.kind, x.payload, x.requested_by::text, x.evidence_id::text`);
      return r ?? null;
    },
    finish: async (
      id: string,
      to: "applied" | "rejected",
      from: "pending" | "approved",
      note: string | null,
    ): Promise<{ requested_by: string } | null> => {
      const [r] = await tx.execute<{
        requested_by: string;
      }>(sql`update contracts.exec_requests x set status = ${to}, decided_at = now(), decided_note = ${note}::text
        where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind <> 'transaction' and x.status = ${from}
        returning x.requested_by::text`);
      return r ?? null;
    },
    status: async (id: string): Promise<string | null> => {
      const [r] = await tx.execute<{
        status: string;
      }>(sql`select x.status from contracts.exec_requests x
        where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind <> 'transaction'`);
      return r?.status ?? null;
    },
    /** `FactsReader`: loại + payload lúc lập yêu cầu (dữ kiện HIỆN TẠI). */
    payloadOf: async (
      id: string,
    ): Promise<{ kind: string; payload: Record<string, unknown> } | null> => {
      const [r] = await tx.execute<{
        kind: string;
        payload: Record<string, unknown> | string;
      }>(sql`select x.kind, x.payload
        from contracts.exec_requests x where x.tenant_id = ${t}::uuid and x.id = ${id}::uuid and x.kind <> 'transaction'`);
      if (!r) return null;
      return {
        kind: r.kind,
        payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      };
    },
    /** Tạm khoá (chỉ khi chưa khoá). Trả số HĐ đổi (0 ⇒ đã khoá). `by` = người yêu cầu (người khoá). */
    applyHold: async (c: string, by: string, reason: string | null, evidenceId: string | null) => {
      const [r] = await tx.execute<{ n: number }>(sql`with u as (
          update contracts.contracts k set exec_hold_at = now(), exec_hold_by = ${by}::uuid, exec_hold_reason = ${reason}::text,
            exec_hold_evidence_id = ${evidenceId}::uuid, updated_at = now()
          where k.tenant_id = ${t}::uuid and k.id = ${c}::uuid and k.exec_hold_at is null and k.superseded_at is null
            and k.status = 'done' and k.effect in ('active', 'expiring') returning k.id as contract_id),
        ${auditCte(t, "exec_hold", by, sql`jsonb_build_object('reason', ${reason}::text, 'evidence_id', ${evidenceId}::text)`)}
        select count(*)::int as n from u`);
      return r?.n ?? 0;
    },
    /** Mở khoá (chỉ khi đang khoá). Trả số HĐ đổi (0 ⇒ không bị khoá). */
    applyRelease: async (c: string, by: string, evidenceId: string | null) => {
      const [r] = await tx.execute<{ n: number }>(sql`with u as (
          update contracts.contracts k set exec_hold_at = null, exec_hold_by = null, exec_hold_reason = null,
            exec_hold_evidence_id = null, updated_at = now()
          where k.tenant_id = ${t}::uuid and k.id = ${c}::uuid and k.exec_hold_at is not null returning k.id as contract_id),
        ${auditCte(t, "exec_release", by, sql`jsonb_build_object('evidence_id', ${evidenceId}::text)`)}
        select count(*)::int as n from u`);
      return r?.n ?? 0;
    },
    /** Tách mốc tiền: mốc gốc còn `amount - tách`, hàng con mang phần tách (hạn mới). null ⇒ mốc không mở / không phải mốc tiền / tách ≥ số tiền. */
    applySplit: (
      id: string,
      s: { due_date: string; amount: number; title?: string | undefined },
      by: string,
      evidenceId: string | null,
    ) =>
      one<{ ob: Ob; child: Ob } | null>(
        tx,
        sql`with u as (
          update contracts.obligations o set amount = o.amount - ${s.amount}::bigint, updated_at = now()
          where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status = 'open' and o.kind <> 'delivery' and o.kind <> 'penalty'
            and o.amount > ${s.amount}::bigint returning o.*),
        ch as (
          insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, title, owner,
            source, parent_obligation_id)
          select ${t}::uuid, u.contract_id, u.party_key, u.direction, u.kind,
            (select coalesce(max(z.seq), 0) + 1 from contracts.obligations z where z.tenant_id = ${t}::uuid and z.contract_id = u.contract_id),
            ${s.due_date}::date, ${s.amount}::bigint, coalesce(${s.title ?? null}::text, u.title), u.owner, 'manual', u.id from u
          returning *),
        ${auditCte(t, "obligation_split", by, sql`jsonb_build_object('obligation_id', u.id, 'child_id', (select ch.id from ch), 'amount', ${s.amount}::bigint, 'evidence_id', ${evidenceId}::text)`)}
        select jsonb_build_object('ob', ${obJson("u")}, 'child', (select ${obJson("ch")} from ch)) as j from u`,
      ),
    /** Miễn phạt: mốc phạt đang mở ⇒ `cancelled`. null ⇒ không phải mốc phạt đang mở. */
    applyWaive: (id: string, by: string, evidenceId: string | null) =>
      one<Ob | null>(
        tx,
        sql`with u as (
          update contracts.obligations o set status = 'cancelled', updated_at = now()
          where o.tenant_id = ${t}::uuid and o.id = ${id}::uuid and o.status = 'open' and o.kind = 'penalty' returning o.*),
        ${auditCte(t, "obligation_penalty_waived", by, sql`jsonb_build_object('obligation_id', u.id, 'amount', u.amount, 'evidence_id', ${evidenceId}::text)`)}
        select ${obJson("u")} as j from u`,
      ),
    /** Báo người yêu cầu (chuông) — MỘT câu `notify.enqueue` (role gói chỉ có EXECUTE hàm này). */
    notify: async (
      userId: string,
      requestId: string,
      title: string,
      body: string,
    ): Promise<void> => {
      const row = JSON.stringify([
        {
          user_id: userId,
          kind: "contract.exec_request",
          title: title.slice(0, 200),
          body: body.slice(0, 2000),
          link: "/contracts",
          dedup_key: `exec-request:${requestId}`,
        },
      ]);
      await tx.execute(sql`select notify.enqueue('contracts', ${row}::jsonb)`);
    },
  };
}
