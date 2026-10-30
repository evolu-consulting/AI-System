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
  /** FB1 (HUB-FR-138): tham chiếu FileBox (null ⇒ kho local). */
  fileboxFileId?: string | null;
  fileboxVersionId?: string | null;
};

/** INSERT (chưa gắn; `storage_key = tenant/id`; FB1 cột `filebox_*` khi kho FileBox) → `created_at`. */
export async function insertAttachment(tx: Tx, a: NewAttachment): Promise<Date> {
  const [r] = await tx.execute<{ created_at: Date | string }>(sql`insert into hub.attachments
      (id, tenant_id, user_id, origin, job_id, conversation_id, flow_id, filename, safe_name, mime, size, sha256,
       storage_key, filebox_file_id, filebox_version_id)
    values (${a.id}, ${a.tenantId}, ${a.userId}, ${a.origin}, ${a.jobId}, ${a.conversationId}, ${a.flowId},
       ${a.filename}, ${a.safeName}, ${a.mime}, ${a.size}, ${a.sha256}, ${a.tenantId}::text || '/' || ${a.id}::text,
       ${a.fileboxFileId ?? null}, ${a.fileboxVersionId ?? null})
    returning created_at`);
  return new Date(r?.created_at ?? Date.now());
}

/** Xoá hàng vừa INSERT khi `commit` storage lỗi (R05; scope `system`). */
export async function deleteAttachment(tx: Tx, id: string, tenantId: string): Promise<void> {
  await tx.execute(
    sql`delete from hub.attachments where id = ${id} and tenant_id = ${tenantId} and message_id is null and room_id is null`,
  );
}

export type ReadableAttachment = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  purgedAt: Date | null;
  storageKey: string;
  /** FB1 (HUB-FR-139): dựng locator đọc (null ⇒ kho local). */
  fileboxFileId: string | null;
  fileboxVersionId: string | null;
};

/**
 * X2b2-R05/R06 (plan X2b2 §6.4; gương `canReadAttachment`) · file đọc được của người xem; không có → null. Scope `user`:
 * chưa gắn phòng ⇒ chủ + hội thoại (nếu có) chưa xoá (H2c P22); gắn phòng ⇒ thành viên hiện tại (`hub.is_room_member`,
 * phòng xoá ⇒ mọi `left_at` đặt ⇒ false) ∧ (chủ file ∨ tin không bị giữ — R11 RV1 #1, `hub.room_msg_withheld`, gương
 * `roomOutputsVisible`). RLS 0023/0026 lọc thêm lớp 2.
 */
export async function findReadableAttachment(
  tx: Tx,
  o: { tenantId: string; userId: string; id: string },
): Promise<ReadableAttachment | null> {
  const [r] =
    await tx.execute<ReadableRow>(sql`select a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at,
      a.storage_key, a.filebox_file_id, a.filebox_version_id
    from hub.attachments a left join hub.conversations c on c.id = a.conversation_id
    where a.id = ${o.id} and a.tenant_id = ${o.tenantId}
      and ((a.room_id is null and a.user_id = ${o.userId} and c.deleted_at is null)
        or (a.room_id is not null and hub.is_room_member(a.room_id)
          and (a.user_id = ${o.userId} or a.room_message_id is null or not hub.room_msg_withheld(a.room_message_id))))`);
  return r ? toReadable(r) : null;
}

type ReadableRow = {
  id: string;
  filename: string;
  mime: string;
  size: string | number;
  created_at: Date | string;
  purged_at: Date | string | null;
  storage_key: string;
  filebox_file_id: string | null;
  filebox_version_id: string | null;
};

const toReadable = (r: ReadableRow): ReadableAttachment => ({
  id: r.id,
  filename: r.filename,
  mime: r.mime,
  size: Number(r.size),
  createdAt: new Date(r.created_at),
  purgedAt: r.purged_at === null ? null : new Date(r.purged_at),
  storageKey: r.storage_key,
  fileboxFileId: r.filebox_file_id,
  fileboxVersionId: r.filebox_version_id,
});

/**
 * PC-R14 · plan §6.6 (B5b) · file diff/log của một `hub.autofix_results` trong tenant `tenantId` + run sở hữu. Scope
 * `system` (RLS attachments scope user chỉ thấy file của chủ) ⇒ lọc `tenant_id` tường minh cả hai bảng; CHỈ gọi rồi kiểm
 * quyền xem run trước khi trả file. Index một phần `autofix_results_{diff,log}_att_idx` (BitmapOr). `purged_at` giữ nguyên.
 */
