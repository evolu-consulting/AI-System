// CR-127 K3 · BR-02/03/04/36a · spec §2.1, §3 (#3, #4, #8, #16): SQL của Gửi / Gửi lại / Rút về / Tạo lại. Trong tx gói (role `contracts_rw`,
// RLS tenant); mọi câu lọc `tenant_id`. Đổi trạng thái chỉ qua cổng `applyTransition` (usecase gọi) — ở đây chỉ cột phụ + hồ sơ.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { FLOW_STARTING } from "../application/contract-flow.ports";

export type SubmitHead = {
  status: string;
  extractState: string;
  round: number;
  submittedBy: string | null;
  createdBy: string;
  ownerId: string | null;
  runId: string | null;
  needsFile: boolean;
  fields: unknown;
  textSha: string | null;
  sourceText: string | null;
  last: { fields: unknown; textSha: string | null } | null;
  /** Trường + văn bản y hệt lần gửi trước (so trong DB, jsonb =). */
  same: boolean;
  returnNote: string | null;
};

type HeadRow = {
  status: string;
  extract_state: string;
  submit_round: number;
  submitted_by: string | null;
  created_by: string;
  owner_user_id: string | null;
  run_id: string | null;
  needs_file: boolean;
  fields: unknown;
  sha: string | null;
  source_text: string | null;
  last_fields: unknown;
  last_sha: string | null;
  has_last: boolean;
  same: boolean;
  return_note: string | null;
};
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

