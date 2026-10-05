// HUB-FR-44 · HUB-FR-75 · H2c-R05, R06, R13 · SQL bảng `hub.attachments` cho upload và xem lại (plan-db §2.6, §3).
// Câu tham số hoá (`sql` drizzle); luôn lọc `tenant_id` tường minh. Scope do service mở (`withHubScope`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

/** Khoá advisory hai khoá không gian `hub.attach.tenant` (≠ `hub.runs.user`, ≠ `K_CLAIM` — P8). Giữ tới hết transaction. */
export async function lockTenantQuota(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('hub.attach.tenant'), hashtext(${tenantId}::text))`,
  );
}

/** Tổng `size` file chưa xoá nội dung của tenant (R06; index-only `attachments_tenant_live_idx`). */
export async function quotaUsed(tx: Tx, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{
    used: string | number;
  }>(sql`select coalesce(sum(size), 0)::bigint as used
    from hub.attachments where tenant_id = ${tenantId} and purged_at is null`);
  return Number(r?.used ?? 0);
}

export type NewAttachment = {
  id: string;
  tenantId: string;
  userId: string;
  origin: "upload" | "output";
  jobId: string | null;
  conversationId: string | null;
  flowId: string | null;
  filename: string;
  safeName: string;
  mime: string;
  size: number;
  sha256: string;
};

/** INSERT (chưa gắn; `storage_key = tenant/id`) → `created_at`. */
export async function insertAttachment(tx: Tx, a: NewAttachment): Promise<Date> {
  const [r] = await tx.execute<{ created_at: Date | string }>(sql`insert into hub.attachments
      (id, tenant_id, user_id, origin, job_id, conversation_id, flow_id, filename, safe_name, mime, size, sha256,
       storage_key)
    values (${a.id}, ${a.tenantId}, ${a.userId}, ${a.origin}, ${a.jobId}, ${a.conversationId}, ${a.flowId},
       ${a.filename}, ${a.safeName}, ${a.mime}, ${a.size}, ${a.sha256}, ${a.tenantId}::text || '/' || ${a.id}::text)
    returning created_at`);
  return new Date(r?.created_at ?? Date.now());
}

/** Xoá hàng vừa INSERT khi `commit` storage lỗi (R05; scope `system`). */
export async function deleteAttachment(tx: Tx, id: string, tenantId: string): Promise<void> {
  await tx.execute(
    sql`delete from hub.attachments where id = ${id} and tenant_id = ${tenantId} and message_id is null`,
  );
}
