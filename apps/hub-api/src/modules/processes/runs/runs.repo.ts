// HUB-FR-105 · HUB-FR-113 · PF1 · SQL bắt đầu + liệt kê run (plan §2.1, §4, §10; plan-contract §3). Chạy trong
// `withHubScope({kind:"user"})` của người bắt đầu/người xem; mọi câu lọc `tenant_id` tường minh, RLS T là lưới.
// Khoá bắt đầu (§10): rooms (tin gọi) → advisory `process:<tenant>` → process_runs. Không log nội dung.
import type { ProcessRunStatus, ProcessRunSummary } from "@ai/contracts/chat";
import { PROCESS_RUN_ACTIVE } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import { appError } from "../../../lib/errors";
import { levenshtein } from "../../commands/suggest.rules";

type Json = Record<string, unknown>;
const iso = (c: SQL) => sql`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Định nghĩa trong tenant để bắt đầu (kể cả tắt/đã xoá ⇒ `canRun` quyết; mẫu `tenant_id IS NULL` không thấy). */
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
};

const DEF_COLS = sql`d.id, d.key, d.name, d.version, d.enabled, (d.deleted_at is not null) as deleted,
  d.run_group_ids, d.stages, d.token_budget`;

export async function findDefByKey(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<StartDefRow | null> {
  const [r] = await tx.execute<StartDefRow>(sql`select ${DEF_COLS}
    from hub.process_defs d where d.tenant_id = ${tenantId} and d.key = ${key} limit 1`);
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
};

export async function catalogDefs(tx: Tx, tenantId: string): Promise<CatalogRow[]> {
  return tx.execute<CatalogRow>(sql`select d.key, d.name, d.description, d.input_hint,
      jsonb_array_length(d.stages)::int as stage_count, d.run_group_ids
    from hub.process_defs d
    where d.tenant_id = ${tenantId} and d.enabled = true and d.deleted_at is null
    order by d.name asc, d.key asc limit 200`);
}

/** §4 · đếm run đang chạy của tenant (`process_runs_active_idx`) — gọi dưới advisory lock. */
export async function countActive(tx: Tx, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from hub.process_runs
    where tenant_id = ${tenantId} and status in ${activeList()}`);
  return r?.n ?? 0;
}

const activeList = () =>
  sql`(${sql.join(
    PROCESS_RUN_ACTIVE.map((s) => sql`${s}`),
    sql`, `,
  )})`;

/** §10 · khoá tuần tự hoá start theo tenant (xact-local). */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('process:' || ${tenantId}::text))`);
}

export type NewRun = {
  id: string;
  tenantId: string;
  convId: string;
  flowId: string;
  def: StartDefRow;
  startedBy: string;
  originKind: "room" | "conversation" | "admin";
  originRoomId: string | null;
  originConversationId: string | null;
  input: string;
  expiresAt: Date;
};

/** Tạo hội thoại nền + flow (= thread) + `process_runs` + `stage_runs` (stage 0 queued, còn lại pending ≤ 10). */
export async function insertRun(tx: Tx, n: NewRun): Promise<void> {
  const name = n.def.name;
  await tx.execute(sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
    values (${n.convId}, ${n.tenantId}, ${n.startedBy}, ${name}, ${name.toLowerCase()}, ${n.id})`);
  await tx.execute(sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title)
    values (${n.flowId}, ${n.tenantId}, ${n.startedBy}, ${n.convId}, ${name})`);
  const snapshot = {
    key: n.def.key,
    name: n.def.name,
    stages: n.def.stages,
    token_budget: n.def.token_budget,
    run_group_ids: n.def.run_group_ids,
  };
  await tx.execute(sql`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by,
      origin_kind, origin_room_id, origin_conversation_id, input, conversation_id, flow_id, expires_at)
    values (${n.id}, ${n.tenantId}, ${n.def.id}, ${n.def.version}, ${JSON.stringify(snapshot)}::jsonb, ${n.startedBy},
      ${n.originKind}, ${n.originRoomId}, ${n.originConversationId}, ${n.input}, ${n.convId}, ${n.flowId},
      ${n.expiresAt.toISOString()}::timestamptz)`);
  const stages = n.def.stages.length;
  const rows = sql.join(
    Array.from(
      { length: stages },
      (_, i) => sql`(${n.tenantId}, ${n.id}, ${i}, ${i === 0 ? "queued" : "pending"})`,
    ),
    sql`, `,
  );
  await tx.execute(
    sql`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values ${rows}`,
  );
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

const RUN_COLS = sql`r.id, r.snapshot, r.def_version, r.status, r.current_stage_idx, r.origin_kind, r.origin_room_id,
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
  const snap = r.snapshot as { key: string; name: string; stages: unknown[] };
  const reason =
    r.status === "needs_decision" ? (r.decision?.reason as string | undefined) : undefined;
  return {
    id: r.id,
    process: { key: snap.key, name: snap.name, version: r.def_version },
    status: r.status,
    current_stage_idx: r.current_stage_idx,
    stage_count: snap.stages.length,
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
