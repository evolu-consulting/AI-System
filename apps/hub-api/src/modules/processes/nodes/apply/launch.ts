// CR-103 · R1 · node `apply` — chạy (P-c2 · PC2-R03): nhánh riêng (audit + applyPlan + job/không-job), KHÔNG tạo
// `hub.runs`/agent. Chốt kết quả: `runs/apply-driver.ts` (sweep), view: `runs/view-apply.ts`.
import { launchApplyStage } from "../../runs/apply-launch";
import type { NodeLauncher } from "../../runs/launch-common";

export const applyLauncher: NodeLauncher = {
  launch(d, tx, c) {
    return launchApplyStage(d, tx, {
      runId: c.runId,
      idx: c.idx,
      head: c.head,
      stage: { id: c.stage.id, attempt: Number(c.stage.attempt) },
      def: c.def,
    });
  },
};