export function submissionsRepo(tx: Tx, tid: string) {
  return {
    /** Khoá HĐ (`forUpdate: false` ⇒ chỉ đọc — xem trước M4) + hồ sơ lần gửi trước + ý kiến trả lại của lượt gần nhất. MỘT câu. Không thấy ⇒ null. */
    async lock(
      id: string,
      o: { forUpdate: boolean } = { forUpdate: true },
    ): Promise<SubmitHead | null> {
      const [r] =
        await tx.execute<HeadRow>(sql`select c.status, c.extract_state, c.submit_round, c.submitted_by,
          c.created_by, c.owner_user_id, c.run_id, (c.renews_id is not null and c.file_id is null) as needs_file, c.fields,
          case when c.source_text is null then null else encode(sha256(convert_to(c.source_text, 'UTF8')), 'hex') end as sha,
          c.source_text, s.fields as last_fields, s.text_sha256 as last_sha, (s.id is not null) as has_last,
          (s.id is not null and s.fields = c.fields and s.text_sha256 is not distinct from
            case when c.source_text is null then null else encode(sha256(convert_to(c.source_text, 'UTF8')), 'hex') end) as same,
          (select a.feedback from contracts.approvals a where a.tenant_id = c.tenant_id and a.contract_id = c.id
            and a.status = 'returned' order by a.updated_at desc limit 1) as return_note
        from contracts.contracts c
        left join lateral (select x.id, x.fields, x.text_sha256 from contracts.contract_submissions x
          where x.tenant_id = c.tenant_id and x.contract_id = c.id order by x.round desc limit 1) s on true
        where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid ${o.forUpdate ? sql`for update of c` : sql``}`);
      if (!r) return null;
      return {
        status: r.status,
        extractState: r.extract_state,
        round: Number(r.submit_round),
        submittedBy: r.submitted_by,
        createdBy: r.created_by,
        ownerId: r.owner_user_id,
        runId: r.run_id,
        needsFile: r.needs_file === true,
        fields: json(r.fields),
        textSha: r.sha,
        sourceText: r.source_text,
        last: r.has_last ? { fields: json(r.last_fields), textSha: r.last_sha } : null,
        same: r.same === true,
        returnNote: r.return_note,
      };
    },
    /**
     * Có quy trình: lượt duyệt chờ flow (`mode engine`, chưa run, `FLOW_STARTING`) — dùng lại lượt sống (lượt đọc AI sau tải lên) hoặc mở
     * lượt mới (Gửi lại: lượt cũ đã đóng, hồ sơ giữ) + `contracts.run_id` = lượt. MỘT câu. Trả id lượt.
     */
    async openFlowLot(id: string, actor: string, links: unknown | null): Promise<string> {
      const fresh = crypto.randomUUID();
      const pl = links ? JSON.stringify(links) : null;
      // FIX-Z3 · lượt sống ĐÃ gắn run (run bị huỷ/kết thúc mà lượt chưa đóng — vd hub 0135) ⇒ đóng `cancelled` giữ hồ sơ, KHÔNG dùng lại
      // (dùng lại sẽ xoá dấu run cũ). Câu riêng TRƯỚC câu mở lượt: chỉ mục `approvals_live_uq` kiểm ngay từng hàng.
      await tx.execute(sql`update contracts.approvals x set status = 'cancelled', decided_at = now(), updated_at = now()
        where x.tenant_id = ${tid}::uuid and x.contract_id = ${id}::uuid
          and x.status in ('extracting', 'level1', 'level2') and x.engine_run_id is not null`);
      const [r] = await tx.execute<{ aid: string }>(sql`with
        old as (select x.id from contracts.approvals x where x.tenant_id = ${tid}::uuid and x.contract_id = ${id}::uuid
          and x.status in ('extracting', 'level1', 'level2') limit 1),
        up as (update contracts.approvals x set status = 'level1', mode = 'engine', engine_run_id = null,
            feedback = ${FLOW_STARTING}, started_by = ${actor}::uuid, pending_links = ${pl}::jsonb, updated_at = now()
          from old where x.id = old.id and x.tenant_id = ${tid}::uuid returning x.id),
        ins as (insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback, pending_links)
          select ${fresh}::uuid, ${tid}::uuid, ${id}::uuid, 'level1', ${actor}::uuid, 'engine', ${FLOW_STARTING}, ${pl}::jsonb
          where not exists (select 1 from old) returning id),
        a as (select id from up union all select id from ins),
        c as (update contracts.contracts c set run_id = (select id from a) from a
          where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid returning c.id)
        select (select id from a)::text as aid, (select count(*) from c) as n`);
      if (!r?.aid) throw new Error("submit: approval lot not opened");
      return r.aid;
    },
    /** Không quy trình / Rút về: đóng lượt sống của HĐ (`done` | `cancelled`) + ghi lý do. MỘT câu. */
    async closeLot(id: string, status: "done" | "cancelled", actor: string, note: string | null) {
      await tx.execute(sql`update contracts.approvals x set status = ${status}, decided_by = ${actor}::uuid,
          decided_at = now(), feedback = coalesce(${note}, x.feedback), updated_at = now()
        where x.tenant_id = ${tid}::uuid and x.contract_id = ${id}::uuid and x.status in ('extracting', 'level1', 'level2')`);
    },
    /** Engine run của lượt duyệt hiện tại (Rút về). */
    async engineRunOf(
      id: string,
    ): Promise<{ approvalId: string; engineRunId: string | null } | null> {
      const [r] = await tx.execute<{
        id: string;
        engine_run_id: string | null;
      }>(sql`select a.id, a.engine_run_id
        from contracts.contracts c join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
        where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid`);
      return r ? { approvalId: r.id, engineRunId: r.engine_run_id } : null;
    },
    /** Hồ sơ lần gửi (chỉ thêm): văn bản chỉ lưu khi khác lần trước. + event `no_flow` khi đi thẳng DONE. MỘT câu. */
    async record(
      id: string,
      s: {
        round: number;
        actor: string;
        fields: unknown;
        textSha: string | null;
        sourceText: string | null;
        returnNote: string | null;
        unchangedReason: string | null;
        noFlow: boolean;
      },
    ): Promise<void> {
      await tx.execute(sql`with
        s as (insert into contracts.contract_submissions (tenant_id, contract_id, round, submitted_by, fields, text_sha256,
            source_text, return_note, unchanged_reason)
          values (${tid}::uuid, ${id}::uuid, ${s.round}::int, ${s.actor}::uuid, ${JSON.stringify(s.fields ?? {})}::jsonb,
            ${s.textSha}, ${s.sourceText}, ${s.returnNote}, ${s.unchangedReason}) returning id)
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tid}::uuid, ${id}::uuid, 'no_flow', ${s.actor}::uuid, jsonb_build_object('round', ${s.round}::int)
        from s where ${s.noFlow}::boolean`);
    },
    /** Bằng chứng "Gửi lại không đổi" qua DEFINER hub (E1). */
    async evidence(
      subjectId: string,
      e: { note: string; signature_attachment_id?: string; attachment_ids?: string[] },
    ) {
      const ids = `{${(e.attachment_ids ?? []).join(",")}}`;
      const [r] = await tx.execute<{
        id: string;
      }>(sql`select hub.record_evidence('unchanged_resubmit', ${subjectId}::uuid,
        ${e.note}, ${e.signature_attachment_id ?? null}::uuid, ${ids}::uuid[], null::uuid)::text as id`);
      return r?.id ?? null;
    },
    /** #16 · HĐ mới DRAFT từ HĐ bị từ chối: chép tệp + văn bản + trường + dòng hàng, `extract_state = ready`. MỘT câu. Trả id mới. */
    async recreate(id: string, actor: string): Promise<string | null> {
      const nid = crypto.randomUUID();
      const [r] = await tx.execute<{ id: string }>(sql`with
        src as (select * from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid and c.status = 'reject'),
        n as (insert into contracts.contracts (id, tenant_id, kind, parent_id, title, direction, status, owner_user_id, created_by,
            fields, file_id, source_text, clauses, warnings, category_ids, visibility_owner_id, deal, commission_pct,
            commission_fixed, product_group, doc_type, frame_root_id, source, extract_state, renews_id)
          select ${nid}::uuid, s.tenant_id, s.kind, s.parent_id, s.title, s.direction, 'draft', s.owner_user_id, ${actor}::uuid,
            s.fields, s.file_id, s.source_text, s.clauses, s.warnings, s.category_ids, s.visibility_owner_id, s.deal,
            s.commission_pct, s.commission_fixed, s.product_group, s.doc_type, s.frame_root_id, s.source, 'ready',
            s.renews_id
          from src s returning id),
        it as (insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited,
            product_id, component_ids)
          select i.tenant_id, n.id, i.ord, i.name, i.unit, i.qty, i.unit_price, i.verified, i.edited, i.product_id, i.component_ids
          from n, contracts.contract_items i where i.tenant_id = ${tid}::uuid and i.contract_id = ${id}::uuid),
        ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tid}::uuid, n.id, 'recreated', ${actor}::uuid, jsonb_build_object('from_id', ${id}::text) from n)
        select id::text from n`);
      return r?.id ?? null;
    },
  };
}
export type SubmissionsRepo = ReturnType<typeof submissionsRepo>;
