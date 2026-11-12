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
import type { FormSubmitRequest } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { claimError, processError } from "../core/errors";
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
import * as repo from "../runs/runs.repo";
import { stageRowOf } from "../runs/team-runner";
import { ViewService } from "../runs/view.service";
import { allPartialOut, allVoteStep } from "./all-vote";
import { approveDecide } from "./approve-out";
import { type FormSubmit, formPre, formReplayCheck } from "./form-out";
import { evidenceCheck } from "./gate.rules";
import { recordTaskEvidence } from "./gate-task.repo";
import {
  buildState,
  cancelEnd,
  type Eff,
  type Gx,
  type Locked,
  notFound,
  snapOf,
} from "./gates.effects";
import {
  assertMayDecide,
  assertNotClaimedByOther,
  decideOut,
  evidenceModeOf,
  type Outcome,
  PASS,
  type Req,
  refreshDecision,
  scopeOf,
  updatedOf,
  vrole,
} from "./gates.helpers";
import * as g from "./gates.repo";
import { assertHeadGate, reviewGroupMember } from "./head-gate.check";
import { parallelStep, partialOut } from "./parallel-approve";
import { assertDecisionAllowed, assertReviewAllowed, cancelRunOf, reviewOut } from "./review-out";
// HUB-FR-107 · HUB-FR-109 · AC-H28 · M5 · §3.1 · §3.4 · §10 · PF1 · cổng kiểm: `POST /review-tasks/:id/decision`
// (Đạt/Chưa đạt), `POST /process-runs/:id/{decide,cancel}`. Khoá `process_runs` FOR UPDATE trước (§10); đóng task
// first-wins (`core.closeTask`); máy trạng thái thuần (`transition`) → hiệu ứng DB (`gates.effects`); phát/đăng +
// `launcher.kick` SAU COMMIT. Scope `user` người thao tác (RLS `room_members` theo tenant); lọc `tenant_id` tường minh.

