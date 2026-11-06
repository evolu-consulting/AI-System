// ADM-FR-60, ADM-FR-61, ADM-NFR-07 · truy vấn tenants (scope platform; RLS vẫn áp).
import type { EntityStatus } from "@ai/contracts/common";
import { TENANT_APP_IDS, type TenantApp } from "@ai/contracts/tenants";
import { type Tx, tenants, users } from "@ai/db";
import { and, asc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

export type TenantRow = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  maxConcurrentSub: number | null;
  /** ADM-FR-72: tên IANA (TZ-R01). */
  timezone: string;
  /** N2-FR-04 · trần run quy trình đồng thời. */
  processRunsMax: number;
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  /** M4-R17: username người ghi gần nhất; null khi chưa ai ghi hoặc không thấy qua RLS. */
  updatedBy: string | null;
  /** CR-121 Q-1 · chỉ có ở danh sách. */
  apps?: TenantApp[];
};

// Tham chiếu tenants.id viết tay: Drizzle in cột không kèm tên bảng trong select nên "id" sẽ bị hiểu là u.id.
const userCount = sql<number>`(select count(*)::int from admin.users u where u.tenant_id = admin.tenants.id)`;
const updatedBy = sql<
  string | null
>`(select u.username from admin.users u where u.id = admin.tenants.updated_by)`;
// CR-121 Q-1 · app của feature = cột `admin.features.app` (c18, nguồn duy nhất; không suy theo tiền tố khoá). `core`/`other` không tính.
const APP_LIST = sql.raw(TENANT_APP_IDS.map((a) => `'${a}'`).join(","));
const APP_OF = sql`f.app`;
const ENTITLED = sql`from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
  where e.tenant_id = admin.tenants.id and e.revoked_at is null`;
const appsAgg = sql<TenantApp[]>`(select coalesce(array_agg(distinct a order by a), '{}') from
  (select ${APP_OF} as a ${ENTITLED}) s where a in (${APP_LIST}))`;
const hasApp = (app: TenantApp) => sql`exists (select 1 ${ENTITLED} and ${APP_OF} = ${app})`;
const rowCols = {
  id: tenants.id,
  key: tenants.key,
  name: tenants.name,
  active: tenants.active,
  maxConcurrentSub: tenants.maxConcurrentSub,
  timezone: tenants.timezone,
  processRunsMax: tenants.processRunsMax,
  userCount,
  createdAt: tenants.createdAt,
  updatedAt: tenants.updatedAt,
  version: tenants.version,
  updatedBy,
};

export type TenantFilter = {
  q?: string;
  status?: EntityStatus;
  app?: TenantApp;
  limit: number;
  offset: number;
};

function filterSql(f: { q?: string }): SQL | undefined {
  return f.q ? or(ilike(tenants.key, likeArg(f.q)), ilike(tenants.name, likeArg(f.q))) : undefined;
}
const statusSql = (s?: EntityStatus) => (s ? eq(tenants.active, s === "active") : undefined);

export async function listTenants(tx: Tx, f: TenantFilter) {
  const rows = await tx
    .select({ ...rowCols, apps: appsAgg, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(tenants)
    .where(and(filterSql(f), statusSql(f.status), f.app ? hasApp(f.app) : undefined))
    .orderBy(asc(tenants.key))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await tx
    .select({
      all: sql<number>`count(*)`.mapWith(Number),
      active: sql<number>`count(*) filter (where ${tenants.active})`.mapWith(Number),
      locked: sql<number>`count(*) filter (where not ${tenants.active})`.mapWith(Number),
    })
    .from(tenants)
    .where(and(filterSql(f), f.app ? hasApp(f.app) : undefined));
  return {
    rows: rows as (TenantRow & { total: number })[],
    counts: c ?? { all: 0, active: 0, locked: 0 },
  };
}

export async function findTenant(tx: Tx, id: string, o: { forUpdate?: boolean } = {}) {
  const q = tx.select(rowCols).from(tenants).where(eq(tenants.id, id)).limit(1);
  const [row] = o.forUpdate ? await q.for("no key update") : await q;
  return (row as TenantRow | undefined) ?? null;
}

export async function tenantStats(tx: Tx, tenantId: string) {
  const [s] = await tx
    .select({
      tenant_admin_count:
        sql<number>`count(*) filter (where ${users.role} = 'tenant_admin')`.mapWith(Number),
      locked_user_count:
        sql<number>`count(*) filter (where not ${users.active} or ${users.lockedByTenant})`.mapWith(
          Number,
        ),
    })
    .from(users)
    .where(eq(users.tenantId, tenantId));
  return s ?? { tenant_admin_count: 0, locked_user_count: 0 };
}

/** niti-onboard: hồ sơ công ty (chỉ chi tiết tenant đọc — danh sách không kéo jsonb). */
export async function tenantProfile(tx: Tx, id: string): Promise<Record<string, unknown>> {
  // CR-121 · D6: legal_name/address/tax_id/email nay là cột (0035) — không đọc lại từ jsonb (có thể còn bản cũ).
  const [r] = await tx
    .select({
      profile: sql<
        Record<string, unknown>
      >`${tenants.profile} - 'legal_name' - 'address' - 'tax_id' - 'email'`,
    })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  return (r?.profile as Record<string, unknown> | undefined) ?? {};
}

export async function insertTenant(
  tx: Tx,
  t: {
    key: string;
    name: string;
    maxConcurrentSub: number | null;
    timezone: string;
    settings?: Record<string, unknown>;
    updatedBy: string;
  },
): Promise<string> {
  const id = Bun.randomUUIDv7();
  await tx.insert(tenants).values({ id, ...t });
  return id;
}

/** Ghi trường đổi + tăng version/updated_at, `updated_by` = người ghi (chỉ gọi khi thực sự có thay đổi). */
export async function updateTenant(
  tx: Tx,
  id: string,
  set: {
    name?: string;
    maxConcurrentSub?: number | null;
    timezone?: string;
    processRunsMax?: number;
    active?: boolean;
  },
  by: string,
): Promise<void> {
  await tx
    .update(tenants)
    .set({ ...set, version: sql`${tenants.version} + 1`, updatedAt: sql`now()`, updatedBy: by })
    .where(eq(tenants.id, id));
}
