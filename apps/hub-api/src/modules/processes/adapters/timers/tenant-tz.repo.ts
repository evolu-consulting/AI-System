// HUB-FR-144 · ADM-FR-72 · TZ-R04 · plan §4.6 bước 2 · `TenantTzReader` gắn tx + `tenantId` của hàng run đã khoá: đọc
// `admin.tenants.timezone` (quyền `hub_ro` sẵn có) TRONG tx lưu hẹn, lọc tenant tường minh. Không hàng ⇒ mặc định + warn.
import { TENANT_TZ_DEFAULT } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Logger } from "../../application/ports";
import type { TenantTzReader } from "../../application/timers/wait.ports";

export function tenantTzRepo(tx: Tx, tenantId: string, log?: Pick<Logger, "warn">): TenantTzReader {
  return {
    async read() {
      const [r] = await tx.execute<{ timezone: string }>(sql`
        select timezone from admin.tenants where id = ${tenantId}`);
      if (r?.timezone) return r.timezone;
      log?.warn("process-tenant-tz-missing", { tenantId });
      return TENANT_TZ_DEFAULT;
    },
  };
}
