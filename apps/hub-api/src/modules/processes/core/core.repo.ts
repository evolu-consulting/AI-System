// HUB-FR-104…113 · repo lõi quy trình dùng chung mọi PF (plan §8 hàng 0b khung, §10 thứ tự khoá): khoá/đọc run, chèn/đóng
// task + grant, outbox tin thread. Chạy trong `withHubScope`; mọi câu lọc `tenant_id` tường minh khi có, RLS T là lưới.
// Không log nội dung.
import type { DecisionReason, RoomProcessKind, TaskKind, TaskResult } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { processRuns, processThreadEvents, reviewTasks } from "@ai/db/schema/hub-processes";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { FanoutRow } from "../../rooms/public";
import { reviewTimingOf } from "./review-timing.sql";
import { insertGrants } from "./task-grants.sql";

export type RunHead = typeof processRuns.$inferSelect;

/** §10 · `process_runs` FOR UPDATE (sau `rooms`/advisory nếu có, trước `stage_runs`). null = không thấy (RLS/tenant). */
export async function lockRun(tx: Tx, tenantId: string, runId: string): Promise<RunHead | null> {
  const [row] = await tx
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.id, runId), eq(processRuns.tenantId, tenantId)))
    .for("update");
  return row ?? null;
}

/**
 * HUB-FR-112 · HUB-FR-113 · người nhận `process.updated` (plan-contract §5): người bắt đầu + thành viên đang hoạt động
 * của phòng nguồn + assignee (user + thành viên group) các task **open**. Gọi TRƯỚC khi đóng task (để assignee task vừa
 * đóng vẫn nhận). Qua definer `hub.process_run_recipients` (0020): nhánh `room_members` cần bỏ RLS vì người gọi có thể
 * không là thành viên phòng nguồn (gates review/decide/cancel bởi reviewer ngoài phòng; `lostPermission` khi người bắt
 * đầu đã rời) — policy `room_members_select` (0011) khoá theo caller-là-thành-viên nên đọc thẳng sẽ rơi mất họ. Definer
 * cách ly chặt theo tenant của run (scope 'user' khớp GUC tenant; 'system' tin cậy), trả tập đã khử trùng.
 */
export async function runRecipients(tx: Tx, runId: string, tenantId: string): Promise<string[]> {
  const rows = await tx.execute<{ uid: string | null }>(
    sql`select uid from hub.process_run_recipients(${runId}::uuid, ${tenantId}::uuid)`,
  );
  return rows.map((r) => r.uid).filter((x): x is string => x !== null);
}

export type RunKey = { runId: string; tenantId: string };

/**
 * CR-116 B3 · người nhận như `runRecipients` cho CẢ LÔ run, MỘT câu (definer theo tập `hub.process_runs_recipients`, 0088 —
 * cùng thân + cách ly của 0020). Trả `runId → người nhận` (run không thấy/khác tenant/scope sai ⇒ `[]`). Lô rỗng ⇒ 0 câu.
 */
