// ADM-FR-41 · M4-R04, R05 · truy vấn `admin.quota_alerts` + người nhận (plan M4 §3.2, §5.2). Luôn trong
// withScope(tenant) → RLS, và lọc `tenant_id` tường minh. Khoá hạng 13a (plan §6): chỉ INSERT on conflict / UPDATE
// claim hàng của tenant, tx evaluator không giữ khoá nào khác.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { AlertKey } from "./quotas.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

/** Lời claim quá hạn (tiến trình chết giữa chừng) được nhận lại sau khoảng này. */
export const CLAIM_STALE = "5 minutes";
/** Số lần gửi lỗi tối đa trước khi `failed`. */
export const MAX_ATTEMPTS = 5;
const PCT_MAX = 32767; // smallint
const ERR_MAX = 200;

export type NewAlert = AlertKey & { pct: number; status: "pending" | "skipped" };
export type ClaimedAlert = { id: string; level: 80 | 100; pct: number; attempts: number };
export type Recipient = { email: string; locale: "vi" | "en" };

/** Tháng "YYYY-MM" → cột `date` ngày 1. */
const monthDate = (month: string) => `${month}-01`;

/** Khoá cảnh báo đã có của tháng (mọi trạng thái). */
export async function existingAlerts(tx: Tx, tenantId: string, month: string): Promise<AlertKey[]> {
  const rows = await run<{ feature_id: string | null; level: number }>(
    tx,
    sql`select feature_id, level from admin.quota_alerts
    where tenant_id = ${tenantId} and month = ${monthDate(month)}::date`,
  );
  return rows.map((r) => ({ featureId: r.feature_id, level: r.level === 100 ? 100 : 80 }));
}

/** Giữ chỗ trước khi gửi: unique (tenant, feature, level, month) → ON CONFLICT DO NOTHING (chạy song song an toàn). */
export async function insertAlerts(
  tx: Tx,
  tenantId: string,
  month: string,
  due: readonly NewAlert[],
): Promise<void> {
  for (const a of due) {
    await tx.execute(sql`insert into admin.quota_alerts (tenant_id, feature_id, level, month, pct, status)
      values (${tenantId}, ${a.featureId}, ${a.level}, ${monthDate(month)}::date,
        ${Math.min(a.pct, PCT_MAX)}, ${a.status})
      on conflict do nothing`);
  }
}

/** Nhận việc gửi: `pending` hoặc `sending` quá hạn → `sending`. Cảnh báo mới nhất cuối cùng (80 trước 100). */
export async function claimAlerts(tx: Tx, tenantId: string): Promise<ClaimedAlert[]> {
  const rows = await run<{ id: string; level: number; pct: number; attempts: number }>(
    tx,
    sql`update admin.quota_alerts set status = 'sending', claimed_at = now()
    where tenant_id = ${tenantId} and (status = 'pending'
      or (status = 'sending' and claimed_at < now() - ${CLAIM_STALE}::interval))
    returning id, level, pct, attempts`,
  );
  return rows
    .map((r) => ({
      id: r.id,
      level: r.level === 100 ? (100 as const) : (80 as const),
      pct: r.pct,
      attempts: r.attempts,
    }))
    .sort((a, b) => a.level - b.level);
}

/** tenant_admin đang hoạt động có email (M4-R05); index `users_tenant_role_active_idx`. */
export async function recipients(tx: Tx, tenantId: string): Promise<Recipient[]> {
  return run<Recipient>(
    tx,
    sql`select email, locale from admin.users
    where tenant_id = ${tenantId} and role = 'tenant_admin' and active and email is not null
    order by email`,
  );
}

export async function tenantName(tx: Tx, tenantId: string): Promise<string | null> {
  const rows = await run<{ name: string }>(
    tx,
    sql`select name from admin.tenants where id = ${tenantId}`,
  );
  return rows[0]?.name ?? null;
}

/** Không có người nhận → `skipped` (không gửi được, không thử lại). */
export async function markSkipped(tx: Tx, tenantId: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await tx.execute(sql`update admin.quota_alerts set status = 'skipped', claimed_at = null
      where tenant_id = ${tenantId} and id = ${id}`);
  }
}

/** Kết quả gửi: null = thành công → `sent`; mã lỗi → `pending` (attempts+1) hoặc `failed` khi đủ MAX_ATTEMPTS. */
export async function markResult(
  tx: Tx,
  tenantId: string,
  id: string,
  error: string | null,
): Promise<void> {
  if (error === null) {
    await tx.execute(sql`update admin.quota_alerts
      set status = 'sent', sent_at = now(), claimed_at = null, last_error = null
      where tenant_id = ${tenantId} and id = ${id}`);
    return;
  }
  await tx.execute(sql`update admin.quota_alerts
    set attempts = attempts + 1, last_error = ${error.slice(0, ERR_MAX)}, claimed_at = null,
      status = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end
    where tenant_id = ${tenantId} and id = ${id}`);
}
