// CR-121 · R-1 · điều khiển lượt chạy (quản trị): Dừng · Chạy lại bước · Chạy lại cả lượt. Quyền kiểm ở ĐÂY (vai trước mọi đọc;
// tenant khác ⇒ 404). Mỗi thao tác một tx, khoá `process_runs` FOR UPDATE ĐẦU TIÊN (§10) rồi mới đọc trạng thái ⇒ compare-and-set
// theo (run, trạng thái): bấm 2 lần ⇒ một kết quả. Dừng/chạy lại bước DÙNG LẠI hiệu ứng có sẵn (`cancelEnd`, `applyBack`) — kết quả
// job muộn bị driver bỏ (run kết thúc / `current_run_id` đã đổi). Huỷ `hub.runs` + phát + kick SAU COMMIT như `GateService`.
import type { ProcessRunStatus, ProcessRunSummary, RunControlReason } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { appError, safeErrorFields } from "../../../lib/errors";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import { processUpdated } from "../core/events";
import type { ProcessDeps } from "../core/ports";
import { canRaiseBackLimit } from "../domain/gates/back.rules";
import {
  alreadyStopped,
  type ControlActor,
  canRerunRun,
  canRerunStep,
  canStop,
  type RunControlOp,
  rerunIfTarget,
  rerunStepFeedback,
  rerunStepPackBlocked,
  roleAllows,
} from "../domain/runs/run-control.rules";
import type { StageRunStatus } from "../domain/types";
import { runEndHook } from "../runs/run-end-hooks";
import * as repo from "../runs/runs.repo";
import { stepsOfSnap } from "../runs/step-persist";
import { stageRowOf } from "../runs/team-runner";
import { applyBack, type CancelIds } from "./back.effects";
import { cancelEnd, type Locked, notFound, snapOf } from "./gates.effects";
import * as g from "./gates.repo";
import { auditControl, insertRerun, rerunOf } from "./run-control.repo";

type Actor = ControlActor & { userId: string };
type Out = {
  body: ProcessRunSummary;
  events: UserEvent[];
  runId: string;
  kick: boolean;
  cancel?: CancelIds;
  cancelRun?: { tenantId: string };
};

const actorOf = (u: AuthUser): Actor => ({
  userId: u.userId,
  tenantId: u.tenantId,
  role: u.role === "platform_admin" || u.role === "tenant_admin" ? u.role : "member",
});
/** Như `GateService`: platform_admin + `?tenant_id` ⇒ tenant đích. */
const scopeOf = (u: AuthUser, tq?: string) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.role === "platform_admin" && tq ? tq : u.tenantId,
});
function assertRole(op: RunControlOp, a: Actor): void {
  if (!roleAllows(op, a.role)) throw appError("FORBIDDEN");
}

/** Khoá run (§10, câu đầu có khoá); tenant khác (trừ platform_admin) ⇒ 404 không lộ tồn tại. */
async function lockVisible(tx: Tx, a: Actor, runId: string): Promise<Locked> {
  const [head] = await tx.execute<{ tenant_id: string }>(
    sql`select tenant_id from hub.process_runs where id = ${runId}`,
  );
  if (!head) throw notFound();
  if (a.role !== "platform_admin" && a.tenantId !== head.tenant_id) throw notFound();
  const run = await core.lockRun(tx, head.tenant_id, runId);
  if (!run) throw notFound();
  return run;
}

async function summaryOf(tx: Tx, tenantId: string, runId: string): Promise<ProcessRunSummary> {
  const row = await repo.loadSummary(tx, tenantId, runId);
  if (!row) throw notFound();
  return repo.toSummary(row);
}

export class RunControlService {
  constructor(private readonly d: ProcessDeps) {}

