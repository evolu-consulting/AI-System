// CR-125 · «Quy trình con» — huỷ lượt cha ⇒ huỷ mọi lượt con còn chạy (và cháu, đệ quy ≤ `SUBPROCESS_DEPTH_MAX`) TRONG tx huỷ cha. Thứ tự
// khoá cha → con (cha đã khoá FOR UPDATE; con khoá theo id). Cùng hiệu ứng như `cancelEnd` của lượt thường: huỷ `hub.runs`, đóng stage +
// hẹn + task, lượt `cancelled`, thread `run_end` + thông báo. Stage cha đã `cancelled` trước ⇒ trigger 0129 không ghi hẹn cho cha.
import { SUBPROCESS_DEPTH_MAX } from "@ai/contracts/hub-admin";
import type { UserEvent } from "../../../lib/user-stream";
import { bindTx } from "../adapters/hub-uow";
import { cancelTimers } from "../application/timers/cancel-timers.usecase";
import { enqueueThread } from "../core/thread";
import { liveChildRuns } from "../nodes/registry.launch";
import type { Gx } from "./gates.effects";
import * as g from "./gates.repo";

export async function cancelChildren(
  gx: Gx,
  p: { tenantId: string; runId: string; depth?: number },
): Promise<UserEvent[]> {
  const depth = p.depth ?? 0;
  if (depth >= SUBPROCESS_DEPTH_MAX) return [];
  const { d, tx } = gx;
  const ids = await liveChildRuns(tx, p.tenantId, p.runId);
  const events: UserEvent[] = [];
  for (const id of ids) {
    const now = d.now();
    await g.cancelStageRuns(tx, id, p.tenantId);
    await g.cancelStages(tx, id, p.tenantId);
    await cancelTimers(bindTx(tx, p.tenantId).repos, id, { kind: "all" }, now);
    await g.closeOpenTasks(tx, {
      runId: id,
      tenantId: p.tenantId,
      result: "cancelled",
      exceptId: null,
      now,
    });
    await g.setRunStatus(tx, id, "cancelled", now);
    await enqueueThread(tx, {
      runId: id,
      roomId: "",
      kind: "run_end",
      process_run_id: id,
      status: "cancelled",
      actor: null,
    });
    events.push(...(await d.notifier.runFinished(tx, id)));
    events.push(
      ...(await cancelChildren(gx, { tenantId: p.tenantId, runId: id, depth: depth + 1 })),
    );
  }
  return events;
}
