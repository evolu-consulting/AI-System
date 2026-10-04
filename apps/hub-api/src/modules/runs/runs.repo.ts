// HUB-FR-41 · HUB-FR-45 · P12 · SQL của run (plan H1 §5.1, §5.2, §3.5). Câu `user` gọi trong `withHubScope(user)` và
// vẫn lọc `tenant_id` + `user_id` tường minh; câu kết thúc gọi trong `withHubScope(system)` (việc nền của chủ run).
import type { Ask } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { conversations, flows, messages, runs } from "@ai/db/schema/hub";
import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type Owner = { tenantId: string; userId: string };
export type Locale = "vi" | "en";
export type RunStatus = "running" | "finished" | "failed" | "cancelled";

/** Thời điểm ghi cắt về ms (cùng cách conversations, B5): JSON trả ms nên thứ tự client thấy khớp DB. */
const NOW_MS = sql`date_trunc('milliseconds', now())`;
const LEASE = sql`now() + interval '30 seconds'`;
/** Unique partial index "một run `running` mỗi flow" (H1-R11). */
export const FLOW_RUNNING_UQ = "runs_flow_running_uq";

const ownedBy = (t: { tenantId: AnyPgColumn; userId: AnyPgColumn }, o: Owner): SQL =>
  and(eq(t.tenantId, o.tenantId), eq(t.userId, o.userId)) as SQL;

/** §5.1 bước 1 · khoá hội thoại đầu tiên (§3.5); không thấy/đã xoá → false. `updated_at` không lùi. */
export async function touchConversation(tx: Tx, o: Owner, id: string): Promise<boolean> {
  const c = conversations;
  const rows = await tx
    .update(c)
    .set({ updatedAt: sql`greatest(${c.updatedAt}, ${NOW_MS})` })
    .where(and(ownedBy(c, o), eq(c.id, id), isNull(c.deletedAt)))
    .returning({ id: c.id });
  return rows.length > 0;
}

/** §5.1 bước 2 · flow có sẵn của hội thoại: +2 tin (user + assistant sẽ ghi khi kết thúc). */
export async function touchFlow(
  tx: Tx,
  o: Owner,
  p: { conversationId: string; flowId: string },
): Promise<boolean> {
  const f = flows;
  const rows = await tx
    .update(f)
    .set({ messageCount: sql`${f.messageCount} + 2`, lastActiveAt: NOW_MS })
    .where(and(ownedBy(f, o), eq(f.id, p.flowId), eq(f.conversationId, p.conversationId)))
    .returning({ id: f.id });
  return rows.length > 0;
}

export async function insertFlow(
  tx: Tx,
  o: Owner,
  p: { id: string; conversationId: string; title: string },
): Promise<void> {
  await tx.insert(flows).values({
    ...o,
    ...p,
    messageCount: 2,
    createdAt: NOW_MS,
    lastActiveAt: NOW_MS,
  });
}

export type RunInsert = {
  id: string;
  conversationId: string;
  flowId: string;
  configVersion: number;
  userMessageId: string;
  answerMessageId: string;
  owner: string;
  locale: Locale;
  /** H2a-R08 · vắng = `orchestrated`; `command` kèm `commandId` + `featureId`. */
  kind?: "orchestrated" | "command";
  commandId?: string | null;
  featureId?: string | null;
};

/** §5.1 bước 3 · `owner` + lease 30 s. Trả `started_at` (đã cắt ms). 23505 `FLOW_RUNNING_UQ` do người gọi xử lý. */
export async function insertRun(tx: Tx, o: Owner, p: RunInsert): Promise<Date> {
  const [row] = await tx
    .insert(runs)
    .values({ ...o, ...p, status: "running", leaseUntil: LEASE, startedAt: NOW_MS })
    .returning({ startedAt: runs.startedAt });
  if (!row) throw new Error("insert run returned no row");
  return row.startedAt;
}

export async function insertMessage(
  tx: Tx,
  o: Owner,
  p: {
    id: string;
    conversationId: string;
    flowId: string;
    role: "user" | "assistant";
    content: string;
    runId: string;
    ask?: Ask | null;
  },
): Promise<void> {
  await tx.insert(messages).values({ ...o, ...p, ask: p.ask ?? null, createdAt: NOW_MS });
}

export type RunRecord = {
  id: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
  status: RunStatus;
  answerMessageId: string;
  locale: Locale;
  lastSeq: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorHint: string | null;
};

