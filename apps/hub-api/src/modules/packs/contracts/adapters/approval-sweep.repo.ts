// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét của flow duyệt trong gói — MỘT câu mỗi tenant: đếm HĐ trong flow có lượt
// duyệt (số đo) + HĐ `extracting` quá hạn (job AI mất: khởi động lại giữa chừng, dữ liệu chuyển từ engine) ⇒
// `extract_failed STALE` + event + lượt duyệt `failed`. Ghi có điều kiện ⇒ chạy lại / nhiều instance không đổi thêm gì.
// M3c (review B #7): job còn XẾP HÀNG (lượt `queued_at` có giá trị — worker chưa nhận) không bị STALE theo `staleMinutes`, chỉ
// đóng khi chờ quá `queuedMinutes` (entry Redis mất); job đã chạy tính hạn từ `updated_at` (worker chạm lúc bắt đầu).
// Review B #12: lượt `extracting` mà HĐ đã xong lượt đọc (afterExtraction lỗi sau khi ghi kết quả) ⇒ `level1`/`failed`
// (prod-fix: tenant tắt duyệt ⇒ `cancelled` + HĐ bỏ `run_id`, không mở cấp 1 / run engine).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { HealedLevel1, SweepRepo } from "../application/approval.ports";

const lv1Of = (v: unknown): HealedLevel1[] => {
  const a = (typeof v === "string" ? JSON.parse(v) : v) as { id: string; by: string }[] | null;
  return (a ?? []).map((x) => ({ contractId: x.id, userId: x.by }));
};

/** contract-flow S3b · lượt engine còn `level1` (ngẫu nhiên ≤ limit — không đói khi nhiều lượt đang chạy). MỘT câu. */
function engineRunsQ(tx: Tx, tid: string): SweepRepo["engineRuns"] {
  return async (limit) => {
    const rows = await tx.execute<{
      id: string;
      run: string;
    }>(sql`select a.id, a.engine_run_id as run
      from contracts.approvals a where a.tenant_id = ${tid}::uuid and a.mode = 'engine' and a.status = 'level1'
        and a.engine_run_id is not null order by random() limit ${limit}::int`);
    return rows.map((r) => ({ approvalId: r.id, runId: r.run }));
  };
}

/** contract-flow S3b · đồng bộ HĐ theo run đã kết thúc, MỘT câu UPDATE theo tập (dữ liệu lô qua một tham số JSON), khớp CẢ lượt lẫn
 *  `engine_run_id` (run đã được mở lại ⇒ bỏ qua): Từ chối ⇒ HĐ `rejected` + lượt `rejected` + event; stalled ⇒ GIỮ `mode='engine'`
 *  (KHÔNG về máy cũ — lách head_only/luồng), ghi lý do vào `feedback`, chờ owner/admin mở lại. Chạy lại vô hại. */
