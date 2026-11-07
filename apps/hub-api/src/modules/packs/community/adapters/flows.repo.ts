// CR-120 · cr120-community-flows · SQL của 3 khe Community (bảng community 0008). Mọi câu chạy trong tx gói (RLS người xem hoặc
// scope hệ thống của tenant); mỗi hàm MỘT câu, văn bản cố định, lô qua `= any(uuid[])`. Cập nhật trạng thái luôn có điều kiện trạng
// thái hiện tại + task id (compare-and-set) ⇒ hai người bấm cùng lúc chỉ một người thắng (người kia 409).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Moderation, ReportAction, Screen } from "../domain/flow.rules";
import type { JoinRow, ModPostRow, ReportRow } from "../domain/flow-rows.types";

export type { JoinRow, ModPostRow, ReportRow } from "../domain/flow-rows.types";

const arr = (ids: readonly string[]) => `{${ids.join(",")}}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuids = (ids: readonly string[]) => ids.filter((i) => UUID.test(i));

const MOD_COLS = sql`p.id::text as id, p.moderation, p.mod_screen, p.mod_reason, p.mod_task_id::text as mod_task_id,
  to_json(p.mod_at) #>> '{}' as mod_at, p.mod_decided_by::text as decided_by, p.mod_decided_name as decided_name, to_json(p.mod_decided_at) #>> '{}' as decided_at,
  p.mod_feedback as feedback, p.type, p.author_org::text as author_org, p.author_user_id::text as author_user_id,
  p.author_name, case when (select packs.viewer_ext_org()) is null then p.title_raw else p.title_masked end as title,
  p.title_masked, case when (select packs.viewer_ext_org()) is null then p.body_raw else p.body_masked end as body,
  p.fields_raw ->> 'product' as product, to_json(p.created_at) #>> '{}' as created_at`;

/** Mở lượt duyệt cho bài vừa tạo (cùng tx tạo bài). */
export async function openModeration(tx: Tx, postId: string): Promise<void> {
  await tx.execute(sql`update community.posts set moderation = 'pending', mod_screen = 'running',
    mod_task_id = gen_random_uuid(), mod_at = now() where id = ${postId}::uuid`);
}

/** Sửa nội dung bài ⇒ pending/running lại với task MỚI, xoá quyết định cũ (cả bài đang chờ: screen cũ + quyết định theo task cũ thành
 *  vô hiệu). Trả số hàng đổi. */
export async function reopenModeration(tx: Tx, postId: string): Promise<number> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`update community.posts set moderation = 'pending', mod_screen = 'running',
      mod_task_id = gen_random_uuid(), mod_at = now(), mod_reason = null, mod_decided_by = null, mod_decided_name = null,
      mod_decided_at = null, mod_feedback = null
    where id = ${postId}::uuid and moderation in ('approved', 'rejected', 'none', 'pending') returning id`);
  return rows.length;
}

/** Ghi kết quả screen (scope hệ thống) — chỉ khi lượt còn đang chạy VÀ vẫn đúng task đã đọc lúc bắt đầu sàng lọc
 *  (bài bị sửa giữa chừng ⇒ task đổi ⇒ kết quả của nội dung cũ bị bỏ). Trả số hàng đổi. */
export async function applyScreen(
  tx: Tx,
  postId: string,
  taskId: string,
  r: { moderation: Moderation; screen: Screen; reason: string | null },
): Promise<number> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`update community.posts set moderation = ${r.moderation},
      mod_screen = ${r.screen}, mod_reason = ${r.reason}, mod_screened_at = now()
    where id = ${postId}::uuid and mod_task_id = ${taskId}::uuid and moderation = 'pending' and mod_screen = 'running'
    returning id`);
  return rows.length;
}

export async function modRows(tx: Tx, ids: readonly string[]): Promise<ModPostRow[]> {
  const ok = uuids(ids);
  if (ok.length === 0) return [];
  return [
    ...(await tx.execute<ModPostRow>(
      sql`select ${MOD_COLS} from community.posts p where p.id = any(${arr(ok)}::uuid[])`,
    )),
  ];
}

/** Hàng đợi duyệt (chủ quản): bài đang chờ, cũ trước. */
export async function modQueue(tx: Tx, limit: number): Promise<ModPostRow[]> {
  return [
    ...(await tx.execute<ModPostRow>(sql`select ${MOD_COLS} from community.posts p
      where p.moderation = 'pending' order by p.mod_at asc nulls last, p.id limit ${limit}::int`)),
  ];
}

