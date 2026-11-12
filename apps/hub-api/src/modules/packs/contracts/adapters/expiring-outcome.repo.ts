// CR-127 · K6 · spec §7 "Sắp hết hạn" · BR-08/67/68: kết cục của quy trình `contract.expiring` ghi vào HĐ (một nguồn: `effect_outcome` + bằng chứng).
// renew ⇒ HĐ gia hạn DRAFT (`renews_id`, `extract_state='ready'`, chưa tệp ⇒ Gửi đòi FILE_REQUIRED); khi HĐ gia hạn vào DONE (hook `ContractDoneHook`,
// một chỗ cho "vào done") ⇒ HĐ cũ `effect_outcome='renewed'`. terminate ⇒ `terminated` ngay. let_expire ⇒ không đặt gì (hiệu lực tự hết hạn theo ngày).
// Chạy dưới role gói trong tx engine (`withPackRoleInTx`); bằng chứng qua `hub.record_evidence` (chủ thể `effect_outcome`, id = HĐ cũ). Idempotent.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ContractDoneHook } from "../application/contract-done.ports";
import { refreshEffect } from "./contract-state.repo";
import { currentScheduleFacts, EV_EXPIRING } from "./schedule-source.repo";

export type ExpiringOutcome = "renew" | "terminate" | "let_expire";
export const isExpiringOutcome = (o: string): o is ExpiringOutcome =>
  o === "renew" || o === "terminate" || o === "let_expire";
export type ExpiringResult = "applied" | "already_applied" | "not_found";
/** CR-127 SG1: bằng chứng người dùng nhập (đường tay `POST /contracts/:id/expiry-outcome`); vắng ⇒ câu mặc định của quy trình (`NOTE`). */
export type ExpiringEvidence = {
  note: string;
  signature_attachment_id?: string | null | undefined;
  attachment_ids?: string[] | null | undefined;
};
const evidenceArgs = (e?: ExpiringEvidence) => ({
  note: e?.note ?? null,
  sig: e?.signature_attachment_id ?? null,
  atts: e?.attachment_ids?.length ? `{${e.attachment_ids.join(",")}}` : null,
});

const NOTE = {
  renew:
    "Quy trình Sắp hết hạn: gia hạn — đã tạo hợp đồng gia hạn (nháp), chờ tải văn bản và gửi duyệt.",
  terminate: "Quy trình Sắp hết hạn: chấm dứt hợp đồng.",
  renewed: "Hợp đồng gia hạn đã hoàn tất — hợp đồng này ghi nhận Đã gia hạn.",
} as const;

type Cur = {
  id: string;
  ok: boolean;
  outcome: string | null;
  has_child: boolean;
  actor: string | null;
};

/** Người ghi bằng chứng: `hub.record_evidence` đọc `app.user_id` — chưa đặt (engine/hệ thống) ⇒ dùng `fallback`; cả hai trống ⇒ lỗi rõ (không ghi bằng chứng vô chủ). */
export const ensureUser = async (tx: Tx, fallback: string | null): Promise<void> => {
  const [r] = await tx.execute<{ v: string | null }>(
    sql`select set_config('app.user_id', coalesce(nullif(current_setting('app.user_id', true), ''), ${fallback}::text, ''), true) as v`,
  );
  if (!r?.v)
    throw new Error(
      "contracts expiring: không xác định được người thao tác (hợp đồng chưa có người phụ trách / người tạo) — gán người phụ trách rồi chạy lại",
    );
};

