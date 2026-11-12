// CR-124 · q3 · FLOW4-FR-07/08/11 · SQL bên NHẬN (tx gói của tenant B). `take` → `insertBatch` → `emitReceived` = 3 câu CỐ ĐỊNH mỗi lô (Luật 4c),
// cùng tx: lần gửi 'delivered' + HĐ nhận + sự kiện `contract.received` cùng commit (lỗi ⇒ cả ba rollback, lần gửi quay lại 'sent').
// HĐ nhận là bản ghi RIÊNG của B (`contracts.contracts.source='partner_inbox'`) — không id/tenant/lịch sử duyệt của A.
// CR-127 K8 · spec §3 #9–11: HĐ nhận vào PROCESSING theo `initialState('partner_inbox')`; bản sửa của đối tác (lần gửi có `prev_id` = vòng
// trước đã Trả lại) vào CÙNG HĐ nhận (Q10): draft → processing (`partner_revised`, `submit_round+1`) + bản ghi nhận vòng mới, chạy lại từ đầu.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type OutcomeInput, type OutcomeResult, withPackRoleInTx } from "../../kit/public";
import { FLOW_STARTING } from "../application/contract-flow.ports";
import { initialState, transition } from "../domain/contract-state.rules";
import {
  FALLBACK_REASON,
  type Importance,
  INBOX_CONTRACT_EV,
  isPartnerOutcome,
  type PartnerOutcome,
} from "../domain/partner-send.rules";
import { contractStateRepo } from "./contract-state.repo";

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
  /** CR-127 K8 · lần gửi trước (vòng đã Trả lại) của CHÍNH bên gửi tới tenant này; null = vòng đầu / đổi người nhận. */
  prevId: string | null;
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
  /** CR-127 K8 · bản sửa vào HĐ nhận đã có (`contractId` = HĐ cũ, đang DRAFT "Chờ đối tác gửi bản sửa"). */
  revision?: boolean;
};

/** Lượt duyệt của HĐ nhận khi flow nhận kết thúc: Đồng ý ⇒ done, Từ chối ⇒ rejected, Trả lại ⇒ cancelled (như `APPROVAL_STATUS_OF`). */
const APPROVAL_STATUS_OF_RECEIVED: Record<PartnerOutcome, "done" | "rejected" | "cancelled"> = {
  confirmed: "done",
  declined: "rejected",
  returned: "cancelled",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxSettings = {
  importantMin: number;
  criticalMin: number;
  ownerId: string | null;
  /** CR-127 · P2 · nhóm «Người ký HĐ» (null ⇒ chưa có ⇒ đề nghị ký cùng lúc tự về xử lý bình thường). */
  signerGroupId: string | null;
};

async function settingsOf(tx: Tx, tid: string): Promise<InboxSettings> {
  const [r] = await tx.execute<{
    imp: string | number;
    cri: string | number;
    owner: string | null;
    sg: string | null;
  }>(sql`
    select important_min as imp, critical_min as cri, owner_user_id::text as owner, signer_group_id::text as sg
    from contracts.partner_settings where tenant_id = ${tid}::uuid`);
  return r
    ? {
        importantMin: Number(r.imp),
        criticalMin: Number(r.cri),
        ownerId: r.owner,
        signerGroupId: r.sg,
      }
    : { importantMin: 500_000_000, criticalMin: 2_000_000_000, ownerId: null, signerGroupId: null };
}

async function takeRows(tx: Tx, limit: number): Promise<TakenRow[]> {
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
    prev_id: string | null;
  }>(sql`select id::text, round, prev_reason, payload, file_ref, pdf_sha256, expires_at, sender_name,
      sender_tax_code, sender_verified, prev_id::text from hub.partner_inbox_take(${limit}::int)`);
  return rows.map((r) => ({
    id: r.id,
    round: r.round,
    prevReason: r.prev_reason,
    payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : (r.payload ?? {})) as Record<
      string,
      unknown
    >,
    fileRef: r.file_ref,
    pdfSha256: r.pdf_sha256,
    expiresAt: new Date(r.expires_at).toISOString(),
    senderName: r.sender_name ?? "Công ty đối tác",
    senderTaxCode: r.sender_tax_code,
    senderVerified: r.sender_verified === true,
    prevId: r.prev_id ?? null,
  }));
}