/** P-b2 D8 · decision `back_limit` + `add_attempt` ⇒ `back.effects` (nâng trần rồi quay lại); còn lại như P-a. */

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
    hooks?: { onEvidence?: (evidenceId: string) => void },
  ): Promise<TaskDetail> {
    const req = await this.#req(u);
    const out = await withHubScope(this.d.db, scopeOf(u, tenantIdQ), (tx) =>
      this.#review(tx, req, taskId, b, undefined, hooks?.onEvidence),
    );
    await this.#post(out);
    return out.body;
  }

  // ── CR-118 · POST /review-tasks/:id/form (node `form`): Đạt kèm giá trị form trong CÙNG tx; gửi lại cùng giá trị ⇒ 200.
  // Khoá run TRƯỚC khi đọc trạng thái task: hai lần gửi đồng thời ⇒ lần sau thấy task đã đóng ⇒ nhánh gửi lại. ──
  async formSubmit(u: AuthUser, taskId: string, b: FormSubmitRequest, tq?: string) {
    const req = await this.#req(u);
    const form = { values: b.values, external: u.userKind === "external" };
    const out = await withHubScope(this.d.db, scopeOf(u, tq), async (tx) => {
      const t0 = await g.loadTask(tx, taskId);
      assertMayDecide(t0, req, PASS);
      const run = await core.lockRun(tx, t0.tenant_id, t0.process_run_id);
      if (!run) throw notFound();
      const task = await g.loadTask(tx, taskId);
      if (task?.status !== "closed") return this.#review(tx, req, taskId, PASS, form);
      await formReplayCheck(tx, { run, idx: task.stage_idx, taskId, form });
      const [body] = await loadTaskDetails(tx, { ...req.v, groupIds: req.groupIds }, [taskId]);
      if (!body) throw notFound();
      return { body, events: [], kick: false, runId: run.id } satisfies Outcome<TaskDetail>;
    });
    await this.#post(out);
    return out.body;
  }

  async #review(
    tx: Tx,
    req: Req,
    taskId: string,
    b: ReviewDecisionRequest,
    form?: FormSubmit,
    onEvidence?: (evidenceId: string) => void,
  ): Promise<Outcome<TaskDetail>> {
    const { v, groupIds } = req;
    const task = await g.loadTask(tx, taskId);
    assertMayDecide(task, req, b);
    const idx = task.stage_idx;
    // T19-perf · khoá run (§10, câu ĐẦU) + 2 câu đọc gửi liền (cùng kết nối ⇒ đọc SAU khi giữ khoá). Run không thấy ⇒ 404.
    const [run, recipients, s] = await Promise.all([
      core.lockRun(tx, task.tenant_id, task.process_run_id),
      core.runRecipients(tx, task.process_run_id, task.tenant_id),
      stageRowOf(tx, task.process_run_id, idx),
    ]);
    assertHeadGate(run, idx, task, req); // run không thấy ⇒ 404 · S1b · head_only (snapshot đã khoá)
    assertReviewAllowed(run, idx, v.userId, b); // N2-FR-05 403 · P-b2 422 BACK_TARGET_INVALID — trước khi đóng task
    // CR-127 · E4 · bước bật "Ý kiến + chữ ký hoặc tệp" ⇒ Duyệt thiếu bằng chứng = 422 TRƯỚC khi đóng task (không ghi gì). Form: bỏ qua.
    if (
      !form &&
      evidenceCheck({ result: b.result, mode: evidenceModeOf(run, idx), evidence: b.evidence }) !==
        "ok"
    )
      throw claimError("EVIDENCE_REQUIRED");
    const gx: Gx = { d: this.d, tx };
    // CR-127 · E5 · "Cần: tất cả": ghi phiếu (+ bằng chứng của phiếu); chưa đủ n ⇒ thẻ vẫn mở.
    const vote = await allVoteStep(
      gx,
      { run, task, b },
      { userId: v.userId, groupIds },
      onEvidence,
    );
    if (vote.mode === "partial")
      return allPartialOut(gx, run, taskId, { ...v, groupIds, recipients });
    const par = await parallelStep(gx, { run, idx, task, b }); // CR-125 · cùng duyệt (run đã khoá)
    if (par.partial) return partialOut(gx, { run, idx, task, b }, { ...v, groupIds, recipients });
    const pre = { run, idx, outputId: s?.current_output_id ?? null, taskId, v, form };
    const answer = await formPre(tx, pre); // CR-118 · stage form chỉ quyết qua gửi form (ghi output cùng tx)
    const def = snapOf(run).stages[idx];
    const eb = await approveDecide(tx, { ...pre, tenantId: run.tenantId, def: def as never }, b); // CR-122 E2b
    const t = transition(buildState({ run, s, def, idx, reason: null }), {
      kind: "review",
      result: eb.result,
    });
    const [closed, ref] = await Promise.all([
      core.closeTask(tx, taskId, {
        result: b.result,
        at: this.d.now(),
        decidedBy: v.userId,
        // BR-26: `feedback` chỉ là lý do người dùng nhập; ý kiến của bằng chứng KHÔNG chép vào đây (sẽ lộ qua lịch sử run).
        feedback: b.feedback ?? null,
        sections: b.sections ?? null,
        answer,
      }),
      g.actorRef(tx, v.userId, run.tenantId), // đọc tên người quyết — gửi liền sau UPDATE (pipeline)
    ]);
    if (!closed) {
      // CR-127 · E2 · đua với Nhận việc (câu nhận không khoá run): `closeTask` chặn khi người khác vừa nhận ⇒ báo đúng lý do.
      const now = await g.loadTask(tx, taskId);
      if (now?.status === "open") assertNotClaimedByOther(now, v.userId);
      throw processError("REVIEW_TASK_CLOSED");
    }
    if (!t.ok) throw processError(t.code);
    // CR-127 · E4 · bằng chứng CÙNG tx đóng task (rollback chung nếu lỗi); ý kiến Trả lại/Từ chối vẫn ở `feedback` như cũ.
    // E5 · phiếu "Cần: tất cả" đã ghi bằng chứng của phiếu ⇒ không ghi lần hai.
    const ev = vote.evidenceId ? null : b.evidence;
    if (ev) {
      const evId = await recordTaskEvidence(tx, {
        tenantId: run.tenantId,
        taskId,
        userId: v.userId,
        evidence: ev,
      });
      onEvidence?.(evId); // (không gọi `?.(await …)`: tham số không được đánh giá khi hook vắng)
    }
    const e: Eff = { run, idx, next: t.next, effects: t.effects, ref };
    const { events, step, status, kick, cancel } = await reviewOut(gx, e, task, eb);
    // D9 · decision mở cũ nhất ∥ đọc thẻ task trả về: độc lập (`process_runs.decision` không thuộc `TaskDetail`) ⇒ pipeline.
    const [, details] = await Promise.all([
      refreshDecision(gx, run),
      loadTaskDetails(tx, { ...v, groupIds }, [taskId]),
    ]);
    events.push(...par.events, ...processUpdated(recipients, updatedOf(run, status, step)));
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
    const facts = await this.#facts(tx, run, groupIds, v.userId);
    const member = await reviewGroupMember(tx, run, def?.after, req);
    if (!canDecide(v, { ...facts, reason, reviewGroupMember: member }))
      throw runAccess(v, facts) ? processError("NOT_PROCESS_DECIDER") : notFound();
    assertDecisionAllowed(run, idx, v.userId, { reason, option: b.option }); // N2-D06 · D3-07 · 403 trước khi ghi
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
      packBound: run.packKey != null, // fix-review · run gắn gói chỉ gói huỷ
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