export async function findAutofixAttachment(
  tx: Tx,
  o: { tenantId: string; id: string },
): Promise<{ runId: string; file: ReadableAttachment } | null> {
  // P-c2 · plan §6.6 · mở rộng PC-R14: file diff/log của `autofix_results` HOẶC log test của stage Áp
  // (`autofix_applies.test_log_attachment_id`) — cùng run + tenant; UNION để BitmapOr hai index một phần.
  const [r] = await tx.execute<
    ReadableRow & { run_id: string }
  >(sql`select run_id, id, filename, mime, size, created_at, purged_at, storage_key,
      filebox_file_id, filebox_version_id from (
      select ar.process_run_id as run_id, a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at, a.storage_key,
        a.filebox_file_id, a.filebox_version_id
      from hub.autofix_results ar join hub.attachments a on a.id = ${o.id} and a.tenant_id = ar.tenant_id
      where ar.tenant_id = ${o.tenantId}
        and (ar.diff_attachment_id = ${o.id} or ar.test_log_attachment_id = ${o.id})
      union all
      select aa.process_run_id as run_id, a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at, a.storage_key,
        a.filebox_file_id, a.filebox_version_id
      from hub.autofix_applies aa join hub.attachments a on a.id = ${o.id} and a.tenant_id = aa.tenant_id
      where aa.tenant_id = ${o.tenantId} and aa.test_log_attachment_id = ${o.id}
    ) hit limit 1`);
  return r ? { runId: r.run_id, file: toReadable(r) } : null;
}

/** HUB-BR-25 · U5 · quyền xem run của người xem (definer `hub.process_run_viewer`, cùng nguồn với view — scope `user`). */
export async function processRunViewer(tx: Tx, runId: string): Promise<"full" | "task" | null> {
  const [r] = await tx.execute<{ access: "full" | "task" | null }>(
    sql`select hub.process_run_viewer(${runId}::uuid) as access`,
  );
  return r?.access ?? null;
}

/**
 * RV-8 · file còn dùng được trước khi gửi Dify: hàng của tenant, `purged_at IS NULL`, hội thoại (nếu có) chưa xoá. Scope
 * `system` (lệnh/MCP chạy nền theo run). Trả locator FileBox của hàng (payload job không mang — MCP `tools/call`); vắng ⇒ null.
 */
export async function availableFile(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ fileboxFileId: string | null; fileboxVersionId: string | null } | null> {
  const rows = await tx.execute<{
    filebox_file_id: string | null;
    filebox_version_id: string | null;
  }>(
    sql`select a.filebox_file_id, a.filebox_version_id
    from hub.attachments a left join hub.conversations c on c.id = a.conversation_id
    where a.id = ${id} and a.tenant_id = ${tenantId} and a.purged_at is null and c.deleted_at is null`,
  );
  const r = rows[0];
  return r ? { fileboxFileId: r.filebox_file_id, fileboxVersionId: r.filebox_version_id } : null;
}

/** Mảng uuid → literal `{…}` (tham số `::uuid[]`; drizzle `sql` nở mảng JS thành danh sách — B10-2). Id đã qua zod uuid. */
export const uuidArray = (ids: readonly string[]): string => `{${ids.join(",")}}`;

type SendRow = {
  id: string;
  safe_name: string;
  mime: string;
  size: string | number;
  sha256: string;
  filebox_file_id: string | null;
  filebox_version_id: string | null;
};

/** E12 R09 (plan-db §2.1, PL7) · file gửi được của chủ trong `ids`; scope `user`, ngoài transaction tạo run. */
export async function sendableFiles(
  tx: Tx,
  o: { tenantId: string; userId: string },
  ids: readonly string[],
): Promise<SendRow[]> {
  return tx.execute<SendRow>(sql`select id, safe_name, mime, size, sha256,
      filebox_file_id, filebox_version_id from hub.attachments
    where id = any(${uuidArray(ids)}::uuid[]) and tenant_id = ${o.tenantId} and user_id = ${o.userId}
      and message_id is null and room_id is null and purged_at is null and created_at > now() - interval '24 hours'`);
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
      and a.message_id is null and a.room_id is null and a.purged_at is null
      and a.created_at > now() - interval '24 hours'
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
  filebox_file_id: string | null;
  filebox_version_id: string | null;
};