const insertJson = (items: readonly InboxItem[]) =>
  JSON.stringify(
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

async function insertInboxBatch(
  tx: Tx,
  tid: string,
  items: readonly InboxItem[],
  o: { ownerId: string | null; approvalFeedback: string | null; awaiting: boolean },
): Promise<number> {
  if (items.length === 0) return 0;
  const j = insertJson(items);
  const { ownerId, approvalFeedback, awaiting } = o;
  const init = initialState("partner_inbox"); // #9 partner_received ⇒ processing (cổng: INSERT theo luật, không literal)
  const [r] = await tx.execute<{ n: number }>(sql`with src as (
        select * from jsonb_to_recordset(${j}::jsonb) as x(contract_id uuid, approval_id uuid, mailbox_id uuid, title text, fields jsonb,
          sender_name text, sender_tax_code text, sender_verified boolean, round int, prev_reason text, importance text,
          message text, shared jsonb, file_ref text, pdf_sha256 text, expires_at timestamptz)),
      fresh as (select s.* from src s
        where not exists (select 1 from contracts.partner_inbox p where p.tenant_id = ${tid}::uuid and p.mailbox_id = s.mailbox_id)),
      -- CR-127 K8 · spec §3 #9: trạng thái + extract_state từ initialState('partner_inbox') (cổng), không literal.
      c as (insert into contracts.contracts (id, tenant_id, kind, doc_type, source, title, status, extract_state, created_by,
          owner_user_id, run_id, fields)
        select f.contract_id, ${tid}::uuid, 'contract', 'contract', 'partner_inbox', f.title, ${init.status}::text,
          ${init.extractState}::text, ${SYSTEM_USER}::uuid, ${ownerId}::uuid,
          case when ${approvalFeedback}::text is null then null else f.approval_id end, f.fields
        from fresh f returning id),
      -- Lượt duyệt chờ bộ điều phối mở quy trình nhận (như HĐ gửi duyệt: holdForFlow); OutcomeHandler.launched gắn run vào đúng dòng này.
      -- Chỉ khi flow nhận đã sẵn sàng (feedback không null): chưa sẵn sàng ⇒ HĐ nhận không có thẻ duyệt treo "đang mở quy trình".
      ap as (insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback)
        select f.approval_id, ${tid}::uuid, f.contract_id, 'level1', ${SYSTEM_USER}::uuid, 'engine', ${approvalFeedback}::text
        from fresh f join c on c.id = f.contract_id where ${approvalFeedback}::text is not null returning 1),
      i as (insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, sender_tax_code,
          sender_verified, round, prev_reason, importance, message, shared, file_ref, pdf_sha256, expires_at, awaiting_decision)
        select ${tid}::uuid, f.contract_id, f.mailbox_id, f.sender_name, f.sender_tax_code, f.sender_verified, f.round,
          f.prev_reason, f.importance, f.message, f.shared, f.file_ref, f.pdf_sha256, f.expires_at, ${awaiting}::boolean
        from fresh f join c on c.id = f.contract_id returning 1),
      -- CR-125 · nhận HĐ từ đối tác ⇒ một dòng lịch sử HĐ nhận (từ ai · vòng), cùng câu với HĐ nhận.
      ev as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tid}::uuid, f.contract_id, 'partner_received',
          jsonb_strip_nulls(jsonb_build_object('from', f.sender_name, 'round', f.round))
        from fresh f join c on c.id = f.contract_id)
      select (select count(*) from i)::int as n`);
  return r?.n ?? 0;
}

/** #11 · luật cổng cho bản sửa: chỉ DRAFT → PROCESSING (`partner_revised`), tăng `submit_round`. */
const REVISED = (() => {
  const t = transition("draft", "partner_revised", {});
  if ("error" in t) throw new Error("contract-state: partner_revised không hợp lệ");
  return { from: "draft", to: t.to };
})();

/**
 * CR-127 K8 · #11 · bản sửa vào CÙNG HĐ nhận: MỘT câu theo tập — cổng theo tập (GUC `bulk:<txid>`, CAS `status = draft`, HĐ nhận) đổi
 * DRAFT → PROCESSING + `submit_round+1` + trường mới, lượt duyệt mới (khi flow nhận sẵn sàng), bản ghi nhận vòng mới, lịch sử. HĐ đã rời DRAFT
 * (đua) ⇒ 0 hàng ⇒ vòng này không ghi gì (hiếm).
 */
async function reviseInboxBatch(
  tx: Tx,
  tid: string,
  items: readonly InboxItem[],
  o: { approvalFeedback: string | null; awaiting: boolean },
): Promise<number> {
  if (items.length === 0) return 0;
  const j = insertJson(items);
  const { approvalFeedback, awaiting } = o;
  const [r] = await tx.execute<{ n: number }>(sql`with src as (
        select * from jsonb_to_recordset(${j}::jsonb) as x(contract_id uuid, approval_id uuid, mailbox_id uuid, title text, fields jsonb,
          sender_name text, sender_tax_code text, sender_verified boolean, round int, prev_reason text, importance text,
          message text, shared jsonb, file_ref text, pdf_sha256 text, expires_at timestamptz)),
      fresh as (select s.* from src s
        where not exists (select 1 from contracts.partner_inbox p where p.tenant_id = ${tid}::uuid and p.mailbox_id = s.mailbox_id)),
      g as (select set_config('contracts.state_gate', 'bulk:' || txid_current()::text, true) as v),
      c as (update contracts.contracts k set status = ${REVISED.to}::text, submit_round = k.submit_round + 1, title = f.title,
          fields = f.fields, run_id = case when ${approvalFeedback}::text is null then null else f.approval_id end,
          version = k.version + 1, updated_at = now()
        from fresh f, g where g.v is not null and k.tenant_id = ${tid}::uuid and k.id = f.contract_id
          and k.status = ${REVISED.from}::text and k.source = 'partner_inbox'
        returning k.id),
      ap as (insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback)
        select f.approval_id, ${tid}::uuid, f.contract_id, 'level1', ${SYSTEM_USER}::uuid, 'engine', ${approvalFeedback}::text
        from fresh f join c on c.id = f.contract_id where ${approvalFeedback}::text is not null returning 1),
      i as (insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, sender_tax_code,
          sender_verified, round, prev_reason, importance, message, shared, file_ref, pdf_sha256, expires_at, awaiting_decision)
        select ${tid}::uuid, f.contract_id, f.mailbox_id, f.sender_name, f.sender_tax_code, f.sender_verified, f.round,
          f.prev_reason, f.importance, f.message, f.shared, f.file_ref, f.pdf_sha256, f.expires_at, ${awaiting}::boolean
        from fresh f join c on c.id = f.contract_id returning 1),
      sc as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tid}::uuid, c.id, 'status_changed', jsonb_build_object('from', ${REVISED.from}::text, 'to', ${REVISED.to}::text,
          'ev', 'partner_revised', 'reason', null, 'evidence_id', null) from c),
      ev as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tid}::uuid, f.contract_id, 'partner_received',
          jsonb_strip_nulls(jsonb_build_object('from', f.sender_name, 'round', f.round, 'reason', f.prev_reason))
        from fresh f join c on c.id = f.contract_id)
      select (select count(*) from i)::int as n`);
  return r?.n ?? 0;
}

/** Vòng sửa: `prev_id` ⇒ HĐ nhận của vòng trước (bản ghi đã Trả lại, HĐ đang DRAFT). MỘT câu theo tập; rỗng ⇒ không gọi. */
async function revisionTargets(
  tx: Tx,
  tid: string,
  prevIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = prevIds.filter((x) => UUID.test(x));
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ prev: string; contract_id: string }>(sql`
    select p.mailbox_id::text as prev, p.contract_id::text as contract_id from contracts.partner_inbox p
    join contracts.contracts c on c.tenant_id = p.tenant_id and c.id = p.contract_id
    where p.tenant_id = ${tid}::uuid and p.mailbox_id = any(${`{${ids.join(",")}}`}::uuid[]) and p.status = 'returned'
      and c.status = ${REVISED.from}::text and c.source = 'partner_inbox'`);
  return new Map([...rows].map((r) => [r.prev, r.contract_id]));
}

