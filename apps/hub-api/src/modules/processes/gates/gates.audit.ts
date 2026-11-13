// [AUDIT] · «Ai duyệt làm gì đều phải có record» + «duyệt hợp lệ thì giữ»: việc SAU COMMIT của một quyết định task duyệt.
// - Bước kế khởi động lỗi KHÔNG trả lỗi cho người bấm (trước đây ⇒ UI «báo lỗi mà vẫn duyệt», thẻ gói nhả chỗ SP + bỏ ghi lịch sử):
//   log có mã + lượt ⇒ «Cần xử lý» `start_failed` (thẻ riêng, nói lý do; Thử lại / Huỷ).
// - Run gắn gói, quyết đi đường chung ⇒ báo gói ghi lịch sử (lỗi ⇒ cảnh báo; vòng quét gói ghi bù theo task).
import type { ReviewDecisionRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import type { PackDecidedEvent, ProcessDeps } from "../core/ports";
import { delegatedLive } from "../core/task-grants.sql";
import { kickOrFlag } from "../runs/kick-failure";
import { recordTaskEvidence } from "./gate-task.repo";
import { snapOf } from "./gates.effects";
import type { Outcome } from "./gates.helpers";
import * as g from "./gates.repo";

/** Sau COMMIT: huỷ `hub.runs` bị quay lại/huỷ · phát sự kiện · đăng thread ∥ kick bước kế. Không ném. */
export async function postCommit(d: ProcessDeps, out: Outcome<unknown>): Promise<void> {
  const c = out.cancel;
  const cr = out.cancelRun;
  if (c || cr)
    await withHubScope(d.db, { kind: "system" }, async (tx) => {
      if (c) await g.cancelRunsByIds(tx, c.tenantId, c);
      if (cr) await g.cancelStageRuns(tx, out.runId, cr.tenantId);
    }).catch((err) =>
      // Đã COMMIT: job muộn bị driver bỏ (`current_run_id` NULL); sweeps dọn `hub.runs` treo.
      d.log.warn("process-back-cancel-failed", { run_id: out.runId, ...safeErrorFields(err) }),
    );
  await publishUserEvents(d.redis, out.events, d.log);
  // T19-perf · đăng tin thread ∥ kick (kết nối riêng): đăng idempotent theo id sự kiện; sự kiện của gate đã phát TRƯỚC.
  await Promise.all([
    d.postThread(out.runId).catch(() => {}),
    out.kick
      ? kickOrFlag(d, (id) => d.launcher.kick(id), out.runId, { afterDecision: true })
      : undefined,
  ]);
}

/** Đường chung (không qua thẻ gói) trên run gắn gói ⇒ gói ghi lịch sử bằng CÙNG hàm của thẻ. Không ném. */
export async function notifyPack(d: ProcessDeps, out: Outcome<unknown>): Promise<void> {
  if (!out.decided || !d.packDecided) return;
  await d
    .packDecided(out.decided)
    .catch((err: unknown) =>
      d.log.warn("process-pack-decided-failed", { run_id: out.runId, ...safeErrorFields(err) }),
    );
}

/** CR-127 · E4 · bằng chứng CÙNG tx đóng task; phiếu "Cần: tất cả" đã ghi (`voteEv`) ⇒ không ghi lần hai. Trả id bằng chứng. */
export async function taskEvidence(
  tx: Tx,
  a: { tenantId: string; taskId: string; userId: string; b: ReviewDecisionRequest },
  voteEv: string | null | undefined,
  onEvidence?: (evidenceId: string) => void,
): Promise<string | null> {
  if (voteEv) return voteEv;
  if (!a.b.evidence) return null;
  const id = await recordTaskEvidence(tx, { ...a, evidence: a.b.evidence });
  onEvidence?.(id);
  return id;
}

/** Sự kiện «đã quyết» cho gói của run (undefined nếu run không gắn gói). */
export function decidedOf(
  run: { tenantId: string; id: string; packKey?: string | null },
  idx: number,
  taskId: string,
  o: {
    b: ReviewDecisionRequest;
    userId: string;
    evidenceId: string | null;
    override?: boolean;
    onBehalfOf?: string | null;
  },
): PackDecidedEvent | undefined {
  if (!run.packKey) return undefined;
  const def = snapOf(run as never).stages[idx] as { key?: string } | undefined;
  const fb = o.b.feedback?.trim() ?? "";
  return {
    tenantId: run.tenantId,
    packKey: run.packKey,
    runId: run.id,
    taskId,
    stageKey: def?.key ?? "",
    result: o.b.result as PackDecidedEvent["result"],
    feedback: fb ? fb.slice(0, 1000) : null,
    actor: o.userId,
    evidenceId: o.evidenceId,
    ...(o.override ? { override: true } : {}),
    ...(o.onBehalfOf ? { onBehalfOf: o.onBehalfOf } : {}),
  };
}

/** [AUDIT] · người quyết đang làm THAY ai (hàng uỷ quyền `via='delegated'` còn hiệu lực của task — cùng luật `recordTaskEvidence`). 1 câu. */
export async function delegatorOf(
  tx: Tx,
  tenantId: string,
  taskId: string,
  userId: string,
): Promise<string | null> {
  const [r] = await tx.execute<{ id: string | null }>(sql`select d.on_behalf_of::text as id
    from hub.review_task_assignees d where d.tenant_id = ${tenantId}::uuid and d.task_id = ${taskId}::uuid
      and d.user_id = ${userId}::uuid and d.via = 'delegated' and d.on_behalf_of is not null and ${delegatedLive("d")}
    limit 1`);
  return r?.id ?? null;
}
