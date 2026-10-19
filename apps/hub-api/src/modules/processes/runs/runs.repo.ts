// HUB-FR-105 · HUB-FR-113 · PF1 · SQL bắt đầu + liệt kê run (plan §2.1, §4, §10; plan-contract §3). Chạy trong
// `withHubScope({kind:"user"})` của người bắt đầu/người xem; mọi câu lọc `tenant_id` tường minh, RLS T là lưới.
// Khoá bắt đầu (§10): rooms (tin gọi) → advisory `process:<tenant>` → process_runs. Không log nội dung.
import type { OpenTask, ProcessRunStatus, ProcessRunSummary } from "@ai/contracts/chat";
import { type ProcessInputDef, stepGroups } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { appError } from "../../../lib/errors";
import { levenshtein } from "../../commands/suggest.rules";
import { CAP_COUNTED } from "../domain/runs/active-cap.rules";

type Json = Record<string, unknown>;
const iso = (c: SQL) => sql`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Định nghĩa trong tenant để bắt đầu (kể cả tắt ⇒ `canRun` quyết; đã xoá mềm/mẫu `tenant_id IS NULL` không thấy). */
export type StartDefRow = {
  id: string;
  key: string;
  name: string;
  version: number;
  enabled: boolean;
  deleted: boolean;
  run_group_ids: string[];
  stages: unknown[];
  token_budget: number | null;
  sources: string[];
  inputs: ProcessInputDef[];
  ttl_days: number | null;
};

const DEF_COLS = sql`d.id, d.key, d.name, d.version, d.enabled, (d.deleted_at is not null) as deleted,
  d.run_group_ids, d.stages, d.token_budget, coalesce(d.sources, '[]'::jsonb) as sources,
  coalesce(d.inputs, '[]'::jsonb) as inputs, d.ttl_days`;

export async function findDefByKey(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<StartDefRow | null> {
  const [r] = await tx.execute<StartDefRow>(sql`select ${DEF_COLS} from hub.process_defs d
    where d.tenant_id = ${tenantId} and d.key = ${key} and d.deleted_at is null order by d.created_at desc, d.id desc limit 1`);
  return r ?? null;
}

/** Theo id trong tenant (nút "Chạy" admin — def đã kiểm ở `DefsService.run`). */
export async function findDefById(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<StartDefRow | null> {
  const [r] = await tx.execute<StartDefRow>(sql`select ${DEF_COLS}
    from hub.process_defs d where d.tenant_id = ${tenantId} and d.id = ${id} limit 1`);
  return r ?? null;
}

/** Catalog người xem có thể bắt đầu (bật, chưa xoá, trong run group) — lọc group ở service (≤ 200). */
export type CatalogRow = {
  key: string;
  name: string;
  description: string;
  input_hint: string;
  stage_count: number;
  run_group_ids: string[];
  inputs: ProcessInputDef[];
};

export async function catalogDefs(tx: Tx, tenantId: string): Promise<CatalogRow[]> {
  return tx.execute<CatalogRow>(sql`select d.key, d.name, d.description, d.input_hint,
      jsonb_array_length(d.stages)::int as stage_count, d.run_group_ids,
      coalesce(d.inputs, '[]'::jsonb) as inputs, d.ttl_days
    from hub.process_defs d
    where d.tenant_id = ${tenantId} and d.enabled = true and d.deleted_at is null
    order by d.name asc, d.key asc limit 200`);
}

/** §4 · PD-R16 · đếm run tính trần (`CAP_COUNTED`, không gồm `waiting_timer`; `process_runs_active_idx`) — dưới advisory lock. */
export async function countActive(tx: Tx, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.process_runs
    where tenant_id = ${tenantId} and status in ${activeList()}`);
  return r?.n ?? 0;
}

/** N2-FR-04 · MỘT câu: số run tính trần + trần của tenant (`admin.tenants.process_runs_max`, hub_ro đọc; vắng ⇒ null). */
export async function activeAndCap(
  tx: Tx,
  tenantId: string,
): Promise<{ n: number; max: number | null }> {
  const [r] = await tx.execute<{ n: number; max: number | null }>(sql`select
      (select count(*)::int from hub.process_runs where tenant_id = ${tenantId} and status in ${activeList()}) as n,
      (select process_runs_max from admin.tenants where id = ${tenantId}) as max`);
  return { n: Number(r?.n ?? 0), max: r?.max == null ? null : Number(r.max) };
}

const activeList = () =>
  sql`(${sql.join(
    CAP_COUNTED.map((s) => sql`${s}`),
    sql`, `,
  )})`;

