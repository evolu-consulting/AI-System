// HUB-FR-107 · HUB-FR-109 · AC-H28 · M5 · §3.1 · §3.4 · §10 · PF1 · cổng kiểm: `POST /review-tasks/:id/decision`
// (Đạt/Chưa đạt), `POST /process-runs/:id/{decide,cancel}`. Khoá `process_runs` FOR UPDATE trước (§10); đóng task
// first-wins (`core.closeTask`); máy trạng thái thuần (`transition`) → hiệu ứng DB (`gates.effects`); phát/đăng +
// `launcher.kick` SAU COMMIT. Scope `user` người thao tác (RLS `room_members` theo tenant); lọc `tenant_id` tường minh.
import type {
  DecideProcessRunRequest,
  DecisionReason,
  ProcessRunSummary,
  ProcessRunView,
  ReviewDecisionRequest,
  TaskDetail,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { transition } from "../core/process-state.rules";
import {
  canCancel,
  canDecide,
  type RunFacts,
  runAccess,
  type Viewer,
} from "../core/run-access.rules";
import { loadTaskDetails } from "../core/task-view";
import * as repo from "../runs/runs.repo";
import { stageRowOf } from "../runs/team-runner";
import { ViewService } from "../runs/view.service";
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
  reviewEffects,
  snapOf,
} from "./gates.effects";
import * as g from "./gates.repo";

/** Người thao tác + nhóm (gộp để ≤ 4 tham số, CONVENTIONS §2). */
type Req = { v: Viewer; groupIds: ReadonlySet<string> };
type Outcome<T> = { body: T; events: UserEvent[]; kick: boolean; runId: string };

/** Scope `user` của người thao tác; platform_admin + `?tenant_id` ⇒ tenant đích (plan §5, như ViewService). */
const scopeOf = (u: AuthUser, tenantIdQ?: string) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId,
});
const vrole = (r: AuthUser["role"]): Viewer["role"] =>
  r === "platform_admin" || r === "tenant_admin" ? r : "member";

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
    if (!task) throw notFound();
    if (v.role !== "platform_admin" && v.tenantId !== task.tenant_id) throw notFound();
    const users = await g.assigneeUserIds(tx, taskId, task.tenant_id);
    const grp = task.assignee_group_id;
    if (!users.has(v.userId) && !(grp !== null && groupIds.has(grp))) throw notFound();
    if (task.kind !== "review") throw processError("TASK_KIND_MISMATCH");
    if (reviewDecisionCheck(b) !== "ok") throw processError("FEEDBACK_REQUIRED");
    const run = await core.lockRun(tx, task.tenant_id, task.process_run_id);
    if (!run) throw notFound();
    const recipients = await core.runRecipients(tx, run.id, run.tenantId);
    const idx = task.stage_idx;
    const s = await stageRowOf(tx, run.id, idx);
    const t = transition(buildState({ run, s, def: snapOf(run).stages[idx], idx, reason: null }), {
      kind: "review",
      result: b.result,
    });
    const closed = await core.closeTask(tx, taskId, {
      result: b.result,
      at: this.d.now(),
      decidedBy: v.userId,
      feedback: b.feedback ?? null,
      sections: b.sections ?? null,
    });
    if (!closed) throw processError("REVIEW_TASK_CLOSED");
    if (!t.ok) throw processError(t.code);
    const ref = await g.actorRef(tx, v.userId, run.tenantId);
    const e: Eff = { run, idx, next: t.next, effects: t.effects, ref };
    const events = await reviewEffects({ d: this.d, tx }, e, task, b);
    events.push(
      ...processUpdated(recipients, {
        id: run.id,
        status: t.next.status,
        stageIdx: t.next.stageIdx,
      }),
    );
    const detail = (await loadTaskDetails(tx, { ...v, groupIds }, [taskId]))[0];
    if (!detail) throw notFound();
    return { body: detail, events, kick: needsKick(t.effects), runId: run.id };
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
    const idx = Number(run.currentStageIdx);
    const def = snapOf(run).stages[idx];
    const reason = ((run.decision as { reason?: DecisionReason } | null)?.reason ??
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
    const dtask = await g.openDecisionTask(tx, run.id, run.tenantId);
    const ref = await g.actorRef(tx, v.userId, run.tenantId);
    const e: Eff = { run, idx, next: t.next, effects: t.effects, ref };
    const events = await decideEffects({ d: this.d, tx }, e, b.option, dtask);
    events.push(
      ...processUpdated(recipients, {
        id: run.id,
        status: t.next.status,
        stageIdx: t.next.stageIdx,
      }),
    );
    return { body: null, events, kick: needsKick(t.effects), runId: run.id };
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
    const idx = Number(run.currentStageIdx);
    const stage = await stageRowOf(tx, run.id, idx);
    const t = transition(
      buildState({ run, s: stage, def: snapOf(run).stages[idx], idx, reason: null }),
      {
        kind: "cancel",
      },
    );
    if (!t.ok) throw processError(t.code);
    const ref = await g.actorRef(tx, v.userId, run.tenantId);
    const gx: Gx = { d: this.d, tx };
    const events = await cancelEnd(gx, { run, idx, ref }, null);
    events.push(
      ...processUpdated(recipients, {
        id: run.id,
        status: t.next.status,
        stageIdx: t.next.stageIdx,
      }),
    );
    const row = await repo.loadSummary(tx, run.tenantId, run.id);
    if (!row) throw notFound();
    return { body: repo.toSummary(row), events, kick: false, runId: run.id };
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
    await publishUserEvents(this.d.redis, out.events, this.d.log);
    await this.d.postThread(out.runId).catch(() => {});
    if (out.kick) await this.d.launcher.kick(out.runId);
  }
}
