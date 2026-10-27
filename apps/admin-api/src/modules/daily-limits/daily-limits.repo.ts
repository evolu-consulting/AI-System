// tenant-quotas · adapter Drizzle cho `admin.tenant_daily_limits` (RLS admin_rw, scope platform) + tổng token AI hôm nay từ
// `hub.usage_logs` (cùng công thức `hub.ai_tokens_since`). Số câu cố định: đọc 1 (+1 token), ghi 1.
import { type Db, type Tx, tenantDailyLimits as tdl, tenants } from "@ai/db";
import { eq, sql } from "drizzle-orm";

export type DailyLimitsRow = {
  uploads: number | null;
  actions: number | null;
  aiTokens: number | null;
  aiTokensResetAt: Date | null;
};
export type TenantLimits = { timezone: string; row: DailyLimitsRow };

const EMPTY: DailyLimitsRow = {
  uploads: null,
  actions: null,
  aiTokens: null,
  aiTokensResetAt: null,
};

/** Tenant + hàng hạn mức (LEFT JOIN, một câu); tenant không tồn tại ⇒ null. `lock` ⇒ +1 câu khoá hàng tenant (ghi tuần tự). */
export async function readLimits(
  tx: Tx,
  tenantId: string,
  lock = false,
): Promise<TenantLimits | null> {
  if (lock)
    await tx.execute(sql`select 1 from admin.tenants where id = ${tenantId}::uuid for update`);
  const [r] = await tx
    .select({
      timezone: tenants.timezone,
      uploads: tdl.uploadsDay,
      actions: tdl.actionsDay,
      aiTokens: tdl.aiTokensDay,
      aiTokensResetAt: tdl.aiTokensResetAt,
      has: sql<boolean>`${tdl.tenantId} is not null`,
    })
    .from(tenants)
    .leftJoin(tdl, eq(tdl.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId));
  if (!r) return null;
  const { timezone, has, ...row } = r;
  return { timezone, row: has ? row : EMPTY };
}

/** Ghi cả bộ hạn mức (giữ `ai_tokens_reset_at`). */
export async function saveLimits(
  tx: Tx,
  tenantId: string,
  v: Omit<DailyLimitsRow, "aiTokensResetAt">,
  actorId: string,
): Promise<void> {
  const set = {
    uploadsDay: v.uploads,
    actionsDay: v.actions,
    aiTokensDay: v.aiTokens,
    updatedAt: sql`now()`,
    updatedBy: actorId,
  };
  await tx
    .insert(tdl)
    .values({ tenantId, ...set })
    .onConflictDoUpdate({ target: tdl.tenantId, set });
}

/** "Đặt lại hôm nay" token AI: mốc đếm mới = `at`. */
export async function saveAiReset(
  tx: Tx,
  tenantId: string,
  at: Date,
  actorId: string,
): Promise<void> {
  const set = { aiTokensResetAt: at, updatedAt: sql`now()`, updatedBy: actorId };
  await tx
    .insert(tdl)
    .values({ tenantId, ...set })
    .onConflictDoUpdate({ target: tdl.tenantId, set });
}

/** Token AI (input + output, chỉ dòng có `feature`) của tenant từ `since` — index `usage_logs_tenant_feature_key_at_idx`. */
export async function aiTokensUsed(db: Db, tenantId: string, since: Date): Promise<number> {
  const rows =
    (await db.db.execute(sql`select coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0)::bigint as n
    from hub.usage_logs where tenant_id = ${tenantId}::uuid and at >= ${since.toISOString()}::timestamptz
      and feature is not null`)) as unknown as { n: string | number }[];
  return Number(rows[0]?.n ?? 0);
}
