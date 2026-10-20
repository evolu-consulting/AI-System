// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét của flow duyệt trong gói — MỘT câu mỗi tenant: đếm HĐ trong flow có lượt
// duyệt (số đo) + HĐ `extracting` quá hạn (job AI mất: khởi động lại giữa chừng, dữ liệu chuyển từ engine) ⇒
// `extract_failed STALE` + event + lượt duyệt `failed`. Ghi có điều kiện ⇒ chạy lại / nhiều instance không đổi thêm gì.
// M3c (review B #7): job còn XẾP HÀNG (lượt `queued_at` có giá trị — worker chưa nhận) không bị STALE theo `staleMinutes`, chỉ
// đóng khi chờ quá `queuedMinutes` (entry Redis mất); job đã chạy tính hạn từ `updated_at` (worker chạm lúc bắt đầu).
// Review B #12: lượt `extracting` mà HĐ đã xong lượt đọc (afterExtraction lỗi sau khi ghi kết quả) ⇒ `level1`/`failed`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SweepRepo } from "../application/approval.ports";

export function sweepRepo(tx: Tx, tid: string): SweepRepo {
  return {
    async sweep({ staleMinutes, queuedMinutes, limit }) {
      const [r] = await tx.execute<{ read: number; closed: number; healed: number }>(sql`with
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
            status = case done.status when 'needs_review' then 'level1' else 'failed' end
          from done where x.id = done.id and x.tenant_id = ${tid}::uuid and x.status = 'extracting' returning x.id)
        select (select count(*) from flow where run_id is not null)::int as read,
          (select count(*) from u)::int as closed, (select count(*) from h)::int as healed`);
      return {
        read: Number(r?.read ?? 0),
        closed: Number(r?.closed ?? 0),
        healed: Number(r?.healed ?? 0),
      };
    },
  };
}