export async function runRecipientsMany(
  tx: Tx,
  runs: readonly RunKey[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(runs.map((r) => [r.runId, []]));
  if (runs.length === 0) return out;
  const arr = (xs: string[]) => `{${xs.join(",")}}`;
  const rows = await tx.execute<{ run_id: string; uid: string | null }>(
    sql`select run_id, uid from hub.process_runs_recipients(${arr(runs.map((r) => r.runId))}::uuid[], ${arr(runs.map((r) => r.tenantId))}::uuid[])`,
  );
  for (const r of rows) {
    const xs = out.get(r.run_id);
    if (xs && r.uid !== null && !xs.includes(r.uid)) xs.push(r.uid);
  }
  return out;
}

/** Đọc đầu run không khoá. */
export async function loadRunHead(
  tx: Tx,
  tenantId: string,
  runId: string,
): Promise<RunHead | null> {
  const [row] = await tx
    .select()
    .from(processRuns)
    .where(and(eq(processRuns.id, runId), eq(processRuns.tenantId, tenantId)));
  return row ?? null;
}

export type NewTask = {
  tenantId: string;
  runId: string;
  stageRunId: string;
  kind: TaskKind;
  remindAt: Date;
  outputId?: string | null;
  question?: string | null;
  choices?: string[] | null;
  excerpt?: string | null;
  reason?: DecisionReason | null;
  /** CR-127 · E10 · bản ghi gói của việc nhóm (`kind='milestone'` ⇒ id mốc). */
  subjectRef?: string | null;
  /** Grant: user (`via=initial`) + tối đa một group. */
  userIds: readonly string[];
  groupId: string | null;
};

/** Mở task + grant (plan-step0 §1: PF1 `open_review/open_ask/open_decision`). Trả id task. */
export async function insertTask(tx: Tx, t: NewTask): Promise<string> {
  const id = crypto.randomUUID();
  const rt = t.kind === "review" ? await reviewTimingOf(tx, t) : null;
  // CR-127 · E10a · việc Xác nhận mốc: nhắc + quá hạn chuyển cho chép từ cấu hình node như Duyệt (đích giao đã chọn ở
  // `openMilestoneTask` ⇒ chỉ lấy mốc giờ, không cửa duyệt / R#15 / phiếu tất cả).
  const mt =
    t.kind === "milestone" ? (await reviewTimingOf(tx, { ...t, userIds: [] })).timing : null;
  const timing = rt?.timing ?? mt;
  await tx.insert(reviewTasks).values({
    ...(timing ?? {}),
    // CR-127 · E3 (việc dở E2) · bước có người giữ cửa (trưởng phòng head_only / người duyệt cụ thể) ⇒ need='head' (không Nhận việc).
    ...needOf(rt),
    id,
    tenantId: t.tenantId,
    processRunId: t.runId,
    stageRunId: t.stageRunId,
    kind: t.kind,
    outputId: t.outputId ?? null,
    question: t.question ?? null,
    choices: t.choices ?? null,
    excerpt: t.excerpt ?? null,
    reason: t.reason ?? null,
    subjectRef: t.subjectRef ?? null,
    assigneeGroupId: t.groupId,
    remindAt: timing?.remindAt ?? t.remindAt,
  });
  // CR-127 · E3 · grant + uỷ quyền (hàng `via='delegated'`) trong MỘT câu như trước.
  // E5 · người bỏ phiếu = hàng user `via='initial'` (không hàng Group: thành viên vào phòng sau không có phiếu); n = 0 ⇒ giao đích
  // "Quá hạn chuyển cho" / quản trị công ty như việc một người (hàng `via='escalated'`).
  // CR-127 · Z2 · bước Duyệt chỉ có người (không phòng, có cửa `approver_user_id`) ⇒ giao đích danh người đó (hàng `via='initial'`).
  const gateOnly = t.kind === "review" && !t.groupId && t.userIds.length === 0 ? rt?.gate : null;
  const userIds = gateOnly ? [gateOnly] : t.userIds;
  await insertGrants(tx, { ...t, userIds, ...grantOf(t, rt), taskId: id, gate: rt?.gate ?? null });
  return id;
}

type Timing = Awaited<ReturnType<typeof reviewTimingOf>> | null;
/** `need` của task duyệt: cửa duyệt ⇒ 'head'; E5 "Cần: tất cả" (không cửa) ⇒ 'all'; còn lại mặc định cột ('one'). */
const needOf = (rt: Timing) =>
  rt?.gate ? { need: "head" as const } : rt?.all ? { need: "all" as const } : {};

/** Grant người dùng/nhóm + đích giao thêm (R#15; E5 n = 0) của task. */
function grantOf(t: NewTask, rt: Timing) {
  const all = rt?.all ?? null;
  if (!all) return { escalated: rt?.sole ?? null };
  const userIds = [...t.userIds, ...all.voters];
  return { userIds, groupId: null, escalated: all.voters.length === 0 ? all.zero : null };
}

export type CloseTask = {
  result: TaskResult;
  at: Date;
  decidedBy?: string | null;
  feedback?: string | null;
  answer?: string | null;
  sections?: string[] | null;
};

/** §3.4 · khoá đóng: `status='open'` ⇒ đầu thắng; false ⇒ người gọi trả 409 `REVIEW_TASK_CLOSED`. */
export async function closeTask(tx: Tx, taskId: string, c: CloseTask): Promise<boolean> {
  const rows = await tx
    .update(reviewTasks)
    .set({
      status: "closed",
      result: c.result,
      decidedBy: c.decidedBy ?? null,
      decidedAt: c.at,
      feedback: c.feedback ?? null,
      answer: c.answer ?? null,
      sections: c.sections ?? null,
    })
    .where(
      and(
        eq(reviewTasks.id, taskId),
        eq(reviewTasks.status, "open"),
        // CR-127 · E2 · người quyết khác người đã Nhận việc (`need='one'`) ⇒ không đóng (cổng báo `TASK_CLAIMED`).
        c.decidedBy
          ? or(
              ne(reviewTasks.need, "one"),
              isNull(reviewTasks.claimedBy),
              eq(reviewTasks.claimedBy, c.decidedBy),
            )
          : undefined,
      ),
    )
    .returning({ id: reviewTasks.id });
  return rows.length > 0;
}

// ── Outbox tin thread (plan-thread T5) ──

export type ThreadTarget = {
  tenantId: string;
  originKind: string;
  roomId: string | null;
  name: string;
};

/** Nơi đăng tin thread của run (đọc dưới scope người làm, RLS T). */
export async function threadTarget(tx: Tx, runId: string): Promise<ThreadTarget | null> {
  const [row] = await tx
    .select({
      tenantId: processRuns.tenantId,
      originKind: processRuns.originKind,
      roomId: processRuns.originRoomId,
      name: sql<string>`${processRuns.snapshot}->>'name'`,
    })
    .from(processRuns)
    .where(eq(processRuns.id, runId));
  return row ?? null;
}

export type NewThreadEvent = {
  id: string;
  tenantId: string;
  runId: string;
  roomId: string;
  kind: RoomProcessKind;
  meta: Record<string, unknown>;
  content: string;
};

/**
 * INSERT không RETURNING (SELECT chỉ `system`). `created_at = clock_timestamp()`: nhiều sự kiện trong một tx vẫn đúng thứ
 * tự đăng (`now()` của tx bằng nhau).
 */
export async function insertThreadEvent(tx: Tx, e: NewThreadEvent): Promise<void> {
  await tx.insert(processThreadEvents).values({
    id: e.id,
    tenantId: e.tenantId,
    processRunId: e.runId,
    roomId: e.roomId,
    kind: e.kind,
    placement: e.kind === "block" ? "main" : "flow",
    meta: e.meta,
    content: e.content,
    createdAt: sql`clock_timestamp()`,
  });
}

/** Sự kiện chưa đăng, cũ trước (`process_thread_events_unposted_idx`); `runId` ⇒ chỉ của run đó. Scope `system`. */
export async function unpostedEvents(
  tx: Tx,
  limit: number,
  runId?: string,
): Promise<{ id: string; runId: string }[]> {
  const t = processThreadEvents;
  const where = runId ? and(isNull(t.postedAt), eq(t.processRunId, runId)) : isNull(t.postedAt);
  return tx
    .select({ id: t.id, runId: t.processRunId })
    .from(t)
    .where(where)
    .orderBy(asc(t.createdAt), asc(t.id))
    .limit(limit);
}

export type PostedEvent = {
  posted: boolean;
  reason: "posted" | "already" | "skipped";
  roomId: string;
  seq: number | null;
  createdAt: Date | null;
};

/**
 * HUB-FR-143 · plan §6 · RA-01 · khoá run của sự kiện `FOR KEY SHARE` TRƯỚC definer: chèn `room_messages` có FK
 * `process_run_id` ⇒ lấy `FOR KEY SHARE` trên `process_runs` SAU khi definer đã khoá `rooms` (thứ tự room → run, ngược
 * tx quy trình run → … → rooms qua FK của `process_thread_events`) ⇒ 40P01. Lấy SỚM đúng khoá FK đó là đủ: chỉ `FOR UPDATE`
 * (tx quy trình `runs.lock`) chặn được nó ⇒ poster chờ tx đó commit hẳn rồi mới khoá `rooms` (run → room → sự kiện); tx chỉ
 * giữ `NO KEY UPDATE` (UPDATE thường, hết hạn) không chặn FK nên không thành chu trình.
 * cr126-expire-race · KHÔNG dùng `FOR SHARE`: nó xung đột `NO KEY UPDATE` ⇒ `claimExpired` (`SKIP LOCKED`) bỏ qua run poster đang
 * đăng tin ngay sau commit apply ⇒ run quá hạn lọt một lượt quét.
 * Một câu, không vòng hàng; sự kiện/run không thấy ⇒ không khoá gì (definer tự xử lý `not found`/`skipped`).
 */
export async function lockEventRun(tx: Tx, eventId: string): Promise<void> {
  await tx.execute(sql`select 1 from hub.process_runs r
    join hub.process_thread_events e on e.process_run_id = r.id and e.tenant_id = r.tenant_id
    where e.id = ${eventId}::uuid for key share of r`);
}

/** Definer `hub.room_post_process_message` (khoá rooms → sự kiện → room_messages; idempotent `id = event.id`). */
export async function postProcessMessage(tx: Tx, eventId: string): Promise<PostedEvent> {
  const [row] = await tx.execute<{
    posted: boolean;
    reason: PostedEvent["reason"];
    room_id: string;
    seq: number | string | null;
    created_at: Date | string | null;
  }>(sql`select * from hub.room_post_process_message(${eventId}::uuid)`);
  if (!row) throw new Error("room_post_process_message returned no row");
  return {
    posted: row.posted,
    reason: row.reason,
    roomId: row.room_id,
    seq: row.seq === null ? null : Number(row.seq),
    createdAt: row.created_at === null ? null : new Date(row.created_at),
  };
}

export type EventMessage = {
  id: string;
  roomId: string;
  runId: string;
  kind: RoomProcessKind;
  placement: "main" | "flow";
  meta: Record<string, unknown>;
  content: string;
  senderId: string;
  flowId: string;
  name: string;
};

/** Dữ liệu dựng `RoomMessage` của tin vừa đăng (scope `system`: `room_messages` không đọc được, dựng từ sự kiện). */
export async function eventMessage(tx: Tx, eventId: string): Promise<EventMessage | null> {
  const e = processThreadEvents;
  const [row] = await tx
    .select({
      id: e.id,
      roomId: e.roomId,
      runId: e.processRunId,
      kind: e.kind,
      placement: e.placement,
      meta: e.meta,
      content: e.content,
      senderId: processRuns.processDefId,
      flowId: processRuns.flowId,
      name: sql<string>`${processRuns.snapshot}->>'name'`,
    })
    .from(e)
    .innerJoin(
      processRuns,
      and(eq(processRuns.id, e.processRunId), eq(processRuns.tenantId, e.tenantId)),
    )
    .where(eq(e.id, eventId));
  return row ?? null;
}

/** Chưa đọc của phòng + tổng chưa đọc từng thành viên hiện tại (definer `room_fanout_sys`, cùng tx đăng). */
export async function fanoutSys(tx: Tx, roomId: string): Promise<FanoutRow[]> {
  const rows = await tx.execute<{
    user_id: string;
    unread: number | string;
    total: number | string;
  }>(sql`select user_id, unread, total from hub.room_fanout_sys(${roomId}::uuid)`);
  return rows.map((r) => ({
    user_id: r.user_id,
    unread: Number(r.unread),
    total: Number(r.total),
  }));
}
