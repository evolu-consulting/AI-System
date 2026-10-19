// #226 · cổng của module `kh` cho module `processes` (CONVENTIONS §10): processes không import `kh.writes.repo`
// trực tiếp (depcruise `no-cross-module-repo`); hai thao tác hàng chờ ghi `## Tóm tắt` đi qua đây.
import type { Tx } from "@ai/db";
import { enqueueKhSummary as enqueue, writeStatesOfRun as statesOfRun } from "./kh.writes.repo";

/** D8: cuối nhánh `done` của `persistStage` (cùng tx) — xếp một hàng `pending` khi có đích và `## Tóm tắt`. */
export function enqueueKhSummary(
  tx: Tx,
  w: { tenantId: string; stageRunId: string },
): Promise<void> {
  return enqueue(tx, w);
}

/** `StageView.knowledge.summary`: trạng thái ghi theo `output_id` của run. */
export function writeStatesOfRun(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<Map<string, string>> {
  return statesOfRun(tx, runId, tenantId);
}
