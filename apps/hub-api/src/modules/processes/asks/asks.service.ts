// HUB-FR-110 · HUB-FR-111 · PF2 · trả lời ask (đầu thắng ⇒ stage queued ⇒ `kick` sau COMMIT) + nhờ người khác trả lời
// (≤ 3; review: cùng Group). KHÔNG mở task (PF1). Thứ tự khoá plan §10: process_runs FOR UPDATE trước mọi ghi; answer ∥
// forward trên cùng task nối tiếp qua khoá run (không deadlock, P2-14). Không log nội dung trả lời/ghi chú.
import {
  FORWARD_CHAIN_MAX,
  type ForwardReviewTaskRequest,
  ForwardReviewTaskRequestSchema,
  type ReviewAnswerRequest,
  ReviewAnswerRequestSchema,
  type RoomProcessPart,
  type TaskDetail,
  type UserRef,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError } from "../../../lib/errors";
import { parseWith } from "../../../lib/http";
import { clipEntityName, dbHubAudit, type HubAuditRow } from "../../../lib/hub-audit";
import type { UserEvent } from "../../../lib/user-stream";
import { closeTask, lockRun, type RunHead } from "../core/core.repo";
import { processError } from "../core/errors";
import type { ProcessDeps } from "../core/ports";
import type { Viewer } from "../core/run-access.rules";
import { loadTaskDetails, type ViewerCtx } from "../core/task-view";
import { enqueueThread } from "../core/thread";
import { isTerminal } from "../domain/runs/run-state.rules";
import { settleStep, stageRowById } from "../runs/step-persist";
import { type ForwardTarget, type ForwardTask, forwardCheck } from "./ask.rules";
import * as repo from "./asks.repo";

/** Kết quả một thao tác: TaskDetail trả client, sự kiện phát SAU COMMIT, run cần `kick` (chỉ answer thắng). */
export type AskResult = { detail: TaskDetail; events: UserEvent[]; kick: string | null };

type ForwardCtx = {
  user: AuthUser;
  viewer: ViewerCtx;
  taskId: string;
  body: ForwardReviewTaskRequest;
  to: ForwardTarget;
};

export class AsksService {
  readonly #d: ProcessDeps;
  constructor(d: ProcessDeps) {
    this.#d = d;
  }

