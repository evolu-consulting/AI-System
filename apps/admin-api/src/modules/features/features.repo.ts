// ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34 · truy vấn admin.features + feature_entitlements (scope platform, RLS).
// Đếm/gộp bằng subquery trong một câu cho cả trang (spec M2 §6, không N+1). jsonb parse bằng zod khi đọc.
import {
  CORE_FEATURE_KEY,
  FEATURE_DESC_MAX,
  FEATURE_ICON_DEFAULT,
  FEATURE_NAME_MAX,
  type FeatureStatus,
  LocalizedOptionalSchema,
  LocalizedTextSchema,
} from "@ai/contracts";
import { featureCommands, featureEntitlements, features, type Tx, tenants, users } from "@ai/db";
import { and, asc, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { likeArg, outer, usernameOf } from "../../lib/sql";

const NameSchema = LocalizedTextSchema(FEATURE_NAME_MAX);
const DescSchema = LocalizedOptionalSchema(FEATURE_DESC_MAX);

export type FeatureRow = {
  id: string;
  key: string;
  name: { vi: string; en?: string };
  description: { vi?: string; en?: string };
  icon: string;
  status: FeatureStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  commandCount: number;
  tenantCount: number;
};

const commandCount = sql<number>`(select count(*) from ${featureCommands}
  where ${featureCommands.featureId} = ${outer(features.id)})`.mapWith(Number);
const tenantCount = sql<number>`(select count(*) from ${featureEntitlements}
  where ${featureEntitlements.featureId} = ${outer(features.id)} and ${featureEntitlements.revokedAt} is null)`.mapWith(
  Number,
);

const rowCols = {
  id: features.id,
  key: features.key,
  name: features.name,
  description: features.description,
  icon: features.icon,
  status: features.status,
  version: features.version,
  createdAt: features.createdAt,
  updatedAt: features.updatedAt,
  updatedBy: usernameOf(features.updatedBy),
  commandCount,
  tenantCount,
};

type RawRow = Omit<FeatureRow, "name" | "description" | "icon"> & {
  name: unknown;
  description: unknown;
  icon: string | null;
};

/** jsonb lệch schema (sửa tay DB) → ném (500, có id), không đoán. */
function toRow(r: RawRow): FeatureRow {
  const name = NameSchema.safeParse(r.name);
  const d = DescSchema.safeParse(r.description);
  if (!name.success || !d.success) throw new Error(`features: jsonb hỏng ở hàng ${r.id}`);
  return { ...r, name: name.data, description: d.data, icon: r.icon ?? FEATURE_ICON_DEFAULT };
}

export type FeatureFilter = { q?: string; status?: FeatureStatus; limit: number; offset: number };

function baseWhere(f: FeatureFilter): SQL | undefined {
  if (!f.q) return undefined;
  const q = likeArg(f.q);
  return or(
    ilike(features.key, q),
    sql`${features.name}->>'vi' ilike ${q}`,
    sql`${features.name}->>'en' ilike ${q}`,
  );
}

export async function listFeatures(tx: Tx, f: FeatureFilter) {
  const rows = await tx
    .select({ ...rowCols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(features)
    .where(and(baseWhere(f), f.status ? eq(features.status, f.status) : undefined))
    .orderBy(desc(sql`${features.key} = ${CORE_FEATURE_KEY}`), asc(features.key))
    .limit(f.limit)
    .offset(f.offset);
  const [c] = await tx
    .select({
      all: sql<number>`count(*)`.mapWith(Number),
      on: sql<number>`count(*) filter (where ${features.status} = 'on')`.mapWith(Number),
      beta: sql<number>`count(*) filter (where ${features.status} = 'beta')`.mapWith(Number),
      off: sql<number>`count(*) filter (where ${features.status} = 'off')`.mapWith(Number),
    })
    .from(features)
    .where(baseWhere(f));
  return {
    rows: rows.map((r) => ({ ...toRow(r as RawRow), total: r.total })),
    counts: c ?? { all: 0, on: 0, beta: 0, off: 0 },
  };
}

export async function findFeature(tx: Tx, id: string): Promise<FeatureRow | null> {
  const [row] = await tx.select(rowCols).from(features).where(eq(features.id, id)).limit(1);
  return row ? toRow(row as RawRow) : null;
}

/** `lock`: `no key update` (sắp ghi) | `share` (giữ không bị xoá: entitlement). */
export async function lockFeature(
  tx: Tx,
  id: string,
  lock: "no key update" | "share",
): Promise<{ id: string; key: string } | null> {
  const [row] = await tx
    .select({ id: features.id, key: features.key })
    .from(features)
    .where(eq(features.id, id))
    .for(lock);
  return row ?? null;
}

export async function coreFeatureId(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ id: features.id })
    .from(features)
    .where(eq(features.key, CORE_FEATURE_KEY));
  if (!row) throw new Error("features: thiếu feature core (seed)");
  return row.id;
}

/** Σ user active (`active && !locked_by_tenant`) của tenant được hiệu lực; `core` = mọi tenant. */
export async function affectedUserCount(tx: Tx, f: { id: string; key: string }): Promise<number> {
  const activeUser = and(eq(users.active, true), eq(users.lockedByTenant, false));
  const entitled = sql`exists(select 1 from ${featureEntitlements}
    where ${featureEntitlements.featureId} = ${f.id} and ${featureEntitlements.tenantId} = ${outer(users.tenantId)}
      and ${featureEntitlements.revokedAt} is null)`;
  const [r] = await tx
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(users)
    .where(f.key === CORE_FEATURE_KEY ? activeUser : and(activeUser, entitled));
  return r?.n ?? 0;
}

export type FeatureSet = {
  name?: unknown;
  description?: unknown;
  icon?: string;
  status?: FeatureStatus;
};

export async function insertFeature(
  tx: Tx,
  f: Required<FeatureSet> & { id: string; key: string; actorId: string },
): Promise<void> {
  const { actorId, ...rest } = f;
  await tx.insert(features).values({ ...rest, updatedBy: actorId });
}

/** Ghi trường đổi + tăng `version` (gọi cả khi chỉ tập command đổi). */
export async function bumpFeature(
  tx: Tx,
  id: string,
  set: FeatureSet,
  actorId: string,
): Promise<void> {
  await tx
    .update(features)
    .set({
      ...set,
      version: sql`${features.version} + 1`,
      updatedBy: actorId,
      updatedAt: sql`now()`,
    })
    .where(eq(features.id, id));
}

export async function deleteFeature(tx: Tx, id: string): Promise<void> {
  await tx.delete(features).where(eq(features.id, id));
}

/** Command của feature (chi tiết, sắp `name`) + số feature hiện có của mỗi command. */
export async function featureCommandItems(tx: Tx, featureId: string) {
  const rows = await tx.execute(sql`select c.id, c.name, c.description, c.enabled,
      (select count(*)::int from admin.feature_commands fc2 where fc2.command_id = c.id) as feature_count
    from admin.feature_commands fc join admin.commands c on c.id = fc.command_id
    where fc.feature_id = ${featureId} order by c.name`);
  return rows as unknown as {
    id: string;
    name: string;
    description: unknown;
    enabled: boolean;
    feature_count: number;
  }[];
}

/** Command chỉ thuộc feature này (chặn xoá, M2-R21), sắp `name`. */
export async function exclusiveCommands(
  tx: Tx,
  featureId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await tx.execute(sql`select c.id, c.name from admin.feature_commands fc
    join admin.commands c on c.id = fc.command_id
    where fc.feature_id = ${featureId} and not exists (select 1 from admin.feature_commands fc2
      where fc2.command_id = fc.command_id and fc2.feature_id <> ${featureId})
    order by c.name`);
  return rows as unknown as { id: string; name: string }[];
}

// ---- entitlement (M2-R22) ----

export type EntitlementRow = {
  tenantId: string;
  tenantKey: string;
  tenantName: string;
  tenantActive: boolean;
  activeUserCount: number;
  grantedAt: Date;
  grantedBy: string | null;
};

const activeUserCount = sql<number>`(select count(*) from ${users}
  where ${users.tenantId} = ${outer(tenants.id)} and ${users.active} and not ${users.lockedByTenant})`.mapWith(
  Number,
);
const entCols = {
  tenantId: tenants.id,
  tenantKey: tenants.key,
  tenantName: tenants.name,
  tenantActive: tenants.active,
  activeUserCount,
  grantedAt: featureEntitlements.grantedAt,
  grantedBy: usernameOf(featureEntitlements.grantedBy),
};

export async function listEntitlements(
  tx: Tx,
  featureId: string,
  f: { q?: string; limit: number; offset: number },
) {
  const q = f.q ? likeArg(f.q) : undefined;
  const rows = await tx
    .select({ ...entCols, total: sql<number>`count(*) over()`.mapWith(Number) })
    .from(featureEntitlements)
    .innerJoin(tenants, eq(tenants.id, featureEntitlements.tenantId))
    .where(
      and(
        eq(featureEntitlements.featureId, featureId),
        isNull(featureEntitlements.revokedAt),
        q ? or(ilike(tenants.key, q), ilike(tenants.name, q)) : undefined,
      ),
    )
    .orderBy(asc(tenants.key))
    .limit(f.limit)
    .offset(f.offset);
  return rows as (EntitlementRow & { total: number })[];
}

export async function findEntitlement(
  tx: Tx,
  featureId: string,
  tenantId: string,
): Promise<EntitlementRow | null> {
  const [row] = await tx
    .select(entCols)
    .from(featureEntitlements)
    .innerJoin(tenants, eq(tenants.id, featureEntitlements.tenantId))
    .where(
      and(eq(featureEntitlements.featureId, featureId), eq(featureEntitlements.tenantId, tenantId)),
    )
    .limit(1);
  return (row as EntitlementRow | undefined) ?? null;
}

export async function tenantExists(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id));
  return !!row;
}

/** Cấp idempotent: chưa có → chèn; đã thu hồi → `revoked_at=null` + granted_* mới; đang hiệu lực → không ghi. */
export async function grantEntitlement(
  tx: Tx,
  e: { featureId: string; tenantId: string; actorId: string },
): Promise<void> {
  await tx
    .insert(featureEntitlements)
    .values({ featureId: e.featureId, tenantId: e.tenantId, grantedBy: e.actorId })
    .onConflictDoUpdate({
      target: [featureEntitlements.featureId, featureEntitlements.tenantId],
      set: { revokedAt: null, grantedBy: e.actorId, grantedAt: sql`now()` },
      setWhere: sql`${featureEntitlements.revokedAt} is not null`,
    });
}

/** Thu hồi = đặt `revoked_at` (không xoá hàng, BR-12); chưa cấp/đã thu hồi → không ghi. */
export async function revokeEntitlement(
  tx: Tx,
  e: { featureId: string; tenantId: string },
): Promise<void> {
  await tx
    .update(featureEntitlements)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(featureEntitlements.featureId, e.featureId),
        eq(featureEntitlements.tenantId, e.tenantId),
        isNull(featureEntitlements.revokedAt),
      ),
    );
}