const runCols = {
  id: runs.id,
  tenantId: runs.tenantId,
  userId: runs.userId,
  conversationId: runs.conversationId,
  flowId: runs.flowId,
  status: runs.status,
  answerMessageId: runs.answerMessageId,
  locale: runs.locale,
  lastSeq: runs.lastSeq,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  errorCode: runs.errorCode,
  errorMessage: runs.errorMessage,
  errorHint: runs.errorHint,
};

/** Run của user (E13/E14/E15). Hội thoại xoá mềm không ẩn run: client đang theo dõi vẫn nhận `CANCELLED` của E9. */
export async function findRun(tx: Tx, o: Owner, id: string): Promise<RunRecord | undefined> {
  const [row] = await tx
    .select(runCols)
    .from(runs)
    .where(and(ownedBy(runs, o), eq(runs.id, id)));
  return row;
}

/** Nội dung tin assistant của run (dựng lại sự kiện kết thúc từ DB, §5.3). */
export async function messageContent(tx: Tx, o: Owner, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ content: messages.content })
    .from(messages)
    .where(and(ownedBy(messages, o), eq(messages.id, id)));
  return row?.content ?? null;
}

export type FinishUpdate = {
  runId: string;
  flowId: string;
  owner: string;
  status: Exclude<RunStatus, "running">;
  lastSeq: number;
  error: { code: string; message: string; hint: string } | null;
};

/**
 * §5.2 + P12 · thứ tự khoá §3.5: `flows FOR UPDATE` **trước** `UPDATE runs`. Chỉ khi run còn `running` và còn là của
 * `owner` mới kết thúc; 0 dòng → null (người gọi không ghi gì thêm, không XADD).
 */
export async function finishRun(
  tx: Tx,
  p: FinishUpdate,
): Promise<{ startedAt: Date; finishedAt: Date } | null> {
  await tx.execute(sql`select id from hub.flows where id = ${p.flowId} for update`);
  const [row] = await tx
    .update(runs)
    .set({
      status: p.status,
      lastSeq: p.lastSeq,
      errorCode: p.error?.code ?? null,
      errorMessage: p.error?.message ?? null,
      errorHint: p.error?.hint ?? null,
      finishedAt: NOW_MS,
    })
    .where(and(eq(runs.id, p.runId), eq(runs.status, "running"), eq(runs.owner, p.owner)))
    .returning({ startedAt: runs.startedAt, finishedAt: runs.finishedAt });
  if (!row?.finishedAt) return null;
  return { startedAt: row.startedAt, finishedAt: row.finishedAt };
}

/** Sau tin assistant: flow nhớ agent cuối (`undefined` = giữ) và có đang chờ trả lời `ask` không. */
export async function updateFlowAfterRun(
  tx: Tx,
  p: { flowId: string; agentId?: string | null; pendingAsk: boolean },
): Promise<void> {
  await tx
    .update(flows)
    .set(
      p.agentId === undefined
        ? { pendingAsk: p.pendingAsk }
        : { pendingAsk: p.pendingAsk, agentId: p.agentId },
    )
    .where(eq(flows.id, p.flowId));
}

/**
 * §5.2 · gia hạn lease 30 s các run của `owner`; trả id đã gia hạn. `FOR UPDATE SKIP LOCKED`: hàng đang bị khoá
 * (kết thúc/huỷ/E9 giữ nhiều hàng `runs`) bị bỏ qua lượt này thay vì chờ — một câu khoá nhiều hàng theo thứ tự tuỳ ý
 * có thể tạo vòng chờ với E9 (§3.5). Người gọi tự kiểm hàng bị bỏ qua (`ownedRunning`).
 */
export async function renewLeases(tx: Tx, ids: string[], owner: string): Promise<string[]> {
  const free = tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.id, ids), eq(runs.owner, owner), eq(runs.status, "running")))
    .for("update", { skipLocked: true });
  const rows = await tx
    .update(runs)
    .set({ leaseUntil: LEASE })
    .where(inArray(runs.id, free))
    .returning({ id: runs.id });
  return rows.map((r) => r.id);
}

/** Run trong `ids` còn `running` và còn của `owner` (đọc không khoá, trạng thái đã COMMIT). */
export async function ownedRunning(tx: Tx, ids: string[], owner: string): Promise<string[]> {
  const rows = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.id, ids), eq(runs.owner, owner), eq(runs.status, "running")));
  return rows.map((r) => r.id);
}