/** R14 (plan-db §2.3) · ứng viên tập file của run (≤ 11 hàng, `available`); `command` → chỉ tin hiện tại. */
export async function runFileRows(
  tx: Tx,
  p: { flowId: string; currentMessageId: string; command: boolean },
): Promise<RunFileRow[]> {
  return tx.execute<RunFileRow>(sql`select a.id, a.message_id, m.created_at as message_created_at, a.position,
      a.safe_name, a.mime, a.size, a.sha256, a.filebox_file_id, a.filebox_version_id
    from hub.messages m join hub.attachments a on a.message_id = m.id
    where m.flow_id = ${p.flowId} and a.purged_at is null
      and (${!p.command}::boolean or m.id = ${p.currentMessageId})
    order by (m.id = ${p.currentMessageId}) desc, m.created_at desc, m.id desc, a.position
    limit 11`);
}

/**
 * P21 · PL10 (plan-db §2.5) · số **tên** output còn sống của lần claim hiện hành (`created_at >= jobs.started_at`), không
 * tính tên `except` (gửi lại cùng tên = thay, không chiếm suất — RV-2, khớp `bindOutputs` DISTINCT ON). Scope `system`.
 */
export async function countJobOutputs(tx: Tx, jobId: string, except: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(distinct a.safe_name)::int as n
    from hub.attachments a join hub.jobs j on j.id = a.job_id
    where a.job_id = ${jobId} and a.origin = 'output' and a.created_at >= j.started_at
      and a.purged_at is null and a.safe_name <> ${except}`);
  return Number(r?.n ?? 0);
}

/**
 * RV-2 · output cùng `safe_name` của lần claim hiện hành, chưa gắn ⇒ `purged_at = now()` (thay bằng bản mới; sweeper R27
 * xoá hàng + nội dung lượt sau, hạn mức tenant nhả ngay). Gọi sau khoá tenant, **trước** khoá `jobs` (P8: attachments → jobs).
 */
export async function supersedeJobOutput(tx: Tx, jobId: string, safeName: string): Promise<void> {
  await tx.execute(sql`update hub.attachments a set purged_at = now()
    from hub.jobs j
    where j.id = a.job_id and a.job_id = ${jobId} and a.origin = 'output' and a.safe_name = ${safeName}
      and a.message_id is null and a.room_id is null and a.purged_at is null and a.created_at >= j.started_at`);
}

/**
 * RV-1 · lần claim đã xác thực còn giữ: job `running` với đúng `token_hash` — `FOR SHARE` tới hết transaction INSERT
 * (requeue/kết thúc job chờ commit) ⇒ output không gắn nhầm sang lần claim mới.
 */
export async function claimHeld(tx: Tx, jobId: string, tokenHash: Buffer): Promise<boolean> {
  const rows = await tx.execute<{ ok: number }>(sql`select 1 as ok from hub.jobs
    where id = ${jobId} and token_hash = ${tokenHash} and status = 'running' for share`);
  return rows.length > 0;
}

/**
 * R26 · PL6 · PL10 (plan-db §2.4, nguyên văn) · trong `SseWriter.finish` (scope `system`, run `finished`, sau INSERT tin
 * assistant — P8): mỗi (job, `safe_name`) của lần claim hiện hành lấy bản mới nhất, ≤ 10 theo (thứ tự job, tên) → gắn
 * vào tin trả lời. Trả số hàng gắn.
 */
export async function bindOutputs(
  tx: Tx,
  p: { runId: string; messageId: string; conversationId: string; flowId: string },
): Promise<number> {
  const rows = await tx.execute<{ id: string }>(sql`with latest as (
      select distinct on (a.job_id, a.safe_name) a.id, a.job_id, a.safe_name, j.created_at as job_created_at
      from hub.jobs j join hub.attachments a on a.job_id = j.id
      where j.run_id = ${p.runId} and a.origin = 'output' and a.message_id is null and a.room_id is null
        and a.purged_at is null and a.created_at >= j.started_at
      order by a.job_id, a.safe_name, a.created_at desc
    ), picked as (
      select id, (row_number() over (order by job_created_at, job_id, safe_name) - 1)::smallint as pos
      from latest order by job_created_at, job_id, safe_name limit 10
    )
    update hub.attachments a
    set message_id = ${p.messageId}, conversation_id = ${p.conversationId}, flow_id = ${p.flowId}, bound_at = now(),
      position = p.pos
    from picked p where a.id = p.id
    returning a.id`);
  return rows.length;
}
