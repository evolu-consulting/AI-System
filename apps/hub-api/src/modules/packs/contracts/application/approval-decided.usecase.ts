// [AUDIT] · «Ai duyệt làm gì đều phải có record»: quyết bước duyệt HĐ đi đường chung `POST /review-tasks/:id/decision` (Việc của tôi,
// chuông) không qua thẻ HĐ ⇒ engine báo `onDecided.contracts` SAU COMMIT ⇒ ghi `stage_decided` bằng CÙNG hàm repo của thẻ
// (`recordDecision`, idempotent theo task). Scope system của tenant (người quyết có thể không đọc được HĐ sau khi task đóng).
import type { PackDecided, PackDecidedTask, PackTaskEvent } from "../../kit/public";
import type { TaskEventsRepo } from "../adapters/task-events.repo";
import type { DecisionRunRef } from "./approval.ports";
import type { ApprovalEnginePort, ApprovalEngineTxRepos } from "./approval-engine.ports";

type SystemUow = {
  system<T>(
    tenantId: string,
    fn: (r: Pick<ApprovalEngineTxRepos, "approvalEngine">) => Promise<T>,
  ): Promise<T>;
};

const ACTION = { pass: "approve", fail: "return", reject: "reject" } as const;

/** Một quyết định đã COMMIT ở engine ⇒ một dòng lịch sử HĐ (run không thuộc HĐ nào của tenant ⇒ bỏ qua). Ném khi ghi lỗi (engine log). */
export function recordEngineDecision(uow: SystemUow) {
  return (e: PackDecided): Promise<void> =>
    uow.system(e.tenantId, async (r) => {
      const run = await r.approvalEngine.byRun(e.runId, { lock: false });
      if (!run) return;
      // [AUDIT] · Toàn quyền duyệt thay qua đường chung ⇒ cùng bản ghi `approval_override` như thẻ (idempotent lượt × task × người).
      if (e.override)
        await r.approvalEngine.recordOverride?.(run.contractId, run.approvalId, {
          runId: e.runId,
          taskId: e.taskId,
          stageKey: e.stageKey,
          action: ACTION[e.result],
          actor: e.actor,
        });
      await r.approvalEngine.recordDecision?.(run.contractId, run.approvalId, {
        taskId: e.taskId,
        stageKey: e.stageKey,
        action: ACTION[e.result],
        feedback: e.feedback,
        actor: e.actor,
        evidenceId: e.evidenceId,
        onBehalfOf: e.onBehalfOf ?? null,
      });
    });
}

/** [AUDIT] · nhận / trả / giao lại / tự trả / chuyển cấp (đã COMMIT ở engine) ⇒ `task_handled`, MỘT câu mỗi tenant của lô. */
export function recordTaskEvents(uow: {
  system<T>(tenantId: string, fn: (r: { taskEvents: TaskEventsRepo }) => Promise<T>): Promise<T>;
}) {
  return async (rows: PackTaskEvent[]): Promise<void> => {
    const byTenant = new Map<string, PackTaskEvent[]>();
    for (const x of rows) byTenant.set(x.tenantId, [...(byTenant.get(x.tenantId) ?? []), x]);
    for (const [t, list] of byTenant) await uow.system(t, (r) => r.taskEvents.record(list));
  };
}

type BackfillUow = {
  system<T>(
    tenantId: string,
    fn: (r: {
      sweep: { decisionRuns?(limit: number): Promise<DecisionRunRef[]> };
      approvalEngine?: Pick<ApprovalEngineTxRepos["approvalEngine"], "recordDecisions">;
    }) => Promise<T>,
  ): Promise<T>;
};

/** [AUDIT] · đường bù (vòng quét duyệt HĐ): task đã quyết ở engine mà HĐ chưa có `stage_decided` (ghi sau COMMIT bị lỗi / sập giữa
 *  chừng) ⇒ ghi bù bằng CÙNG `recordDecision`, giữ lúc quyết thật; idempotent theo task. 1 câu gói + 1 câu engine + 1 câu chèn theo tập. */
export async function backfillDecisions(
  d: { uow: BackfillUow; port: Pick<ApprovalEnginePort, "decidedTasksOf"> | undefined },
  tenantId: string,
  limit: number,
): Promise<number> {
  if (!d.port?.decidedTasksOf) return 0;
  const runs = await d.uow.system(
    tenantId,
    async (r) => (await r.sweep.decisionRuns?.(limit)) ?? [],
  );
  if (runs.length === 0) return 0;
  const byRun = new Map(runs.map((x) => [x.runId, x]));
  const tasks = await d.port.decidedTasksOf(tenantId, [...byRun.keys()]);
  const missing = tasks.flatMap((k: PackDecidedTask) => {
    const run = byRun.get(k.runId);
    return run && !run.have.includes(k.taskId) ? [{ run, k }] : [];
  });
  if (missing.length === 0) return 0;
  const items = missing.map(({ run, k }) => ({
    contractId: run.contractId,
    approvalId: run.approvalId,
    taskId: k.taskId,
    stageKey: k.stageKey,
    action: ACTION[k.result],
    feedback: k.feedback,
    actor: k.actor,
    evidenceId: k.evidenceId,
    at: k.at,
  }));
  await d.uow.system(tenantId, async (r) => r.approvalEngine?.recordDecisions?.(items)); // MỘT câu cho cả lô
  return missing.length;
}
