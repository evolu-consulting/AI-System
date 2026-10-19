// HD-FR-35 · #218 · D3-09 · M3-decouple: vòng quét của flow duyệt trong gói — MỘT câu mỗi tenant: đếm HĐ trong flow có lượt
// duyệt (số đo) + HĐ `extracting` quá `staleMinutes` (job AI mất: khởi động lại giữa chừng, dữ liệu chuyển từ engine) ⇒
// `extract_failed STALE` + event + lượt duyệt `failed`. Ghi có điều kiện ⇒ chạy lại / nhiều instance không đổi thêm gì.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SweepRepo } from "../application/approval.ports";

export function sweepRepo(tx: Tx, tid: string): SweepRepo {
  return {
    async sweep(staleMinutes, limit) {
      const [r] = await tx.execute<{ read: number; closed: number }>(sql`with
        flow as (select id, run_id from contracts.contracts
          where tenant_id = ${tid}::uuid and status in ('extracting', 'extract_failed', 'needs_review')
          order by updated_at, id limit ${limit}::int),
        stale as (select id, run_id from contracts.contracts
          where tenant_id = ${tid}::uuid and status = 'extracting'
            and updated_at < now() - make_interval(mins => ${staleMinutes}::int)
          order by updated_at, id limit ${limit}::int for update skip locked),
        u as (update contracts.contracts c set status = 'extract_failed', error = 'STALE', version = c.version + 1,
            updated_at = now()
          from stale where c.id = stale.id and c.tenant_id = ${tid}::uuid and c.status = 'extracting'
          returning c.id, c.run_id),
        a as (update contracts.approvals x set status = 'failed', updated_at = now()
          from u where x.id = u.run_id and x.tenant_id = ${tid}::uuid and x.status = 'extracting'),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, data)
          select ${tid}::uuid, u.id, 'extract_failed',
            jsonb_build_object('run_id', u.run_id::text, 'code', 'STALE') from u)
        select (select count(*) from flow where run_id is not null)::int as read,
          (select count(*) from u)::int as closed`);
      return { read: Number(r?.read ?? 0), closed: Number(r?.closed ?? 0) };
    },
  };
}
