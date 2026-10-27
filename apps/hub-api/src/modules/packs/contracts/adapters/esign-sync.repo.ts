// esign-sweep2 · MỘT câu chọn phong bì cho pha đồng bộ nền (role `contracts_job`, chéo tenant — migration 0065 chỉ cấp đọc cột cần lọc
// + ghi DUY NHẤT `sync_checked_at` trên phong bì mở): lọc tenant bật gói + nhà cung cấp không demo (hai tham số JSON), mốc
// `greatest(updated_at, sync_checked_at)` cũ hơn `now - minMin` theo index một phần `esign_envelopes_sync_idx`, cũ nhất trước,
// `FOR UPDATE SKIP LOCKED` + đặt `sync_checked_at = now` trong cùng câu. Văn bản cố định; mốc giờ là tham số.
import type { Db } from "@ai/db";
import { withPackJobScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import type { EsignSyncClaimed, EsignSyncDeps } from "../application/esign-sync";

export const esignSyncClaim =
  (db: Db, providers: () => readonly string[]): EsignSyncDeps["claim"] =>
  async ({ now, minMin, max, tenants }) => {
    const keys = providers();
    if (keys.length === 0 || tenants.length === 0 || max <= 0) return [];
    const at = now.toISOString();
    const rows = await withPackJobScope(db, "contracts", (tx) =>
      tx.execute<{ tenant_id: string; provider: string; envelope_id: string }>(sql`with
        c as (select e.id from contracts.esign_envelopes e
          where e.status in ('sent', 'delivered')
            and greatest(e.updated_at, e.sync_checked_at) < ${at}::timestamptz - make_interval(mins => ${minMin}::int)
            and e.tenant_id = any(array(select jsonb_array_elements_text(${JSON.stringify(tenants)}::jsonb))::uuid[])
            and e.provider = any(array(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))
          order by greatest(e.updated_at, e.sync_checked_at), e.id
          limit ${max}::int
          for update of e skip locked)
        update contracts.esign_envelopes x set sync_checked_at = ${at}::timestamptz
        from c where x.id = c.id and x.status in ('sent', 'delivered')
        returning x.tenant_id::text as tenant_id, x.provider, x.envelope_id`),
    );
    return rows.map(
      (r): EsignSyncClaimed => ({
        tenantId: r.tenant_id,
        provider: r.provider,
        envelopeId: r.envelope_id,
      }),
    );
  };
