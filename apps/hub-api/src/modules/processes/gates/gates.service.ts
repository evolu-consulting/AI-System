// HUB-FR-107 · HUB-FR-109 · AC-H28 · M5 · §3.1 · §3.4 · §10 · PF1 · cổng kiểm: `POST /review-tasks/:id/decision`
// (Đạt/Chưa đạt), `POST /process-runs/:id/{decide,cancel}`. Khoá `process_runs` FOR UPDATE trước (§10); đóng task
// first-wins (`core.closeTask`); máy trạng thái thuần (`transition`) → hiệu ứng DB (`gates.effects`); phát/đăng +
// `launcher.kick` SAU COMMIT. Scope `user` người thao tác (RLS `room_members` theo tenant); lọc `tenant_id` tường minh.
import type {
  DecideProcessRunRequest,
  DecisionReason,
  ProcessRunStatus,
  ProcessRunSummary,
  ProcessRunView,
  ReviewDecisionRequest,
  TaskDetail,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { loadTaskDetails } from "../core/task-view";
import {
  canCancel,
  canDecide,
  type RunFacts,
  runAccess,
  type Viewer,
} from "../domain/runs/run-access.rules";
import { isTerminal, transition } from "../domain/runs/run-state.rules";
import { pickDecisionStage } from "../domain/runs/step.rules";
import { decisionOptionsFor } from "../domain/tasks/decision.rules";
import * as repo from "../runs/runs.repo";
import type { StepOutcome } from "../runs/step-persist";
import { stageRowOf } from "../runs/team-runner";
import { ViewService } from "../runs/view.service";
import { type BackOut, backFromDecision, type CancelIds } from "./back.effects";
import { reviewDecisionCheck } from "./gate.rules";
import {
  buildState,
  cancelEnd,
  decideEffects,
  type Eff,
  type Gx,
  type Locked,
  needsKick,
  notFound,
  snapOf,
} from "./gates.effects";
import * as g from "./gates.repo";
import { assertReviewAllowed, cancelRunOf, reviewOut } from "./review-out";

/** P-b2 D8 · decision `back_limit` + `add_attempt` ⇒ `back.effects` (nâng trần rồi quay lại); còn lại như P-a. */
async function decideOut(
  gx: Gx,
  e: Eff,
  q: {
    reason: DecisionReason;
    option: DecideProcessRunRequest["option"];
    dtask: g.GateTask | null;
  },
): Promise<BackOut & { kick: boolean }> {
  const { reason, option, dtask } = q;
  if (reason !== "back_limit" || option !== "add_attempt") {
    const o = await decideEffects(gx, e, option, dtask);
    // D8 · `use_current` cho `back_limit` ⇒ stage coi như Đạt: bỏ đích + góp ý quay lại đã lưu (bị từ chối).
    if (reason === "back_limit" && option === "use_current" && dtask)
      await g.clearBackPending(gx.tx, { stageRunId: dtask.stage_run_id, tenantId: e.run.tenantId });
    return { ...o, kick: needsKick(e.effects, o.step) };
  }
  if (!dtask) throw processError("PROCESS_RUN_STATE");
  const o = await backFromDecision(gx, { run: e.run, idx: e.idx, ref: e.ref, dtask });
  return { ...o, kick: o.step?.kind === "next_step" };
}

/** D9 · còn decision mở sau khi quyết ⇒ `process_runs.decision` jsonb = decision mở CŨ nhất (tương thích). */
async function refreshDecision(gx: Gx, run: Locked): Promise<void> {
  const open = await g.openDecisions(gx.tx, run.id, run.tenantId);
  const idx = pickDecisionStage(open);
  if (idx === null) return;
  const reason = open.find((o) => o.stageIdx === idx)?.reason ?? "interrupted";
  const stage = await stageRowOf(gx.tx, run.id, idx);
  const options = decisionOptionsFor((stage?.current_output_id ?? null) !== null, reason);
  const at = gx.d.now().toISOString();
  await g.setDecisionJson(
    gx.tx,
    { id: run.id, tenantId: run.tenantId },
    JSON.stringify({ reason, stage_idx: idx, options, at }),
  );
}

/** Người thao tác + nhóm (gộp để ≤ 4 tham số, CONVENTIONS §2). */
type Req = { v: Viewer; groupIds: ReadonlySet<string> };
type Outcome<T> = {
  body: T;
  events: UserEvent[];
  kick: boolean;
  runId: string;
  /** P-b2 · `hub.runs` của stage bị quay lại — huỷ SAU COMMIT ở scope system, TRƯỚC `kick`. */
  cancel?: CancelIds;
  /** HUB-FR-111 · run quy trình đã huỷ ⇒ huỷ mọi `hub.runs` còn chạy của nó SAU COMMIT ở scope system (TECH-DEBT #147). */
  cancelRun?: { tenantId: string };
};

/** Scope `user` của người thao tác; platform_admin + `?tenant_id` ⇒ tenant đích (plan §5, như ViewService). */
const scopeOf = (u: AuthUser, tenantIdQ?: string) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId,
});
/** `process.updated` sau ghi: theo `step-persist` (bước/trạng thái tổng hợp); null ⇒ trạng thái máy + stage hiện tại. */
const updatedOf = (run: Locked, status: ProcessRunStatus, step: StepOutcome | null) =>
  step
    ? { id: run.id, status: step.status, stageIdx: step.stageIdx, step: step.step }
    : { id: run.id, status, stageIdx: Number(run.currentStageIdx), step: Number(run.currentStep) };