/** CR-121 C-7 · số hàng chờ của 3 hàng việc người duyệt — MỘT câu (3 subquery đếm theo index một phần/`(tenant_id, status, …)`), RLS tenant. */
export async function pendingCounts(
  tx: Tx,
  tenantId: string,
): Promise<{ review: number; join: number; reports: number }> {
  const [r] = await tx.execute<{ review: number; join: number; reports: number }>(sql`select
      (select count(*) from community.posts p where p.tenant_id = ${tenantId}::uuid and p.moderation = 'pending')::int as review,
      (select count(*) from community.join_requests j where j.tenant_id = ${tenantId}::uuid and j.status = 'pending')::int as join,
      (select count(*) from community.reports r where r.tenant_id = ${tenantId}::uuid and r.status = 'pending')::int as reports`);
  return {
    review: Number(r?.review ?? 0),
    join: Number(r?.join ?? 0),
    reports: Number(r?.reports ?? 0),
  };
}

/** Bài của chính người xem đang/đã qua duyệt (mới trước). */
export async function myModeration(tx: Tx, userId: string, limit: number): Promise<ModPostRow[]> {
  return [
    ...(await tx.execute<ModPostRow>(sql`select ${MOD_COLS} from community.posts p
      where p.author_user_id = ${userId}::uuid and p.moderation <> 'none'
      order by p.created_at desc, p.id desc limit ${limit}::int`)),
  ];
}

/** Quyết duyệt (compare-and-set theo task id + trạng thái chờ). Trả số hàng đổi (0 ⇒ 409). */
export async function decideModeration(
  tx: Tx,
  d: {
    id: string;
    taskId: string;
    next: Moderation;
    by: string;
    name: string;
    feedback: string | null;
  },
): Promise<number> {
  const rows = await tx.execute<{
    id: string;
  }>(sql`update community.posts set moderation = ${d.next},
      mod_decided_by = ${d.by}::uuid, mod_decided_name = ${d.name}, mod_decided_at = now(), mod_feedback = ${d.feedback}
    where id = ${d.id}::uuid and mod_task_id = ${d.taskId}::uuid and moderation = 'pending' returning id`);
  return rows.length;
}

// ---- join_requests
const JOIN_COLS = sql`j.id::text as id, j.status, j.task_id::text as task_id, to_json(j.created_at) #>> '{}' as created_at, j.company, j.contact, j.email,
  j.reason, j.labels, j.requester_user_id::text as requester_user_id, j.requester_org::text as requester_org,
  j.decided_by::text as decided_by, j.decided_name, to_json(j.decided_at) #>> '{}' as decided_at, j.feedback`;

export async function insertJoin(
  tx: Tx,
  j: {
    tenantId: string;
    userId: string;
    org: string;
    company: string;
    contact: string;
    email: string;
    reason: string;
    labels: readonly string[];
  },
): Promise<string> {
  const rows = await tx.execute<{ id: string }>(sql`insert into community.join_requests
      (tenant_id, requester_user_id, requester_org, company, contact, email, reason, labels)
    values (${j.tenantId}::uuid, ${j.userId}::uuid, ${j.org}::uuid, ${j.company}, ${j.contact}, ${j.email}, ${j.reason},
      array(select distinct jsonb_array_elements_text(${JSON.stringify(j.labels)}::jsonb)))
    returning id::text as id`);
  return rows[0]?.id as string;
}

export async function joinRows(tx: Tx, ids: readonly string[]): Promise<JoinRow[]> {
  const ok = uuids(ids);
  if (ok.length === 0) return [];
  return [
    ...(await tx.execute<JoinRow>(
      sql`select ${JOIN_COLS} from community.join_requests j where j.id = any(${arr(ok)}::uuid[])`,
    )),
  ];
}

/** Danh sách (RLS: chủ quản mọi yêu cầu; đối tác yêu cầu của công ty mình). `pending` ⇒ chỉ đang chờ. */
export async function joinList(tx: Tx, pendingOnly: boolean, limit: number): Promise<JoinRow[]> {
  return [
    ...(await tx.execute<JoinRow>(sql`select ${JOIN_COLS} from community.join_requests j
      where (not ${pendingOnly}::boolean or j.status = 'pending')
      order by j.created_at desc, j.id desc limit ${limit}::int`)),
  ];
}

