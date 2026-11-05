// seed-niti · cấp feature công ty `contracts-approval-engine` (Admin › Công ty › Tính năng) qua CHÍNH service Admin
// (audit + config_changed); đang hiệu lực ⇒ không ghi. dry ⇒ chỉ so. Thiếu feature này HĐ không bao giờ vào luồng duyệt.
import { type Db, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { grantEntitlement } from "../../../apps/admin-api/src/modules/features/features.entitlements";
import { ENGINE_FEATURE_KEY } from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-engine.rules";

type Actor = { userId: string; tenantId: string; tenantKey: string };
type Row = { fid: string | null; tid: string | null; on: boolean };

export async function ensureEngine(
  admin: Db,
  tenantKey: string,
  actor: Actor,
  dry: boolean,
): Promise<"granted" | "same"> {
  const [r] = await withScope(
    admin,
    { kind: "platform" },
    async (tx) =>
      (await tx.execute(
        sql`select (select id from admin.features where key = ${ENGINE_FEATURE_KEY}) fid,
      (select id from admin.tenants where key = ${tenantKey}) tid,
      exists (select 1 from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
        join admin.tenants t on t.id = e.tenant_id
        where f.key = ${ENGINE_FEATURE_KEY} and t.key = ${tenantKey} and e.revoked_at is null) "on"`,
      )) as unknown as Row[],
  );
  if (!r?.fid)
    throw new Error(`seed-niti: thiếu feature ${ENGINE_FEATURE_KEY} (chạy migration admin)`);
  if (r.on) return "same";
  if (dry || !r.tid) return "granted";
  const call = {
    ctx: { db: admin },
    actor: { ...actor, role: "platform_admin" as const, sid: null },
    scope: { kind: "platform" as const },
  };
  await grantEntitlement(call as never, r.fid, r.tid);
  return "granted";
}