/** §10 · khoá tuần tự hoá start theo tenant (xact-local). */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('process:' || ${tenantId}::text))`);
}

export async function setTrigger(tx: Tx, runId: string, messageId: string): Promise<void> {
  await tx.execute(
    sql`update hub.process_runs set trigger_message_id = ${messageId} where id = ${runId}`,
  );
}

/** Tin gọi `!key` (user, `main`, `flow_id` = thread, `process_run_id` = thẻ gốc). Trả dữ liệu dựng `RoomMessage`. */
export type CallMessageRow = {
  id: string;
  room_id: string;
  seq: number;
  content: string;
  client_msg_id: string;
  created_at: string;
  display_name: string | null;
  username: string | null;
  flow_id: string;
  process_run_id: string;
};

export async function insertCallMessage(
  tx: Tx,
  p: {
    tenantId: string;
    userId: string;
    roomId: string;
    seq: number;
    at: Date;
    content: string;
    clientMsgId: string;
    flowId: string;
    runId: string;
  },
): Promise<CallMessageRow> {
  const [r] = await tx.execute<CallMessageRow>(sql`
    with m as (
      insert into hub.room_messages (id, room_id, tenant_id, seq, sender_type, sender_id, content, client_msg_id,
        created_at, flow_id, placement, process_run_id)
      values (${crypto.randomUUID()}, ${p.roomId}, ${p.tenantId}, ${p.seq}, 'user', ${p.userId}, ${p.content},
        ${p.clientMsgId}, ${p.at.toISOString()}::timestamptz, ${p.flowId}, 'main', ${p.runId})
      returning *)
    select m.id, m.room_id, m.seq, m.content, m.client_msg_id, ${iso(sql`m.created_at`)} as created_at,
      u.display_name, u.username, m.flow_id, m.process_run_id
    from m left join admin.users u on u.id = m.sender_id and u.tenant_id = m.tenant_id`);
  if (!r) throw new Error("insert call message returned no row");
  return r;
}

export async function isRoomMember(
  tx: Tx,
  tenantId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.room_members
    where room_id = ${roomId} and tenant_id = ${tenantId} and user_id = ${userId} and left_at is null limit 1`);
  return r !== undefined;
}