  // ── POST /process-runs/:id/stop ──
  async stop(u: AuthUser, runId: string, reason: RunControlReason, tq?: string) {
    const a = actorOf(u);
    assertRole("stop", a);
    const out = await withHubScope(this.d.db, scopeOf(u, tq), async (tx): Promise<Out> => {
      const run = await lockVisible(tx, a, runId);
      const status = run.status as ProcessRunStatus;
      // Đã dừng (lần bấm trước / người khác) ⇒ cùng kết quả, không ghi thêm.
      if (alreadyStopped(status))
        return { body: await summaryOf(tx, run.tenantId, run.id), events: [], runId, kick: false };
      if (!canStop(status)) throw processError("PROCESS_RUN_STATE");
      const recipients = await core.runRecipients(tx, run.id, run.tenantId);
      const idx = Number(run.currentStageIdx);
      const ref = await g.actorRef(tx, a.userId, run.tenantId);
      // Đóng task mở (người chờ không còn thấy việc), huỷ hẹn, stage + run ⇒ cancelled, run_end + notifier.
      const events = await cancelEnd({ d: this.d, tx }, { run, idx, ref }, null);
      // CR-127 K3 · #7b · lượt gắn bản ghi app (vd HĐ đang duyệt) ⇒ app đưa bản ghi về nháp, cùng tx (CAS theo run, không ném).
      await runEndHook(tx, "cancelled", run, `cancelled:${reason}`);
      const stepNow = Number(run.currentStep);
      events.push(
        ...processUpdated(recipients, {
          id: run.id,
          status: "cancelled",
          stageIdx: idx,
          step: stepNow,
        }),
      );
      await auditControl(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorId: a.userId,
        actorRole: a.role,
        op: "stop",
        summary: { reason, from_status: status, stage_idx: idx },
      });
      const body = await summaryOf(tx, run.tenantId, run.id);
      return { body, events, runId: run.id, kick: false, cancelRun: { tenantId: run.tenantId } };
    });
    await this.#post(out);
    return out.body;
  }

  // ── POST /process-runs/:id/rerun-step (chỉ platform_admin) ──
  async rerunStep(
    u: AuthUser,
    runId: string,
    b: { reason: RunControlReason; stage_idx: number },
    tq?: string,
  ) {
    const a = actorOf(u);
    assertRole("rerun_step", a);
    const out = await withHubScope(this.d.db, scopeOf(u, tq), async (tx): Promise<Out> => {
      const run = await lockVisible(tx, a, runId);
      const idx = b.stage_idx;
      const steps = stepsOfSnap(snapOf(run));
      const target = steps[idx];
      if (target === undefined) throw processError("PROCESS_RUN_STATE");
      const s = await stageRowOf(tx, run.id, idx);
      const st = (s?.status ?? null) as StageRunStatus | null;
      // CAS theo trạng thái SAU khoá: lần bấm thứ hai thấy stage đã `queued` ⇒ 409, không chạy lại hai lần.
      const packBound = run.packKey != null;
      if (rerunStepPackBlocked(run.status as ProcessRunStatus, packBound))
        throw processError("PROCESS_RUN_STATE", { pack_bound: true });
      if (!canRerunStep(run.status as ProcessRunStatus, st, packBound))
        throw processError("PROCESS_RUN_STATE");
      if (!canRaiseBackLimit(Number(run.backLimit))) throw processError("PROCESS_RUN_STATE");
      const recipients = await core.runRecipients(tx, run.id, run.tenantId);
      // Không tiêu "số lần quay lại" của người duyệt: nâng trần cùng lúc tăng vòng (raiseLimit). Kết quả cũ giữ (output theo version).
      const { step, cancel } = await applyBack(
        { d: this.d, tx },
        {
          run,
          fromIdx: idx,
          target,
          feedback: rerunStepFeedback(b.reason),
          decidedBy: a.userId,
          taskId: null,
          raiseLimit: true,
          backEvent: false,
        },
      );
      await auditControl(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorId: a.userId,
        actorRole: a.role,
        op: "rerun_step",
        summary: {
          reason: b.reason,
          stage_idx: idx,
          step: target,
          from_status: run.status,
          stage_status: st,
        },
      });
      const events = processUpdated(recipients, {
        id: run.id,
        status: step.status,
        stageIdx: step.stageIdx,
        step: step.step,
      });
      const body = await summaryOf(tx, run.tenantId, run.id);
      return { body, events, runId: run.id, kick: true, cancel };
    });
    await this.#post(out);
    return out.body;
  }

  // ── CR-122 E2b · POST /process-runs/:id/rerun-from-if (quản trị công ty) — chạy lại từ node Nếu sau "dữ kiện đổi" ──
  async rerunFromIf(u: AuthUser, runId: string, reason: RunControlReason, tq?: string) {
    const a = actorOf(u);
    assertRole("rerun_if", a);
    const out = await withHubScope(this.d.db, scopeOf(u, tq), async (tx): Promise<Out> => {
      const run = await lockVisible(tx, a, runId);
      const [r] = await tx.execute<{ decision: unknown }>(sql`select decision from hub.process_runs
        where id = ${run.id} and tenant_id = ${run.tenantId}`);
      const stages = (snapOf(run).stages ?? []) as { executor?: { kind?: string } }[];
      const ifIdx = rerunIfTarget(
        run.status as ProcessRunStatus,
        r?.decision,
        stages.map((s) => s?.executor?.kind),
      );
      // CAS sau khoá: lần bấm thứ hai thấy run đã `running` + decision null ⇒ 409, không chạy lại hai lần.
      if (ifIdx === null) throw processError("PROCESS_RUN_STATE");
      const target = stepsOfSnap(snapOf(run))[ifIdx] as number;
      const recipients = await core.runRecipients(tx, run.id, run.tenantId);
      // Đặt lại từ bước Nếu (Nếu đọc lại dữ kiện HIỆN TẠI khi chạy); không tiêu số lần quay lại của người duyệt.
      const { step, cancel } = await applyBack(
        { d: this.d, tx },
        {
          run,
          fromIdx: Number(run.currentStageIdx),
          target,
          feedback: rerunStepFeedback(reason),
          decidedBy: a.userId,
          taskId: null,
          raiseLimit: true,
          backEvent: false,
        },
      );
      await auditControl(tx, {
        tenantId: run.tenantId,
        runId: run.id,
        actorId: a.userId,
        actorRole: a.role,
        op: "rerun_if",
        summary: { reason, stage_idx: ifIdx, step: target, from_status: run.status },
      });
      const events = processUpdated(recipients, {
        id: run.id,
        status: step.status,
        stageIdx: step.stageIdx,
        step: step.step,
      });
      const body = await summaryOf(tx, run.tenantId, run.id);
      return { body, events, runId: run.id, kick: true, cancel };
    });
    await this.#post(out);
    return out.body;
  }

  // ── POST /process-runs/:id/rerun ⇒ { created, body } (lần bấm lại ⇒ created=false, cùng run mới) ──
  async rerun(u: AuthUser, runId: string, reason: RunControlReason) {
    const a = actorOf(u);
    assertRole("rerun", a);
    // Tenant lấy từ chính run (không cần `?tenant_id`). Scope system: hội thoại nền/flow của run mới thuộc NGƯỜI BẮT ĐẦU (RLS theo user) ⇒ không ghi được dưới scope admin.
    // Quyền + tenant đã kiểm ở `assertRole`/`lockVisible` (lọc `tenant_id` tường minh ở mọi câu).
    const out = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const run = await lockVisible(tx, a, runId);
      const prev = await rerunOf(tx, run.tenantId, run.id);
      if (prev) return { created: false, body: await summaryOf(tx, run.tenantId, prev), id: prev };
      if (!canRerunRun(run.status as ProcessRunStatus, run.packKey != null))
        throw processError(
          "PROCESS_RUN_STATE",
          run.packKey != null ? { pack_bound: true } : undefined,
        );
      const id = crypto.randomUUID();
      await insertRerun(tx, {
        id,
        convId: crypto.randomUUID(),
        flowId: crypto.randomUUID(),
        tenantId: run.tenantId,
        oldId: run.id,
        steps: stepsOfSnap(snapOf(run)),
        actorId: a.userId,
        actorRole: a.role,
        summary: { reason },
        now: this.d.now(),
      });
      return { created: true, body: await summaryOf(tx, run.tenantId, id), id };
    });
    if (out.created)
      await this.d.launcher
        .kick(out.id)
        .catch(() => this.d.log.warn("process-kick-failed", { run_id: out.id }));
    return { created: out.created, body: out.body };
  }

  async #post(out: Out): Promise<void> {
    const { cancel: c, cancelRun: cr } = out;
    if (c || cr)
      await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
        if (c) await g.cancelRunsByIds(tx, c.tenantId, c);
        if (cr) await g.cancelStageRuns(tx, out.runId, cr.tenantId);
      }).catch((err) =>
        // Đã COMMIT: job muộn bị driver bỏ (run kết thúc / `current_run_id` đổi); sweeps dọn `hub.runs` treo.
        this.d.log.warn("process-control-cancel-failed", {
          run_id: out.runId,
          ...safeErrorFields(err),
        }),
      );
    await publishUserEvents(this.d.redis, out.events, this.d.log);
    await Promise.all([
      this.d.postThread(out.runId).catch(() => {}),
      out.kick ? this.d.launcher.kick(out.runId) : undefined,
    ]);
  }
}
