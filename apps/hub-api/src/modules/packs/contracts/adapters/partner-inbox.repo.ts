// CR-124 · q3 · FLOW4-FR-07/08/11 · SQL bên NHẬN (tx gói của tenant B). `take` → `insertBatch` → `emitReceived` = 3 câu CỐ ĐỊNH mỗi lô (Luật 4c),
// cùng tx: lần gửi 'delivered' + HĐ nhận + sự kiện `contract.received` cùng commit (lỗi ⇒ cả ba rollback, lần gửi quay lại 'sent').
// HĐ nhận là bản ghi RIÊNG của B (`contracts.contracts.source='partner_inbox'`) — không id/tenant/lịch sử duyệt của A.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type OutcomeInput, type OutcomeResult, withPackRoleInTx } from "../../kit/public";
import { FLOW_STARTING } from "../application/contract-flow.ports";
import {
  FALLBACK_REASON,
  type Importance,
  INBOX_CONTRACT_STATUS,
  isPartnerOutcome,
  type PartnerOutcome,
} from "../domain/partner-send.rules";

export type TakenRow = {
  id: string;
  round: number;
  prevReason: string | null;
  payload: Record<string, unknown>;
  fileRef: string | null;
  pdfSha256: string | null;
  expiresAt: string;
  senderName: string;
  senderTaxCode: string | null;
  senderVerified: boolean;
};

/** Người tạo HĐ nhận = hệ thống (không có người dùng). `created_by` NOT NULL, không FK sang admin. */
export const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

export type InboxItem = {
  contractId: string;
  /** Lượt duyệt (`contracts.approvals`) của HĐ nhận: thẻ duyệt của quy trình nhận hiện ở trang HĐ như HĐ gửi duyệt (spec §8c). */
  approvalId: string;
  row: TakenRow;
  importance: Importance;
  title: string;
  fields: Record<string, { value: unknown }>;
  shared: Record<string, unknown>;
  message: string | null;
};

