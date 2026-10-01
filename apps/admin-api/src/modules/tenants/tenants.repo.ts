// ADM-FR-60, ADM-FR-61, ADM-NFR-07 · truy vấn tenants (scope platform; RLS vẫn áp).
import type { EntityStatus } from "@ai/contracts";
import { type Tx, tenants, users } from "@ai/db";
import { and, asc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { likeArg } from "../../lib/sql";

export type TenantRow = {
  id: string;
  key: string;
  name: string;
  active: boolean;
  maxConcurrentSub: number | null;
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

// Tham chiếu tenants.id viết tay: Drizzle in cột không kèm tên bảng trong select nên "id" sẽ bị hiểu là u.id.
const userCount = sql<number>`(select count(*)::int from admin.users u where u.tenant_id = admin.tenants.id)`;
const rowCols = {
  id: tenants.id,
  key: tenants.key,
  name: tenants.name,
  active: tenants.active,
  maxConcurrentSub: tenants.maxConcurrentSub,
  userCount,
  createdAt: tenants.createdAt,
  updatedAt: tenants.updatedAt,
  version: tenants.version,
};

export type TenantFilter = { q?: string; status?: EntityStatus; limit: number; offset: number };

function filterSql(f: { q?: string }): SQL | undefined {
  return f.q ? or(ilike(tenants.key, likeArg(f.q)), ilike(tenants.name, likeArg(f.q))) : undefined;
}
const statusSql = (s?: EntityStatus) => (s ? eq(tenants.active, s === "active") : undefined);

export async function listTenants(tx: Tx, f: TenantFilter) {
  const rows = await tx
    .select({ ...rowCols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(tenants)
    .where(and(filterSql(f), statusSql(f.status)))
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
    .where(filterSql(f));
  return {
    rows: rows as (TenantRow & { total: number })[],
    counts: c ?? { all: 0, active: 0, locked: 0 },
  };
}

export async function findTenant(tx: Tx, id: string, o: { forUpdate?: boolean } = {}) {
  const q = tx.select(rowCols).from(tenants).where(eq(tenants.id, id)).limit(1);
  const [row] = o.forUpdate ? await q.for("update") : await q;
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

export async function insertTenant(
  tx: Tx,
  t: { key: string; name: string; maxConcurrentSub: number | null },
): Promise<string> {
  const id = Bun.randomUUIDv7();
  await tx.insert(tenants).values({ id, ...t });
  return id;
}

/** Ghi trường đổi + tăng version/updated_at (chỉ gọi khi thực sự có thay đổi). */
export async function updateTenant(
  tx: Tx,
  id: string,
  set: { name?: string; maxConcurrentSub?: number | null; active?: boolean },
): Promise<void> {
  await tx
    .update(tenants)
    .set({ ...set, version: sql`${tenants.version} + 1`, updatedAt: sql`now()` })
    .where(eq(tenants.id, id));
}
