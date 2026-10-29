// CR-103 · fnr-if · node `if` — chạy: Hub tự chốt stage `done` rồi join bước; việc đánh giá + nhảy bước do `settleStep`
// (`ifTarget`/`skippedStages`, cùng đường rẽ nhánh `after.branch`). Không tạo `hub.runs`/agent/output. Kick bước đích do
// `kickOnce` làm SAU COMMIT (kết quả `events`, như `wait_until`).
import { sql } from "drizzle-orm";
import { settleStepTx } from "../../adapters/runs/step.repo";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import type { NodeLauncher } from "../../runs/launch-common";

export const ifLauncher: NodeLauncher = {
  async launch(_d, tx, c) {
    if (c.def.executor.kind !== "if") return { kind: "skip" };
    const tenantId = c.u.tenantId;
    await tx.execute(sql`update hub.stage_runs set status = 'done', current_run_id = null,
        started_at = coalesce(started_at, now()), finished_at = now(), updated_at = now()
      where id = ${c.stage.id} and tenant_id = ${tenantId}`);
    const step = await settleStepTx(tx, c.runId, tenantId);
    if (!step) return { kind: "events", events: [] };
    const more = step.kind === "next_step"; // bước đích vừa `queued` ⇒ kickOnce lặp để chạy tiếp (không chờ hẹn như wait_until)
    const recipients = await core.runRecipients(tx, c.runId, tenantId);
    const run = { id: c.runId, status: step.status, stageIdx: step.stageIdx, step: step.step };
    return { kind: "events", events: processUpdated(recipients, run), more };
  },
};