  async #viewer(user: AuthUser): Promise<ViewerCtx> {
    const u = await this.#d.config.user(user.userId);
    const v: Viewer = { userId: user.userId, tenantId: user.tenantId, role: user.role };
    return { ...v, groupIds: u?.groupIds ?? new Set<string>() };
  }

  /** Người gọi có là assignee của task (user hoặc thành viên group ban đầu)? Ngoài ra ⇒ 404 (không lộ). */
  #isAssignee(g: repo.TaskGrants, viewer: ViewerCtx): boolean {
    return g.userIds.has(viewer.userId) || (g.groupId !== null && viewer.groupIds.has(g.groupId));
  }

  #audit(
    v: Viewer,
    a: {
      taskId: string;
      action: "answer" | "forward";
      username: string | null;
      after: Record<string, unknown>;
    },
  ): HubAuditRow {
    return {
      tenantId: v.tenantId,
      actorId: v.userId,
      actorUsername: a.username,
      actorRole: v.role,
      action: a.action,
      entity: "review_task",
      entityId: a.taskId,
      entityName: clipEntityName(a.taskId),
      hubConfigVersion: null,
      before: null,
      after: a.after,
      summary: {},
    };
  }

  #ref(refs: ReadonlyMap<string, repo.UserInfo>, id: string): UserRef {
    return { id, display_name: refs.get(id)?.display_name ?? id };
  }

  #forwardPart(o: {
    head: repo.TaskHead;
    taskId: string;
    refs: ReadonlyMap<string, repo.UserInfo>;
    fromId: string;
    toId: string;
    depth: number;
  }): Extract<RoomProcessPart, { kind: "forward" }> {
    return {
      kind: "forward",
      process_run_id: o.head.runId,
      stage_idx: o.head.stageIdx,
      task_id: o.taskId,
      task_kind: o.head.kind,
      from: this.#ref(o.refs, o.fromId),
      to: this.#ref(o.refs, o.toId),
      depth: o.depth,
    };
  }

  /** Đích chuyển theo ConfigCache: dùng được = active ∧ không bị tenant khoá (như `accountUsable`). */
  async #target(user: AuthUser, toId: string): Promise<ForwardTarget> {
    const t = await this.#d.config.user(toId);
    return {
      id: toId,
      active: t ? t.active && !t.lockedByTenant : false,
      sameTenant: t?.tenantId === user.tenantId,
      groupIds: t?.groupIds ?? new Set<string>(),
    };
  }

  /** Đuôi chung answer/forward (trong tx): tin thread + audit + `TaskDetail`. `part.process_run_id` = run. */
  async #finish(
    tx: Tx,
    viewer: ViewerCtx,
    o: {
      part: Extract<RoomProcessPart, { kind: "task_result" | "forward" }>;
      audit: {
        action: "answer" | "forward";
        username: string | null;
        after: Record<string, unknown>;
      };
      events: UserEvent[];
      kick: string | null;
    },
  ): Promise<AskResult> {
    await enqueueThread(tx, { runId: o.part.process_run_id, roomId: "", ...o.part });
    await dbHubAudit.insert(tx, this.#audit(viewer, { taskId: o.part.task_id, ...o.audit }));
    const [detail] = await loadTaskDetails(tx, viewer, [o.part.task_id]);
    if (!detail) throw appError("NOT_FOUND");
    return { detail, events: o.events, kick: o.kick };
  }

  /**
   * §10 · khoá run (process_runs FOR UPDATE) rồi đọc trạng thái + grant; người gọi không là assignee ⇒ 404 (không lộ
   * tồn tại). answer ∥ forward nối tiếp qua khoá này (P2-14).
   */
  async #access(
    tx: Tx,
    user: AuthUser,
    viewer: ViewerCtx,
    taskId: string,
  ): Promise<{ head: repo.TaskHead; run: RunHead; grants: repo.TaskGrants }> {
    const head = await repo.taskHead(tx, user.tenantId, taskId);
    if (!head) throw appError("NOT_FOUND");
    const run = await lockRun(tx, user.tenantId, head.runId);
    if (!run) throw appError("NOT_FOUND");
    const grants = await repo.taskGrants(tx, user.tenantId, taskId);
    if (!grants || !this.#isAssignee(grants, viewer)) throw appError("NOT_FOUND");
    return { head, run, grants };
  }

  /** P-b2 §3.7 · guard theo STAGE (bước song song: run có thể `running` vì stage khác) ⇒ stage `queued` + join bước. */
  async #resume(
    tx: Tx,
    p: { tenantId: string; head: repo.TaskHead; run: RunHead; at: Date },
  ): Promise<void> {
    const { tenantId, head, run, at } = p;
    const stage = await stageRowById(tx, head.runId, head.stageRunId, tenantId);
    if (isTerminal(run.status) || stage?.status !== "waiting_answer")
      throw processError("PROCESS_RUN_STATE");
    await repo.resumeStage(tx, { tenantId, runId: head.runId, stageRunId: head.stageRunId, at });
    await settleStep(tx, head.runId, tenantId);
  }

  // ── POST /review-tasks/:id/answer (HUB-FR-110) ──
  async answer(user: AuthUser, taskId: string, raw: unknown): Promise<AskResult> {
    const viewer = await this.#viewer(user);
    return withHubScope(
      this.#d.db,
      { kind: "user", tenantId: user.tenantId, userId: user.userId },
      async (tx) => {
        const { head, run } = await this.#access(tx, user, viewer, taskId);
        if (head.kind !== "ask") throw processError("TASK_KIND_MISMATCH");
        // Thứ tự contract §3: quyền xem (404) → zod (400) → trạng thái (409).
        const body = parseWith(ReviewAnswerRequestSchema, raw) as ReviewAnswerRequest;
        const at = this.#d.now();
        const won = await closeTask(tx, taskId, {
          result: "answer",
          at,
          decidedBy: user.userId,
          answer: body.answer,
        });
        if (!won) throw processError("REVIEW_TASK_CLOSED");
        await this.#resume(tx, { tenantId: user.tenantId, head, run, at });
        const refs = await repo.userRefs(tx, user.tenantId, [user.userId]);
        const me = refs.get(user.userId);
        const part: Extract<RoomProcessPart, { kind: "task_result" }> = {
          kind: "task_result",
          process_run_id: head.runId,
          stage_idx: head.stageIdx,
          task_id: taskId,
          task_kind: "ask",
          result: "answer",
          actor: this.#ref(refs, user.userId),
          outside: await this.#outside(tx, user.tenantId, run, user.userId),
          answer: body.answer,
          ...(body.choice !== undefined && { choice: body.choice }),
        };
        const events = await this.#d.notifier.taskClosed(tx, taskId);
        return this.#finish(tx, viewer, {
          part,
          audit: { action: "answer", username: me?.username ?? null, after: { result: "answer" } },
          events,
          kick: head.runId,
        });
      },
    );
  }

  // ── POST /review-tasks/:id/forward (HUB-FR-111) ──
  async forward(user: AuthUser, taskId: string, raw: unknown): Promise<AskResult> {
    const viewer = await this.#viewer(user);
    const body = parseWith(ForwardReviewTaskRequestSchema, raw) as ForwardReviewTaskRequest;
    const to = await this.#target(user, body.to_user_id);
    return withHubScope(
      this.#d.db,
      { kind: "user", tenantId: user.tenantId, userId: user.userId },
      (tx) => this.#forwardTx(tx, { user, viewer, taskId, body, to }),
    );
  }

  async #forwardTx(tx: Tx, c: ForwardCtx): Promise<AskResult> {
    const { user, viewer, taskId, body, to } = c;
    const { head, grants } = await this.#access(tx, user, viewer, taskId);
    const t: ForwardTask = {
      kind: head.kind,
      status: grants.status,
      forwards: grants.forwards,
      groupId: grants.groupId,
      assigneeIds: grants.userIds,
    };
    const check = forwardCheck(t, to, user.userId);
    if (check !== "ok") throw processError(check);
    const depth = Math.min(grants.forwards + 1, FORWARD_CHAIN_MAX);
    await repo.addForwardAssignee(tx, {
      tenantId: user.tenantId,
      taskId,
      userId: body.to_user_id,
      fromUserId: user.userId,
      note: body.note ?? null,
      depth,
    });
    const refs = await repo.userRefs(tx, user.tenantId, [user.userId, body.to_user_id]);
    const part = this.#forwardPart({
      head,
      taskId,
      refs,
      fromId: user.userId,
      toId: body.to_user_id,
      depth,
    });
    const events = await this.#d.notifier.taskOpened(tx, taskId);
    return this.#finish(tx, viewer, {
      part,
      audit: {
        action: "forward",
        username: refs.get(user.userId)?.username ?? null,
        after: { to: body.to_user_id, depth },
      },
      events,
      kick: null,
    });
  }

  /** `task_result.outside` (T8): người làm KHÔNG là thành viên phòng nguồn (run không từ phòng ⇒ false). */
  async #outside(tx: Tx, tenantId: string, run: RunHead, userId: string): Promise<boolean> {
    if (run.originKind !== "room" || !run.originRoomId) return false;
    return !(await repo.isRoomMember(tx, tenantId, run.originRoomId, userId));
  }
}
