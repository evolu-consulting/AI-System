// HUB-FR-107 · tách từ gates.service.ts (CR-127 R1 #3): bước phụ thuần của cổng kiểm (quyết, quyền quyết, claim).
import type {
  DecideProcessRunRequest,
  DecisionReason,
  ProcessRunStatus,
  ReviewDecisionRequest,
} from "@ai/contracts/chat";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { UserEvent } from "../../../lib/user-stream";
import { claimError, processError } from "../core/errors";
import type { Viewer } from "../domain/runs/run-access.rules";
import { pickDecisionStage } from "../domain/runs/step.rules";
import { claimBlocks, type TaskNeed } from "../domain/tasks/claim.rules";
import { decisionOptionsFor } from "../domain/tasks/decision.rules";
import type { StepOutcome } from "../runs/step-persist";
import { stageRowOf } from "../runs/team-runner";
import { type BackOut, backFromDecision, type CancelIds } from "./back.effects";
import { reviewDecisionCheck } from "./gate.rules";
import {
  decideEffects,
  type Eff,
  type Gx,
  type Locked,
  needsKick,
  notFound,
  snapOf,
} from "./gates.effects";
import * as g from "./gates.repo";

export async function decideOut(
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
export async function refreshDecision(gx: Gx, run: Locked): Promise<void> {
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
export type Req = { v: Viewer; groupIds: ReadonlySet<string> };
export type Outcome<T> = {
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
export const scopeOf = (u: AuthUser, tenantIdQ?: string) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId,
});
/** `process.updated` sau ghi: theo `step-persist` (bước/trạng thái tổng hợp); null ⇒ trạng thái máy + stage hiện tại. */
export const updatedOf = (run: Locked, status: ProcessRunStatus, step: StepOutcome | null) =>
  step
    ? { id: run.id, status: step.status, stageIdx: step.stageIdx, step: step.step }
    : { id: run.id, status, stageIdx: Number(run.currentStageIdx), step: Number(run.currentStep) };
export const vrole = (r: AuthUser["role"]): Viewer["role"] =>
  r === "platform_admin" || r === "tenant_admin" ? r : "member";

export type LoadedTask = Awaited<ReturnType<typeof g.loadTask>>;
export const PASS: ReviewDecisionRequest = { result: "pass" };

/** Task phải có, cùng tenant (trừ platform_admin), người quyết thuộc Group duyệt/chuyển cấp, đúng loại, phản hồi hợp lệ. */
export function assertMayDecide(
  task: LoadedTask,
  { v, groupIds }: Req,
  b: ReviewDecisionRequest,
): asserts task is NonNullable<LoadedTask> {
  if (!task) throw notFound();
  if (v.role !== "platform_admin" && v.tenantId !== task.tenant_id) throw notFound();
  const users = new Set(task.user_ids ?? []);
  const inGroup = (id: string | null) => id !== null && groupIds.has(id);
  // PD-R21 · thành viên Group duyệt HOẶC Group chuyển cấp đều quyết được (người đầu tiên khoá).
  // contract-flow S1b · trưởng phòng (có thể ngoài `group_members`) qua cửa sơ bộ; `assertHeadGate` chốt sau khi khoá run.
  const head = task.group_head != null && task.group_head === v.userId;
  // prod-fix2 · Group "cũng quyết" của stage (vd "Toàn quyền" của gói) như Group chuyển cấp.
  const also = (task.also_group_ids ?? []).some(inGroup);
  if (!users.has(v.userId) && !inGroup(task.assignee_group_id) && !inGroup(task.escalated_group_id))
    if (!head && !also) throw notFound();
  if (task.kind !== "review") throw processError("TASK_KIND_MISMATCH");
  if (reviewDecisionCheck(b) !== "ok") throw processError("FEEDBACK_REQUIRED");
  assertNotClaimedByOther(task, v.userId);
}

/** CR-127 · E4 · chế độ bằng chứng của bước (`after.evidence` trong snapshot chụp lúc mở run; vắng ⇒ chỉ ý kiến). */
export function evidenceModeOf(run: Locked, idx: number): "opinion" | "opinion_plus" | null {
  const after = snapOf(run).stages[idx]?.after as { evidence?: string } | undefined;
  if (after?.evidence === "opinion_plus") return "opinion_plus";
  return after?.evidence === "opinion" ? "opinion" : null;
}

/** CR-127 · E2 · spec §5.1 · việc nhóm `need='one'` đã có người khác nhận ⇒ 409 `TASK_CLAIMED{by}` ("X vừa nhận việc này"). */
export function assertNotClaimedByOther(
  t: { need?: string; claimed_by?: string | null; claimer_name?: string | null },
  userId: string,
): void {
  if (!claimBlocks({ need: (t.need ?? "one") as TaskNeed, claimedBy: t.claimed_by }, userId))
    return;
  const by = t.claimed_by as string;
  throw claimError("TASK_CLAIMED", { by: { id: by, display_name: t.claimer_name || by } });
}
