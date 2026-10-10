// HUB-FR-110 · HUB-FR-111 · PF2 · đọc/ghi phục vụ trả lời + chuyển task (plan §9, §10). Chạy trong `withHubScope` scope
// `user` của người làm (RLS T lưới; câu lọc `tenant_id` tường minh). Không log nội dung trả lời/ghi chú.
import type { UserRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import {
  processRuns,
  reviewTaskAssignees,
  reviewTasks,
  stageRuns,
} from "@ai/db/schema/hub-processes";
import { and, eq, sql } from "drizzle-orm";

/** Đầu task (bất biến trong vòng đời): để biết run cần khoá + loại + stage. null ⇒ 404. */
export type TaskHead = {
  runId: string;
  stageRunId: string;
  stageIdx: number;
  kind: "review" | "ask" | "decision";
  groupId: string | null;
};

export async function taskHead(tx: Tx, tenantId: string, taskId: string): Promise<TaskHead | null> {
  const [row] = await tx
    .select({
      runId: reviewTasks.processRunId,
      stageRunId: reviewTasks.stageRunId,
      stageIdx: stageRuns.stageIdx,
      kind: reviewTasks.kind,
      groupId: reviewTasks.assigneeGroupId,
    })
    .from(reviewTasks)
    .innerJoin(
      stageRuns,
      and(eq(stageRuns.id, reviewTasks.stageRunId), eq(stageRuns.tenantId, reviewTasks.tenantId)),
    )
    .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.tenantId, tenantId)));
  return row ? { ...row, stageIdx: Number(row.stageIdx) } : null;
}

/** Trạng thái + grant đọc SAU khi khoá run (đầu thắng/chuỗi chuyển thấy được bản đã COMMIT). */
export type TaskGrants = {
  status: "open" | "closed";
  /** User đã là assignee (initial + đã chuyển). */
  userIds: Set<string>;
  /** Group duyệt gán ban đầu (nếu có). */
  groupId: string | null;
  /** Số lần đã chuyển. */
  forwards: number;
};

export async function taskGrants(
  tx: Tx,
  tenantId: string,
  taskId: string,
): Promise<TaskGrants | null> {
  const [t] = await tx
    .select({ status: reviewTasks.status, groupId: reviewTasks.assigneeGroupId })
    .from(reviewTasks)
    .where(and(eq(reviewTasks.id, taskId), eq(reviewTasks.tenantId, tenantId)));
  if (!t) return null;
  const rows = await tx
    .select({ userId: reviewTaskAssignees.userId, via: reviewTaskAssignees.via })
    .from(reviewTaskAssignees)
    .where(and(eq(reviewTaskAssignees.taskId, taskId), eq(reviewTaskAssignees.tenantId, tenantId)));
  const userIds = new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])));
  const forwards = rows.filter((r) => r.via === "forward").length;
  return { status: t.status, userIds, groupId: t.groupId, forwards };
}

/** Trả lời đầu thắng ⇒ stage `queued`, run `running` (PF1 `kick` chạy tiếp). */
export async function resumeStage(
  tx: Tx,
  o: { tenantId: string; runId: string; stageRunId: string; at: Date },
): Promise<void> {
  await tx
    .update(stageRuns)
    .set({ status: "queued", updatedAt: o.at })
    .where(and(eq(stageRuns.id, o.stageRunId), eq(stageRuns.tenantId, o.tenantId)));
  await tx
    .update(processRuns)
    .set({ status: "running", updatedAt: o.at })
    .where(and(eq(processRuns.id, o.runId), eq(processRuns.tenantId, o.tenantId)));
}

/** Thêm một assignee `via=forward` (plan §3.4). `note` riêng tư (không vào tin thread). */
export async function addForwardAssignee(
  tx: Tx,
  a: {
    tenantId: string;
    taskId: string;
    userId: string;
    fromUserId: string;
    note: string | null;
    depth: number;
  },
): Promise<void> {
  await tx.insert(reviewTaskAssignees).values({
    tenantId: a.tenantId,
    taskId: a.taskId,
    userId: a.userId,
    via: "forward",
    fromUserId: a.fromUserId,
    note: a.note,
    depth: a.depth,
  });
}

/** `UserRef` + `username` (audit) cho actor/from/to tin thread — scope `user`, cùng tenant. */
export type UserInfo = UserRef & { username: string };
export async function userRefs(
  tx: Tx,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, UserInfo>> {
  if (ids.length === 0) return new Map();
  const uniq = [...new Set(ids)];
  const rows = await tx.execute<{ id: string; display_name: string | null; username: string }>(
    sql`select id, display_name, username from admin.users
      where id = any(${`{${uniq.join(",")}}`}::uuid[]) and tenant_id = ${tenantId}`,
  );
  return new Map(
    rows.map((u) => [
      u.id,
      { id: u.id, display_name: u.display_name || u.username, username: u.username },
    ]),
  );
}

/** Người làm có đang là thành viên phòng (`left_at IS NULL`)? Dùng cho `task_result.outside` (T8). */
export async function isRoomMember(
  tx: Tx,
  tenantId: string,
  roomId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ ok: number }>(
    sql`select 1 as ok from hub.room_members
      where room_id = ${roomId} and tenant_id = ${tenantId} and user_id = ${userId} and left_at is null
      limit 1`,
  );
  return rows.length > 0;
}