export async function decideJoin(
  tx: Tx,
  d: {
    id: string;
    taskId: string;
    next: "approved" | "rejected";
    by: string;
    name: string;
    feedback: string | null;
  },
): Promise<JoinRow | null> {
  const rows =
    await tx.execute<JoinRow>(sql`update community.join_requests j set status = ${d.next},
      decided_by = ${d.by}::uuid, decided_name = ${d.name}, decided_at = now(), feedback = ${d.feedback}
    where j.id = ${d.id}::uuid and j.task_id = ${d.taskId}::uuid and j.status = 'pending' returning ${JOIN_COLS}`);
  return rows[0] ?? null;
}

// ---- reports
const REPORT_COLS = sql`r.id::text as id, r.post_id::text as post_id,
  coalesce((select case when (select packs.viewer_ext_org()) is null then p.title_raw else p.title_masked end from community.posts p where p.id = r.post_id), '') as post_title, r.reporter_user_id::text as reporter_user_id,
  r.reason, r.status, r.triage, r.triage_kind, r.triage_level, r.action, r.task_id::text as task_id, to_json(r.created_at) #>> '{}' as created_at,
  r.decided_by::text as decided_by, r.decided_name, to_json(r.decided_at) #>> '{}' as decided_at, r.feedback`;

/** Tạo báo cáo; trùng (người × bài) ⇒ null (route 409). Bài không thấy ⇒ RLS chặn ⇒ ném (route 404 trước đó). */
export async function insertReport(
  tx: Tx,
  r: { tenantId: string; postId: string; userId: string; org: string | null; reason: string },
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`insert into community.reports
      (tenant_id, post_id, reporter_user_id, reporter_org, reason)
    values (${r.tenantId}::uuid, ${r.postId}::uuid, ${r.userId}::uuid, ${r.org}::uuid, ${r.reason})
    on conflict (tenant_id, reporter_user_id, post_id) do nothing returning id::text as id`);
  return rows[0]?.id ?? null;
}

export async function applyTriage(
  tx: Tx,
  id: string,
  t: { kind: string; level: string } | null,
): Promise<number> {
  const rows = await tx.execute<{ id: string }>(sql`update community.reports set
      triage = ${t ? "done" : "error"}, triage_kind = ${t?.kind ?? null}, triage_level = ${t?.level ?? null}
    where id = ${id}::uuid and triage = 'running' returning id`);
  return rows.length;
}

export async function reportRows(tx: Tx, ids: readonly string[]): Promise<ReportRow[]> {
  const ok = uuids(ids);
  if (ok.length === 0) return [];
  return [
    ...(await tx.execute<ReportRow>(
      sql`select ${REPORT_COLS} from community.reports r where r.id = any(${arr(ok)}::uuid[])`,
    )),
  ];
}

export async function reportList(
  tx: Tx,
  pendingOnly: boolean,
  limit: number,
): Promise<ReportRow[]> {
  return [
    ...(await tx.execute<ReportRow>(sql`select ${REPORT_COLS} from community.reports r
      where (not ${pendingOnly}::boolean or r.status = 'pending')
      order by r.created_at desc, r.id desc limit ${limit}::int`)),
  ];
}

/** Quyết báo cáo + (hide) ẩn bài trong CÙNG câu (CTE). Trả hàng đã đổi hoặc null (409). */
export async function decideReport(
  tx: Tx,
  d: {
    id: string;
    taskId: string;
    action: ReportAction;
    by: string;
    name: string;
    feedback: string | null;
  },
): Promise<ReportRow | null> {
  const rows = await tx.execute<ReportRow>(sql`with r as (
      update community.reports r set status = 'resolved', action = ${d.action}, decided_by = ${d.by}::uuid,
        decided_name = ${d.name}, decided_at = now(), feedback = ${d.feedback}
      where r.id = ${d.id}::uuid and r.task_id = ${d.taskId}::uuid and r.status = 'pending' returning r.*
    ), h as (
      update community.posts p set hidden = true from r
      where ${d.action} = 'hide' and p.id = r.post_id and p.tenant_id = r.tenant_id returning p.id
    ) select ${REPORT_COLS}, (select count(*) from h) as hidden_n from r`);
  return rows[0] ?? null;
}