export function partnerInboxRepo(tx: Tx, tid: string) {
  return {
    /** Ngưỡng mức quan trọng + người phụ trách HĐ nhận của công ty (chưa đặt ⇒ mặc định spec §6, owner trống). MỘT câu. */
    settings: (): Promise<InboxSettings> => settingsOf(tx, tid),
    /** CR-125 G7 · số HĐ đối tác gửi tới đang chờ công ty nhận (menu `contracts.partner`). MỘT câu theo tập; index `partner_inbox_mailbox_uq`/`list_idx` theo `tenant_id`. */
    async pendingCount(): Promise<number> {
      const [r] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from contracts.partner_inbox
        where tenant_id = ${tid}::uuid and status = 'pending'`);
      return r?.n ?? 0;
    },
    take: (limit: number): Promise<TakenRow[]> => takeRows(tx, limit),
    /** CR-127 K8 · gắn bản sửa vào HĐ nhận cũ: mục có `prevId` khớp ⇒ `contractId` = HĐ cũ + `revision`. ≤ 1 câu. */
    async linkRevisions(items: readonly InboxItem[]): Promise<InboxItem[]> {
      const m = await revisionTargets(
        tx,
        tid,
        items.flatMap((i) => (i.row.prevId ? [i.row.prevId] : [])),
      );
      return items.map((i) => {
        const cid = i.row.prevId ? m.get(i.row.prevId) : undefined;
        return cid ? { ...i, contractId: cid, revision: true } : i;
      });
    },
    /**
     * HĐ nhận + bản ghi nhận, MỘT câu theo tập (vòng mới) + MỘT câu cho bản sửa (chỉ khi có). Trùng `(tenant, mailbox)` ⇒ bỏ qua.
     * `awaiting` = không có quy trình nhận ⇒ chờ người phụ trách quyết (spec §3 #9b).
     */
    async insertBatch(
      items: readonly InboxItem[],
      ownerId: string | null = null,
      /** Lý do ban đầu của lượt duyệt (FLOW_STARTING = chờ bộ điều phối); null ⇒ KHÔNG tạo lượt duyệt (chưa có flow nhận sẵn sàng). */
      approvalFeedback: string | null = FLOW_STARTING,
      awaiting = false,
    ): Promise<number> {
      const fresh = items.filter((i) => !i.revision);
      const rev = items.filter((i) => i.revision);
      const a = await insertInboxBatch(tx, tid, fresh, { ownerId, approvalFeedback, awaiting });
      const b = await reviseInboxBatch(tx, tid, rev, { approvalFeedback, awaiting });
      return a + b;
    },
    /** `contract.received` cùng tx (hàm DEFINER, CHỈ tenant hiện tại). event_id = `partner:<mailbox>` như bộ chuyển q1 ⇒ trùng không phát đôi. */
    async emitReceived(
      items: readonly InboxItem[],
      actorId: string | null = null,
      /** CR-127 · P2 · công ty nhận có nhóm Người ký HĐ ⇒ fact `sign_together` theo đề nghị của bên gửi; chưa có ⇒ false (nhánh thường). */
      signTogetherOk = true,
    ): Promise<number> {
      if (items.length === 0) return 0;
      const j = JSON.stringify(
        items.map((i) => ({
          event_id: `partner:${i.row.id}`,
          ref: i.contractId,
          facts: {
            round: i.row.round,
            importance: i.importance,
            sign_together: signTogetherOk && Boolean(i.row.payload.sign_together),
          },
        })),
      );
      const [r] = await tx.execute<{ n: number }>(sql`select count(e.id)::int as n from (
          select hub.emit_flow_event(${tid}::uuid, x.event_id, 'contract.received', x.ref, x.facts, ${actorId}::uuid) as id
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
    select coalesce(nullif(btrim(s.feedback), ''), nullif(btrim(tk.feedback), '')) as feedback
    from hub.stage_runs s join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
      -- Duyệt rẽ nhánh (return_step/reject_step): cổng đi như Đạt ⇒ góp ý nằm ở task duyệt đã đóng của bước, không ở stage.
      left join lateral (select t.feedback from hub.review_tasks t
        where t.stage_run_id = s.id and t.tenant_id = s.tenant_id and t.status = 'closed'
        order by t.decided_at desc nulls last limit 1) tk on true
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
    // CR-127 K8 · một HĐ nhận nhiều vòng ⇒ bản ghi của vòng MỚI NHẤT.
    const [f] =
      await tx.execute<Found>(sql`select mailbox_id::text, status, reason from contracts.partner_inbox
      where tenant_id = ${tid}::uuid and contract_id = ${i.ref}::uuid order by round desc, created_at desc limit 1 for update`);
    if (!f) return "not_found";
    if (f.status === o) return "already_applied";
    if (f.status !== "pending") throw new Error(`contracts outcome: lần nhận đã ${f.status}`);
    const reason = o === "confirmed" ? null : (fb ?? f.reason ?? FALLBACK_REASON[o]);
    // CR-127 K1b · CỔNG TRƯỚC `partner_reply`: inbox còn pending mà HĐ không ở processing ⇒ dữ liệu lệch ⇒ ném (engine rollback, không trả lời đối tác).
    const g = await contractStateRepo(tx, tid).applyTransition({
      contractId: i.ref,
      ev: INBOX_CONTRACT_EV[o],
      actorId: i.actorId,
    });
    if (!g.ok) throw new Error(`contracts outcome: HĐ nhận không ở processing (${i.ref})`);
    await tx.execute(
      sql`select hub.partner_reply(${f.mailbox_id}::uuid, ${o}, ${reason}, 'receiver_flow', null)`,
    );
    await tx.execute(sql`with p as (update contracts.partner_inbox set status = ${o}, reason = ${reason}, replied_at = now(),
          awaiting_decision = false
        where tenant_id = ${tid}::uuid and mailbox_id = ${f.mailbox_id}::uuid returning contract_id),
      ap as (update contracts.approvals x set status = ${APPROVAL_STATUS_OF_RECEIVED[o]}, engine_run_id = ${i.runId}::uuid,
          decided_by = ${i.actorId}::uuid, decided_at = now(), updated_at = now()
        from p where x.tenant_id = ${tid}::uuid and x.contract_id = p.contract_id and x.status = 'level1' returning 1)
      select count(*) from p`);
    return "applied";
  });
}