export async function applyExpiringOutcome(
  tx: Tx,
  tid: string,
  i: { ref: string; actorId: string | null; outcome: ExpiringOutcome; evidence?: ExpiringEvidence },
): Promise<ExpiringResult> {
  const [c] = await tx.execute<Cur>(sql`select c.id::text as id,
      (c.kind = 'contract' and c.status = 'done' and c.superseded_at is null) as ok, c.effect_outcome as outcome,
      exists (select 1 from contracts.contracts r where r.tenant_id = c.tenant_id and r.renews_id = c.id
        and r.status <> 'reject' and r.superseded_at is null) as has_child, -- bản nháp gia hạn đã bị từ chối/thay không tính
      coalesce(c.owner_user_id, c.created_by)::text as actor
    from contracts.contracts c where c.id = ${i.ref}::uuid and c.tenant_id = ${tid}::uuid for update`);
  if (!c || !c.ok) return "not_found";
  if (i.outcome === "let_expire" && !i.evidence) return "applied";
  if (c.outcome !== null || (i.outcome === "renew" && c.has_child)) return "already_applied";
  const actor = i.actorId ?? c.actor;
  await ensureUser(tx, actor);
  const ev = evidenceArgs(i.evidence);
  if (i.outcome === "let_expire") {
    // Đường tay: ghi quyết định "Để hết hạn" (bằng chứng + lịch sử); không đổi trạng thái — hiệu lực tự hết hạn theo ngày.
    await tx.execute(sql`with ev as (select hub.record_evidence('effect_outcome', ${c.id}::uuid, ${ev.note ?? ""}, ${ev.sig}::uuid,
          ${ev.atts}::uuid[], null::uuid) as id)
      insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${tid}::uuid, ${c.id}::uuid, 'expiry_let_expire', ${actor}::uuid, jsonb_build_object('evidence_id', ev.id::text) from ev`);
    return "applied";
  }
  if (i.outcome === "terminate") {
    await tx.execute(sql`with ev as (select hub.record_evidence('effect_outcome', ${c.id}::uuid, ${ev.note ?? NOTE.terminate}, ${ev.sig}::uuid,
          ${ev.atts}::uuid[], null::uuid) as id),
      u as (update contracts.contracts k set effect_outcome = 'terminated', effect_outcome_at = now(), effect_evidence_id = ev.id,
          version = k.version + 1, updated_at = now() from ev where k.id = ${c.id}::uuid and k.tenant_id = ${tid}::uuid
        returning k.id, ev.id as eid),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, 'terminated', ${actor}::uuid, jsonb_build_object('evidence_id', u.eid::text) from u),
      ob as (insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
        select ${tid}::uuid, 'contract', u.id, 'upsert' from u)
      select 1`);
    await refreshEffect(tx, [c.id]);
    return "applied";
  }
  const nid = crypto.randomUUID();
  await tx.execute(sql`with ev as (select hub.record_evidence('effect_outcome', ${c.id}::uuid, ${ev.note ?? NOTE.renew}, ${ev.sig}::uuid,
        ${ev.atts}::uuid[], null::uuid) as id),
    n as (insert into contracts.contracts (id, tenant_id, kind, title, direction, status, owner_user_id, created_by, fields,
        category_ids, visibility_owner_id, deal, commission_pct, commission_fixed, product_group, doc_type, frame_root_id, source,
        extract_state, renews_id)
      select ${nid}::uuid, s.tenant_id, s.kind, s.title, s.direction, 'draft', s.owner_user_id, ${actor}::uuid,
        s.fields - 'end_date' - 'start_date' - 'signed_date', s.category_ids, s.visibility_owner_id, s.deal, s.commission_pct,
        s.commission_fixed, s.product_group, s.doc_type, s.frame_root_id, s.source, 'ready', s.id
      from contracts.contracts s where s.id = ${c.id}::uuid and s.tenant_id = ${tid}::uuid returning id),
    it as (insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited,
        product_id, component_ids)
      select i.tenant_id, n.id, i.ord, i.name, i.unit, i.qty, i.unit_price, i.verified, i.edited, i.product_id, i.component_ids
      from n, contracts.contract_items i where i.tenant_id = ${tid}::uuid and i.contract_id = ${c.id}::uuid),
    e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${tid}::uuid, n.id, 'renewal_created', ${actor}::uuid,
        jsonb_build_object('from_id', ${c.id}::text, 'evidence_id', ev.id::text) from n, ev),
    ob as (insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
      select ${tid}::uuid, 'contract', n.id, 'upsert' from n)
    select 1`);
  return "applied";
}