/** Lượt duyệt của HĐ nhận khi flow nhận kết thúc: Đồng ý ⇒ done, Từ chối ⇒ rejected, Trả lại ⇒ cancelled (như `APPROVAL_STATUS_OF`). */
const APPROVAL_STATUS_OF_RECEIVED: Record<PartnerOutcome, "done" | "rejected" | "cancelled"> = {
  confirmed: "done",
  declined: "rejected",
  returned: "cancelled",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxSettings = { importantMin: number; criticalMin: number; ownerId: string | null };

export function partnerInboxRepo(tx: Tx, tid: string) {
  return {
    /** Ngưỡng mức quan trọng + người phụ trách HĐ nhận của công ty (chưa đặt ⇒ mặc định spec §6, owner trống). MỘT câu. */
    async settings(): Promise<InboxSettings> {
      const [r] = await tx.execute<{
        imp: string | number;
        cri: string | number;
        owner: string | null;
      }>(sql`
        select important_min as imp, critical_min as cri, owner_user_id::text as owner
        from contracts.partner_settings where tenant_id = ${tid}::uuid`);
      return r
        ? { importantMin: Number(r.imp), criticalMin: Number(r.cri), ownerId: r.owner }
        : { importantMin: 500_000_000, criticalMin: 2_000_000_000, ownerId: null };
    },
    async take(limit: number): Promise<TakenRow[]> {
      const rows = await tx.execute<{
        id: string;
        round: number;
        prev_reason: string | null;
        payload: unknown;
        file_ref: string | null;
        pdf_sha256: string | null;
        expires_at: string | Date;
        sender_name: string | null;
        sender_tax_code: string | null;
        sender_verified: boolean | null;
      }>(sql`select id::text, round, prev_reason, payload, file_ref, pdf_sha256, expires_at, sender_name,
          sender_tax_code, sender_verified from hub.partner_inbox_take(${limit}::int)`);
      return rows.map((r) => ({
        id: r.id,
        round: r.round,
        prevReason: r.prev_reason,
        payload: (typeof r.payload === "string"
          ? JSON.parse(r.payload)
          : (r.payload ?? {})) as Record<string, unknown>,
        fileRef: r.file_ref,
        pdfSha256: r.pdf_sha256,
        expiresAt: new Date(r.expires_at).toISOString(),
        senderName: r.sender_name ?? "Công ty đối tác",
        senderTaxCode: r.sender_tax_code,
        senderVerified: r.sender_verified === true,
      }));
    },
    /** HĐ nhận + bản ghi nhận, MỘT câu theo tập. Trùng `(tenant, mailbox)` ⇒ bỏ qua (chạy lại vô hại). */
    async insertBatch(items: readonly InboxItem[], ownerId: string | null = null): Promise<number> {
      if (items.length === 0) return 0;
      const j = JSON.stringify(
        items.map((i) => ({
          contract_id: i.contractId,
          approval_id: i.approvalId,
          mailbox_id: i.row.id,
          title: i.title,
          fields: i.fields,
          sender_name: i.row.senderName,
          sender_tax_code: i.row.senderTaxCode,
          sender_verified: i.row.senderVerified,
          round: i.row.round,
          prev_reason: i.row.prevReason,
          importance: i.importance,
          message: i.message,
          shared: i.shared,
          file_ref: i.row.fileRef,
          pdf_sha256: i.row.pdfSha256,
          expires_at: i.row.expiresAt,
        })),
      );
      const [r] = await tx.execute<{ n: number }>(sql`with src as (
          select * from jsonb_to_recordset(${j}::jsonb) as x(contract_id uuid, approval_id uuid, mailbox_id uuid, title text, fields jsonb,
            sender_name text, sender_tax_code text, sender_verified boolean, round int, prev_reason text, importance text,
            message text, shared jsonb, file_ref text, pdf_sha256 text, expires_at timestamptz)),
        fresh as (select s.* from src s
          where not exists (select 1 from contracts.partner_inbox p where p.tenant_id = ${tid}::uuid and p.mailbox_id = s.mailbox_id)),
        c as (insert into contracts.contracts (id, tenant_id, kind, doc_type, source, title, status, created_by,
            owner_user_id, run_id, fields)
          select f.contract_id, ${tid}::uuid, 'contract', 'contract', 'partner_inbox', f.title, 'needs_review',
            ${SYSTEM_USER}::uuid, ${ownerId}::uuid, f.approval_id, f.fields from fresh f returning id),
        -- Lượt duyệt chờ bộ điều phối mở quy trình nhận (như HĐ gửi duyệt: holdForFlow); OutcomeHandler.launched gắn run vào đúng dòng này.
        ap as (insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback)
          select f.approval_id, ${tid}::uuid, f.contract_id, 'level1', ${SYSTEM_USER}::uuid, 'engine', ${FLOW_STARTING}
          from fresh f join c on c.id = f.contract_id returning 1),
        i as (insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, sender_tax_code,
            sender_verified, round, prev_reason, importance, message, shared, file_ref, pdf_sha256, expires_at)
          select ${tid}::uuid, f.contract_id, f.mailbox_id, f.sender_name, f.sender_tax_code, f.sender_verified, f.round,
            f.prev_reason, f.importance, f.message, f.shared, f.file_ref, f.pdf_sha256, f.expires_at
          from fresh f join c on c.id = f.contract_id returning 1)
        select (select count(*) from i)::int as n`);
      return r?.n ?? 0;
    },
    /** `contract.received` cùng tx (hàm DEFINER, CHỈ tenant hiện tại). event_id = `partner:<mailbox>` như bộ chuyển q1 ⇒ trùng không phát đôi. */
    async emitReceived(items: readonly InboxItem[]): Promise<number> {
      if (items.length === 0) return 0;
      const j = JSON.stringify(
        items.map((i) => ({
          event_id: `partner:${i.row.id}`,
          ref: i.contractId,
          facts: { round: i.row.round, importance: i.importance },
        })),
      );
      const [r] = await tx.execute<{ n: number }>(sql`select count(e.id)::int as n from (
          select hub.emit_flow_event(${tid}::uuid, x.event_id, 'contract.received', x.ref, x.facts, null) as id
          from jsonb_to_recordset(${j}::jsonb) as x(event_id text, ref text, facts jsonb)) e`);
      return r?.n ?? 0;
    },
  };
}

type Found = { mailbox_id: string; status: string; reason: string | null };

/**
 * Lý do gửi cho đối tác = góp ý CHỈ của bước Duyệt đã RẼ nhánh Từ chối/Trả lại (output `fields.decision` khớp kết quả), mới nhất. Ghi chú của người
 * duyệt trước đó (đã Đạt) là nội bộ ⇒ KHÔNG BAO GIỜ gửi ra ngoài; bước quyết không có góp ý ⇒ null (dùng lý do dự phòng, không lùi về bước trước). MỘT câu.
 */
export async function reviewerReason(
  tx: Tx,
  tid: string,
  runId: string,
  outcome: PartnerOutcome,
): Promise<string | null> {
  const decision = outcome === "declined" ? "rejected" : outcome === "returned" ? "returned" : null;
  if (!decision || !UUID.test(runId)) return null;
  const [r] = await tx.execute<{ feedback: string | null }>(sql`
    select nullif(btrim(s.feedback), '') as feedback
    from hub.stage_runs s join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
    where s.tenant_id = ${tid}::uuid and s.process_run_id = ${runId}::uuid and s.status = 'done'
      and jsonb_typeof(o.fields) = 'object' and o.fields ->> 'decision' = ${decision}
    order by s.stage_idx desc limit 1`);
  return r?.feedback ? r.feedback.slice(0, 2000) : null;
}

/**
 * Kết thúc của flow nhận ⇒ trả lời gửi về bên gửi (spec §8c): Đồng ý/Trả lại/Từ chối ⇒ `hub.partner_reply(..., 'receiver_flow')` + trạng thái
 * bản ghi nhận + HĐ nhận, TRONG tx engine (đổi sang role gói như `contract.submitted`). Idempotent: đã áp đúng kết quả ⇒ `already_applied`.
 */
export async function applyReceivedOutcome(tx: Tx, i: OutcomeInput): Promise<OutcomeResult> {
  if (!UUID.test(i.ref) || !isPartnerOutcome(i.outcome))
    throw new Error(`contracts outcome chưa hỗ trợ: ${i.event} · ${i.outcome}`);
  const o: PartnerOutcome = i.outcome;
  const tid = i.tenantId;
  // q4 · lý do của người duyệt bước cuối (góp ý Trả lại/Từ chối) đọc ở tx engine (role hub) TRƯỚC khi đổi sang role gói.
  const fb = o === "confirmed" ? null : await reviewerReason(tx, tid, i.runId, o);
  return withPackRoleInTx(tx, "contracts", tid, async () => {
    const [f] =
      await tx.execute<Found>(sql`select mailbox_id::text, status, reason from contracts.partner_inbox
      where tenant_id = ${tid}::uuid and contract_id = ${i.ref}::uuid for update`);
    if (!f) return "not_found";
    if (f.status === o) return "already_applied";
    if (f.status !== "pending") throw new Error(`contracts outcome: lần nhận đã ${f.status}`);
    const reason = o === "confirmed" ? null : (fb ?? f.reason ?? FALLBACK_REASON[o]);
    await tx.execute(
      sql`select hub.partner_reply(${f.mailbox_id}::uuid, ${o}, ${reason}, 'receiver_flow', null)`,
    );
    await tx.execute(sql`with p as (update contracts.partner_inbox set status = ${o}, reason = ${reason}, replied_at = now()
        where tenant_id = ${tid}::uuid and contract_id = ${i.ref}::uuid returning contract_id),
      ap as (update contracts.approvals x set status = ${APPROVAL_STATUS_OF_RECEIVED[o]}, engine_run_id = ${i.runId}::uuid,
          decided_by = ${i.actorId}::uuid, decided_at = now(), updated_at = now()
        from p where x.tenant_id = ${tid}::uuid and x.contract_id = p.contract_id and x.status = 'level1' returning 1)
      update contracts.contracts c set status = ${INBOX_CONTRACT_STATUS[o]},
        confirmed_at = case when ${o === "confirmed"}::boolean then now() else c.confirmed_at end,
        version = c.version + 1, updated_at = now()
      from p where c.id = p.contract_id and c.tenant_id = ${tid}::uuid`);
    return "applied";
  });
}
