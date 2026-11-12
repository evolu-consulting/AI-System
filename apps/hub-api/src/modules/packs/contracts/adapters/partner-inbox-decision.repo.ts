// CR-127 K8 · BR-57/58 · spec §3 #9b: HĐ nhận KHÔNG có quy trình nhận chạy được (không flow khớp / lượt nhận huỷ / lỗi / hết hạn) ⇒ HĐ giữ
// PROCESSING, bản ghi nhận `awaiting_decision = true` ⇒ người phụ trách HĐ nhận quyết Đồng ý / Trả lại / Từ chối
// (`POST /contracts/:id/inbox-decision`). Không trả lời đối tác ở hook (đối tác chỉ nhận câu trả lời khi người phụ trách quyết).
// Quyết = cổng `applyTransition` (inbox_accept/return/reject) + `hub.partner_reply` (receiver_flow) + đóng bản ghi nhận/lượt duyệt — cùng tx.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type FlowRunEnd, withPackRoleInTx } from "../../kit/public";
import { CONTRACTS_PACK } from "../domain/contract-flow-events.rules";
import type { ContractEv } from "../domain/contract-state.rules";
import type { PartnerOutcome } from "../domain/partner-send.rules";
import { approvalWrite } from "./approval.repo";
import { contractStateRepo } from "./contract-state.repo";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InboxDecision = "accept" | "return" | "reject";
const EV_OF: Record<InboxDecision, ContractEv> = {
  accept: "inbox_accept",
  return: "inbox_return",
  reject: "inbox_reject",
};
const OUTCOME_OF: Record<InboxDecision, PartnerOutcome> = {
  accept: "confirmed",
  return: "returned",
  reject: "declined",
};
const APPROVAL_OF: Record<InboxDecision, "done" | "rejected" | "cancelled"> = {
  accept: "done",
  reject: "rejected",
  return: "cancelled",
};

/**
 * MỘT câu: (1) đóng lượt duyệt của HĐ nhận nếu khớp lượt (`run` null = chưa có run — không mở được); (2) bật `awaiting_decision` cho bản ghi
 * nhận đang chờ của HĐ nhận còn PROCESSING. CAS: có `run` ⇒ chỉ khi lượt duyệt của HĐ gắn ĐÚNG run đó (lượt cũ / đã quyết ⇒ 0 hàng).
 */
const AWAIT_SQL = (
  tid: string,
  ref: string,
  run: string | null,
  reason: string,
  st: string,
) => sql`with
  c as (select k.id, k.run_id from contracts.contracts k
    where k.tenant_id = ${tid}::uuid and k.id = ${ref}::uuid and k.status = 'processing' and k.source = 'partner_inbox'),
  a as (update contracts.approvals x set status = ${st}, feedback = left(${reason}, 4000), decided_at = now(), updated_at = now()
    from c where x.tenant_id = ${tid}::uuid and x.contract_id = c.id and x.id = c.run_id and x.mode = 'engine'
      and x.status in ('level1', 'level2') and x.engine_run_id is not distinct from ${run}::uuid
    returning x.id),
  p as (update contracts.partner_inbox p set awaiting_decision = true
    from c where p.tenant_id = ${tid}::uuid and p.contract_id = c.id and p.status = 'pending' and not p.awaiting_decision
      and (exists (select 1 from a) or (${run}::uuid is null and c.run_id is null))
    returning 1)
  select count(*)::int as n from p`;

/**
 * Hook `notLaunched` / `cancelled` / `failed` của `contract.received` — TRONG tx engine/bộ điều phối (role gói + tenant của lượt). Không ném
 * vì CAS; trả true khi đã chuyển sang chờ người phụ trách quyết.
 */
export async function markInboxAwaiting(
  tx: Tx,
  i: { tenantId: string; ref: string; runId: string | null; reason: string },
  approvalStatus: "failed" | "cancelled",
): Promise<boolean> {
  if (!UUID.test(i.tenantId) || !UUID.test(i.ref) || (i.runId !== null && !UUID.test(i.runId)))
    return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, async () => {
    await approvalWrite(tx);
    const [r] = await tx.execute<{ n: number }>(
      AWAIT_SQL(i.tenantId, i.ref, i.runId, i.reason.slice(0, 200), approvalStatus),
    );
    return Number(r?.n ?? 0) > 0;
  });
}

/** `failedBatch` (hết hạn theo lô) cho HĐ nhận: hiếm ⇒ MỘT câu mỗi mục (lệch Luật 4c, ghi spec §12). Trả số HĐ nhận chuyển chờ quyết. */
export async function markInboxAwaitingBatch(
  tx: Tx,
  items: readonly FlowRunEnd[],
): Promise<number> {
  let n = 0;
  for (const i of items) if (await markInboxAwaiting(tx, i, "failed")) n++;
  return n;
}

export type InboxDecideErr = "not_found" | "INBOX_NOT_AWAITING" | "INBOX_DECISION_FORBIDDEN";

/** Lần gửi của đối tác đã hết hạn / đã có trả lời (hub 55000) — ném để rollback cổng. */
export class InboxReplyClosed extends Error {
  constructor() {
    super("INBOX_REPLY_CLOSED");
  }
}