const vrole = (r: AuthUser["role"]): Viewer["role"] =>
  r === "platform_admin" || r === "tenant_admin" ? r : "member";

type LoadedTask = Awaited<ReturnType<typeof g.loadTask>>;

/** Task phải có, cùng tenant (trừ platform_admin), người quyết thuộc Group duyệt/chuyển cấp, đúng loại, phản hồi hợp lệ. */
function assertMayDecide(
  task: LoadedTask,
  { v, groupIds }: Req,
  b: ReviewDecisionRequest,
): asserts task is NonNullable<LoadedTask> {
  if (!task) throw notFound();
  if (v.role !== "platform_admin" && v.tenantId !== task.tenant_id) throw notFound();
  const users = new Set(task.user_ids ?? []);
  const inGroup = (id: string | null) => id !== null && groupIds.has(id);
  // PD-R21 · thành viên Group duyệt HOẶC Group chuyển cấp đều quyết được (người đầu tiên khoá).
  if (!users.has(v.userId) && !inGroup(task.assignee_group_id) && !inGroup(task.escalated_group_id))
    throw notFound();
  if (task.kind !== "review") throw processError("TASK_KIND_MISMATCH");
  if (reviewDecisionCheck(b) !== "ok") throw processError("FEEDBACK_REQUIRED");
}

export class GateService {
  private readonly view: ViewService;
  constructor(private readonly d: ProcessDeps) {
    this.view = new ViewService({ db: d.db, config: d.config });
  }

