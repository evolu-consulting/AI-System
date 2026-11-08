// CR-125 · purchase-flow G3 · «A + B cùng duyệt» (`after.parallel` của bước Duyệt) — mở MỘT thẻ duyệt mỗi nhóm cùng lúc và quyết theo
// luật (`all` / `any` / `{min:n}`). Chạy TRONG tx quyết định của cổng kiểm: run đã khoá `FOR UPDATE` (§10) TRƯỚC khi đếm ⇒ hai người
// quyết cùng lúc nối tiếp nhau, người sau thấy lá phiếu đã COMMIT của người trước ⇒ chỉ MỘT lần chuyển bước. Thẻ của mình đóng
// compare-and-set (`core.closeTask` status='open') ⇒ gửi lại / bấm 2 lần ⇒ 409 `REVIEW_TASK_CLOSED`, không ghi gì thêm.
// - Đạt chưa đủ luật ⇒ chỉ đóng thẻ mình (lá phiếu = `review_tasks` result/decided_by — sổ ai quyết gì), bước vẫn chờ.
// - Đạt đủ luật ⇒ đường Đạt thường; thẻ còn mở đóng `superseded` + lý do.
// - Từ chối / Trả lại (bất kỳ nhóm) ⇒ thắng ngay: đóng thẻ còn mở `superseded` + lý do, rồi đường Từ chối / Trả lại thường.
import type { ReviewDecisionRequest, TaskDetail } from "@ai/contracts/chat";
import { type ParallelRule, parallelNeed } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { UserEvent } from "../../../lib/user-stream";
import * as core from "../core/core.repo";
import { processError } from "../core/errors";
import { processUpdated } from "../core/events";
import { loadTaskDetails, type ViewerCtx } from "../core/task-view";
import { type Gx, type Locked, notFound, snapOf, threadResult } from "./gates.effects";
import * as g from "./gates.repo";
import { type ParallelSnap, parallelGroupIds } from "./parallel-open";

/** Lý do đóng thẻ của nhóm khác (hiện ở thẻ / lịch sử). */
export const PARALLEL_CLOSED_BY_DECISION = "Đã có người từ chối/trả lại";
export const PARALLEL_CLOSED_BY_QUORUM = "Đã đủ người duyệt";

/** Luật thuần: lá phiếu này chốt bước chưa. `passedOthers` = số thẻ khác cùng vòng đã Đạt. */
export function parallelVerdict(
  p: { groups: readonly unknown[]; rule: ParallelRule },
  passedOthers: number,
  result: ReviewDecisionRequest["result"],
): "partial" | "final" {
  if (result !== "pass") return "final"; // Từ chối / Trả lại: người đầu tiên thắng
  return passedOthers + 1 >= Math.min(parallelNeed(p), p.groups.length) ? "final" : "partial";
}

/** Số thẻ KHÁC cùng vòng (cùng output) của bước đã Đạt. Một câu; run đã khoá ⇒ đọc bản đã COMMIT. */
async function passedOthers(tx: Tx, taskId: string, tenantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number | string }>(sql`
    select count(*)::int as n from hub.review_tasks o
    join hub.review_tasks t on t.id = ${taskId} and t.tenant_id = o.tenant_id
    where o.tenant_id = ${tenantId} and o.stage_run_id = t.stage_run_id and o.kind = 'review' and o.id <> t.id
      and o.output_id is not distinct from t.output_id and o.status = 'closed' and o.result = 'pass'`);
  return Number(r?.n ?? 0);
}

/** Đóng thẻ còn mở của bước (trừ thẻ mình) `superseded` + lý do; trả sự kiện đóng thẻ. */
async function closeSiblings(gx: Gx, task: g.GateTask, feedback: string): Promise<UserEvent[]> {
  const rows = await gx.tx.execute<{ id: string }>(sql`update hub.review_tasks
    set status = 'closed', result = 'superseded', feedback = ${feedback}, decided_at = ${gx.d.now().toISOString()}::timestamptz
    where stage_run_id = ${task.stage_run_id} and tenant_id = ${task.tenant_id} and kind = 'review'
      and status = 'open' and id <> ${task.id}
    returning id`);
  const ids = [...rows].map((r) => r.id);
  return (await Promise.all(ids.map((id) => gx.d.notifier.taskClosed(gx.tx, id)))).flat();
}

/**
 * Gọi SAU khi khoá run, TRƯỚC khi đóng thẻ mình. Bước thường ⇒ `{partial:false, events:[]}` (không câu SQL nào). Cùng duyệt: Đạt chưa
 * đủ ⇒ `partial` (người gọi chỉ đóng thẻ mình — `partialOut`); chốt ⇒ đóng thẻ nhóm khác ngay (trước đường Đạt/Từ chối thường).
 */
export async function parallelStep(
  gx: Gx,
  p: { run: Locked; idx: number; task: g.GateTask; b: ReviewDecisionRequest },
): Promise<{ partial: boolean; events: UserEvent[] }> {
  const def = snapOf(p.run).stages[p.idx] as ParallelSnap | undefined;
  const par = def?.after?.parallel;
  if (!parallelGroupIds(def) || !par?.groups || !par.rule) return { partial: false, events: [] };
  const rule = { groups: par.groups, rule: par.rule };
  const others = p.b.result === "pass" ? await passedOthers(gx.tx, p.task.id, p.run.tenantId) : 0;
  if (parallelVerdict(rule, others, p.b.result) === "partial") return { partial: true, events: [] };
  const why = p.b.result === "pass" ? PARALLEL_CLOSED_BY_QUORUM : PARALLEL_CLOSED_BY_DECISION;
  return { partial: false, events: await closeSiblings(gx, p.task, why) };
}

/** Đạt chưa đủ luật: đóng thẻ mình (first-wins) + tin `task_result` + sự kiện; bước/run giữ nguyên trạng thái. */
export async function partialOut(
  gx: Gx,
  p: { run: Locked; idx: number; task: g.GateTask; b: ReviewDecisionRequest },
  viewer: ViewerCtx & { recipients: string[] },
): Promise<{ body: TaskDetail; events: UserEvent[]; kick: false; runId: string }> {
  const { run, idx, task, b } = p;
  const at = gx.d.now();
  const [closed, ref] = await Promise.all([
    core.closeTask(gx.tx, task.id, {
      result: "pass",
      at,
      decidedBy: viewer.userId,
      feedback: b.feedback ?? null,
    }),
    g.actorRef(gx.tx, viewer.userId, run.tenantId),
  ]);
  if (!closed) throw processError("REVIEW_TASK_CLOSED");
  const meta = { run, idx, taskId: task.id, kind: "review" as const, result: "pass" as const, ref };
  const [, ev] = await Promise.all([
    threadResult(gx, { ...meta, ...(b.feedback ? { feedback: b.feedback } : {}) }),
    gx.d.notifier.taskClosed(gx.tx, task.id),
  ]);
  const [body] = await loadTaskDetails(gx.tx, viewer, [task.id]);
  if (!body) throw notFound();
  const u = { id: run.id, status: run.status, stageIdx: Number(run.currentStageIdx) };
  const events = [
    ...ev,
    ...processUpdated(viewer.recipients, { ...u, step: Number(run.currentStep) } as never),
  ];
  return { body, events, kick: false, runId: run.id };
}
