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

export type OwnedAttachment = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  purgedAt: Date | null;
  storageKey: string;
};

/** File của chủ, hội thoại (nếu có) chưa xoá (plan-db §2.6, P22); không có → null. Scope `user`. */
export async function findOwnedAttachment(
  tx: Tx,
  o: { tenantId: string; userId: string; id: string },
): Promise<OwnedAttachment | null> {
  const [r] = await tx.execute<{
    id: string;
    filename: string;
    mime: string;
    size: string | number;
    created_at: Date | string;
    purged_at: Date | string | null;
    storage_key: string;
  }>(sql`select a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at, a.storage_key
    from hub.attachments a left join hub.conversations c on c.id = a.conversation_id
    where a.id = ${o.id} and a.tenant_id = ${o.tenantId} and a.user_id = ${o.userId} and c.deleted_at is null`);
  if (!r) return null;
  return {
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    size: Number(r.size),
    createdAt: new Date(r.created_at),
    purgedAt: r.purged_at === null ? null : new Date(r.purged_at),
    storageKey: r.storage_key,
  };
}

/** Mảng uuid → literal `{…}` (tham số `::uuid[]`; drizzle `sql` nở mảng JS thành danh sách — B10-2). Id đã qua zod uuid. */
export const uuidArray = (ids: readonly string[]): string => `{${ids.join(",")}}`;

type SendRow = {
  id: string;
  safe_name: string;
  mime: string;
  size: string | number;
  sha256: string;
};

/** E12 R09 (plan-db §2.1, PL7) · file gửi được của chủ trong `ids`; scope `user`, ngoài transaction tạo run. */
export async function sendableFiles(
  tx: Tx,
  o: { tenantId: string; userId: string },
  ids: readonly string[],
): Promise<SendRow[]> {
  return tx.execute<SendRow>(sql`select id, safe_name, mime, size, sha256 from hub.attachments
    where id = any(${uuidArray(ids)}::uuid[]) and tenant_id = ${o.tenantId} and user_id = ${o.userId}
      and message_id is null and purged_at is null and created_at > now() - interval '24 hours'`);
}

/** R11 (plan-db §2.2) · gắn vào tin user trong `createRunTx` (sau INSERT messages — P8); trả id gắn được. */
export async function bindAttachments(
  tx: Tx,
  o: { tenantId: string; userId: string },
  p: { ids: readonly string[]; messageId: string; conversationId: string; flowId: string },
): Promise<string[]> {
  const ids = uuidArray(p.ids);
  const rows = await tx.execute<{ id: string }>(sql`update hub.attachments a
    set message_id = ${p.messageId}, conversation_id = ${p.conversationId}, flow_id = ${p.flowId}, bound_at = now(),
      position = array_position(${ids}::uuid[], a.id) - 1
    where a.id = any(${ids}::uuid[]) and a.tenant_id = ${o.tenantId} and a.user_id = ${o.userId}
      and a.message_id is null and a.purged_at is null and a.created_at > now() - interval '24 hours'
    returning a.id`);
  return rows.map((r) => r.id);
}

export type RunFileRow = {
  id: string;
  message_id: string;
  message_created_at: Date | string;
  position: number;
  safe_name: string;
  mime: string;
  size: string | number;
  sha256: string;
};

/** R14 (plan-db §2.3) · ứng viên tập file của run (≤ 11 hàng, `available`); `command` → chỉ tin hiện tại. */
export async function runFileRows(
  tx: Tx,
  p: { flowId: string; currentMessageId: string; command: boolean },
): Promise<RunFileRow[]> {
  return tx.execute<RunFileRow>(sql`select a.id, a.message_id, m.created_at as message_created_at, a.position,
      a.safe_name, a.mime, a.size, a.sha256
    from hub.messages m join hub.attachments a on a.message_id = m.id
    where m.flow_id = ${p.flowId} and a.purged_at is null
      and (${!p.command}::boolean or m.id = ${p.currentMessageId})
    order by (m.id = ${p.currentMessageId}) desc, m.created_at desc, m.id desc, a.position
    limit 11`);
}