function reconcileQ(tx: Tx, tid: string): SweepRepo["reconcile"] {
  return async (items) => {
    if (items.length === 0) return { rejected: 0, stalled: 0 };
    const json = JSON.stringify(
      items.map((i) => ({
        id: i.approvalId,
        run: i.runId,
        kind: i.kind,
        text: i.kind === "reject" ? i.feedback : i.reason,
      })),
    );
    const [r] = await tx.execute<{ rejected: number; stalled: number }>(sql`with
      v as (select (x->>'id')::uuid as id, (x->>'run')::uuid as run, x->>'kind' as kind, x->>'text' as text
        from jsonb_array_elements(${json}::jsonb) x),
      a as (select y.id, y.contract_id, v.kind, v.text from contracts.approvals y
        join v on v.id = y.id and y.engine_run_id = v.run
        where y.tenant_id = ${tid}::uuid and y.mode = 'engine' and y.status = 'level1' for update of y skip locked),
      rc as (update contracts.contracts c set status = 'rejected', version = c.version + 1, updated_at = now()
        from a where a.kind = 'reject' and c.id = a.contract_id and c.tenant_id = ${tid}::uuid and c.run_id = a.id
          and c.status in ('extracting', 'extract_failed', 'needs_review') returning c.id, c.run_id, a.text),
      ra as (update contracts.approvals x set status = 'rejected', feedback = rc.text, decided_at = now(), updated_at = now()
        from rc where x.id = rc.run_id and x.tenant_id = ${tid}::uuid and x.status = 'level1' returning x.id),
      st as (update contracts.approvals x set feedback = a.text, updated_at = now()
        from a where a.kind = 'stalled' and x.id = a.id and x.tenant_id = ${tid}::uuid and x.mode = 'engine'
          and x.status = 'level1' and x.feedback is distinct from a.text returning x.id),
      ev as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
        select ${tid}::uuid, rc.id, 'rejected', jsonb_build_object('run_id', rc.run_id::text, 'feedback', rc.text)
        from rc)
      select (select count(*) from ra)::int as rejected, (select count(*) from st)::int as stalled`);
    return { rejected: Number(r?.rejected ?? 0), stalled: Number(r?.stalled ?? 0) };
  };
}
export function sweepRepo(tx: Tx, tid: string): SweepRepo {
  return {
    async sweep({ staleMinutes, queuedMinutes, limit }) {
      const [r] = await tx.execute<{
        read: number;
        closed: number;
        healed: number;
        lv1: unknown;
      }>(sql`with
        flow as (select id, run_id from contracts.contracts
          where tenant_id = ${tid}::uuid and status in ('extracting', 'extract_failed', 'needs_review')
          order by updated_at, id limit ${limit}::int),
        stale as (select c.id, c.run_id from contracts.contracts c
          left join contracts.approvals q on q.id = c.run_id and q.tenant_id = c.tenant_id and q.status = 'extracting'
          where c.tenant_id = ${tid}::uuid and c.status = 'extracting'
            and case when q.queued_at is null then c.updated_at < now() - make_interval(mins => ${staleMinutes}::int)
              else q.queued_at < now() - make_interval(mins => ${queuedMinutes}::int) end
          order by c.updated_at, c.id limit ${limit}::int for update of c skip locked),
        u as (update contracts.contracts c set status = 'extract_failed', error = 'STALE', version = c.version + 1,
            updated_at = now()
          from stale where c.id = stale.id and c.tenant_id = ${tid}::uuid and c.status = 'extracting'
          returning c.id, c.run_id),
        a as (update contracts.approvals x set status = 'failed', queued_at = null, updated_at = now()
          from u where x.id = u.run_id and x.tenant_id = ${tid}::uuid and x.status = 'extracting'),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
          select ${tid}::uuid, u.id, 'extract_failed',
            jsonb_build_object('run_id', u.run_id::text, 'code', 'STALE') from u),
        done as (select x.id, c.status from contracts.approvals x
          join contracts.contracts c on c.id = x.contract_id and c.tenant_id = x.tenant_id and c.run_id = x.id
          where x.tenant_id = ${tid}::uuid and x.status = 'extracting' and c.status in ('needs_review', 'extract_failed')
          limit ${limit}::int),
        h as (update contracts.approvals x set queued_at = null, updated_at = now(),
            status = case when done.status = 'extract_failed' then 'failed'
              when contracts.approval_on() then 'level1' else 'cancelled' end
          from done where x.id = done.id and x.tenant_id = ${tid}::uuid and x.status = 'extracting'
          returning x.id, x.contract_id, x.started_by, x.status),
        -- prod-fix · tắt duyệt ⇒ không mở cấp 1 (như afterExtraction): HĐ bỏ run_id ⇒ không còn lượt duyệt.
        hc as (update contracts.contracts c set run_id = null from h
          where h.status = 'cancelled' and c.id = h.contract_id and c.tenant_id = ${tid}::uuid and c.run_id = h.id)
        select (select count(*) from flow where run_id is not null)::int as read,
          (select count(*) from u)::int as closed, (select count(*) from h)::int as healed,
          (select coalesce(jsonb_agg(jsonb_build_object('id', h.contract_id, 'by', h.started_by)), '[]'::jsonb)
            from h where h.status = 'level1') as lv1`);
      return {
        read: Number(r?.read ?? 0),
        closed: Number(r?.closed ?? 0),
        healed: Number(r?.healed ?? 0),
        healedLevel1: lv1Of(r?.lv1),
      };
    },
    engineRuns: engineRunsQ(tx, tid),
    reconcile: reconcileQ(tx, tid),
  };
}