  async #req(u: AuthUser): Promise<Req> {
    const groupIds = (await this.d.config.user(u.userId))?.groupIds ?? new Set<string>();
    return { v: { userId: u.userId, tenantId: u.tenantId, role: vrole(u.role) }, groupIds };
  }

  // ── POST /review-tasks/:id/decision ──
  async reviewDecision(
    u: AuthUser,
    taskId: string,
    b: ReviewDecisionRequest,
    tenantIdQ?: string,
  ): Promise<TaskDetail> {
    const req = await this.#req(u);
    const out = await withHubScope(this.d.db, scopeOf(u, tenantIdQ), (tx) =>
      this.#review(tx, req, taskId, b),
    );
    await this.#post(out);
    return out.body;
  }

  async #review(
    tx: Tx,
    req: Req,
    taskId: string,
    b: ReviewDecisionRequest,
  ): Promise<Outcome<TaskDetail>> {
    const { v, groupIds } = req;
    const task = await g.loadTask(tx, taskId);
    assertMayDecide(task, req, b);
    const idx = task.stage_idx;
    // T19-perf · pipeline: khoá run (§10, câu ĐẦU) + 2 câu đọc gửi liền một round-trip; Postgres chạy tuần tự trên cùng
    // kết nối ⇒ hai câu đọc chạy SAU khi đã giữ khoá run. Run không thấy ⇒ 404, kết quả đọc bỏ.
    const [run, recipients, s] = await Promise.all([
      core.lockRun(tx, task.tenant_id, task.process_run_id),
      core.runRecipients(tx, task.process_run_id, task.tenant_id),
      stageRowOf(tx, task.process_run_id, idx),
    ]);
    if (!run) throw notFound();
    assertReviewAllowed(run, idx, v.userId, b); // N2-FR-05 403 · P-b2 422 BACK_TARGET_INVALID — trước khi đóng task
    const t = transition(buildState({ run, s, def: snapOf(run).stages[idx], idx, reason: null }), {
      kind: "review",
      result: b.result,
    });
    const [closed, ref] = await Promise.all([
      core.closeTask(tx, taskId, {
        result: b.result,
        at: this.d.now(),
        decidedBy: v.userId,
        feedback: b.feedback ?? null,
        sections: b.sections ?? null,
      }),
      g.actorRef(tx, v.userId, run.tenantId), // đọc tên người quyết — gửi liền sau UPDATE (pipeline)
    ]);
    if (!closed) throw processError("REVIEW_TASK_CLOSED");
    if (!t.ok) throw processError(t.code);
    const e: Eff = { run, idx, next: t.next, effects: t.effects, ref };
    const gx: Gx = { d: this.d, tx };
    const { events, step, status, kick, cancel } = await reviewOut(gx, e, task, b);
    // D9 · decision mở cũ nhất (Chưa đạt chạm `back_limit` vừa ghi decision mới nhất) ∥ đọc thẻ task trả về: độc lập
    // (`process_runs.decision` không thuộc `TaskDetail`) ⇒ pipeline.
    const [, details] = await Promise.all([
      refreshDecision(gx, run),
      loadTaskDetails(tx, { ...v, groupIds }, [taskId]),
    ]);
    events.push(...processUpdated(recipients, updatedOf(run, status, step)));
    const detail = details[0];
    if (!detail) throw notFound();
    const cancelRun = cancelRunOf(run, status); // N2-FR-02 · Từ chối ⇒ huỷ `hub.runs` sau COMMIT
    return { body: detail, events, kick, runId: run.id, cancel, cancelRun };
  }

  // ── POST /process-runs/:id/decide ──
  async decide(
    u: AuthUser,
    runId: string,
    b: DecideProcessRunRequest,
    tenantIdQ?: string,
  ): Promise<ProcessRunView> {
    const req = await this.#req(u);
    const out = await withHubScope(this.d.db, scopeOf(u, tenantIdQ), (tx) =>
      this.#decide(tx, req, runId, b),
    );
    await this.#post(out);
    return this.view.get(u, out.runId, tenantIdQ);
  }

  async #decide(
    tx: Tx,
    req: Req,
    runId: string,
    b: DecideProcessRunRequest,
  ): Promise<Outcome<null>> {
    const { v, groupIds } = req;
    const run = await this.#lockVisible(tx, v, runId);
    const recipients = await core.runRecipients(tx, run.id, run.tenantId);
    // P-b2 D9 · stage cần quyết = `b.stage_idx` hoặc decision mở cũ nhất; không có decision mở ⇒ stage hiện tại (409 ở
    // `transition` như P-a). `b.stage_idx` không có decision mở ⇒ 409.
    const open = await g.openDecisions(tx, run.id, run.tenantId);
    const picked = pickDecisionStage(open, b.stage_idx);
    if (picked === null && (b.stage_idx !== undefined || open.length > 0))
      throw processError("PROCESS_RUN_STATE");
    const idx = picked ?? Number(run.currentStageIdx);
    const def = snapOf(run).stages[idx];
    const reason = (open.find((o) => o.stageIdx === idx)?.reason ??
      (run.decision as { reason?: DecisionReason } | null)?.reason ??
      "interrupted") as DecisionReason;
    const reviewGroup = def?.after.kind === "review" ? def.after.group_id : null;
    const facts = await this.#facts(tx, run, groupIds, v.userId);
    const member = reviewGroup !== null && groupIds.has(reviewGroup);
    if (!canDecide(v, { ...facts, reason, reviewGroupMember: member }))
      throw runAccess(v, facts) ? processError("NOT_PROCESS_DECIDER") : notFound();
    const stage = await stageRowOf(tx, run.id, idx);
    const t = transition(buildState({ run, s: stage, def, idx, reason }), {
      kind: "decide",
      option: b.option,
    });
    if (!t.ok) throw processError(t.code);
    const dtask = await g.openDecisionTask(tx, run.id, run.tenantId, picked ?? undefined);
    const ref = await g.actorRef(tx, v.userId, run.tenantId);
    const e: Eff = { run, idx, next: t.next, effects: t.effects, ref };
    const gx: Gx = { d: this.d, tx };
    const { events, step, cancel, kick } = await decideOut(gx, e, {
      reason,
      option: b.option,
      dtask,
    });
    await refreshDecision(gx, run);
    events.push(...processUpdated(recipients, updatedOf(run, t.next.status, step)));
    const cancelRun = t.next.status === "cancelled" ? { tenantId: run.tenantId } : undefined;
    return { body: null, events, kick, runId: run.id, cancel, cancelRun };
  }

  // ── POST /process-runs/:id/cancel ──
  async cancel(u: AuthUser, runId: string, tenantIdQ?: string): Promise<ProcessRunSummary> {
    const req = await this.#req(u);
    const out = await withHubScope(this.d.db, scopeOf(u, tenantIdQ), (tx) =>
      this.#cancel(tx, req, runId),
    );
    await this.#post(out);
    return out.body;
  }

  async #cancel(tx: Tx, req: Req, runId: string): Promise<Outcome<ProcessRunSummary>> {
    const { v, groupIds } = req;
    const run = await this.#lockVisible(tx, v, runId);
    const recipients = await core.runRecipients(tx, run.id, run.tenantId);
    const facts = await this.#facts(tx, run, groupIds, v.userId);
    if (!canCancel(v, facts))
      throw runAccess(v, facts) ? processError("NOT_PROCESS_DECIDER") : notFound();
    // HUB-FR-111 · huỷ là việc cấp RUN: chỉ 409 khi run đã kết thúc. Không dựng trạng thái từ một stage — bước song song
    // có stage nhỏ nhất `done` trong khi stage khác còn chạy/chờ duyệt (review vòng 1 P-b2).
    if (isTerminal(run.status as ProcessRunStatus)) throw processError("PROCESS_RUN_STATE");
    const idx = Number(run.currentStageIdx);
    const ref = await g.actorRef(tx, v.userId, run.tenantId);
    const events = await cancelEnd({ d: this.d, tx }, { run, idx, ref }, null);
    events.push(...processUpdated(recipients, updatedOf(run, "cancelled", null)));
    const row = await repo.loadSummary(tx, run.tenantId, run.id);
    if (!row) throw notFound();
    const body = repo.toSummary(row);
    return { body, events, kick: false, runId: run.id, cancelRun: { tenantId: run.tenantId } };
  }

  async #lockVisible(tx: Tx, v: Viewer, runId: string): Promise<Locked> {
    const [head] = await tx.execute<{ tenant_id: string }>(
      sql`select tenant_id from hub.process_runs where id = ${runId}`,
    );
    if (!head) throw notFound();
    if (v.role !== "platform_admin" && v.tenantId !== head.tenant_id) throw notFound();
    const run = await core.lockRun(tx, head.tenant_id, runId);
    if (!run) throw notFound();
    return run;
  }

  async #facts(
    tx: Tx,
    run: Locked,
    groupIds: ReadonlySet<string>,
    userId: string,
  ): Promise<RunFacts> {
    const originRoom = await g.originRoomOf(tx, run.originKind, run.originRoomId, userId);
    const myIds = await repo.assigneeTaskIds(tx, {
      runId: run.id,
      tenantId: run.tenantId,
      userId,
      groupIds: [...groupIds],
    });
    return {
      tenantId: run.tenantId,
      startedBy: run.startedBy,
      originRoom,
      taskAssignee: myIds.length > 0,
    };
  }

  async #post(out: Outcome<unknown>): Promise<void> {
    const c = out.cancel;
    const cr = out.cancelRun;
    if (c || cr)
      await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        if (c) await g.cancelRunsByIds(tx, c.tenantId, c);
        if (cr) await g.cancelStageRuns(tx, out.runId, cr.tenantId);
      }).catch((err) =>
        // Đã COMMIT: job muộn bị driver bỏ (`current_run_id` NULL); sweeps dọn `hub.runs` treo.
        this.d.log.warn("process-back-cancel-failed", {
          run_id: out.runId,
          ...safeErrorFields(err),
        }),
      );
    await publishUserEvents(this.d.redis, out.events, this.d.log);
    // T19-perf · đăng tin thread ∥ kick (kết nối riêng): đăng idempotent theo id sự kiện, mỗi poster đi theo `created_at`
    // ⇒ thứ tự tin giữ nguyên; sự kiện người dùng của gate đã phát TRƯỚC (kick có thể phát sự kiện mới hơn).
    await Promise.all([
      this.d.postThread(out.runId).catch(() => {}),
      out.kick ? this.d.launcher.kick(out.runId) : undefined,
    ]);
  }
}