/** Hook vào-done: HĐ gia hạn (`renews_id`) xong ⇒ bản hiện hành của HĐ cũ `effect_outcome='renewed'` + bằng chứng + tính lại hiệu lực. Không phải HĐ gia hạn ⇒ không làm gì. */
export const renewalDoneHook: ContractDoneHook = {
  async onDone(txx, tid, contractId) {
    const tx = txx as Tx;
    const [n] = await tx.execute<{
      old_id: string | null;
      actor: string | null;
    }>(sql`select n.renews_id::text as old_id,
        coalesce(n.confirmed_by, n.owner_user_id, n.created_by)::text as actor
      from contracts.contracts n where n.id = ${contractId}::uuid and n.tenant_id = ${tid}::uuid`);
    if (!n?.old_id) return;
    await ensureUser(tx, n.actor);
    // Đặt lên bản HIỆN HÀNH của chuỗi (cùng root_id, chưa bị thay) — HĐ cũ `renews_id` trỏ có thể đã có bản mới hơn.
    const [u] = await tx.execute<{ ids: string[] | string }>(sql`with tgt as (
        select k.id from contracts.contracts k
        where k.tenant_id = ${tid}::uuid and k.superseded_at is null and k.status = 'done' and k.effect_outcome is null
          and k.root_id = (select o.root_id from contracts.contracts o where o.id = ${n.old_id}::uuid and o.tenant_id = ${tid}::uuid)),
      ev as (select t.id as cid, hub.record_evidence('effect_outcome', t.id, ${NOTE.renewed}, null::uuid, null::uuid[], null::uuid) as id
        from tgt t),
      u as (update contracts.contracts k set effect_outcome = 'renewed', effect_outcome_at = now(), effect_evidence_id = ev.id,
          version = k.version + 1, updated_at = now() from ev where k.id = ev.cid and k.tenant_id = ${tid}::uuid
        returning k.id, ev.id as eid),
      e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, u.id, 'renewed', ${n.actor}::uuid,
          jsonb_build_object('by_contract', ${contractId}::text, 'evidence_id', u.eid::text) from u),
      ob as (insert into contracts.index_outbox (tenant_id, entity, entity_id, op)
        select ${tid}::uuid, 'contract', u.id, 'upsert' from u)
      select coalesce(json_agg(u.id), '[]'::json) as ids from u`);
    const ids: string[] = typeof u?.ids === "string" ? JSON.parse(u.ids) : (u?.ids ?? []);
    await refreshEffect(tx, ids);
  },
};

/** Repo cho đường tay `POST /contracts/:id/expiry-outcome` (MỘT tx `PackUow`): áp kết cục (cùng `applyExpiringOutcome` với quy trình) + dữ kiện cho "có quy trình khớp?". */
export function expiryRepo(tx: Tx, t: string) {
  return {
    /** Kết cục + id HĐ gia hạn DRAFT vừa tạo (chỉ `renew` đã áp). */
    async apply(i: {
      ref: string;
      actorId: string;
      outcome: ExpiringOutcome;
      evidence: ExpiringEvidence;
    }): Promise<{ result: ExpiringResult; renewalId: string | null }> {
      const result = await applyExpiringOutcome(tx, t, i);
      if (result !== "applied" || i.outcome !== "renew") return { result, renewalId: null };
      const [r] = await tx.execute<{
        id: string;
      }>(sql`select r.id::text as id from contracts.contracts r
        where r.tenant_id = ${t}::uuid and r.renews_id = ${i.ref}::uuid and r.status <> 'reject' and r.superseded_at is null
        order by r.created_at desc limit 1`);
      return { result, renewalId: r?.id ?? null };
    },
    /** Dữ kiện HĐ cho `hasFlowFor(contract.expiring)` (cùng nguồn với bộ đọc của quy trình: `currentScheduleFacts`). */
    facts: async (ref: string, today: string) =>
      (await currentScheduleFacts(tx, t, EV_EXPIRING, ref, today))?.facts ?? {},
  };
}