export type InboxEvidence = {
  note: string;
  signature_attachment_id?: string | undefined;
  attachment_ids?: string[] | undefined;
};

/** Bằng chứng quyết qua DEFINER hub (E1; tenant + người ghi lấy từ GUC của tx). `subject_kind` = inbox_decision (MIGC 0094). */
async function recordEvidence(
  tx: Tx,
  contractId: string,
  e: InboxEvidence,
): Promise<string | null> {
  const ids = `{${(e.attachment_ids ?? []).join(",")}}`;
  const [r] = await tx.execute<{
    id: string;
  }>(sql`select hub.record_evidence('inbox_decision', ${contractId}::uuid,
    ${e.note}, ${e.signature_attachment_id ?? null}::uuid, ${ids}::uuid[], null::uuid)::text as id`);
  return r?.id ?? null;
}

type Pending = { mailbox_id: string; owner: string | null; run_id: string | null };

/**
 * Người phụ trách (hoặc quản trị công ty) quyết HĐ nhận đang chờ — TRONG tx gói scope người dùng (RLS). Thứ tự: khoá bản ghi nhận đang chờ →
 * kiểm vai → cổng (CAS processing) → trả lời đối tác (`hub.partner_reply`, receiver_flow; hết hạn/đã trả lời ⇒ 55000) → đóng bản ghi + lượt.
 */
export async function decideInbox(
  tx: Tx,
  tid: string,
  q: {
    contractId: string;
    decision: InboxDecision;
    actorId: string;
    isAdmin: boolean;
    evidence: InboxEvidence | null;
  },
): Promise<{ status: string } | { error: InboxDecideErr }> {
  const [f] =
    await tx.execute<Pending>(sql`select p.mailbox_id::text, c.owner_user_id::text as owner,
      c.run_id::text as run_id
    from contracts.partner_inbox p join contracts.contracts c on c.tenant_id = p.tenant_id and c.id = p.contract_id
    where p.tenant_id = ${tid}::uuid and p.contract_id = ${q.contractId}::uuid and p.status = 'pending'
    order by p.round desc limit 1 for update of p`);
  if (!f) {
    const [c] = await tx.execute<{ id: string }>(sql`select id::text from contracts.contracts
      where tenant_id = ${tid}::uuid and id = ${q.contractId}::uuid`);
    return { error: c ? "INBOX_NOT_AWAITING" : "not_found" };
  }
  if (!q.isAdmin && f.owner !== q.actorId) return { error: "INBOX_DECISION_FORBIDDEN" };
  const [aw] = await tx.execute<{
    a: boolean;
  }>(sql`select awaiting_decision as a from contracts.partner_inbox
    where tenant_id = ${tid}::uuid and mailbox_id = ${f.mailbox_id}::uuid`);
  if (!aw?.a) return { error: "INBOX_NOT_AWAITING" };
  const note = q.evidence?.note ?? null;
  const evidenceId = q.evidence ? await recordEvidence(tx, q.contractId, q.evidence) : null;
  const g = await contractStateRepo(tx, tid).applyTransition({
    contractId: q.contractId,
    ev: EV_OF[q.decision],
    actorId: q.actorId,
    reason: note,
    evidenceId,
  });
  if (!g.ok) return { error: "INBOX_NOT_AWAITING" };
  return closeAndReply(tx, tid, f, { ...q, note });
}

async function closeAndReply(
  tx: Tx,
  tid: string,
  f: Pending,
  q: { contractId: string; decision: InboxDecision; actorId: string; note: string | null },
): Promise<{ status: string } | { error: InboxDecideErr }> {
  const o = OUTCOME_OF[q.decision];
  const reason = o === "confirmed" ? null : (q.note ?? "").slice(0, 2000);
  try {
    await tx.execute(
      sql`select hub.partner_reply(${f.mailbox_id}::uuid, ${o}, ${reason}, 'receiver_flow', null)`,
    );
  } catch (e) {
    const c = e as { code?: string; cause?: { code?: string } };
    // Ném (không trả lỗi) ⇒ tx rollback cả bước cổng đã áp; route dịch sang 409.
    if ((c?.code ?? c?.cause?.code) === "55000") throw new InboxReplyClosed();
    throw e;
  }
  await approvalWrite(tx);
  const [r] = await tx.execute<{ status: string }>(sql`with
    p as (update contracts.partner_inbox set status = ${o}, reason = ${reason}, replied_at = now(), awaiting_decision = false
      where tenant_id = ${tid}::uuid and mailbox_id = ${f.mailbox_id}::uuid returning contract_id),
    ap as (update contracts.approvals x set status = ${APPROVAL_OF[q.decision]}, decided_by = ${q.actorId}::uuid,
        decided_at = now(), updated_at = now()
      from p where x.tenant_id = ${tid}::uuid and x.contract_id = p.contract_id and x.status in ('level1', 'level2') returning 1),
    ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${tid}::uuid, p.contract_id, 'inbox_decided', ${q.actorId}::uuid,
        jsonb_strip_nulls(jsonb_build_object('decision', ${q.decision}::text, 'note', ${q.note}::text)) from p)
    select c.status from contracts.contracts c where c.tenant_id = ${tid}::uuid and c.id = ${q.contractId}::uuid`);
  return { status: r?.status ?? "processing" };
}