export async function ownsConversation(
  tx: Tx,
  tenantId: string,
  convId: string,
  userId: string,
): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.conversations
    where id = ${convId} and tenant_id = ${tenantId} and user_id = ${userId} and deleted_at is null
      and process_run_id is null limit 1`);
  return r !== undefined;
}

// ── liệt kê (GET /process-runs) ──
export type RunSummaryRow = {
  id: string;
  snapshot: Json;
  def_version: number;
  status: ProcessRunStatus;
  current_stage_idx: number;
  current_step: number;
  origin_kind: "room" | "conversation" | "admin";
  origin_room_id: string | null;
  origin_conversation_id: string | null;
  started_by: string;
  started_by_name: string | null;
  decision: Json | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type ListFilter = {
  tenantId: string;
  startedBy?: string;
  roomId?: string;
  conversationId?: string;
  processKey?: string;
  status?: ProcessRunStatus;
  limit: number;
  after?: [string, string];
};

const RUN_COLS = sql`r.id, r.snapshot, r.def_version, r.status, r.current_stage_idx, r.current_step, r.origin_kind, r.origin_room_id,
  r.origin_conversation_id, r.started_by, u.display_name as started_by_name, r.decision,
  ${iso(sql`r.started_at`)} as started_at, ${iso(sql`r.updated_at`)} as updated_at,
  ${iso(sql`r.finished_at`)} as finished_at`;

/** `limit + 1` để biết còn trang; thứ tự (started_at, id) giảm (các idx §11). */
export async function listRuns(tx: Tx, f: ListFilter): Promise<RunSummaryRow[]> {
  const where: SQL[] = [sql`r.tenant_id = ${f.tenantId}`];
  if (f.startedBy) where.push(sql`r.started_by = ${f.startedBy}`);
  if (f.roomId) where.push(sql`r.origin_room_id = ${f.roomId}`);
  if (f.conversationId) where.push(sql`r.origin_conversation_id = ${f.conversationId}`);
  if (f.processKey) where.push(sql`r.snapshot->>'key' = ${f.processKey}`);
  if (f.status) where.push(sql`r.status = ${f.status}`);
  if (f.after)
    where.push(sql`(r.started_at, r.id) < (${f.after[0]}::timestamptz, ${f.after[1]}::uuid)`);
  return tx.execute<RunSummaryRow>(sql`select ${RUN_COLS} from hub.process_runs r
    left join admin.users u on u.id = r.started_by and u.tenant_id = r.tenant_id
    where ${sql.join(where, sql` and `)}
    order by r.started_at desc, r.id desc limit ${f.limit + 1}`);
}

export async function loadSummary(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<RunSummaryRow | null> {
  const [r] = await tx.execute<RunSummaryRow>(sql`select ${RUN_COLS} from hub.process_runs r
    left join admin.users u on u.id = r.started_by and u.tenant_id = r.tenant_id
    where r.id = ${runId} and r.tenant_id = ${tenantId}`);
  return r ?? null;
}

// ── ánh xạ + cursor + gợi ý (thuần) ──
export function toSummary(r: RunSummaryRow): ProcessRunSummary {
  const snap = r.snapshot as { key: string; name: string; stages: { step?: number }[] };
  const reason =
    r.status === "needs_decision" ? (r.decision?.reason as string | undefined) : undefined;
  return {
    id: r.id,
    process: { key: snap.key, name: snap.name, version: r.def_version },
    status: r.status,
    current_stage_idx: r.current_stage_idx,
    stage_count: snap.stages.length,
    current_step: r.current_step,
    step_count: stepGroups(snap.stages).length,
    started_by: { id: r.started_by, display_name: r.started_by_name ?? r.started_by },
    origin: {
      kind: r.origin_kind,
      ...(r.origin_room_id && { room_id: r.origin_room_id }),
      ...(r.origin_conversation_id && { conversation_id: r.origin_conversation_id }),
    },
    started_at: r.started_at,
    updated_at: r.updated_at,
    finished_at: r.finished_at,
    ...(reason && { decision_reason: reason as ProcessRunSummary["decision_reason"] }),
  };
}

export function encodeCursor(key: [string, string]): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}
export function decodeCursor(raw: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "string")
      return [v[0], v[1]];
  } catch {
    // rơi xuống lỗi dưới
  }
  throw appError("VALIDATION_ERROR");
}

// ── view (GET /process-runs/:id) — plan-contract §2 ──
// D2-47 · `loadHistory` (thêm mục `escalate`) dời sang `history.repo.ts` (trần 400 dòng); giữ lối gọi `repo.loadHistory`.
export { loadHistory } from "./history.repo";

type OpenTaskRow = {
  id: string;
  kind: OpenTask["kind"];
  stage_idx: number;
  group_id: string | null;
  group_name: string | null;
  assignees: { id: string; display_name: string }[];
  esc_group_id: string | null;
  esc_group_name: string | null;
};

/** Hàng SQL → `OpenTask`; `escalated_group` (P-d1 · A4 G7) chỉ có khi task đã chuyển cấp (assignee `via='escalated'`). */
export function toOpenTask(t: OpenTaskRow): OpenTask {
  return {
    id: t.id,
    kind: t.kind,
    stage_idx: Number(t.stage_idx),
    assignees: (t.assignees ?? []).slice(0, 20),
    group: t.group_id ? { id: t.group_id, name: t.group_name ?? t.group_id } : null,
    ...(t.esc_group_id && {
      escalated_group: { id: t.esc_group_id, name: t.esc_group_name ?? t.esc_group_id },
    }),
  };
}

/** WaitingNote (`open_tasks`): task mở của run + assignee user + group (≤ 10, một truy vấn gộp). */
export async function openTaskViews(tx: Tx, runId: string, tenantId: string): Promise<OpenTask[]> {
  const rows = await tx.execute<OpenTaskRow>(sql`
    select t.id, t.kind, s.stage_idx, t.assignee_group_id as group_id, g.name->>'vi' as group_name,
      esc.group_id as esc_group_id, esc.name as esc_group_name,
      coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'display_name',
          coalesce(u.display_name, u.username)) order by a.created_at)
        from hub.review_task_assignees a join admin.users u on u.id = a.user_id and u.tenant_id = a.tenant_id
        where a.task_id = t.id and a.tenant_id = t.tenant_id), '[]'::jsonb) as assignees
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    left join admin.groups g on g.id = t.assignee_group_id and g.tenant_id = t.tenant_id
    left join lateral (select a.group_id, eg.name->>'vi' as name
        from hub.review_task_assignees a
        left join admin.groups eg on eg.id = a.group_id and eg.tenant_id = a.tenant_id
        where a.task_id = t.id and a.tenant_id = t.tenant_id and a.via = 'escalated' and a.group_id is not null
        limit 1) esc on true
    where t.process_run_id = ${runId} and t.tenant_id = ${tenantId} and t.status = 'open'
    order by t.created_at limit 10`);
  return rows.map(toOpenTask);
}

/** Id task mà người xem là assignee (user hoặc thành viên group), theo thứ tự tạo (≤ 20). */
export async function assigneeTaskIds(
  tx: Tx,
  q: { runId: string; tenantId: string; userId: string; groupIds: readonly string[] },
): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select distinct t.id, t.created_at from hub.review_tasks t
    join hub.review_task_assignees a on a.task_id = t.id and a.tenant_id = t.tenant_id
    where t.process_run_id = ${q.runId} and t.tenant_id = ${q.tenantId}
      and (a.user_id = ${q.userId}
        or (a.group_id is not null and a.group_id = any(${`{${q.groupIds.join(",")}}`}::uuid[])))
    order by t.created_at limit 20`);
  return rows.map((x) => x.id);
}

const SUGGEST_MAX = 3;
/** R-G05 · key gần `typed` (≤ 3, sắp theo khoảng cách rồi tên). Ngưỡng `max(2, ⌊len/2⌋)`: khớp `hoa-dn`→`hoa-don`
 * (dist 1) và `hoa-dn`→`hoa-don-t` (P1-02, dist 3), loại `zzz`. `typed` rỗng ⇒ []. */
export function suggestProcesses(typed: string, keys: readonly string[]): string[] {
  const t = typed.toLowerCase().normalize("NFC");
  if (t === "") return [];
  const limit = Math.max(2, Math.floor([...t].length / 2));
  return keys
    .map((k) => ({ k, d: levenshtein(t, k) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, SUGGEST_MAX)
    .map((x) => x.k);
}
